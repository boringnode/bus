/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright BoringNode
 */

import { setImmediate, setTimeout } from 'node:timers/promises'
import { test } from '@japa/runner'
import { Redis, Cluster } from 'ioredis'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { RedisTransport } from '../../src/transports/redis.js'
import { JsonEncoder } from '../../src/encoders/json_encoder.js'
import { type TransportEncoder, type TransportMessage } from '../../src/types/main.js'

/**
 * A stand-in for a client coming from *another* copy of `ioredis` - a different
 * major installed alongside ours, which is the normal outcome of a package
 * manager resolving two ranges.
 *
 * The Proxy sits on a null-prototype target and forwards everything to a real
 * client, so it has exactly the shape of a client while failing
 * `instanceof Redis` / `instanceof Cluster` against the copy this package
 * resolved - which is precisely what a foreign-major client looks like from in
 * here. Only one `ioredis` can be installed in this repository, so this is the
 * faithful way to express the situation in a test.
 */
function asForeignMajorClient<T extends Redis | Cluster>(client: T) {
  const duplicates: T[] = []

  const proxy = new Proxy(Object.create(null), {
    get(_target, property) {
      const value = (client as any)[property]

      if (property === 'duplicate') {
        return (...args: any[]) => {
          const duplicated = value.apply(client, args)
          duplicates.push(duplicated)
          return duplicated
        }
      }

      return typeof value === 'function' ? value.bind(client) : value
    },
    has(_target, property) {
      return property in (client as any)
    },
  }) as T

  return { client: proxy, duplicates }
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
    const redisInstance = new Redis({
      host: container.getHost(),
      port: container.getMappedPort(6379),
    })
    const foreign = asForeignMajorClient(redisInstance)

    cleanup(async () => {
      await redisInstance.quit()
    })

    /**
     * The premise of the test: same shape, but not an instance of the `ioredis`
     * classes this package resolved.
     */
    assert.isFalse(foreign.client instanceof Redis)
    assert.isFalse(foreign.client instanceof Cluster)

    const transport = new RedisTransport(foreign.client).setId('bus1')
    cleanup(() => transport.disconnect())

    /**
     * The connection must have been duplicated (publisher + subscriber) rather
     * than handed to `new Redis()` as if it were an options object, which would
     * silently dial 127.0.0.1:6379.
     */
    assert.lengthOf(foreign.duplicates, 2)

    /**
     * And the messages must really land on the configured server, not on the
     * default one.
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
    const cluster = new Cluster([{ host: '127.0.0.1', port: 7000 }], { lazyConnect: true })
    const foreign = asForeignMajorClient(cluster)

    cleanup(async () => {
      cluster.disconnect()
    })

    assert.isFalse(foreign.client instanceof Redis)
    assert.isFalse(foreign.client instanceof Cluster)

    const transport = new RedisTransport(foreign.client)
    cleanup(() => {
      for (const duplicated of foreign.duplicates) duplicated.disconnect()
    })

    assert.lengthOf(foreign.duplicates, 2)
    assert.instanceOf(foreign.duplicates[0], Cluster)

    transport.onReconnect(() => {})
    assert.equal(foreign.duplicates[1].listenerCount('reconnecting'), 1)
  })

  test('should keep useMessageBuffer when given a client from another copy of ioredis', async ({
    assert,
    cleanup,
  }, done) => {
    assert.plan(4)

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

    const foreign1 = asForeignMajorClient(redisInstance)
    const foreign2 = asForeignMajorClient(redisInstance)

    const transport1 = new RedisTransport(foreign1.client, new BinaryEncoder(), {
      useMessageBuffer: true,
    }).setId('bus1')

    const transport2 = new RedisTransport(foreign2.client, new BinaryEncoder(), {
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
    assert.lengthOf(foreign1.duplicates, 2)
    assert.equal(foreign1.duplicates[1].listenerCount('messageBuffer'), 1)
    assert.equal(foreign1.duplicates[1].listenerCount('message'), 0)

    const data = ['foo', '👍']

    await transport1.subscribe('testing-channel', (payload) => {
      assert.deepEqual(payload, data)
      done()
    })

    await setTimeout(200)
    await transport2.publish('testing-channel', data)
  }).waitForDone()

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
