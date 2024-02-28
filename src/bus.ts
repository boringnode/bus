/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import { createId } from '@paralleldrive/cuid2'
import { RetryQueue } from './retry_queue.js'
import debug from './debug.js'
import type { RetryQueueOptions, Transport, TransportMessage } from './types/main.js'

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
      await this.publish(channel, message)
      return true
    })
  }

  async #onReconnect() {
    debug(`bus driver ${this.#driver.constructor.name} reconnected`)

    await this.#processErrorRetryQueue()
  }

  async subscribe(channel: string, handler: (message: any) => void) {
    debug(`subscribing to channel ${channel}`)

    this.#driver.subscribe(channel, async (message) => {
      await this.#processErrorRetryQueue()

      debug(`received message ${message.payload} from bus`)
      handler(message)
    })
  }

  async publish(channel: string, message: Omit<TransportMessage, 'busId'>) {
    const composedMessage = { ...message, busId: this.#busId }

    try {
      debug(`publishing message ${composedMessage.payload} to bus`)

      await this.#driver.publish(channel, composedMessage)

      return true
    } catch (error) {
      debug(`error publishing message ${composedMessage.payload} to bus. Retrying later`)

      const wasAdded = this.#errorRetryQueue.enqueue(channel, composedMessage)
      if (!wasAdded) return false

      debug(`added message ${composedMessage.payload} to error retry queue`)
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
