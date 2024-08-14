/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright Boring Node
 */

import { connect, MqttClient } from 'mqtt'
import { assert } from '@poppinss/utils/assert'

import debug from '../debug.js'
import {
  Transport,
  TransportEncoder,
  TransportMessage,
  Serializable,
  SubscribeHandler,
  MqttProtocol,
  MqttTransportConfig,
} from '../types/main.js'
import { JsonEncoder } from '../encoders/json_encoder.js'

export function mqtt(config: MqttTransportConfig, encoder?: TransportEncoder) {
  return () => new MqttTransport(config, encoder)
}

export class MqttTransport implements Transport {
  #id: string | undefined
  #client: MqttClient
  #url: string
  readonly #encoder: TransportEncoder

  constructor(config: MqttTransportConfig, encoder?: TransportEncoder) {
    this.#encoder = encoder ?? new JsonEncoder()
    this.#url = `${config.protocol || MqttProtocol.MQTT}://${config.host}${config.port ? `:${config.port}` : ''}`

    this.#client = connect(this.#url, config.options ?? {})
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
    this.#client.subscribe(channel, (err) => {
      if (err) {
        throw err
      }
    })

    this.#client.on('message', (receivedChannel: string, message: Buffer | string) => {
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

  onReconnect(): void {
    this.#client.reconnect()
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.#client.unsubscribeAsync(channel)
  }
}
