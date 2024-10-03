<div align="center">
  <img src="https://github.com/user-attachments/assets/04d2c9b7-9b36-4e17-8bd6-ab8fe85dadbf" alt="@boringnode/bus">
</div>

<div align="center">

[![typescript-image]][typescript-url]
[![gh-workflow-image]][gh-workflow-url]
[![npm-image]][npm-url]
[![npm-download-image]][npm-download-url]
[![license-image]][license-url]

</div>

<hr />

`@boringnode/bus` is a service bus implementation for Node.js. It is designed to be simple and easy to use.

Currently, it supports the following transports:

<p>
👉 <strong>Memory:</strong> A simple in-memory transport for testing purposes.<br />
👉 <strong>Redis:</strong> A Redis transport for production usage.
👉 <strong>Mqtt:</strong> A Mqtt transport for production usage.
</p>

## Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [Installation](#installation)
- [Usage](#usage)
- [Retry Queue](#retry-queue)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Installation

```bash
npm install @boringnode/bus
```

## Usage

The module exposes a manager that can be used to register buses.

```typescript
import { BusManager } from '@boringnode/bus'
import { redis } from '@boringnode/bus/transports/redis'
import { mqtt } from '@boringnode/bus/transports/mqtt'
import { memory } from '@boringnode/bus/transports/memory'

const manager = new BusManager({
  default: 'main',
  transports: {
    main: {
      transport: memory(),
    },
    redis: {
      transport: redis({
        host: 'localhost',
        port: 6379,
      }),
    },
    mqtt: {
      transport: mqtt({
        host: 'localhost',
        port: 1883,
      }),
    },
  }
})
```

Once the manager is created, you can subscribe to channels and publish messages.

```typescript
manager.subscribe('channel', (message) => {
  console.log('Received message', message)
})

manager.publish('channel', 'Hello world')
```

By default, the bus will use the `default` transport. You can specify different transport by using the `use` method.

```typescript
manager.use('redis').publish('channel', 'Hello world')
manager.use('mqtt').publish('channel', 'Hello world')
```

### Without the manager

If you don't need multiple buses, you can create a single bus directly by importing the transports and the Bus class.

```typescript
import { Bus } from '@boringnode/bus'
import { RedisTransport } from '@boringnode/bus/transports/redis'

const transport = new RedisTransport({
  host: 'localhost',
  port: 6379,
})

const bus = new Bus(transport, {
  retryQueue: {
    retryInterval: '100ms'
  }
})
```

## Retry Queue

The bus also supports a retry queue. When a message fails to be published, it will be moved to the retry queue.

For example, your Redis server is down.

```typescript
const manager = new BusManager({
  default: 'main',
  transports: {
    main: {
      transport: redis({
        host: 'localhost',
        port: 6379,
      }),
      retryQueue: {
        retryInterval: '100ms'
      }
    },
  }
})

manager.use('redis').publish('channel', 'Hello World')
```

The message will be moved to the retry queue and will be retried every 100ms.

You have multiple options to configure the retry queue.

```typescript
export interface RetryQueueOptions {
  // Enable the retry queue (default: true)
  enabled?: boolean
  
  // Defines if we allow duplicates messages in the retry queue (default: true)
  removeDuplicates?: boolean
  
  // The maximum size of the retry queue (default: null)
  maxSize?: number | null
  
  // The interval between each retry (default: false)
  retryInterval?: Duration | false
}
```

## Test helpers

The module also provides some test helpers to make it easier to test the code that relies on the bus. First, you can use the `MemoryTransport` to create a bus that uses an in-memory transport.

You can also use the `ChaosTransport` to simulate a transport that fails randomly, in order to test the resilience of your code.

```ts
import { Bus } from '@boringnode/bus'
import { ChaosTransport } from '@boringnode/bus/test_helpers'

const buggyTransport = new ChaosTransport(new MemoryTransport())
const bus = new Bus(buggyTransport)

/**
 * Now, every time you will try to publish a message, the transport 
 * will throw an error.
 */
buggyTransport.alwaysThrow()
```

[gh-workflow-image]: https://img.shields.io/github/actions/workflow/status/boringnode/bus/checks.yml?branch=main&style=for-the-badge
[gh-workflow-url]: https://github.com/boringnode/bus/actions/workflows/checks.yml
[npm-image]: https://img.shields.io/npm/v/@boringnode/bus.svg?style=for-the-badge&logo=npm
[npm-url]: https://www.npmjs.com/package/@boringnode/bus
[npm-download-image]: https://img.shields.io/npm/dm/@boringnode/bus?style=for-the-badge
[npm-download-url]: https://www.npmjs.com/package/@boringnode/bus
[typescript-image]: https://img.shields.io/badge/Typescript-294E80.svg?style=for-the-badge&logo=typescript
[typescript-url]: https://www.typescriptlang.org
[license-image]: https://img.shields.io/npm/l/@boringnode/bus?color=blueviolet&style=for-the-badge
[license-url]: LICENSE.md
