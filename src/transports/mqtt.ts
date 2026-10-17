/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright BoringNode
 */

import { connect, type MqttClient } from 'mqtt'
import { assert } from '@poppinss/utils/assert'

import debug from '../debug.js'
import type { Transport, TransportEncoder, Serializable, SubscribeHandler } from '../types/core.js'
import { MqttProtocol, type MqttTransportConfig } from '../types/mqtt.js'
import { JsonEncoder } from '../encoders/json_encoder.js'
import { tryDecodeTransportMessage } from '../transport_message.js'

/**
 * Tells if a topic matches an MQTT topic filter, with `+` matching one
 * level and `#` the remaining levels.
 *
 * matchesFilter('a/+', 'a/b')   // true
 * matchesFilter('a/#', 'a')     // true
 * matchesFilter('+/b', '$SYS/b') // false, wildcards skip `$` topics
 */
function matchesFilter(filter: string, topic: string) {
  const filterLevels = filter.split('/')
  const topicLevels = topic.split('/')

  if (topic.startsWith('$') && ['+', '#'].includes(filterLevels[0]!)) return false

  for (const [index, level] of filterLevels.entries()) {
    if (level === '#') return true
    if (index >= topicLevels.length) return false
    if (level !== '+' && level !== topicLevels[index]) return false
  }

  return filterLevels.length === topicLevels.length
}

export function mqtt(config: MqttTransportConfig, encoder?: TransportEncoder) {
  return () => new MqttTransport(config, encoder)
}

export class MqttTransport implements Transport {
  #id: string | undefined
  #client: MqttClient
  #url: string
  readonly #encoder: TransportEncoder
  readonly #handlers = new Map<string, SubscribeHandler<any>[]>()
  readonly #reconnectCallbacks: Array<() => void> = []
  #hasConnected = false

  constructor(config: MqttTransportConfig, encoder?: TransportEncoder) {
    this.#encoder = encoder ?? new JsonEncoder()
    this.#url = `${config.protocol || MqttProtocol.MQTT}://${config.host}${config.port ? `:${config.port}` : ''}`

    this.#client = connect(this.#url, config.options ?? {})
    this.#client.on('message', this.#onMessage)
    this.#client.on('connect', this.#onConnect)
  }

  setId(id: string): Transport {
    this.#id = id

    return this
  }

  async disconnect(): Promise<void> {
    this.#client.off('connect', this.#onConnect)
    await this.#client.endAsync()
  }

  async publish(channel: string, message: any): Promise<void> {
    assert(this.#id, 'You must set an id before publishing a message')

    const encoded = this.#encoder.encode({ payload: message, busId: this.#id })

    await this.#client.publishAsync(channel, encoded)
  }

  async subscribe<T extends Serializable>(
    channel: string,
    handler: SubscribeHandler<T>
  ): Promise<void> {
    const handlers = this.#handlers.get(channel) ?? []
    handlers.push(handler)
    this.#handlers.set(channel, handlers)

    try {
      await this.#client.subscribeAsync(channel)
    } catch (error) {
      handlers.splice(handlers.indexOf(handler), 1)
      if (handlers.length === 0) {
        this.#handlers.delete(channel)
      }
      throw error
    }
  }

  /**
   * Calls the callback every time the client connects again after losing
   * its connection. mqtt.js reconnects on its own.
   */
  onReconnect(callback: () => void): void {
    this.#reconnectCallbacks.push(callback)
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.#client.unsubscribeAsync(channel)
    this.#handlers.delete(channel)
  }

  /**
   * `connect` is emitted for the first connection too, which is not a
   * reconnection
   */
  #onConnect = () => {
    if (!this.#hasConnected) {
      this.#hasConnected = true
      return
    }

    debug('mqtt client reconnected')
    for (const callback of this.#reconnectCallbacks) callback()
  }

  /**
   * Some brokers send one copy of a message per matching subscription,
   * so the handlers of overlapping filters run once per copy.
   */
  #onMessage = (channel: string, message: Buffer | string) => {
    const handlers = [...this.#handlers].flatMap(([filter, filterHandlers]) =>
      matchesFilter(filter, channel) ? filterHandlers : []
    )

    if (handlers.length === 0) return

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
