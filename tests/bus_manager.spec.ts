/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import { test } from '@japa/runner'
import { Bus } from '../src/bus.js'
import { BusManager } from '../src/bus_manager.js'
import { MemoryTransport } from '../src/transports/memory_transport.js'

test.group('Bus Manager', () => {
  test('create bus instance from the manager', ({ assert, expectTypeOf }) => {
    const manager = new BusManager({
      default: 'memory',
      transports: {
        memory: {
          transport: () => new MemoryTransport(),
        },
      },
    })

    expectTypeOf(manager.use).parameter(0).toEqualTypeOf<'memory' | undefined>()
    expectTypeOf(manager.use('memory')).toEqualTypeOf<Bus>()

    assert.instanceOf(manager.use('memory'), Bus)
  })

  test('cache bus instance', ({ assert, expectTypeOf }) => {
    const manager = new BusManager({
      default: 'memory',
      transports: {
        memory: {
          transport: () => new MemoryTransport(),
        },
        memory1: {
          transport: () => new MemoryTransport(),
        },
      },
    })

    expectTypeOf(manager.use).parameter(0).toEqualTypeOf<'memory' | 'memory1' | undefined>()
    expectTypeOf(manager.use('memory')).toEqualTypeOf<Bus>()
    expectTypeOf(manager.use('memory1')).toEqualTypeOf<Bus>()

    assert.strictEqual(manager.use('memory'), manager.use('memory'))
    assert.notStrictEqual(manager.use('memory'), manager.use('memory1'))
  })

  test('use default bus', ({ assert }) => {
    const manager = new BusManager({
      default: 'memory',
      transports: {
        memory: {
          transport: () => new MemoryTransport(),
        },
      },
    })

    assert.strictEqual(manager.use(), manager.use('memory'))
  })

  test('fail when default transport is missing', ({ assert }) => {
    const manager = new BusManager({
      transports: {
        memory: {
          transport: () => new MemoryTransport(),
        },
      },
    })

    assert.throws(
      () => manager.use(),
      'Cannot create bus instance. No default transport is defined in the config'
    )
  })

  test('pass retry queue options to the bus instance', ({ assert }) => {
    const manager = new BusManager({
      default: 'memory',
      transports: {
        memory: {
          transport: () => new MemoryTransport(),
          retryQueue: {
            enabled: false,
            maxSize: 100,
          },
        },
      },
    })

    const bus = manager.use('memory')

    assert.deepEqual(bus.getRetryQueue().getOptions(), {
      enabled: false,
      maxSize: 100,
      removeDuplicates: true,
    })
  })

  test('publish message using default transport', async ({ assert }) => {
    const manager = new BusManager({
      default: 'memory1',
      transports: {
        memory1: {
          transport: () => new MemoryTransport(),
        },
        memory2: {
          transport: () => new MemoryTransport(),
        },
      },
    })

    let count = 0

    await manager.use('memory2').subscribe('testing-channel', () => {
      count++
    })

    await manager.publish('testing-channel', 'test')

    assert.equal(count, 1)
  })

  test('subscribe message using default transport', async ({ assert }) => {
    const manager = new BusManager({
      default: 'memory1',
      transports: {
        memory1: {
          transport: () => new MemoryTransport(),
        },
        memory2: {
          transport: () => new MemoryTransport(),
        },
      },
    })

    let count = 0

    await manager.subscribe('testing-channel', () => {
      count++
    })

    await manager.use('memory2').publish('testing-channel', 'test')

    assert.equal(count, 1)
  })

  test('unsubscribe message using default transport', async ({ assert }) => {
    const manager = new BusManager({
      default: 'memory1',
      transports: {
        memory1: {
          transport: () => new MemoryTransport(),
        },
        memory2: {
          transport: () => new MemoryTransport(),
        },
      },
    })

    let count = 0

    await manager.subscribe('testing-channel', () => {
      count++
    })

    await manager.unsubscribe('testing-channel')

    await manager.use('memory2').publish('testing-channel', 'test')

    assert.equal(count, 0)
  })
})
