/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright Boring Node
 */

import hash from 'object-hash'
import type { Serializable } from './types/main.js'

export class MessageHasher {
  hash(value: Serializable): string {
    return hash(value, { algorithm: 'sha1', encoding: 'base64' })
  }
}
