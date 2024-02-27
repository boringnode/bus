/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import type { TransportEncoder, TransportMessage } from '../types/main.js'

export class JsonEncoder implements TransportEncoder {
  encode(message: TransportMessage) {
    return JSON.stringify(message)
  }

  decode(data: string) {
    return JSON.parse(data)
  }
}
