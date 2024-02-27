/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import type { TransportFactory } from './types/main.js'

export function defineConfig<KnownTransports extends Record<string, TransportFactory>>(config: {
  default: keyof KnownTransports
  transports: KnownTransports
}): { default: keyof KnownTransports; transports: KnownTransports } {
  return config
}
