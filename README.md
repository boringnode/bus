<div align="center">
  <img src="https://github.com/RomainLanz/bus/assets/2793951/fb93dc3d-d05d-40e4-a66b-35bb2a161750" alt="@rlanz/bus">
</div>

<div align="center">

[![typescript-image]][typescript-url]
[![gh-workflow-image]][gh-workflow-url]
[![npm-image]][npm-url]
[![npm-download-image]][npm-download-url]
[![license-image]][license-url]

</div>

<hr />

`@rlanz/bus` is a service bus implementation for Node.js. It is designed to be simple and easy to use.

Currently, it supports the following drivers:

<p>
👉 <strong>Memory:</strong> A simple in-memory driver for testing purposes.<br />
👉 <strong>Redis:</strong> A Redis driver for production usage.
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
npm install @rlanz/bus
```

## Usage

The module exposes a manager that can be used to register buses.

```typescript
import { BusManager } from '@rlanz/bus'
import { redis } from "@rlanz/bus/drivers/redis"
import { memory } from "@rlanz/bus/drivers/memory"

const manager = new BusManager({
  default: 'main',
  transports: {
    main: {
      driver: memory(),
    },
    redis: {
      driver: redis({
        host: 'localhost',
        port: 6379,
      }),
    }
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
```

## Retry Queue

The bus also supports a retry queue. When a message fails to be published, it will be moved to the retry queue.

For example, your Redis server is down.

```typescript
const manager = new BusManager({
  default: 'main',
  transports: {
    main: {
      driver: redis({
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

[gh-workflow-image]: https://img.shields.io/github/actions/workflow/status/romainlanz/bus/test.yml?branch=main&style=for-the-badge
[gh-workflow-url]: https://github.com/romainlanz/bus/actions/workflows/test.yml
[npm-image]: https://img.shields.io/npm/v/@rlanz/bus.svg?style=for-the-badge&logo=npm
[npm-url]: https://www.npmjs.com/package/@rlanz/bus
[npm-download-image]: https://img.shields.io/npm/dm/@rlanz/bus?style=for-the-badge
[npm-download-url]: https://www.npmjs.com/package/@rlanz/bus
[typescript-image]: https://img.shields.io/badge/Typescript-294E80.svg?style=for-the-badge&logo=typescript
[typescript-url]: https://www.typescriptlang.org
[license-image]: https://img.shields.io/npm/l/@rlanz/bus?color=blueviolet&style=for-the-badge
[license-url]: LICENSE.md
