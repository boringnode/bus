/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright Boring Node
 */

import { setTimeout } from 'node:timers/promises'
import { test } from '@japa/runner'
import { Bus } from '../src/bus.js'
import { MemoryTransport } from '../src/transports/memory.js'
import { ChaosTransport } from '../test_helpers/chaos_transport.js'

const kTestingChannel = 'testing-channel'

test.group('Bus', () => {
  test('should retry queue processing with an interval', async ({ assert, cleanup }) => {
    const transport1 = new ChaosTransport(new MemoryTransport())
    const transport2 = new ChaosTransport(new MemoryTransport())

    const bus1 = new Bus(transport1, { retryQueue: { retryInterval: '100ms' } })
    const bus2 = new Bus(transport2, { retryQueue: { retryInterval: '100ms' } })

    cleanup(async () => {
      await bus1.disconnect()
      await bus2.disconnect()
    })

    transport1.alwaysThrow()
    transport2.alwaysThrow()

    let count = 0

    await bus1.subscribe(kTestingChannel, () => {
      count++
    })

    await bus2.publish(kTestingChannel, 'test')

    assert.equal(count, 0)

    transport1.neverThrow()
    transport2.neverThrow()

    await setTimeout(200)

    assert.equal(count, 1)
  })

  test('should retry queue processing when asked', async ({ assert, cleanup }) => {
    const transport1 = new ChaosTransport(new MemoryTransport())
    const transport2 = new ChaosTransport(new MemoryTransport())

    const bus1 = new Bus(transport1)
    const bus2 = new Bus(transport2)

    cleanup(async () => {
      await bus1.disconnect()
      await bus2.disconnect()
    })

    transport1.alwaysThrow()
    transport2.alwaysThrow()

    let count = 0

    await bus1.subscribe(kTestingChannel, () => {
      count++
    })

    await bus2.publish(kTestingChannel, 'test')

    assert.equal(count, 0)

    transport1.neverThrow()
    transport2.neverThrow()

    await bus2.processErrorRetryQueue()

    assert.equal(count, 1)
  })

  test('should not retry when retry queue is disabled', async ({ assert, cleanup }) => {
    const transport1 = new ChaosTransport(new MemoryTransport())
    const transport2 = new ChaosTransport(new MemoryTransport())

    const bus1 = new Bus(transport1, { retryQueue: { enabled: false } })
    const bus2 = new Bus(transport2, { retryQueue: { enabled: false } })

    cleanup(async () => {
      await bus1.disconnect()
      await bus2.disconnect()
    })

    transport1.alwaysThrow()
    transport2.alwaysThrow()

    let count = 0

    await bus1.subscribe(kTestingChannel, () => {
      count++
    })

    await bus2.publish(kTestingChannel, 'test')

    assert.equal(count, 0)

    transport1.neverThrow()
    transport2.neverThrow()

    await setTimeout(200)

    assert.equal(count, 0)
  })

  test('should not remove item from queue if publish failed', async ({ assert, cleanup }) => {
    const transport = new ChaosTransport(new MemoryTransport())
    const bus = new Bus(transport, { retryQueue: { enabled: true } })

    cleanup(async () => {
      await bus.disconnect()
    })

    transport.alwaysThrow()

    await bus.publish(kTestingChannel, 'test')

    assert.deepEqual(bus.getRetryQueue().size(), 1)

    await bus.processErrorRetryQueue()

    assert.deepEqual(bus.getRetryQueue().size(), 1)
  })
})
