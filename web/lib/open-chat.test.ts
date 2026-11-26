import { test } from 'node:test'
import assert from 'node:assert/strict'
import { follows } from './open-chat'

const all = () => true
test('a page follows the chat opened elsewhere, but never while it is in use', () => {
  const open = { sessionId: 'a', at: 100 }
  assert.equal(follows(open, 50, false, all), true)
  assert.equal(follows(open, 50, true, all), false)
  // Just loaded: it starts on what is open.
  assert.equal(follows(open, 0, true, all), true)
  // Its own pick came later.
  assert.equal(follows(open, 100, false, all), false)
  // Not listed yet, or outside the project filter.
  assert.equal(follows(open, 50, false, id => id !== 'a'), false)
  assert.equal(follows(undefined, 0, false, all), false)
})
