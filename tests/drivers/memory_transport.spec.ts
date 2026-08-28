/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright BoringNode
 */

import { setTimeout } from 'node:timers/promises'
import { test } from '@japa/runner'
import { MemoryTransport } from '../../src/transports/memory.js'

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

  test('disconnecting one transport should preserve other transport subscriptions', async ({
    assert,
    cleanup,
  }) => {
    const subscriber = new MemoryTransport().setId('subscriber')
    const disconnected = new MemoryTransport().setId('disconnected')
    const publisher = new MemoryTransport().setId('publisher')
    let receivedMessages = 0
    let disconnectedReceivedMessages = 0

    cleanup(async () => {
      await subscriber.disconnect()
      await publisher.disconnect()
    })

    await subscriber.subscribe('testing-channel', () => {
      receivedMessages++
    })
    await disconnected.subscribe('testing-channel', () => {
      disconnectedReceivedMessages++
    })
    await disconnected.disconnect()
    await publisher.publish('testing-channel', 'test')

    assert.equal(receivedMessages, 1)
    assert.equal(disconnectedReceivedMessages, 0)
  })
})
