/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright Boring Node
 */

import { Redis } from 'ioredis'
import { assert } from '@poppinss/utils/assert'

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
  readonly #useMessageBuffer: boolean = false

  #id: string | undefined

  constructor(path: string, encoder?: TransportEncoder)
  constructor(options: RedisTransportConfig, encoder?: TransportEncoder)
  constructor(options: RedisTransportConfig | string, encoder?: TransportEncoder) {
    // @ts-expect-error - merged definitions of overloaded constructor is not public
    this.#publisher = new Redis(options)
    // @ts-expect-error - merged definitions of overloaded constructor is not public
    this.#subscriber = new Redis(options)
    this.#encoder = encoder ?? new JsonEncoder()

    if (typeof options === 'object') {
      this.#useMessageBuffer = options.useMessageBuffer ?? false
    }
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
    this.#subscriber.subscribe(channel, (err) => {
      if (err) {
        throw err
      }
    })

    const event = this.#useMessageBuffer ? 'messageBuffer' : 'message'
    this.#subscriber.on(event, (receivedChannel: Buffer | string, message: Buffer | string) => {
      receivedChannel = receivedChannel.toString()

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
