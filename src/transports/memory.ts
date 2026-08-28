/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright BoringNode
 */

import type { Transport, Serializable, SubscribeHandler } from '../types/main.js'

export function memory() {
  return () => new MemoryTransport()
}

export class MemoryTransport implements Transport {
  #id!: string

  /**
   * A Map that stores the subscriptions for each channel.
   */
  static #subscriptions: Map<
    string,
    Array<{
      handler: SubscribeHandler<any>
      busId: string
    }>
  > = new Map()

  setId(id: string) {
    this.#id = id

    return this
  }

  /**
   * List of messages received by this bus
   */
  receivedMessages: any[] = []

  async publish(channel: string, message: Serializable) {
    const handlers = MemoryTransport.#subscriptions.get(channel)

    if (!handlers) {
      return
    }

    for (const { handler, busId } of handlers) {
      if (busId === this.#id) continue

      handler(message)
    }
  }

  async subscribe<T extends Serializable>(channel: string, handler: SubscribeHandler<T>) {
    const handlers = MemoryTransport.#subscriptions.get(channel) || []

    handlers.push({ handler: this.#wrapHandler(handler), busId: this.#id })

    MemoryTransport.#subscriptions.set(channel, handlers)
  }

  async unsubscribe(channel: string) {
    const handlers = MemoryTransport.#subscriptions.get(channel) || []

    MemoryTransport.#subscriptions.set(
      channel,
      handlers.filter((h) => h.busId !== this.#id)
    )
  }

  async disconnect() {
    for (const [channel, handlers] of MemoryTransport.#subscriptions) {
      const remainingHandlers = handlers.filter((handler) => handler.busId !== this.#id)

      if (remainingHandlers.length === 0) {
        MemoryTransport.#subscriptions.delete(channel)
      } else {
        MemoryTransport.#subscriptions.set(channel, remainingHandlers)
      }
    }
  }

  onReconnect(_callback: () => void) {}

  #wrapHandler(handler: SubscribeHandler<any>) {
    return (message: any) => {
      this.receivedMessages.push(message)
      handler(message)
    }
  }
}
