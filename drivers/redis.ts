/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import { RedisTransport } from '../src/drivers/redis_transport.js'

export function redis(config: any) {
  return () => new RedisTransport(config)
}
