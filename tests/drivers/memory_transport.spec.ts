/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import { setTimeout } from 'node:timers/promises'
import { test } from '@japa/runner'
import { MemoryTransport } from '../../src/drivers/memory_transport.js'

test.group('Memory Transport', () => {
  test('transport should not receive message emitted by itself', async ({ assert, cleanup }) => {
    const transport = new MemoryTransport().setId('transport')
    cleanup(() => transport.disconnect())

    await transport.subscribe('testing-channel', () => {
      assert.fail('Bus should not receive message emitted by itself')
    })

    await transport.publish('testing-channel', 'test')
    await setTimeout(1000)
  }).disableTimeout()

  test('transport should receive message emitted by another bus', async ({
    assert,
    cleanup,
  }, done) => {
    const transport1 = new MemoryTransport().setId('transport1')
    const transport2 = new MemoryTransport().setId('transport2')

    cleanup(async () => {
      await transport1.disconnect()
      await transport2.disconnect()
    })

    await transport1.subscribe('testing-channel', (payload) => {
      assert.equal(payload, 'test')
      done()
    })

    await transport2.publish('testing-channel', 'test')
  }).waitForDone()
})
