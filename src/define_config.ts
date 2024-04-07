/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright Boring Node
 */

import type { ManagerConfig, TransportConfig } from './types/main.js'

export function defineConfig<KnownTransports extends Record<string, TransportConfig>>(
  config: ManagerConfig<KnownTransports>
): ManagerConfig<KnownTransports> {
  return config
}
