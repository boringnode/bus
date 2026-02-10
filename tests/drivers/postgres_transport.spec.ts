/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright BoringNode
 */

import { setTimeout } from 'node:timers/promises'
import { test } from '@japa/runner'
import { Client } from 'pg'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { PostgresTransport } from '../../src/transports/postgres.js'
import { JsonEncoder } from '../../src/encoders/json_encoder.js'

test.group('Postgres Transport', (group) => {
  let container: StartedPostgreSqlContainer

  group.setup(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start()

    return async () => {
      await container.stop()
    }
  })

  test('transport should not receive message emitted by itself', async ({ assert, cleanup }) => {
    const transport = new PostgresTransport(container.getConnectionUri()).setId('bus')
    cleanup(() => transport.disconnect())

    await transport.subscribe('testing-channel', () => {
      assert.fail('Bus should not receive message emitted by itself')
    })

    await transport.publish('testing-channel', 'test')
    await setTimeout(200)
  }).disableTimeout()

  test('transport should receive message emitted by another bus', async ({
    assert,
    cleanup,
  }, done) => {
    assert.plan(1)

    const transport1 = new PostgresTransport(container.getConnectionUri()).setId('bus1')
    const transport2 = new PostgresTransport(container.getConnectionUri()).setId('bus2')

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
    const transport = new PostgresTransport(container.getConnectionUri()).setId('bus')
    cleanup(() => transport.disconnect())

    let onReconnectTriggered = false
    transport.onReconnect(() => {
      onReconnectTriggered = true
    })

    await transport.publish('warmup', 'warmup')

    /**
     * We use pg_terminate_backend to simulate a connection loss instead of restarting
     * the container because restarting the container might change the exposed port,
     * making it impossible for the driver to reconnect (since it relies on the initial
     * connection string).
     */
    const client = new Client({ connectionString: container.getConnectionUri() })
    await client.connect()
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND datname = current_database()`
    )
    await client.end()

    await setTimeout(5000)

    assert.isTrue(onReconnectTriggered)
  }).disableTimeout()

  test('message should be encoded and decoded correctly when using JSON encoder', async ({
    assert,
    cleanup,
  }, done) => {
    assert.plan(1)

    const transport1 = new PostgresTransport(container.getConnectionUri(), new JsonEncoder()).setId(
      'bus1'
    )
    const transport2 = new PostgresTransport(container.getConnectionUri(), new JsonEncoder()).setId(
      'bus2'
    )

    cleanup(async () => {
      await transport1.disconnect()
      await transport2.disconnect()
    })

    const data = { test: 'test' }

    await transport1.subscribe('testing-channel', (payload) => {
      assert.deepEqual(payload, data)
      done()
    })

    await setTimeout(200)

    await transport2.publish('testing-channel', data)
  }).waitForDone()

  test('should work with config object', async ({ assert, cleanup }, done) => {
    assert.plan(1)

    const config = {
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    }

    const transport1 = new PostgresTransport(config).setId('bus1')
    const transport2 = new PostgresTransport(config).setId('bus2')

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

  test('should handle unsubscribe correctly', async ({ assert, cleanup }) => {
    const transport1 = new PostgresTransport(container.getConnectionUri()).setId('bus1')
    const transport2 = new PostgresTransport(container.getConnectionUri()).setId('bus2')

    cleanup(async () => {
      await transport1.disconnect()
      await transport2.disconnect()
    })

    let messageCount = 0

    await transport1.subscribe('testing-channel', () => {
      messageCount++
    })

    await setTimeout(200)

    // Send first message
    await transport2.publish('testing-channel', 'test1')
    await setTimeout(200)

    // Unsubscribe
    await transport1.unsubscribe('testing-channel')
    await setTimeout(200)

    // Send second message (should not be received)
    await transport2.publish('testing-channel', 'test2')
    await setTimeout(200)

    assert.equal(messageCount, 1)
  })

  test('should handle multiple channels', async ({ assert, cleanup }) => {
    const transport1 = new PostgresTransport(container.getConnectionUri()).setId('bus1')
    const transport2 = new PostgresTransport(container.getConnectionUri()).setId('bus2')

    cleanup(async () => {
      await transport1.disconnect()
      await transport2.disconnect()
    })

    const receivedMessages: string[] = []

    await transport1.subscribe('channel1', (payload) => {
      receivedMessages.push(`channel1:${payload}`)
    })

    await transport1.subscribe('channel2', (payload) => {
      receivedMessages.push(`channel2:${payload}`)
    })

    await setTimeout(200)

    await transport2.publish('channel1', 'message1')
    await transport2.publish('channel2', 'message2')

    await setTimeout(200)

    assert.includeMembers(receivedMessages, ['channel1:message1', 'channel2:message2'])
    assert.lengthOf(receivedMessages, 2)
  })
})
