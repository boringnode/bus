/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import { test } from '@japa/runner'
import { RetryQueue } from '../src/retry_queue.js'
import { RetryQueueWithoutDuplicates } from '../src/retry_queue_without_duplicates.js'
import { RetryQueueWithDuplicates } from '../src/retry_queue_with_duplicates.js'

const channel = 'testing'

test.group('RetryQueue', () => {
  test('should create a queue without duplicates', ({ assert }) => {
    const queue = new RetryQueue({ removeDuplicates: true })

    assert.instanceOf(queue.getInternalQueue(), RetryQueueWithoutDuplicates)
  })

  test('should create a queue with duplicates', ({ assert }) => {
    const queue = new RetryQueue({ removeDuplicates: false })

    assert.instanceOf(queue.getInternalQueue(), RetryQueueWithDuplicates)
  })
})

test.group('RetryQueueWithDuplicates', () => {
  test('does insert duplicates', ({ assert }) => {
    const queue = new RetryQueueWithDuplicates()

    const firstEnqueueResult = queue.enqueue(channel, { busId: 'testing', payload: 'foo' })
    const firstQueueSizeSnapshot = queue.size()
    assert.equal(firstEnqueueResult, true)

    const secondEnqueueResult = queue.enqueue(channel, { busId: 'testing', payload: 'foo' })
    const secondQueueSizeSnapshot = queue.size()
    assert.equal(secondEnqueueResult, true)

    assert.equal(firstQueueSizeSnapshot, 1)
    assert.equal(secondQueueSizeSnapshot, 2)
  })

  test('should enqueue multiple messages', ({ assert }) => {
    const queue = new RetryQueueWithDuplicates()

    queue.enqueue(channel, { busId: 'testing', payload: 'foo' })
    const firstQueueSizeSnapshot = queue.size()

    queue.enqueue(channel, { busId: 'testing', payload: 'bar' })
    const secondQueueSizeSnapshot = queue.size()

    assert.equal(firstQueueSizeSnapshot, 1)
    assert.equal(secondQueueSizeSnapshot, 2)
  })

  test('should remove first inserted message if max size is reached', ({ assert }) => {
    const queue = new RetryQueueWithDuplicates({ maxSize: 5 })

    for (let i = 0; i < 5; i++) {
      queue.enqueue(channel, { busId: 'testing', payload: i })
    }

    const firstQueueSizeSnapshot = queue.size()

    queue.enqueue(channel, { busId: 'testing', payload: 5 })
    const secondQueueSizeSnapshot = queue.size()

    assert.equal(firstQueueSizeSnapshot, 5)
    assert.equal(secondQueueSizeSnapshot, 5)

    const queuedItems = []
    while (queue.size() > 0) queuedItems.push(queue.dequeue())

    assert.deepEqual(
      queuedItems.map((i) => i.payload),
      [1, 2, 3, 4, 5]
    )
  })

  test('should call handler for each message', async ({ assert }) => {
    const queue = new RetryQueueWithDuplicates()

    for (let i = 0; i < 5; i++) {
      queue.enqueue(channel, { busId: 'testing', payload: i })
    }

    let count = 0
    await queue.process(async (_channel, message) => {
      assert.equal(message.payload, count++)
      return true
    })

    assert.equal(count, 5)
  })

  test('should stop processing and re-add message to the queue if handler returns false', async ({
    assert,
  }) => {
    const queue = new RetryQueueWithDuplicates()

    for (let i = 0; i < 5; i++) {
      queue.enqueue(channel, { busId: 'testing', payload: i })
    }

    let count = 0
    await queue.process(async () => {
      return ++count !== 3
    })

    assert.equal(count, 3)
    assert.equal(queue.size(), 3)
  })

  test('should stop processing and re-add message to the queue if handler throws an error', async ({
    assert,
  }) => {
    const queue = new RetryQueueWithDuplicates()

    for (let i = 0; i < 5; i++) {
      queue.enqueue(channel, { busId: 'testing', payload: i })
    }

    let count = 0
    await queue.process(async () => {
      if (++count === 3) throw new Error('test')
      return true
    })

    assert.equal(count, 3)
    assert.equal(queue.size(), 3)
  })
})

test.group('RetryQueueWithoutDuplicates', () => {
  test('does not insert duplicates', ({ assert }) => {
    const queue = new RetryQueueWithoutDuplicates()

    const firstEnqueueResult = queue.enqueue(channel, { busId: 'testing', payload: 'foo' })
    const firstQueueSizeSnapshot = queue.size()
    assert.equal(firstEnqueueResult, true)

    const secondEnqueueResult = queue.enqueue(channel, { busId: 'testing', payload: 'foo' })
    const secondQueueSizeSnapshot = queue.size()
    assert.equal(secondEnqueueResult, false)

    assert.equal(firstQueueSizeSnapshot, 1)
    assert.equal(secondQueueSizeSnapshot, 1)
  })

  test('does not insert duplicates with same payload but different order', ({ assert }) => {
    const queue = new RetryQueueWithoutDuplicates()

    const firstEnqueueResult = queue.enqueue(channel, {
      busId: 'testing',
      payload: { test: 'foo', test2: 'bar' },
    })
    const firstQueueSizeSnapshot = queue.size()
    assert.equal(firstEnqueueResult, true)

    const secondEnqueueResult = queue.enqueue(channel, {
      busId: 'testing',
      payload: { test2: 'bar', test: 'foo' },
    })
    const secondQueueSizeSnapshot = queue.size()
    assert.equal(secondEnqueueResult, false)

    assert.equal(firstQueueSizeSnapshot, 1)
    assert.equal(secondQueueSizeSnapshot, 1)
  })

  test('should enqueue multiple messages', ({ assert }) => {
    const queue = new RetryQueueWithoutDuplicates()

    queue.enqueue(channel, { busId: 'testing', payload: 'foo' })
    const firstQueueSizeSnapshot = queue.size()

    queue.enqueue(channel, { busId: 'testing', payload: 'bar' })
    const secondQueueSizeSnapshot = queue.size()

    assert.equal(firstQueueSizeSnapshot, 1)
    assert.equal(secondQueueSizeSnapshot, 2)
  })

  test('should remove first inserted message if max size is reached', ({ assert }) => {
    const queue = new RetryQueueWithoutDuplicates({ maxSize: 5 })

    for (let i = 0; i < 5; i++) {
      queue.enqueue(channel, { busId: 'testing', payload: i })
    }

    const firstQueueSizeSnapshot = queue.size()

    queue.enqueue(channel, { busId: 'testing', payload: 5 })
    const secondQueueSizeSnapshot = queue.size()

    assert.equal(firstQueueSizeSnapshot, 5)
    assert.equal(secondQueueSizeSnapshot, 5)

    const queuedItems = []
    while (queue.size() > 0) queuedItems.push(queue.dequeue())

    assert.deepEqual(
      queuedItems.map((i) => i.payload),
      [1, 2, 3, 4, 5]
    )
  })

  test('should call handler for each message', async ({ assert }) => {
    const queue = new RetryQueueWithoutDuplicates()

    for (let i = 0; i < 5; i++) {
      queue.enqueue(channel, { busId: 'testing', payload: i })
    }

    let count = 0
    await queue.process(async (_channel, message) => {
      assert.equal(message.payload, count++)
      return true
    })

    assert.equal(count, 5)
  })

  test('should stop processing and re-add message to the queue if handler returns false', async ({
    assert,
  }) => {
    const queue = new RetryQueueWithoutDuplicates()

    for (let i = 0; i < 5; i++) {
      queue.enqueue(channel, { busId: 'testing', payload: i })
    }

    let count = 0
    await queue.process(async () => {
      return ++count !== 3
    })

    assert.equal(count, 3)
    assert.equal(queue.size(), 3)
  })

  test('should stop processing and re-add message to the queue if handler throws an error', async ({
    assert,
  }) => {
    const queue = new RetryQueueWithoutDuplicates()

    for (let i = 0; i < 5; i++) {
      queue.enqueue(channel, { busId: 'testing', payload: i })
    }

    let count = 0
    await queue.process(async () => {
      if (++count === 3) throw new Error('test')
      return true
    })

    assert.equal(count, 3)
    assert.equal(queue.size(), 3)
  })
})
