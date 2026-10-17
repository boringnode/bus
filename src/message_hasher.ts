/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright BoringNode
 */

import hash from 'object-hash'
import type { Serializable } from './types/core.js'

export class MessageHasher {
  hash(value: Serializable): string {
    return hash(value, { algorithm: 'sha1', encoding: 'base64' })
  }
}
