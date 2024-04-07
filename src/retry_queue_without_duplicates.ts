/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright Boring Node
 */

import { MessageHasher } from './message_hasher.js'
import type { TransportMessage, RetryQueueOptions } from './types/main.js'

export class RetryQueueWithoutDuplicates {
  #queue = new Map<string, { channel: string; message: TransportMessage }>()
  #messageHasher: MessageHasher

  readonly #enabled: boolean
  readonly #maxSize: number | null

  constructor(params: RetryQueueOptions = {}) {
    const { enabled = true, maxSize = null } = params

    this.#enabled = enabled
    this.#maxSize = maxSize
    this.#messageHasher = new MessageHasher()
  }

  #generateMessageHash(message: TransportMessage) {
    return this.#messageHasher.hash(message.payload)
  }

  size() {
    return this.#queue.size
  }

  async process(handler: (channel: string, message: TransportMessage) => Promise<boolean>) {
    if (!this.#enabled) return

    for (const { channel, message } of this.#queue.values()) {
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

    const hash = this.#generateMessageHash(message)

    if (this.#queue.has(hash)) {
      return false
    }

    this.#queue.set(hash, { channel, message })

    return true
  }

  dequeue() {
    if (!this.#enabled) return

    const { message } = this.#queue.values().next().value

    if (message) {
      this.#queue.delete(this.#generateMessageHash(message))

      return message
    }
  }
}
