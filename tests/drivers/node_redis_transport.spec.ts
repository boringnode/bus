/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright BoringNode
 */

import { setTimeout } from 'node:timers/promises'
import { test } from '@japa/runner'
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis'
import { createClient, createCluster } from 'redis'
import { NodeRedisTransport } from '../../src/transports/node_redis.js'
import { JsonEncoder } from '../../src/encoders/json_encoder.js'
import { TransportEncoder, TransportMessage } from '../../src/types/main.js'

test.group('Node Redis Transport', (group) => {
  let container: StartedRedisContainer

  group.setup(async () => {
    container = await new RedisContainer('redis:7.2').start()

    return async () => {
      await container.stop()
    }
  })

  test('transport should not receive message emitted by itself', async ({ assert, cleanup }) => {
    const transport = new NodeRedisTransport(container.getConnectionUrl()).setId('bus')
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

    const transport1 = new NodeRedisTransport(container.getConnectionUrl()).setId('bus1')
    const transport2 = new NodeRedisTransport(container.getConnectionUrl()).setId('bus2')

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
    const transport = new NodeRedisTransport(container.getConnectionUrl()).setId('bus')
    cleanup(() => transport.disconnect())

    let onReconnectTriggered = false
    transport.onReconnect(() => {
      onReconnectTriggered = true
    })

    await transport.subscribe('testing-channel', () => {})

    await container.restart()
    await setTimeout(200)

    assert.isTrue(onReconnectTriggered)
  })

  test('message should be encoded and decoded correctly when using JSON encoder', async ({
    assert,
    cleanup,
  }, done) => {
    assert.plan(1)

    const transport1 = new NodeRedisTransport(container.getConnectionUrl(), new JsonEncoder()).setId(
      'bus1'
    )
    const transport2 = new NodeRedisTransport(container.getConnectionUrl(), new JsonEncoder()).setId(
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

  test('send binary data using useMessageBuffer', async ({ assert, cleanup }, done) => {
    assert.plan(1)

    class BinaryEncoder implements TransportEncoder {
      encode(message: TransportMessage<any>) {
        return Buffer.from(JSON.stringify(message))
      }

      decode(data: string | Buffer) {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'binary')
        return JSON.parse(buffer.toString())
      }
    }

    const transport1 = new NodeRedisTransport(
      { url: container.getConnectionUrl(), useMessageBuffer: true },
      new BinaryEncoder()
    ).setId('bus1')

    const transport2 = new NodeRedisTransport(
      { url: container.getConnectionUrl(), useMessageBuffer: true },
      new BinaryEncoder()
    ).setId('bus2')

    cleanup(() => {
      transport1.disconnect()
      transport2.disconnect()
    })

    const data = ['foo', '👍']

    await transport1.subscribe('testing-channel', (payload) => {
      assert.deepEqual(payload, data)
      done()
    })

    await setTimeout(200)
    await transport2.publish('testing-channel', data)
  }).waitForDone()

  test('should work with an existing redis instance', async ({ assert, cleanup }, done) => {
    assert.plan(1)

    const redisInstance = createClient({
      socket: {
        host: container.getHost(),
        port: container.getMappedPort(6379),
      },
    })
    redisInstance.on('error', () => {})
    await redisInstance.connect()

    cleanup(async () => {
      if (redisInstance.isOpen) {
        await redisInstance.close()
      }
    })

    const transport1 = new NodeRedisTransport(redisInstance).setId('bus1')
    const transport2 = new NodeRedisTransport(redisInstance).setId('bus2')

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

  test('should work with an existing cluster instance', async ({ assert, cleanup }, done) => {
    assert.plan(1)

    const cluster = createCluster({
      rootNodes: [{ url: 'redis://127.0.0.1:7000' }],
    })
    cluster.on('error', () => {})
    await cluster.connect()

    cleanup(async () => {
      if (cluster.isOpen) {
        await cluster.close()
      }
    })

    const transport1 = new NodeRedisTransport(cluster).setId('bus1')
    const transport2 = new NodeRedisTransport(cluster).setId('bus2')

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
  })
    .waitForDone()
    .skip(!!process.env.CI, 'Skipping cluster test on CI')

  test('send binary data using useMessageBuffer with existing redis instance', async ({
    assert,
    cleanup,
  }, done) => {
    assert.plan(1)

    class BinaryEncoder implements TransportEncoder {
      encode(message: TransportMessage<any>) {
        return Buffer.from(JSON.stringify(message))
      }

      decode(data: string | Buffer) {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'binary')
        return JSON.parse(buffer.toString())
      }
    }

    const redisInstance = createClient({ url: container.getConnectionUrl() })
    redisInstance.on('error', () => {})
    await redisInstance.connect()

    cleanup(async () => {
      if (redisInstance.isOpen) {
        await redisInstance.close()
      }
    })

    const transport1 = new NodeRedisTransport(redisInstance, new BinaryEncoder(), {
      useMessageBuffer: true,
    }).setId('bus1')

    const transport2 = new NodeRedisTransport(redisInstance, new BinaryEncoder(), {
      useMessageBuffer: true,
    }).setId('bus2')

    cleanup(async () => {
      await transport1.disconnect()
      await transport2.disconnect()
    })

    const data = ['foo', '👍']

    await transport1.subscribe('testing-channel', (payload) => {
      assert.deepEqual(payload, data)
      done()
    })

    await setTimeout(200)
    await transport2.publish('testing-channel', data)
  }).waitForDone()
})
