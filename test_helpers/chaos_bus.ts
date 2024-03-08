/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import { ChaosInjector } from './chaos_injector.js'
import type { Transport, Serializable, SubscribeHandler } from '../src/types/main.js'

export class ChaosBus implements Transport {
  /**
   * The inner bus driver that is wrapped
   */
  readonly #innerBus: Transport

  /**
   * Reference to the chaos injector
   */
  #chaosInjector: ChaosInjector

  constructor(innerBus: Transport) {
    this.#innerBus = innerBus
    this.#chaosInjector = new ChaosInjector()
  }

  setId(id: string) {
    this.#innerBus.setId(id)

    return this.#innerBus
  }

  getInnerBus<T extends Transport>(): T {
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

  async publish(channel: string, message: Serializable) {
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

  onReconnect(_callback: () => void): void {}
}
