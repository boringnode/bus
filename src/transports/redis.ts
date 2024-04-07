/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright Boring Node
 */

import { assert } from '@poppinss/utils/assert'
import { Redis, type RedisOptions } from 'ioredis'
import debug from '../debug.js'
import { JsonEncoder } from '../encoders/json_encoder.js'
import type {
  Transport,
  TransportEncoder,
  TransportMessage,
  Serializable,
  SubscribeHandler,
  RedisTransportConfig,
} from '../types/main.js'

export function redis(config: RedisTransportConfig, encoder?: TransportEncoder) {
  return () => new RedisTransport(config, encoder)
}

export class RedisTransport implements Transport {
  readonly #publisher: Redis
  readonly #subscriber: Redis
  readonly #encoder: TransportEncoder

  #id: string | undefined

  constructor(path: string, encoder?: TransportEncoder)
  constructor(options: RedisOptions, encoder?: TransportEncoder)
  constructor(options: RedisOptions | string, encoder?: TransportEncoder)
  constructor(options: RedisOptions | string, encoder?: TransportEncoder) {
    // @ts-expect-error - merged definitions of overloaded constructor is not public
    this.#publisher = new Redis(options)
    // @ts-expect-error - merged definitions of overloaded constructor is not public
    this.#subscriber = new Redis(options)
    this.#encoder = encoder ?? new JsonEncoder()
  }

  setId(id: string): Transport {
    this.#id = id

    return this
  }

  async disconnect(): Promise<void> {
    this.#publisher.disconnect()
    this.#subscriber.disconnect()
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
    this.#subscriber.subscribe(channel, (err) => {
      if (err) {
        throw err
      }
    })

    this.#subscriber.on('message', (receivedChannel, message) => {
      if (channel !== receivedChannel) return

      debug('received message for channel "%s"', channel)

      const data = this.#encoder.decode<TransportMessage<T>>(message)

      /**
       * Ignore messages published by this bus instance
       */
      if (data.busId === this.#id) {
        debug('ignoring message published by the same bus instance')
        return
      }

      // @ts-expect-error - TODO: Weird typing issue
      handler(data.payload)
    })
  }

  onReconnect(callback: () => void): void {
    this.#subscriber.on('reconnecting', callback)
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.#subscriber.unsubscribe(channel)
  }
}
