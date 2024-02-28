/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import type { TransportMessage, RetryQueueOptions } from './types/main.js'

export class RetryQueueWithDuplicates {
  #queue = new Set<{ channel: string; message: TransportMessage }>()

  readonly #enabled: boolean
  readonly #maxSize: number | null

  constructor(params: RetryQueueOptions = {}) {
    const { enabled = true, maxSize = null } = params

    this.#enabled = enabled
    this.#maxSize = maxSize
  }

  size() {
    return this.#queue.size
  }

  async process(handler: (channel: string, message: TransportMessage) => Promise<boolean>) {
    if (!this.#enabled) return

    for (const { channel, message } of this.#queue) {
      const result = await handler(channel, message).catch(() => false)

      if (!result) {
        break
      }

      this.dequeue()
    }
  }

  enqueue(channel: string, message: TransportMessage) {
    if (!this.#enabled) return false

    if (this.#maxSize && this.#queue.size >= this.#maxSize) {
      this.dequeue()
    }

    this.#queue.add({ channel, message })

    return true
  }

  dequeue() {
    if (!this.#enabled) return

    const [first] = this.#queue

    if (first) {
      this.#queue.delete(first)

      return first.message
    }
  }
}
