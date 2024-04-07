/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright Boring Node
 */

import { RuntimeException } from '@poppinss/utils'
import { Bus } from './bus.js'
import debug from './debug.js'
import type {
  ManagerConfig,
  Serializable,
  SubscribeHandler,
  TransportConfig,
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

    const transportConfig = this.#transports[transportToUse]

    debug('creating new transport instance for %s', transportToUse)
    const transportInstance = new Bus(transportConfig.transport(), {
      retryQueue: transportConfig.retryQueue,
    })
    this.#transportsCache[transportToUse] = transportInstance

    return transportInstance
  }

  async publish(channel: string, message: Serializable) {
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
