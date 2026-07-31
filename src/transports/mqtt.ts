/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright BoringNode
 */

import { connect, type MqttClient } from 'mqtt'
import { assert } from '@poppinss/utils/assert'

import debug from '../debug.js'
import {
  type Transport,
  type TransportEncoder,
  type Serializable,
  type SubscribeHandler,
  MqttProtocol,
  type MqttTransportConfig,
} from '../types/main.js'
import { JsonEncoder } from '../encoders/json_encoder.js'
import { tryDecodeTransportMessage } from '../transport_message.js'

export function mqtt(config: MqttTransportConfig, encoder?: TransportEncoder) {
  return () => new MqttTransport(config, encoder)
}

export class MqttTransport implements Transport {
  #id: string | undefined
  #client: MqttClient
  #url: string
  readonly #encoder: TransportEncoder
  readonly #handlers = new Map<string, SubscribeHandler<any>[]>()

  constructor(config: MqttTransportConfig, encoder?: TransportEncoder) {
    this.#encoder = encoder ?? new JsonEncoder()
    this.#url = `${config.protocol || MqttProtocol.MQTT}://${config.host}${config.port ? `:${config.port}` : ''}`

    this.#client = connect(this.#url, config.options ?? {})
    this.#client.on('message', this.#onMessage)
  }

  setId(id: string): Transport {
    this.#id = id

    return this
  }

  async disconnect(): Promise<void> {
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

  onReconnect(): void {
    this.#client.reconnect()
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.#client.unsubscribeAsync(channel)
    this.#handlers.delete(channel)
  }

  #onMessage = (channel: string, message: Buffer | string) => {
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
