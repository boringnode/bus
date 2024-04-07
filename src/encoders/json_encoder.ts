/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright Boring Node
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
