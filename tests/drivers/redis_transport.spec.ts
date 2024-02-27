/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import { test } from '@japa/runner'
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis'
import { ChaosBus } from '../../test_helpers/chaos_bus.js'
import { RedisTransport } from '../../src/drivers/redis_transport.js'

test.group('Redis Bus', (group) => {
  let container: StartedRedisContainer

  group.setup(async () => {
    container = await new RedisContainer().start()

    return async () => await container.stop()
  })

  test('retry queue processing', async ({ assert, cleanup }) => {
    const bus1 = new ChaosBus(new RedisTransport(container.getConnectionUrl()))
    const bus2 = new ChaosBus(new RedisTransport(container.getConnectionUrl()))

    bus1.alwaysThrow()
    bus2.alwaysThrow()

    cleanup(() => {
      bus1.disconnect()
      bus2.disconnect()
    })
  })
})
