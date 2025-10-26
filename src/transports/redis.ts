/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright BoringNode
 */

import { createClient, RedisClientOptions, RedisClientType } from 'redis'
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
  readonly #publisher: RedisClientType
  readonly #subscriber: RedisClientType
  readonly #encoder: TransportEncoder
  #id: string | undefined

  /**
   * Map to store subscribe handlers for each channel.
   * This is used to dispatch messages from the single central
   * Redis subscriber listener to all relevant application handlers.
   */
  readonly #channelHandlers = new Map<string, Set<SubscribeHandler<any>>>()

  constructor(options: RedisTransportConfig | string, encoder?: TransportEncoder) {
    let clientOptions: RedisClientOptions

    if (typeof options === 'string') {
      clientOptions = { url: options }
    } else {
      // Extract custom bus option and convert to RedisClientOptions
      const { useMessageBuffer, ...redisOptions } = options
      clientOptions = { ...redisOptions }

      if (useMessageBuffer) {
        // node-redis needs returnBuffers: true to get messages as buffers
        clientOptions.returnBuffers = true
      }
    }

    this.#publisher = createClient(clientOptions)
    this.#subscriber = createClient(clientOptions)
    this.#encoder = encoder ?? new JsonEncoder()

    // Central message listener for the subscriber client.
    this.#subscriber.on('message', this.#handleIncomingMessage.bind(this))

    // Handle errors for both publisher and subscriber clients
    this.#subscriber.on('error', (err) => {
      debug('Redis subscriber error: %O', err)
    })
    this.#publisher.on('error', (err) => {
      debug('Redis publisher error: %O', err)
    })
  }

  /**
   * Private method to handle all incoming messages from the subscriber client.
   * Dispatches the message to all registered handlers for the specific channel.
   */
  #handleIncomingMessage(channel: string | Buffer, message: string | Buffer) {
    // Ensure channel is a string for map lookup
    const channelString = channel.toString()
    debug('received raw message for channel "%s"', channelString)

    const handlers = this.#channelHandlers.get(channelString)
    if (!handlers) {
      debug('No handlers for channel "%s"', channelString)
      return
    }

    const data = this.#encoder.decode<TransportMessage<any>>(message)

    /**
     * Ignore messages published by this bus instance
     */
    if (data.busId === this.#id) {
      debug('ignoring message published by the same bus instance')
      return
    }

    for (const handler of handlers) {
      // @ts-expect-error - T is erased by Set<SubscribeHandler<any>>
      handler(data.payload)
    }
  }

  setId(id: string): Transport {
    this.#id = id
    return this
  }

  /**
   * Connects to Redis. This must be called explicitly after instantiation
   * as `node-redis` does not connect automatically.
   */
  async connect(): Promise<void> {
    await Promise.all([this.#publisher.connect(), this.#subscriber.connect()])
  }

  /**
   * Disconnects from Redis gracefully by quitting both publisher and subscriber clients.
   */
  async disconnect(): Promise<void> {
    await Promise.all([this.#publisher.quit(), this.#subscriber.quit()])
  }

  /**
   * Publishes a message to a given Redis channel.
   */
  async publish(channel: string, message: Serializable): Promise<void> {
    assert(this.#id, 'You must set an id before publishing a message')
    assert(this.#publisher.isReady, 'Redis publisher is not connected. Did you call .connect()?')

    const encoded = this.#encoder.encode({ payload: message, busId: this.#id })

    await this.#publisher.publish(channel, encoded)
  }

  /**
   * Subscribes to a Redis channel and registers a handler for incoming messages.
   */
  async subscribe<T extends Serializable>(
    channel: string,
    handler: SubscribeHandler<T>
  ): Promise<void> {
    assert(
      this.#subscriber.isReady,
      'Redis subscriber is not connected. Did you call .connect()?'
    )

    let handlers = this.#channelHandlers.get(channel)
    const isFirstHandlerForChannel = !handlers || handlers.size === 0

    if (!handlers) {
      handlers = new Set()
      this.#channelHandlers.set(channel, handlers)
    }
    handlers.add(handler)

    // Only subscribe to the Redis channel if this is the first handler
    if (isFirstHandlerForChannel) {
      await this.#subscriber.subscribe(channel)
      debug('Subscribed to Redis channel "%s"', channel)
    }
    debug('Added handler for channel "%s". Total handlers: %d', channel, handlers.size)
  }

  /**
   * Registers a callback to be invoked when the Redis subscriber client
   * is ready to process commands (i.e., successfully connected or reconnected).
   */
  onReconnect(callback: () => void): void {
    this.#subscriber.on('ready', callback)
  }

  /**
   * Unsubscribes from a Redis channel, removing all registered handlers
   * for that channel.
   */
  async unsubscribe(channel: string): Promise<void> {
    if (!this.#subscriber.isReady) {
      debug('Cannot unsubscribe from channel "%s", Redis subscriber is not connected.', channel)
      this.#channelHandlers.delete(channel)
      return
    }

    const handlers = this.#channelHandlers.get(channel)
    if (!handlers || handlers.size === 0) {
      debug('No handlers to unsubscribe for channel "%s"', channel)
      return
    }

    this.#channelHandlers.delete(channel)
    debug('Removed all handlers for channel "%s"', channel)

    // Unsubscribe from Redis as no more application-level handlers exist.
    await this.#subscriber.unsubscribe(channel)
    debug('Unsubscribed from Redis channel "%s"', channel)
  }
}