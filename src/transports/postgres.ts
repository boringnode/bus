/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright BoringNode
 */

import { Client } from 'pg'
import { assert } from '@poppinss/utils/assert'

import debug from '../debug.js'
import { JsonEncoder } from '../encoders/json_encoder.js'
import type {
  Transport,
  TransportEncoder,
  TransportMessage,
  Serializable,
  SubscribeHandler,
  PostgresTransportConfig,
} from '../types/main.js'

export function postgres(config: PostgresTransportConfig, encoder?: TransportEncoder) {
  return () => new PostgresTransport(config, encoder)
}

export class PostgresTransport implements Transport {
  readonly #publisher: Client
  readonly #subscriber: Client
  readonly #encoder: TransportEncoder
  readonly #channelHandlers: Map<string, SubscribeHandler<any>> = new Map()
  #publisherConnected: boolean = false
  #subscriberConnected: boolean = false

  #id: string | undefined

  constructor(config: PostgresTransportConfig, encoder?: TransportEncoder)
  constructor(config: string, encoder?: TransportEncoder)
  constructor(options: PostgresTransportConfig | string, encoder?: TransportEncoder) {
    this.#encoder = encoder ?? new JsonEncoder()

    /**
     * If a connection string is passed, use it for both publisher and subscriber
     */
    if (typeof options === 'string') {
      this.#publisher = new Client({ connectionString: options })
      this.#subscriber = new Client({ connectionString: options })
      return
    }

    /**
     * If a config object is passed, create both publisher and subscriber
     */
    this.#publisher = new Client(options)
    this.#subscriber = new Client(options)
  }

  setId(id: string): Transport {
    this.#id = id

    return this
  }

  async #ensureConnected(): Promise<void> {
    if (!this.#publisherConnected) {
      await this.#publisher.connect()
      this.#publisherConnected = true
    }
    if (!this.#subscriberConnected) {
      await this.#subscriber.connect()
      this.#subscriberConnected = true
    }
  }

  async disconnect(): Promise<void> {
    this.#publisherConnected = false
    this.#subscriberConnected = false

    const promises: Promise<void>[] = []

    try {
      promises.push(this.#publisher.end())
    } catch (err) {
      // Ignore errors during disconnect
    }

    try {
      promises.push(this.#subscriber.end())
    } catch (err) {
      // Ignore errors during disconnect
    }

    await Promise.allSettled(promises)
  }

  async publish(channel: string, message: Serializable): Promise<void> {
    assert(this.#id, 'You must set an id before publishing a message')

    await this.#ensureConnected()

    const encoded = this.#encoder.encode({ payload: message, busId: this.#id })
    const payloadString = typeof encoded === 'string' ? encoded : encoded.toString('base64')

    // Use pg's built-in escaping methods to safely escape the identifiers and literals
    const escapedChannel = this.#publisher.escapeIdentifier(channel)
    const escapedPayload = this.#publisher.escapeLiteral(payloadString)

    // Use NOTIFY to send the message
    await this.#publisher.query(`NOTIFY ${escapedChannel}, ${escapedPayload}`)
  }

  async subscribe<T extends Serializable>(
    channel: string,
    handler: SubscribeHandler<T>
  ): Promise<void> {
    await this.#ensureConnected()

    // Store the handler for this channel
    this.#channelHandlers.set(channel, handler)

    // Set up the notification listener if not already set
    if (this.#subscriber.listenerCount('notification') === 0) {
      this.#subscriber.on('notification', (msg) => {
        if (msg.channel) {
          const channelHandler = this.#channelHandlers.get(msg.channel)
          if (channelHandler && msg.payload) {
            debug('received message for channel "%s"', msg.channel)

            try {
              const data = this.#encoder.decode<TransportMessage<T>>(msg.payload)

              /**
               * Ignore messages published by this bus instance
               */
              if (data.busId === this.#id) {
                debug('ignoring message published by the same bus instance')
                return
              }

              channelHandler(data.payload)
            } catch (error) {
              debug('error decoding message: %o', error)
            }
          }
        }
      })
    }

    // Subscribe to the channel using LISTEN
    const escapedChannel = this.#subscriber.escapeIdentifier(channel)
    await this.#subscriber.query(`LISTEN ${escapedChannel}`)
  }

  onReconnect(callback: () => void): void {
    // PostgreSQL client doesn't have built-in reconnection events
    // We'll listen to connection errors and trigger callback on reconnect
    this.#subscriber.on('error', (err) => {
      debug('subscriber error: %o', err)
    })

    this.#subscriber.on('end', () => {
      debug('subscriber connection ended')
      this.#subscriberConnected = false
      // Attempt to reconnect
      this.#subscriber
        .connect()
        .then(() => {
          this.#subscriberConnected = true
          callback()
          // Re-subscribe to all channels
          for (const channel of this.#channelHandlers.keys()) {
            const escapedChannel = this.#subscriber.escapeIdentifier(channel)
            this.#subscriber.query(`LISTEN ${escapedChannel}`).catch((err) => {
              debug('error re-subscribing to channel %s: %o', channel, err)
            })
          }
        })
        .catch((err) => {
          debug('error reconnecting: %o', err)
        })
    })
  }

  async unsubscribe(channel: string): Promise<void> {
    this.#channelHandlers.delete(channel)
    const escapedChannel = this.#subscriber.escapeIdentifier(channel)
    await this.#subscriber.query(`UNLISTEN ${escapedChannel}`)
  }
}
