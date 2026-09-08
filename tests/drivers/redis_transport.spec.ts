/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright BoringNode
 */

import { setImmediate, setTimeout } from 'node:timers/promises'
import { test } from '@japa/runner'
import { Redis, Cluster } from 'ioredis'
import { Redis as ForeignRedis, Cluster as ForeignCluster } from 'ioredis-v6'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { RedisTransport } from '../../src/transports/redis.js'
import { JsonEncoder } from '../../src/encoders/json_encoder.js'
import { type TransportEncoder, type TransportMessage } from '../../src/types/main.js'

/**
 * `ioredis-v6` is a second, real copy of `ioredis` installed side by side with
 * the one this package resolves, through the npm alias
 * `"ioredis-v6": "npm:ioredis@^6.0.0"`. A client built from it is exactly what
 * an application running `@adonisjs/redis@11` hands to a bus resolved against
 * `ioredis` 5: same API, different classes, so `instanceof` says `false`.
 *
 * The cast is part of the scenario too - the two copies ship two unrelated sets
 * of types - but only the runtime behaviour is under test here.
 */
function asForeignClient(client: ForeignRedis): Redis
function asForeignClient(client: ForeignCluster): Cluster
function asForeignClient(client: ForeignRedis | ForeignCluster) {
  return client as unknown as Redis | Cluster
}

/**
 * Records what `duplicate()` returns, so a test can tell "the transport reused
 * the connection" from "the transport built a brand new one".
 *
 * The spy is an own property shadowing the prototype method, so the client
 * remains an instance of its own `ioredis` copy - which is the very thing these
 * tests are about.
 */
function spyOnDuplicate<T extends ForeignRedis | ForeignCluster>(client: T): T[] {
  const duplicates: T[] = []
  const duplicate = (client.duplicate as unknown as () => T).bind(client)

  Object.defineProperty(client, 'duplicate', {
    configurable: true,
    value: () => {
      const duplicated = duplicate()
      duplicates.push(duplicated)
      return duplicated
    },
  })

  return duplicates
}

test.group('Redis Transport', (group) => {
  let container: StartedRedisContainer

  group.setup(async () => {
    container = await new RedisContainer('redis:7.2').start()

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

  test('subscribe should resolve after Redis acknowledges the subscription', async ({
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

    await transport2.publish('testing-channel', 'test')
  }).waitForDone()

  test('subscribing to many channels should not exceed the listener limit', async ({
    assert,
    cleanup,
  }) => {
    const transport = new RedisTransport(container.getConnectionUrl()).setId('bus')
    let listenerWarning: Error | undefined

    const onWarning = (warning: Error) => {
      if (warning.name === 'MaxListenersExceededWarning') {
        listenerWarning = warning
      }
    }

    process.on('warning', onWarning)
    cleanup(async () => {
      process.off('warning', onWarning)
      await transport.disconnect()
    })

    await Promise.all(
      Array.from({ length: 11 }, (_, index) => transport.subscribe(`channel-${index}`, () => {}))
    )
    await setImmediate()

    assert.isUndefined(listenerWarning)
  })

  test('multiple handlers should receive messages from the same channel', async ({
    assert,
    cleanup,
  }) => {
    const transport1 = new RedisTransport(container.getConnectionUrl()).setId('bus1')
    const transport2 = new RedisTransport(container.getConnectionUrl()).setId('bus2')

    cleanup(async () => {
      await transport1.disconnect()
      await transport2.disconnect()
    })

    const messages: string[] = []
    let resolveMessages!: () => void
    const messagesReceived = new Promise<void>((resolve) => (resolveMessages = resolve))
    const handler = (payload: string) => {
      messages.push(payload)
      if (messages.length === 2) resolveMessages()
    }

    await Promise.all([
      transport1.subscribe('shared-channel', handler),
      transport1.subscribe('shared-channel', handler),
    ])
    await transport2.publish('shared-channel', 'test')
    await messagesReceived

    assert.deepEqual(messages, ['test', 'test'])
  })

  test('unsubscribe should remove handlers before resubscribing', async ({ assert, cleanup }) => {
    const transport1 = new RedisTransport(container.getConnectionUrl()).setId('bus1')
    const transport2 = new RedisTransport(container.getConnectionUrl()).setId('bus2')
    let previousHandlerCalls = 0

    cleanup(async () => {
      await transport1.disconnect()
      await transport2.disconnect()
    })

    await transport1.subscribe('resubscribe-channel', () => {
      previousHandlerCalls++
    })
    await transport1.unsubscribe('resubscribe-channel')

    let resolveMessage!: (payload: string) => void
    const message = new Promise<string>((resolve) => (resolveMessage = resolve))
    await transport1.subscribe('resubscribe-channel', resolveMessage)
    await transport2.publish('resubscribe-channel', 'test')
    await message

    assert.equal(previousHandlerCalls, 0)
  })

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
  }, done) => {
    assert.plan(1)

    const transport1 = new RedisTransport(container.getConnectionUrl(), new JsonEncoder()).setId(
      'bus1'
    )
    const transport2 = new RedisTransport(container.getConnectionUrl(), new JsonEncoder()).setId(
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

  test('transport should ignore malformed messages', async ({ assert, cleanup }, done) => {
    assert.plan(1)

    const transport = new RedisTransport(container.getConnectionUrl()).setId('bus')
    const publisher = new Redis(container.getConnectionUrl())

    cleanup(async () => {
      await transport.disconnect()
      await publisher.quit()
    })

    await transport.subscribe('malformed-message-channel', (payload) => {
      assert.equal(payload, 'valid')
      done()
    })

    await setTimeout(200)
    await publisher.publish('malformed-message-channel', '{')
    await publisher.publish('malformed-message-channel', 'null')
    await publisher.publish(
      'malformed-message-channel',
      JSON.stringify({ busId: 'publisher', payload: 'valid' })
    )
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

    const transport1 = new RedisTransport(
      { host: container.getHost(), port: container.getMappedPort(6379), useMessageBuffer: true },
      new BinaryEncoder()
    ).setId('bus1')

    const transport2 = new RedisTransport(
      { host: container.getHost(), port: container.getMappedPort(6379), useMessageBuffer: true },
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

    const redisInstance = new Redis({
      host: container.getHost(),
      port: container.getMappedPort(6379),
    })

    cleanup(async () => {
      await redisInstance.quit()
    })

    const transport1 = new RedisTransport(redisInstance).setId('bus1')
    const transport2 = new RedisTransport(redisInstance).setId('bus2')

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

    const cluster = new Cluster([{ host: '127.0.0.1', port: 7000 }])

    cleanup(async () => {
      await cluster.quit()
    })

    const transport1 = new RedisTransport(cluster).setId('bus1')
    const transport2 = new RedisTransport(cluster).setId('bus2')

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

    const redisInstance = new Redis({
      host: container.getHost(),
      port: container.getMappedPort(6379),
    })

    cleanup(async () => {
      await redisInstance.quit()
    })

    const transport1 = new RedisTransport(redisInstance, new BinaryEncoder(), {
      useMessageBuffer: true,
    }).setId('bus1')

    const transport2 = new RedisTransport(redisInstance, new BinaryEncoder(), {
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

  test('should reuse a client coming from another copy of ioredis', async ({ assert, cleanup }) => {
    const foreignClient = new ForeignRedis({
      host: container.getHost(),
      port: container.getMappedPort(6379),
    })

    cleanup(async () => {
      await foreignClient.quit()
    })

    /**
     * The premise of the test: a genuine `ioredis` client, built from a genuine
     * second copy of the package, which is therefore not an instance of the
     * classes this package resolved.
     */
    assert.isFalse((ForeignRedis as unknown) === (Redis as unknown))
    assert.instanceOf(foreignClient, ForeignRedis)
    assert.isFalse(foreignClient instanceof Redis)
    assert.isFalse(foreignClient instanceof Cluster)

    const duplicates = spyOnDuplicate(foreignClient)
    const transport = new RedisTransport(asForeignClient(foreignClient)).setId('bus1')
    cleanup(() => transport.disconnect())

    /**
     * The connection must have been duplicated (publisher + subscriber) rather
     * than handed to `new Redis()` as if it were an options object, which would
     * silently dial 127.0.0.1:6379.
     */
    assert.lengthOf(duplicates, 2)
    assert.instanceOf(duplicates[0], ForeignRedis)

    /**
     * And the messages must really land on the configured server, not on the
     * default one. The witness connects to the container explicitly, so it only
     * ever sees what was published there.
     */
    const witness = new Redis({
      host: container.getHost(),
      port: container.getMappedPort(6379),
    })
    cleanup(async () => {
      await witness.quit()
    })

    const received = new Promise<string>((resolve) => {
      witness.on('message', (_channel, message) => resolve(message))
    })
    await witness.subscribe('foreign-client-channel')

    await transport.publish('foreign-client-channel', 'test')

    const message = await Promise.race([received, setTimeout(2000).then(() => 'timed-out')])

    assert.deepEqual(JSON.parse(message), { payload: 'test', busId: 'bus1' })
  })

  test('should reuse a cluster client coming from another copy of ioredis', async ({
    assert,
    cleanup,
  }) => {
    const foreignCluster = new ForeignCluster([{ host: '127.0.0.1', port: 7000 }], {
      lazyConnect: true,
    })

    cleanup(() => {
      foreignCluster.disconnect()
    })

    assert.isFalse((ForeignCluster as unknown) === (Cluster as unknown))
    assert.instanceOf(foreignCluster, ForeignCluster)
    assert.isFalse(foreignCluster instanceof Redis)
    assert.isFalse(foreignCluster instanceof Cluster)

    const duplicates = spyOnDuplicate(foreignCluster)
    const transport = new RedisTransport(asForeignClient(foreignCluster))
    cleanup(() => {
      for (const duplicated of duplicates) duplicated.disconnect()
    })

    assert.lengthOf(duplicates, 2)
    assert.instanceOf(duplicates[0], ForeignCluster)
    assert.isFalse(duplicates[0] instanceof Cluster)

    transport.onReconnect(() => {})
    assert.equal(duplicates[1].listenerCount('reconnecting'), 1)
  })

  test('should keep useMessageBuffer when given a client from another copy of ioredis', async ({
    assert,
    cleanup,
  }) => {
    class BinaryEncoder implements TransportEncoder {
      encode(message: TransportMessage<any>) {
        return Buffer.from(JSON.stringify(message))
      }

      decode(data: string | Buffer) {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'binary')
        return JSON.parse(buffer.toString())
      }
    }

    const subscriberClient = new ForeignRedis({
      host: container.getHost(),
      port: container.getMappedPort(6379),
    })

    const publisherClient = new ForeignRedis({
      host: container.getHost(),
      port: container.getMappedPort(6379),
    })

    cleanup(async () => {
      await subscriberClient.quit()
      await publisherClient.quit()
    })

    assert.instanceOf(subscriberClient, ForeignRedis)
    assert.isFalse(subscriberClient instanceof Redis)

    const duplicates = spyOnDuplicate(subscriberClient)

    const transport1 = new RedisTransport(asForeignClient(subscriberClient), new BinaryEncoder(), {
      useMessageBuffer: true,
    }).setId('bus1')

    const transport2 = new RedisTransport(asForeignClient(publisherClient), new BinaryEncoder(), {
      useMessageBuffer: true,
    }).setId('bus2')

    cleanup(async () => {
      await transport1.disconnect()
      await transport2.disconnect()
    })

    /**
     * `useMessageBuffer` only reaches the transport through the third argument,
     * which is ignored on the options-object branch. If the client is not
     * recognized, it silently degrades to `false` and the subscriber listens on
     * "message" instead of "messageBuffer" - decoding binary payloads through a
     * lossy string.
     */
    assert.lengthOf(duplicates, 2)
    assert.equal(duplicates[1].listenerCount('messageBuffer'), 1)
    assert.equal(duplicates[1].listenerCount('message'), 0)

    const data = ['foo', '👍']

    /**
     * The exact bytes the publisher writes. Listening alongside the transport on
     * its own subscriber lets us assert the payload survived the trip untouched,
     * rather than through a UTF-8 round trip that happens to be lossless.
     */
    const expectedBytes = new BinaryEncoder().encode({ payload: data, busId: 'bus2' })
    let receivedBytes: Buffer | undefined
    duplicates[1].on('messageBuffer', (_channel: Buffer, message: Buffer) => {
      receivedBytes = message
    })

    let resolvePayload!: (payload: unknown) => void
    const payloadReceived = new Promise<unknown>((resolve) => (resolvePayload = resolve))
    await transport1.subscribe('testing-channel', resolvePayload)

    await setTimeout(200)
    await transport2.publish('testing-channel', data)

    const payload = await Promise.race([payloadReceived, setTimeout(2000).then(() => 'timed-out')])

    assert.deepEqual(payload, data)
    assert.isTrue(Buffer.isBuffer(receivedBytes))
    assert.isTrue(receivedBytes!.equals(expectedBytes as Buffer))
  })

  test('should throw instead of dialing localhost for an unusable client', async ({ assert }) => {
    const unusable = {
      status: 'ready',
      options: { host: 'redis.internal', port: 6380 },
      emit: () => true,
    }

    assert.throws(
      // @ts-expect-error - deliberately not a valid argument
      () => new RedisTransport(unusable),
      /Cannot use the given Redis connection with "RedisTransport"/
    )
  })

  test('should still build a new connection from a plain options object', async ({
    assert,
    cleanup,
  }, done) => {
    assert.plan(1)

    const transport1 = new RedisTransport({
      host: container.getHost(),
      port: container.getMappedPort(6379),
    }).setId('bus1')

    const transport2 = new RedisTransport({
      host: container.getHost(),
      port: container.getMappedPort(6379),
    }).setId('bus2')

    cleanup(async () => {
      await transport1.disconnect()
      await transport2.disconnect()
    })

    await transport1.subscribe('options-object-channel', (payload) => {
      assert.equal(payload, 'test')
      done()
    })

    await setTimeout(200)
    await transport2.publish('options-object-channel', 'test')
  }).waitForDone()
})
