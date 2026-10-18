/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright BoringNode
 */

import { Redis, Cluster } from 'ioredis'
import { assert } from '@poppinss/utils/assert'

import debug from '../debug.js'
import { JsonEncoder } from '../encoders/json_encoder.js'
import { tryDecodeTransportMessage } from '../transport_message.js'
import type { Transport, TransportEncoder, Serializable, SubscribeHandler } from '../types/core.js'
import type { RedisTransportConfig, RedisTransportOptions } from '../types/redis.js'

export function redis(config: RedisTransportConfig, encoder?: TransportEncoder) {
  return () => new RedisTransport(config, encoder)
}

/**
 * Since ioredis 6, `Redis` and `Cluster` have incompatible `duplicate`
 * signatures, so the union must be narrowed before calling it
 */
function duplicate(connection: Redis | Cluster): Redis | Cluster {
  return connection instanceof Cluster ? connection.duplicate() : connection.duplicate()
}

/**
 * `quit` waits for pending replies but needs a writable connection. With
 * `enableOfflineQueue: false`, it rejects while the connection is down and
 * leaves it reconnecting forever, so we drop it instead
 */
async function close(connection: Redis | Cluster): Promise<void> {
  if (connection.status === 'ready') {
    await connection.quit()
    return
  }

  connection.disconnect()
}

export class RedisTransport implements Transport {
  readonly #publisher: Redis | Cluster
  readonly #subscriber: Redis | Cluster
  readonly #encoder: TransportEncoder
  readonly #useMessageBuffer: boolean = false
  readonly #handlers = new Map<string, SubscribeHandler<any>[]>()

  readonly #reconnectCallbacks: Array<() => void> = []

  #id: string | undefined

  /**
   * Without an error listener, ioredis prints every connection error
   * to stderr
   */
  readonly #onConnectionError: (error: Error) => void = (error) => {
    debug('redis connection error: %O', error)
  }

  constructor(path: string, encoder?: TransportEncoder)
  constructor(options: RedisTransportConfig, encoder?: TransportEncoder)
  constructor(
    connection: Redis | Cluster,
    encoder?: TransportEncoder,
    options?: RedisTransportOptions
  )
  constructor(
    options: RedisTransportConfig | string | Redis | Cluster,
    encoder?: TransportEncoder,
    transportOptions?: RedisTransportOptions
  ) {
    this.#encoder = encoder ?? new JsonEncoder()

    /**
     * If an existing Redis or Cluster instance is passed, we duplicate it
     * to have separate connections for publisher and subscriber
     */
    if (options instanceof Redis || options instanceof Cluster) {
      this.#publisher = duplicate(options)
      this.#subscriber = duplicate(options)
      this.#useMessageBuffer = transportOptions?.useMessageBuffer ?? false
      this.#onConnectionError = (error) => {
        debug('redis connection error: %O', error)

        /**
         * Users listening for errors on their instance expect to see the
         * errors of the connections duplicated from it too
         */
        if (options.listenerCount('error') > 0) options.emit('error', error)
      }
    } else {
      // @ts-expect-error - merged definitions of overloaded constructor is not public
      this.#publisher = new Redis(options)
      // @ts-expect-error - merged definitions of overloaded constructor is not public
      this.#subscriber = new Redis(options)

      if (typeof options === 'object') {
        this.#useMessageBuffer = options.useMessageBuffer ?? false
      }
    }

    const event = this.#useMessageBuffer ? 'messageBuffer' : 'message'
    this.#subscriber.on(event, this.#onMessage)
    this.#publisher.on('error', this.#onConnectionError)
    this.#subscriber.on('error', this.#onConnectionError)
    this.#publisher.on('ready', this.#onPublisherReady)
  }

  setId(id: string): Transport {
    this.#id = id

    return this
  }

  async disconnect(): Promise<void> {
    this.#publisher.off('ready', this.#onPublisherReady)
    await Promise.all([close(this.#publisher), close(this.#subscriber)])
  }

  async publish(channel: string, message: Serializable): Promise<void> {
    assert(this.#id, 'You must set an id before publishing a message')

    const encoded = this.#encoder.encode({ payload: message, busId: this.#id })

    await this.#publisher.publish(channel, encoded)
  }

  async subscribe<T extends Serializable>(
    channel: string,
    handler: SubscribeHandler<T>
  ): Promise<void> {
    const handlers = this.#handlers.get(channel) ?? []
    handlers.push(handler)
    this.#handlers.set(channel, handlers)

    try {
      await this.#subscriber.subscribe(channel)
    } catch (error) {
      handlers.splice(handlers.indexOf(handler), 1)
      if (handlers.length === 0) {
        this.#handlers.delete(channel)
      }
      throw error
    }
  }

  /**
   * Calls the callback every time the publisher becomes usable, so
   * messages queued while Redis was unreachable can be published. This
   * includes the first connection, for messages published before it.
   */
  onReconnect(callback: () => void): void {
    this.#reconnectCallbacks.push(callback)
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.#subscriber.unsubscribe(channel)
    this.#handlers.delete(channel)
  }

  /**
   * Works for both Redis and Cluster connections
   */
  #onPublisherReady = () => {
    debug('redis publisher is ready')
    for (const callback of this.#reconnectCallbacks) callback()
  }

  #onMessage = (receivedChannel: Buffer | string, message: Buffer | string) => {
    const channel = receivedChannel.toString()
    const handlers = this.#handlers.get(channel)

    if (!handlers) return

    debug('received message for channel "%s"', channel)

    const data = tryDecodeTransportMessage(this.#encoder, message)

    if (!data) {
      debug('ignoring invalid message for channel "%s"', channel)
      return
    }

    /**
     * Ignore messages published by this bus instance
     */
    if (data.busId === this.#id) {
      debug('ignoring message published by the same bus instance')
      return
    }

    for (const handler of handlers) {
      handler(data.payload)
    }
  }
}
