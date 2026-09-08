/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright BoringNode
 */

import { Redis } from 'ioredis'
import type { Cluster } from 'ioredis'
import { assert } from '@poppinss/utils/assert'
import { InvalidArgumentsException } from '@poppinss/utils/exception'

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

/**
 * Detect an existing `ioredis` client by its shape rather than with `instanceof`.
 *
 * `instanceof` is evaluated against the copy of `ioredis` this package resolved.
 * When the host application resolves a different copy - a different major, or
 * simply a duplicated one in the dependency tree - the check returns `false` for
 * a perfectly valid client and we would fall through to `new Redis(client)`,
 * which silently connects to `127.0.0.1:6379`.
 *
 * `duplicate` and `sendCommand` are on the prototype of both `Redis` and
 * `Cluster` in every major, and neither name exists in `RedisOptions` or
 * `ClusterOptions`, so an options object can never be mistaken for a client.
 */
function isRedisClient(value: unknown): value is Redis | Cluster {
  if (typeof value !== 'object' || value === null) return false

  const candidate = value as Partial<Redis>

  return typeof candidate.duplicate === 'function' && typeof candidate.sendCommand === 'function'
}

/**
 * `Redis#duplicate` and `Cluster#duplicate` are both parameterless-callable at
 * runtime, but TypeScript cannot resolve the call against a `Redis | Cluster`
 * union: from ioredis 6 on, both signatures are generic over the reply mapping
 * and none of them is compatible with the other. Going through a narrow local
 * signature keeps the source compiling against ioredis 5 and 6 alike.
 */
function duplicateClient(client: Redis | Cluster): Redis | Cluster {
  return (client.duplicate as unknown as () => Redis | Cluster)()
}

/**
 * Values that look like a client - they carry a `status`, an `options` bag and
 * an `emit` method - but that we could not recognize as one. None of those
 * names are valid `ioredis` options, so a legitimate configuration object never
 * lands here. Rather than quietly building a connection to `127.0.0.1:6379`
 * out of it, we fail loudly.
 */
function looksLikeUnsupportedRedisClient(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.status === 'string' &&
    typeof candidate.options === 'object' &&
    candidate.options !== null &&
    typeof candidate.emit === 'function'
  )
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
    if (isRedisClient(options)) {
      this.#publisher = duplicateClient(options)
      this.#subscriber = duplicateClient(options)
      this.#useMessageBuffer = transportOptions?.useMessageBuffer ?? false
    } else {
      if (looksLikeUnsupportedRedisClient(options)) {
        throw new InvalidArgumentsException(
          'Cannot use the given Redis connection with "RedisTransport". Expected an "ioredis" ' +
            'client exposing "duplicate()" and "sendCommand()", or a connection options object.'
        )
      }

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
