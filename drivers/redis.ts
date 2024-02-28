/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import { RedisTransport } from '../src/drivers/redis_transport.js'
import type { RedisTransportConfig, TransportEncoder } from '../src/types/main.js'

export function redis(config: RedisTransportConfig, encoder?: TransportEncoder) {
  return () => new RedisTransport(config, encoder)
}
