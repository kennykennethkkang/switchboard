import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tuckNext } from './tuck'

test('tuckNext: hides on a scroll down past the top, shows on a scroll up', () => {
  assert.equal(tuckNext(0, 40, false), false, 'near the top it always shows')
  assert.equal(tuckNext(200, 230, false), true, 'scrolling down hides')
  assert.equal(tuckNext(230, 234, true), true, 'a small move keeps the state')
  assert.equal(tuckNext(400, 380, true), false, 'scrolling up shows')
  assert.equal(tuckNext(400, 60, true), false)
})
