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
import type {
  Transport,
  TransportEncoder,
  Serializable,
  SubscribeHandler,
  RedisTransportConfig,
  RedisTransportOptions,
} from '../types/main.js'

export function redis(config: RedisTransportConfig, encoder?: TransportEncoder) {
  return () => new RedisTransport(config, encoder)
}

export class RedisTransport implements Transport {
  readonly #publisher: Redis | Cluster
  readonly #subscriber: Redis | Cluster
  readonly #encoder: TransportEncoder
  readonly #useMessageBuffer: boolean = false
  readonly #handlers = new Map<string, SubscribeHandler<any>[]>()

  #id: string | undefined

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
      this.#publisher = options.duplicate()
      this.#subscriber = options.duplicate()
      this.#useMessageBuffer = transportOptions?.useMessageBuffer ?? false
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
  }

  setId(id: string): Transport {
    this.#id = id

    return this
  }

  async disconnect(): Promise<void> {
    await Promise.all([this.#publisher.quit(), this.#subscriber.quit()])
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

  onReconnect(callback: () => void): void {
    this.#subscriber.on('reconnecting', callback)
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.#subscriber.unsubscribe(channel)
    this.#handlers.delete(channel)
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
