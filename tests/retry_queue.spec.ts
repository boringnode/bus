/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright BoringNode
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

  test('should process queued messages only once when processing concurrently', async ({
    assert,
  }) => {
    const queue = new RetryQueue({ removeDuplicates: false })
    const processedMessages: string[] = []
    let notifyHandlerStarted!: () => void
    const handlerStarted = new Promise<void>((resolve) => (notifyHandlerStarted = resolve))
    let releaseHandlers!: () => void
    const handlersReleased = new Promise<void>((resolve) => (releaseHandlers = resolve))

    queue.enqueue(channel, { busId: 'testing', payload: 'foo' })
    queue.enqueue(channel, { busId: 'testing', payload: 'bar' })

    const handler = async (_channel: string, message: { payload: any }) => {
      processedMessages.push(message.payload)
      notifyHandlerStarted()
      await handlersReleased
      return true
    }

    const firstProcessing = queue.process(handler)
    await handlerStarted
    const secondProcessing = queue.process(handler)
    releaseHandlers()

    await Promise.all([firstProcessing, secondProcessing])

    assert.deepEqual(processedMessages, ['foo', 'bar'])
  })

  test('should process queued messages only once when processing is reentrant', async ({
    assert,
  }) => {
    const queue = new RetryQueue({ removeDuplicates: false })
    const processedMessages: string[] = []
    let didReenter = false
    let reentrantProcessing: Promise<void> | undefined

    queue.enqueue(channel, { busId: 'testing', payload: 'foo' })
    queue.enqueue(channel, { busId: 'testing', payload: 'bar' })

    const handler = async (_channel: string, message: { payload: any }) => {
      processedMessages.push(message.payload)

      if (!didReenter) {
        didReenter = true
        reentrantProcessing = queue.process(handler)
      }

      return true
    }

    const processing = queue.process(handler)
    await Promise.all([processing, reentrantProcessing!])

    assert.deepEqual(processedMessages, ['foo', 'bar'])
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
      queuedItems.map((i) => i!.payload),
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

  test('enqueues and processes the same payload for different channels', async ({ assert }) => {
    const queue = new RetryQueueWithoutDuplicates()
    const processedChannels: string[] = []

    assert.isTrue(queue.enqueue('first-channel', { busId: 'testing', payload: 'foo' }))
    assert.isTrue(queue.enqueue('second-channel', { busId: 'testing', payload: 'foo' }))
    assert.equal(queue.size(), 2)

    await queue.process(async (processedChannel) => {
      processedChannels.push(processedChannel)
      return true
    })

    assert.deepEqual(processedChannels, ['first-channel', 'second-channel'])
    assert.equal(queue.size(), 0)
  })

  test('does not evict a queued message when rejecting a duplicate at max size', ({ assert }) => {
    const queue = new RetryQueueWithoutDuplicates({ maxSize: 2 })

    queue.enqueue(channel, { busId: 'testing', payload: 'foo' })
    queue.enqueue(channel, { busId: 'testing', payload: 'bar' })

    assert.isFalse(queue.enqueue(channel, { busId: 'testing', payload: 'bar' }))
    assert.equal(queue.size(), 2)
    assert.equal(queue.dequeue()!.payload, 'foo')
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
