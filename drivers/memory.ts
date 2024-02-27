/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import { MemoryTransport } from '../src/drivers/memory_transport.js'

export function memory() {
  return () => new MemoryTransport()
}
