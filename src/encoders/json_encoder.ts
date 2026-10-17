/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright BoringNode
 */

import type { TransportEncoder, TransportMessage } from '../types/core.js'

export class JsonEncoder implements TransportEncoder {
  encode(message: TransportMessage) {
    return JSON.stringify(message)
  }

  decode(data: string | Buffer) {
    return JSON.parse(data.toString())
  }
}
