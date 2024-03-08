/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import { createId } from '@paralleldrive/cuid2'
import { RetryQueue } from './retry_queue.js'
import debug from './debug.js'
import type { RetryQueueOptions, Serializable, SubscribeHandler, Transport } from './types/main.js'

export class Bus {
  readonly #driver: Transport
  readonly #busId: string
  readonly #errorRetryQueue: RetryQueue

  constructor(driver: Transport, options: { retryQueue?: RetryQueueOptions }) {
    this.#driver = driver
    this.#busId = createId()
    this.#errorRetryQueue = new RetryQueue(options.retryQueue)

    driver.setId(this.#busId).onReconnect(() => this.#onReconnect())
  }

  getRetryQueue() {
    return this.#errorRetryQueue
  }

  #processErrorRetryQueue() {
    debug(`start error retry queue processing with ${this.#errorRetryQueue.size()} messages`)

    return this.#errorRetryQueue.process(async (channel, message) => {
      await this.publish(channel, message.payload)
      return true
    })
  }

  async #onReconnect() {
    debug(`bus driver ${this.#driver.constructor.name} reconnected`)

    await this.#processErrorRetryQueue()
  }

  subscribe<T extends Serializable>(channel: string, handler: SubscribeHandler<T>) {
    debug(`subscribing to channel ${channel}`)

    return this.#driver.subscribe(channel, async (message) => {
      await this.#processErrorRetryQueue()

      debug('received message %j from bus', message)
      // @ts-expect-error - TODO: Weird typing issue
      handler(message)
    })
  }

  async publish(channel: string, message: Serializable) {
    try {
      debug('publishing message %j to bus', message)

      await this.#driver.publish(channel, message)

      return true
    } catch (error) {
      debug('error publishing message %j to bus. Retrying later', message)

      const wasAdded = this.#errorRetryQueue.enqueue(channel, {
        payload: message,
        busId: this.#busId,
      })
      if (!wasAdded) return false

      debug(`added message %j to error retry queue`, message)
      return false
    }
  }

  disconnect() {
    return this.#driver.disconnect()
  }

  unsubscribe(channel: string) {
    return this.#driver.unsubscribe(channel)
  }
}
