/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import { ChaosInjector } from './chaos_injector.js'
import type { BusDriver, BusMessage, Serializable, SubscribeHandler } from '../src/types/main.js'

export class ChaosBus implements BusDriver {
  /**
   * The inner bus driver that is wrapped
   */
  readonly #innerBus: BusDriver

  /**
   * Reference to the chaos injector
   */
  #chaosInjector: ChaosInjector

  constructor(innerBus: BusDriver) {
    this.#innerBus = innerBus
    this.#chaosInjector = new ChaosInjector()
  }

  setId(id: string) {
    this.#innerBus.setId(id)

    return this.#innerBus
  }

  getInnerBus<T extends BusDriver>(): T {
    return this.#innerBus as T
  }

  /**
   * Make the cache always throw an error
   */
  alwaysThrow() {
    this.#chaosInjector.alwaysThrow()
    return this
  }

  /**
   * Reset the cache to never throw an error
   */
  neverThrow() {
    this.#chaosInjector.neverThrow()
    return this
  }

  async publish(channel: string, message: Omit<BusMessage, 'busId'>) {
    await this.#chaosInjector.injectChaos()
    return this.#innerBus.publish(channel, message)
  }

  async subscribe<T extends Serializable>(channel: string, handler: SubscribeHandler<T>) {
    return this.#innerBus.subscribe(channel, handler)
  }

  unsubscribe(channel: string) {
    return this.#innerBus.unsubscribe(channel)
  }

  disconnect() {
    return this.#innerBus.disconnect()
  }
}
