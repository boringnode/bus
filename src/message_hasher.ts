/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import hash from 'object-hash'
import type { Serializable } from './types/main.js'

export class MessageHasher {
  hash(value: Serializable): string {
    return hash(value, { algorithm: 'sha1', encoding: 'base64' })
  }
}
