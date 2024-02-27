/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import { test } from '@japa/runner'
import { Bus } from '../src/bus.js'
import { BusManager } from '../src/bus_manager.js'
import { MemoryTransport } from '../src/drivers/memory_transport.js'

test.group('Bus Manager', () => {
  test('create bus instance from the manager', ({ assert, expectTypeOf }) => {
    const manager = new BusManager({
      default: 'memory',
      transports: {
        memory: () => new MemoryTransport(),
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
        memory: () => new MemoryTransport(),
        memory1: () => new MemoryTransport(),
      },
    })

    expectTypeOf(manager.use).parameter(0).toEqualTypeOf<'memory' | 'memory1' | undefined>()
    expectTypeOf(manager.use('memory')).toEqualTypeOf<Bus>()
    expectTypeOf(manager.use('memory1')).toEqualTypeOf<Bus>()

    assert.strictEqual(manager.use('memory'), manager.use('memory'))
    assert.notStrictEqual(manager.use('memory'), manager.use('memory1'))
  })
})
