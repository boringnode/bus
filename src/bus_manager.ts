/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import { RuntimeException } from '@poppinss/utils'
import { Bus } from './bus.js'
import debug from './debug.js'
import type {
  Serializable,
  SubscribeHandler,
  TransportFactory,
  TransportMessage,
} from './types/main.js'

export class BusManager<KnownTransports extends Record<string, TransportFactory>> {
  readonly #defaultTransportName: keyof KnownTransports
  readonly #transports: KnownTransports

  #transportsCache: Partial<Record<keyof KnownTransports, Bus>> = {}

  constructor(config: { default: keyof KnownTransports; transports: KnownTransports }) {
    debug('creating bus manager. config: %O', config)

    this.#transports = config.transports
    this.#defaultTransportName = config.default
  }

  use<KnownTransport extends keyof KnownTransports>(transports?: KnownTransport): Bus {
    let transportToUse: keyof KnownTransports | undefined = transports || this.#defaultTransportName
    if (!transportToUse) {
      throw new RuntimeException(
        'Cannot create bus instance. No default transport is defined in the config'
      )
    }

    const cachedTransport = this.#transportsCache[transportToUse]
    if (cachedTransport) {
      debug('returning cached transport instance for %s', transportToUse)
      return cachedTransport
    }

    const driverFactory = this.#transports[transportToUse]

    debug('creating new transport instance for %s', transportToUse)
    const transportInstance = new Bus(driverFactory())
    this.#transportsCache[transportToUse] = transportInstance

    return transportInstance
  }

  async publish(channel: string, message: Omit<TransportMessage, 'busId'>) {
    return this.use().publish(channel, message)
  }

  subscribe<T extends Serializable>(channel: string, handler: SubscribeHandler<T>) {
    return this.use().subscribe(channel, handler)
  }

  unsubscribe(channel: string) {
    return this.use().unsubscribe(channel)
  }

  disconnect() {
    return this.use().disconnect()
  }
}
