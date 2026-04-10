/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright BoringNode
 */

import { createClient, createCluster } from 'redis'
import { assert } from '@poppinss/utils/assert'

import debug from '../debug.js'
import { JsonEncoder } from '../encoders/json_encoder.js'
import type {
  Transport,
  TransportEncoder,
  TransportMessage,
  Serializable,
  SubscribeHandler,
  NodeRedisTransportConfig,
  NodeRedisTransportConnection,
  NodeRedisTransportOptions,
  NodeRedisClusterTransportConfig,
} from '../types/main.js'

export function nodeRedis(config: NodeRedisTransportConfig | string, encoder?: TransportEncoder) {
  return () => new NodeRedisTransport(config, encoder)
}

function isNodeRedisConnection(value: unknown): value is NodeRedisTransportConnection {
  const candidate = value as NodeRedisTransportConnection

  return (
    typeof candidate?.duplicate === 'function' &&
    typeof candidate?.publish === 'function' &&
    typeof candidate?.subscribe === 'function'
  )
}

function isClusterConfig(
  value: NodeRedisTransportConfig
): value is NodeRedisClusterTransportConfig {
  const candidate = value as NodeRedisClusterTransportConfig
  return typeof candidate?.rootNodes !== 'undefined'
}

export class NodeRedisTransport implements Transport {
  readonly #publisher: NodeRedisTransportConnection
  readonly #subscriber: NodeRedisTransportConnection
  readonly #encoder: TransportEncoder
  readonly #useMessageBuffer: boolean = false

  #id: string | undefined
  #connected: boolean = false
  #connecting: Promise<void> | null = null

  constructor(options: NodeRedisTransportConfig | string, encoder?: TransportEncoder)
  constructor(
    connection: NodeRedisTransportConnection,
    encoder?: TransportEncoder,
    options?: NodeRedisTransportOptions
  )
  constructor(
    options: NodeRedisTransportConfig | string | NodeRedisTransportConnection,
    encoder?: TransportEncoder,
    transportOptions?: NodeRedisTransportOptions
  ) {
    this.#encoder = encoder ?? new JsonEncoder()

    if (isNodeRedisConnection(options)) {
      this.#publisher = options.duplicate()
      this.#subscriber = options.duplicate()
      this.#useMessageBuffer = transportOptions?.useMessageBuffer ?? false
      this.#bindErrorHandlers()
      return
    }

    if (typeof options === 'string') {
      this.#publisher = createClient({ url: options })
      this.#subscriber = createClient({ url: options })
      this.#bindErrorHandlers()
      return
    }

    this.#useMessageBuffer = options.useMessageBuffer ?? false

    if (isClusterConfig(options)) {
      const { useMessageBuffer, ...clusterOptions } = options
      this.#publisher = createCluster(clusterOptions) as unknown as NodeRedisTransportConnection
      this.#subscriber = createCluster(clusterOptions) as unknown as NodeRedisTransportConnection
      this.#bindErrorHandlers()
      return
    }

    const { useMessageBuffer, ...clientOptions } = options
    this.#publisher = createClient(clientOptions) as unknown as NodeRedisTransportConnection
    this.#subscriber = createClient(clientOptions) as unknown as NodeRedisTransportConnection
    this.#bindErrorHandlers()
  }

  setId(id: string): Transport {
    this.#id = id

    return this
  }

  async disconnect(): Promise<void> {
    await Promise.all([
      this.#publisher.isOpen ? this.#publisher.close() : Promise.resolve(),
      this.#subscriber.isOpen ? this.#subscriber.close() : Promise.resolve(),
    ])

    this.#connected = false
    this.#connecting = null
  }

  async publish(channel: string, message: Serializable): Promise<void> {
    assert(this.#id, 'You must set an id before publishing a message')
    await this.#ensureConnected()

    const encoded = this.#encoder.encode({ payload: message, busId: this.#id })

    await this.#publisher.publish(channel, encoded)
  }

  async subscribe<T extends Serializable>(
    channel: string,
    handler: SubscribeHandler<T>
  ): Promise<void> {
    await this.#ensureConnected()

    await this.#subscriber.subscribe(
      channel,
      (message: string | Buffer) => {
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
      },
      this.#useMessageBuffer
    )
  }

  onReconnect(callback: () => void): void {
    this.#subscriber.on('reconnecting', callback)
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.#ensureConnected()
    await this.#subscriber.unsubscribe(channel)
  }

  async #ensureConnected() {
    if (this.#connected) {
      return
    }

    if (this.#connecting) {
      await this.#connecting
      return
    }

    this.#connecting = Promise.all([
      this.#publisher.isOpen ? Promise.resolve() : this.#publisher.connect(),
      this.#subscriber.isOpen ? Promise.resolve() : this.#subscriber.connect(),
    ]).then(() => undefined)

    try {
      await this.#connecting
      this.#connected = true
    } finally {
      this.#connecting = null
    }
  }

  #bindErrorHandlers() {
    this.#publisher.on('error', (error) => {
      debug('node-redis publisher error: %O', error)
    })

    this.#subscriber.on('error', (error) => {
      debug('node-redis subscriber error: %O', error)
    })
  }
}
