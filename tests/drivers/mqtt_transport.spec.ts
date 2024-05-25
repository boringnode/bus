/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright Boring Node
 */

import { setTimeout } from 'node:timers/promises'
import { test } from '@japa/runner'
import { HiveMQContainer, StartedHiveMQContainer } from '@testcontainers/hivemq'
import { MqttTransport } from '../../src/transports/mqtt.js'
import { JsonEncoder } from '../../src/encoders/json_encoder.js'
import { TransportEncoder, TransportMessage } from '../../src/types/main.js'

test.group('Mqtt Transport', (group) => {
  let container: StartedHiveMQContainer

  group.setup(async () => {
    container = await new HiveMQContainer().start()

    return async () => {
      await container.stop()
    }
  })

  test('transport should not receive message emitted by itself', async ({ assert, cleanup }) => {
    const transport = new MqttTransport({
      host: container.getHost(),
      port: container.getPort(),
    }).setId('bus')
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

    const transport1 = new MqttTransport({
      host: container.getHost(),
      port: container.getPort(),
    }).setId('bus1')
    const transport2 = new MqttTransport({
      host: container.getHost(),
      port: container.getPort(),
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

  test('message should be encoded and decoded correctly when using JSON encoder', async ({
    assert,
    cleanup,
  }) => {
    const transport = new MqttTransport(
      {
        host: container.getHost(),
        port: container.getPort(),
      },
      new JsonEncoder()
    ).setId('bus')
    cleanup(() => transport.disconnect())

    const data = { test: 'test' }

    await transport.subscribe('testing-channel', (payload) => {
      assert.deepEqual(payload, data)
    })

    await setTimeout(200)

    await transport.publish('testing-channel', data)
  })

  test('send binary data', async ({ assert, cleanup }, done) => {
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
      { host: container.getHost(), port: container.getMappedPort(1883) },
      new BinaryEncoder()
    ).setId('bus1')

    const transport2 = new MqttTransport(
      { host: container.getHost(), port: container.getMappedPort(1883) },
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
