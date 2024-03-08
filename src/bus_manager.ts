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
  ManagerConfig,
  Serializable,
  TransportConfig,
  TransportMessage,
} from './types/main.js'

export class BusManager<KnownTransports extends Record<string, TransportConfig>> {
  readonly #defaultTransportName: keyof KnownTransports | undefined
  readonly #transports: KnownTransports

  #transportsCache: Partial<Record<keyof KnownTransports, Bus>> = {}

  constructor(config: ManagerConfig<KnownTransports>) {
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

    const driverConfig = this.#transports[transportToUse]

    debug('creating new transport instance for %s', transportToUse)
    const transportInstance = new Bus(driverConfig.driver(), {
      retryQueue: driverConfig.retryQueue,
    })
    this.#transportsCache[transportToUse] = transportInstance

    return transportInstance
  }

  async publish(channel: string, message: Omit<TransportMessage, 'busId'>) {
    return this.use().publish(channel, message)
  }

  subscribe<T extends Serializable>(
    channel: string,
    handler: (message: T) => Promise<void> | void
  ) {
    return this.use().subscribe(channel, handler)
  }

  unsubscribe(channel: string) {
    return this.use().unsubscribe(channel)
  }

  disconnect() {
    return this.use().disconnect()
  }
}
