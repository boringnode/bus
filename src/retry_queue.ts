/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright BoringNode
 */

import { RetryQueueWithDuplicates } from './retry_queue_with_duplicates.js'
import { RetryQueueWithoutDuplicates } from './retry_queue_without_duplicates.js'
import type { TransportMessage, RetryQueueOptions } from './types/main.js'

export class RetryQueue {
  readonly #options: RetryQueueOptions
  readonly #queue: RetryQueueWithDuplicates | RetryQueueWithoutDuplicates
  #processing: Promise<void> | undefined

  constructor(params: RetryQueueOptions = {}) {
    const { enabled = true, maxSize = null, removeDuplicates = true } = params

    this.#options = { enabled, maxSize, removeDuplicates }

    if (removeDuplicates) {
      this.#queue = new RetryQueueWithoutDuplicates({ enabled, maxSize })
      return
    }

    this.#queue = new RetryQueueWithDuplicates({ enabled, maxSize })
  }

  getOptions() {
    return this.#options
  }

  getInternalQueue() {
    return this.#queue
  }

  size() {
    return this.#queue.size()
  }

  process(handler: (channel: string, message: TransportMessage) => Promise<boolean>) {
    if (this.#processing) return this.#processing

    const processing = Promise.resolve().then(() => this.#queue.process(handler))
    this.#processing = processing.finally(() => {
      this.#processing = undefined
    })

    return this.#processing
  }

  enqueue(channel: string, message: TransportMessage) {
    return this.#queue.enqueue(channel, message)
  }

  dequeue() {
    this.#queue.dequeue()
  }
}
