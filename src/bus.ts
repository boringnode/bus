/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import string from '@poppinss/utils/string'
import { createId } from '@paralleldrive/cuid2'
import { RetryQueue } from './retry_queue.js'
import debug from './debug.js'
import type { RetryQueueOptions, Serializable, SubscribeHandler, Transport } from './types/main.js'

export class Bus {
  readonly #transport: Transport
  readonly #busId: string
  readonly #errorRetryQueue: RetryQueue
  readonly #retryQueueInterval: NodeJS.Timeout | undefined

  constructor(transport: Transport, options?: { retryQueue?: RetryQueueOptions }) {
    this.#transport = transport
    this.#busId = createId()
    this.#errorRetryQueue = new RetryQueue(options?.retryQueue)

    if (options?.retryQueue?.retryInterval) {
      const intervalValue =
        typeof options?.retryQueue?.retryInterval === 'number'
          ? options?.retryQueue?.retryInterval
          : string.milliseconds.parse(options?.retryQueue?.retryInterval)

      this.#retryQueueInterval = setInterval(() => {
        void this.processErrorRetryQueue()
      }, intervalValue)
    }

    transport.setId(this.#busId).onReconnect(() => this.#onReconnect())
  }

  getRetryQueue() {
    return this.#errorRetryQueue
  }

  processErrorRetryQueue() {
    debug(`start error retry queue processing with ${this.#errorRetryQueue.size()} messages`)

    return this.#errorRetryQueue.process(async (channel, message) => {
      await this.publish(channel, message.payload)
      return true
    })
  }

  async #onReconnect() {
    debug(`bus transport ${this.#transport.constructor.name} reconnected`)

    await this.processErrorRetryQueue()
  }

  subscribe<T extends Serializable>(channel: string, handler: SubscribeHandler<T>) {
    debug(`subscribing to channel ${channel}`)

    return this.#transport.subscribe(channel, async (message) => {
      debug('received message %j from bus', message)
      // @ts-expect-error - TODO: Weird typing issue
      handler(message)
    })
  }

  async publish(channel: string, message: Serializable) {
    try {
      debug('publishing message "%j" to channel "%s"', message, channel)

      await this.#transport.publish(channel, message)

      return true
    } catch (error) {
      debug('error publishing message "%j" to channel "%s". Retrying later', message, channel)

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
    if (this.#retryQueueInterval) {
      clearInterval(this.#retryQueueInterval)
    }

    return this.#transport.disconnect()
  }

  unsubscribe(channel: string) {
    return this.#transport.unsubscribe(channel)
  }
}
