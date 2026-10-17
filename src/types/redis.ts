/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright BoringNode
 */

import type { RedisOptions } from 'ioredis'

export type { Redis, Cluster } from 'ioredis'

export interface RedisTransportConfig extends RedisOptions {
  /**
   * If true, we will use `messageBuffer` event instead of `message` event
   * that is emitted by ioredis. `messageBuffer` will returns a buffer instead
   * of a string and this is useful when you are dealing with binary data.
   */
  useMessageBuffer?: boolean
}

export interface RedisTransportOptions {
  /**
   * If true, we will use `messageBuffer` event instead of `message` event
   * that is emitted by ioredis. `messageBuffer` will returns a buffer instead
   * of a string and this is useful when you are dealing with binary data.
   */
  useMessageBuffer?: boolean
}
