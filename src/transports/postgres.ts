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
  #subscriber: Client
  readonly #encoder: TransportEncoder
  readonly #channelHandlers: Map<string, SubscribeHandler<any>> = new Map()
  #publisherConnected: boolean = false
  #subscriberConnected: boolean = false
  #gracefulDisconnect: boolean = false
  #config: PostgresTransportConfig
  #reconnectCallback: (() => void) | undefined

  #id: string | undefined

  constructor(config: PostgresTransportConfig, encoder?: TransportEncoder)
  constructor(config: string, encoder?: TransportEncoder)
  constructor(options: PostgresTransportConfig | string, encoder?: TransportEncoder) {
    this.#encoder = encoder ?? new JsonEncoder()

    if (typeof options === 'string') {
      this.#config = { connectionString: options }
    } else {
      this.#config = options
    }

    this.#publisher = new Client(this.#config)
    this.#subscriber = new Client(this.#config)
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
    this.#gracefulDisconnect = true
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

    this.#ensureNotificationListener()

    // Subscribe to the channel using LISTEN
    const escapedChannel = this.#subscriber.escapeIdentifier(channel)
    await this.#subscriber.query(`LISTEN ${escapedChannel}`)
  }

  #ensureNotificationListener() {
    // Set up the notification listener if not already set
    if (this.#subscriber.listenerCount('notification') > 0) {
      return
    }

    this.#subscriber.on('notification', (msg) => {
      if (msg.channel) {
        const channelHandler = this.#channelHandlers.get(msg.channel)
        if (channelHandler && msg.payload) {
          debug('received message for channel "%s"', msg.channel)

          try {
            const data = this.#encoder.decode<TransportMessage<any>>(msg.payload)

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

  onReconnect(callback: () => void): void {
    this.#reconnectCallback = callback
    this.#setupReconnectionListener()
  }

  #setupReconnectionListener() {
    this.#subscriber.on('error', (err) => {
      debug('subscriber error: %o', err)
    })

    this.#subscriber.on('end', () => {
      debug('subscriber connection ended')
      this.#subscriberConnected = false

      if (this.#gracefulDisconnect) {
        return
      }

      this.#attemptReconnection()
    })
  }

  #attemptReconnection(attempt = 0) {
    const baseDelay = 1000
    const maxDelay = 60000
    // Exponential backoff with jitter
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay) + Math.random() * 1000

    debug('attempting reconnection in %d ms (attempt %d)', delay, attempt)

    setTimeout(() => {
      if (this.#gracefulDisconnect) return

      const newClient = new Client(this.#config)

      newClient
        .connect()
        .then(() => {
          this.#subscriber = newClient
          this.#subscriberConnected = true
          debug('reconnected to postgres')

          this.#ensureNotificationListener()
          this.#setupReconnectionListener()

          if (this.#reconnectCallback) {
            this.#reconnectCallback()
          }

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
          this.#attemptReconnection(attempt + 1)
        })
    }, delay)
  }

  async unsubscribe(channel: string): Promise<void> {
    this.#channelHandlers.delete(channel)
    const escapedChannel = this.#subscriber.escapeIdentifier(channel)
    await this.#subscriber.query(`UNLISTEN ${escapedChannel}`)
  }
}
