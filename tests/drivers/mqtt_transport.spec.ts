/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright Boring Node
 */

import { setTimeout } from 'node:timers/promises'
import { test } from '@japa/runner'
import { HiveMQContainer, StartedHiveMQContainer } from '@testcontainers/hivemq'
import { GenericContainer, StartedTestContainer } from 'testcontainers'
import { MqttTransport } from '../../src/transports/mqtt.js'
import { JsonEncoder } from '../../src/encoders/json_encoder.js'
import { TransportEncoder, TransportMessage } from '../../src/types/main.js'

test.group('Mqtt Transport', (group) => {
  let hiveMqContainer: StartedHiveMQContainer
  let emqxContainer: StartedTestContainer
  let mosquittoContainer: StartedTestContainer

  group.setup(async () => {
    hiveMqContainer = await new HiveMQContainer()
      .withExposedPorts({
        container: 1883,
        host: 1884,
      })
      .start()
    emqxContainer = await new GenericContainer('emqx/emqx').withExposedPorts(1883).start()
    mosquittoContainer = await new GenericContainer('eclipse-mosquitto')
      .withExposedPorts({
        container: 1883,
        host: 1885,
      })
      .withCopyFilesToContainer([
        {
          source: './config/mosquitto.conf',
          target: '/mosquitto/config/mosquitto.conf',
        },
      ])
      .start()

    return async () => {
      await hiveMqContainer.stop()
      await emqxContainer.stop()
      await mosquittoContainer.stop()
    }
  })

  test('HiveMQ transport should not receive message emitted by itself', async ({
    assert,
    cleanup,
  }) => {
    const transport = new MqttTransport({
      host: hiveMqContainer.getHost(),
      port: hiveMqContainer.getPort(),
    }).setId('bus')
    cleanup(() => transport.disconnect())

    await transport.subscribe('testing-channel', () => {
      assert.fail('Bus should not receive message emitted by itself')
    })

    await transport.publish('testing-channel', 'test')
    await setTimeout(1000)
  }).disableTimeout()

  test('HiveMQ transport should receive message emitted by another bus', async ({
    assert,
    cleanup,
  }, done) => {
    assert.plan(1)

    const transport1 = new MqttTransport({
      host: hiveMqContainer.getHost(),
      port: hiveMqContainer.getPort(),
    }).setId('bus1')
    const transport2 = new MqttTransport({
      host: hiveMqContainer.getHost(),
      port: hiveMqContainer.getPort(),
    }).setId('bus2')

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

  test('HiveMQ message should be encoded and decoded correctly when using JSON encoder', async ({
    assert,
    cleanup,
  }, done) => {
    assert.plan(1)
    const transport1 = new MqttTransport(
      {
        host: hiveMqContainer.getHost(),
        port: hiveMqContainer.getPort(),
      },
      new JsonEncoder()
    ).setId('bus1')
    const transport2 = new MqttTransport(
      {
        host: hiveMqContainer.getHost(),
        port: hiveMqContainer.getPort(),
      },
      new JsonEncoder()
    ).setId('bus2')

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

  test('HiveMQ send binary data', async ({ assert, cleanup }, done) => {
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

    const transport1 = new MqttTransport(
      { host: hiveMqContainer.getHost(), port: hiveMqContainer.getPort() },
      new BinaryEncoder()
    ).setId('bus1')

    const transport2 = new MqttTransport(
      { host: hiveMqContainer.getHost(), port: hiveMqContainer.getPort() },
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

  test('EMQX transport should not receive message emitted by itself', async ({
    assert,
    cleanup,
  }) => {
    const transport = new MqttTransport({
      host: emqxContainer.getHost(),
      port: emqxContainer.getMappedPort(1883),
    }).setId('bus')
    cleanup(() => transport.disconnect())

    await transport.subscribe('testing-channel', () => {
      assert.fail('Bus should not receive message emitted by itself')
    })

    await transport.publish('testing-channel', 'test')
    await setTimeout(1000)
  }).disableTimeout()

  test('EMQX transport should receive message emitted by another bus', async ({
    assert,
    cleanup,
  }, done) => {
    assert.plan(1)

    const transport1 = new MqttTransport({
      host: emqxContainer.getHost(),
      port: emqxContainer.getMappedPort(1883),
    }).setId('bus1')
    const transport2 = new MqttTransport({
      host: emqxContainer.getHost(),
      port: emqxContainer.getMappedPort(1883),
    }).setId('bus2')

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

  test('EMQX message should be encoded and decoded correctly when using JSON encoder', async ({
    assert,
    cleanup,
  }, done) => {
    assert.plan(1)
    const transport1 = new MqttTransport(
      {
        host: emqxContainer.getHost(),
        port: emqxContainer.getMappedPort(1883),
      },
      new JsonEncoder()
    ).setId('bus1')
    const transport2 = new MqttTransport(
      {
        host: emqxContainer.getHost(),
        port: emqxContainer.getMappedPort(1883),
      },
      new JsonEncoder()
    ).setId('bus2')
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

  test('EMQX send binary data', async ({ assert, cleanup }, done) => {
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

    const transport1 = new MqttTransport(
      { host: emqxContainer.getHost(), port: emqxContainer.getMappedPort(1883) },
      new BinaryEncoder()
    ).setId('bus1')

    const transport2 = new MqttTransport(
      { host: emqxContainer.getHost(), port: emqxContainer.getMappedPort(1883) },
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

  test('Mosquitto transport should not receive message emitted by itself', async ({
    assert,
    cleanup,
  }) => {
    const transport = new MqttTransport({
      host: mosquittoContainer.getHost(),
      port: mosquittoContainer.getMappedPort(1883),
    }).setId('bus')
    cleanup(() => transport.disconnect())

    await transport.subscribe('testing-channel', () => {
      assert.fail('Bus should not receive message emitted by itself')
    })

    await transport.publish('testing-channel', 'test')
    await setTimeout(1000)
  }).disableTimeout()

  test('Mosquitto transport should receive message emitted by another bus', async ({
    assert,
    cleanup,
  }, done) => {
    assert.plan(1)

    const transport1 = new MqttTransport({
      host: mosquittoContainer.getHost(),
      port: mosquittoContainer.getMappedPort(1883),
    }).setId('bus1')
    const transport2 = new MqttTransport({
      host: mosquittoContainer.getHost(),
      port: mosquittoContainer.getMappedPort(1883),
    }).setId('bus2')

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

  test('Mosquitto message should be encoded and decoded correctly when using JSON encoder', async ({
    assert,
    cleanup,
  }, done) => {
    assert.plan(1)
    const transport1 = new MqttTransport(
      {
        host: mosquittoContainer.getHost(),
        port: mosquittoContainer.getMappedPort(1883),
      },
      new JsonEncoder()
    ).setId('bus1')
    const transport2 = new MqttTransport(
      {
        host: mosquittoContainer.getHost(),
        port: mosquittoContainer.getMappedPort(1883),
      },
      new JsonEncoder()
    ).setId('bus2')
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

  test('Mosquitto send binary data', async ({ assert, cleanup }, done) => {
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

    const transport1 = new MqttTransport(
      { host: mosquittoContainer.getHost(), port: mosquittoContainer.getMappedPort(1883) },
      new BinaryEncoder()
    ).setId('bus1')

    const transport2 = new MqttTransport(
      { host: mosquittoContainer.getHost(), port: mosquittoContainer.getMappedPort(1883) },
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
})
