/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import { test } from '@japa/runner'
import { MessageHasher } from '../src/message_hasher.js'

test.group('Message hasher', () => {
  test('should hash message', ({ assert }) => {
    const hasher = new MessageHasher()

    assert.equal(hasher.hash({ foo: 'bar' }), hasher.hash({ foo: 'bar' }))
    assert.notEqual(hasher.hash({ foo: 'bar' }), hasher.hash({ foo: 'baz' }))
  })

  test('should hash message with different order', ({ assert }) => {
    const hasher = new MessageHasher()
    const hash1 = hasher.hash({ foo: 'bar', baz: 'qux' })
    const hash2 = hasher.hash({ baz: 'qux', foo: 'bar' })

    assert.equal(hash1, hash2)
  })

  test('should hash message with different order (nested)', ({ assert }) => {
    const hasher = new MessageHasher()
    const hash1 = hasher.hash({ foo: 'bar', baz: ['qux', 'quux'] })
    const hash2 = hasher.hash({ baz: ['qux', 'quux'], foo: 'bar' })

    assert.equal(hash1, hash2)
  })
})
