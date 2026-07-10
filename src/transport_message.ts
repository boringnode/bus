/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright BoringNode
 */

import type { Serializable, TransportEncoder, TransportMessage } from './types/main.js'

function isTransportMessage<T extends Serializable>(value: unknown): value is TransportMessage<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof Reflect.get(value, 'busId') === 'string' &&
    Object.hasOwn(value, 'payload')
  )
}

export function tryDecodeTransportMessage<T extends Serializable>(
  encoder: TransportEncoder,
  data: string | Buffer
): TransportMessage<T> | null {
  try {
    const message = encoder.decode<T>(data)

    return isTransportMessage<T>(message) ? message : null
  } catch {
    return null
  }
}
