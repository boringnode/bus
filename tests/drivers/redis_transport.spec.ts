/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright Boring Node
 */

import { setTimeout } from 'node:timers/promises'
import { test } from '@japa/runner'
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis'
import { RedisTransport } from '../../src/transports/redis.js'
import { JsonEncoder } from '../../src/encoders/json_encoder.js'

test.group('Redis Transport', (group) => {
  let container: StartedRedisContainer

  group.setup(async () => {
    container = await new RedisContainer().start()

    return async () => {
      await container.stop()
    }
  })

  test('transport should not receive message emitted by itself', async ({ assert, cleanup }) => {
    const transport = new RedisTransport(container.getConnectionUrl()).setId('bus')
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
    assert.plan(1)

    const transport1 = new RedisTransport(container.getConnectionUrl()).setId('bus1')
    const transport2 = new RedisTransport(container.getConnectionUrl()).setId('bus2')

    cleanup(async () => {
      await transport1.disconnect()
      await transport2.disconnect()
    })

    await transport1.subscribe('testing-channel', (payload) => {
      assert.equal(payload, 'test')
      done()
    })

    await setTimeout(200)

    await transport2.publish('testing-channel', 'test')
  }).waitForDone()

  test('transport should trigger onReconnect when the client reconnects', async ({
    assert,
    cleanup,
  }) => {
    const transport = new RedisTransport(container.getConnectionUrl()).setId('bus')
    cleanup(() => transport.disconnect())

    let onReconnectTriggered = false
    transport.onReconnect(() => {
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
    const transport = new RedisTransport(container.getConnectionUrl(), new JsonEncoder()).setId(
      'bus'
    )
    cleanup(() => transport.disconnect())

    const data = { test: 'test' }

    await transport.subscribe('testing-channel', (payload) => {
      assert.deepEqual(payload, data)
    })

    await setTimeout(200)

    await transport.publish('testing-channel', data)
  })
})
