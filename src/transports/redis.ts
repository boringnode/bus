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
import type {
  Transport,
  TransportEncoder,
  Serializable,
  SubscribeHandler,
  RedisTransportConfig,
  RedisTransportOptions,
} from '../types/main.js'

type Handler = (message: Buffer | string) => void | Promise<void>

export function redis(config: RedisTransportConfig, encoder?: TransportEncoder) {
  return () => new RedisTransport(config, encoder)
}

export class RedisTransport implements Transport {
  readonly #publisher: Redis | Cluster
  readonly #subscriber: Redis | Cluster
  readonly #encoder: TransportEncoder
  readonly #useMessageBuffer: boolean = false
  readonly #handlers = new Map<string, Set<Handler>>()

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
      this.#setupSubscriber()
      return
    }

    // @ts-expect-error - merged definitions of overloaded constructor is not public
    this.#publisher = new Redis(options)
    // @ts-expect-error - merged definitions of overloaded constructor is not public
    this.#subscriber = new Redis(options)

    if (typeof options === 'object') {
      this.#useMessageBuffer = options.useMessageBuffer ?? false
    }
    this.#setupSubscriber()
  }

  #setupSubscriber = () => {
    const event = this.#useMessageBuffer ? 'messageBuffer' : 'message'
    this.#subscriber.on(event, this.#onMessage)
  }

  #onMessage = async (receivedChannel: Buffer | string, message: Buffer | string) => {
    const channel = receivedChannel.toString()
    const handlers = this.#handlers.get(channel)
    debug('received message for channel "%s"', channel)
    if (!handlers || handlers.size === 0) {
      debug('no handlers for channel "%s"', channel)
      return
    }
    for (const handler of handlers) {
      await handler(message)
    }
  }

  #makeHandler = <T extends Serializable>(handler: SubscribeHandler<T>) => {
    return async (message: Buffer | string) => {
      const data = this.#encoder.decode<T>(message)
      if (data.busId === this.#id) {
        debug('ignoring message published by the same bus instance')
        return
      }
      await handler(data.payload)
    }
  }

  setId(id: string): Transport {
    this.#id = id

    return this
  }

  async disconnect(): Promise<void> {
    await Promise.all([this.#publisher.quit(), this.#subscriber.quit()])
  }

  async publish(channel: string, message: Serializable): Promise<number> {
    assert(this.#id, 'You must set an id before publishing a message')

    const encoded = this.#encoder.encode({ payload: message, busId: this.#id })

    return await this.#publisher.publish(channel, encoded)
  }

  async subscribe<T extends Serializable>(
    channel: string,
    handler: SubscribeHandler<T>
  ): Promise<void> {
    let handlers = this.#handlers.get(channel)
    if (!handlers) {
      handlers = new Set()
      this.#handlers.set(channel, handlers)
      await this.#subscriber.subscribe(channel)
    }
    handlers.add(this.#makeHandler(handler))
  }

  onReconnect(callback: () => void): void {
    this.#subscriber.on('reconnecting', callback)
  }

  async unsubscribe(channel: string): Promise<void> {
    this.#handlers.delete(channel)
    await this.#subscriber.unsubscribe(channel)
  }
}
