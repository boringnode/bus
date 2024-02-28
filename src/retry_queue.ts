/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import { RetryQueueWithDuplicates } from './retry_queue_with_duplicates.js'
import { RetryQueueWithoutDuplicates } from './retry_queue_without_duplicates.js'
import type { TransportMessage, RetryQueueOptions } from './types/main.js'

export class RetryQueue {
  #queue: RetryQueueWithDuplicates | RetryQueueWithoutDuplicates

  constructor(params: RetryQueueOptions = {}) {
    const { enabled = true, maxSize = null, removeDuplicates = true } = params

    if (removeDuplicates) {
      this.#queue = new RetryQueueWithoutDuplicates({ enabled, maxSize })
      return
    }

    this.#queue = new RetryQueueWithDuplicates({ enabled, maxSize })
  }

  getInternalQueue() {
    return this.#queue
  }

  size() {
    return this.#queue.size
  }

  async process(handler: (channel: string, message: TransportMessage) => Promise<boolean>) {
    return this.#queue.process(handler)
  }

  enqueue(channel: string, message: TransportMessage) {
    return this.#queue.enqueue(channel, message)
  }

  dequeue() {
    this.#queue.dequeue()
  }
}
