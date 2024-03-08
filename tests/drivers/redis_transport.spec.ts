/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import { setTimeout } from 'node:timers/promises'
import { test } from '@japa/runner'
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis'
import { RedisTransport } from '../../src/drivers/redis_transport.js'
import { JsonEncoder } from '../../src/encoders/json_encoder.js'

test.group('Redis Bus', (group) => {
  let container: StartedRedisContainer

  group.setup(async () => {
    container = await new RedisContainer().start()

    return async () => {
      await container.stop()
    }
  })

  test('bus should not receive message emitted by itself', async ({ assert, cleanup }) => {
    const bus = new RedisTransport(container.getConnectionUrl()).setId('bus')
    cleanup(() => bus.disconnect())

    await bus.subscribe('testing-channel', () => {
      assert.fail('Bus should not receive message emitted by itself')
    })

    await bus.publish('testing-channel', 'test')
    await setTimeout(1000)
  }).disableTimeout()

  test('bus should receive message emitted by another bus', async ({ assert, cleanup }, done) => {
    assert.plan(1)

    const bus1 = new RedisTransport(container.getConnectionUrl()).setId('bus1')
    const bus2 = new RedisTransport(container.getConnectionUrl()).setId('bus2')

    cleanup(async () => {
      await bus1.disconnect()
      await bus2.disconnect()
    })

    await bus1.subscribe('testing-channel', (payload) => {
      assert.equal(payload, 'test')
      done()
    })

    await bus2.publish('testing-channel', 'test')
  }).waitForDone()

  test('bus should trigger onReconnect when the client reconnects', async ({ assert, cleanup }) => {
    const bus = new RedisTransport(container.getConnectionUrl()).setId('bus')
    cleanup(() => bus.disconnect())

    let onReconnectTriggered = false
    bus.onReconnect(() => {
      onReconnectTriggered = true
    })

    await container.restart()
    await setTimeout(200)

    assert.isTrue(onReconnectTriggered)
  })

  test('message should be encoded and decoded correctly when using JSON encoder', async ({
    assert,
    cleanup,
  }) => {
    const bus = new RedisTransport(container.getConnectionUrl(), new JsonEncoder()).setId('bus')
    cleanup(() => bus.disconnect())

    const data = { test: 'test' }

    await bus.subscribe('testing-channel', (payload) => {
      assert.deepEqual(payload, data)
    })

    await bus.publish('testing-channel', data)
  })
})
