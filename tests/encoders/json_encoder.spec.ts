/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright Boring Node
 */

import { test } from '@japa/runner'
import { JsonEncoder } from '../../src/encoders/json_encoder.js'

test.group('JSON Encoder', () => {
  test('json encoder should encode and decode correctly', async ({ assert }) => {
    const data = { busId: 'bus', payload: 'test' }
    const encoder = new JsonEncoder()

    const encodedData = encoder.encode(data)
    const decodedData = encoder.decode(encodedData)

    assert.deepEqual(data, decodedData)
  })
})
