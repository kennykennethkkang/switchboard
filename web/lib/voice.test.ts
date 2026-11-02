import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendHeard, stillSpoken, takesHeard } from './voice'

test('a transcript joins the draft with one space, or starts it', () => {
  assert.equal(appendHeard('', 'what is running'), 'what is running')
  assert.equal(appendHeard('  ', 'hi'), 'hi')
  assert.equal(appendHeard('start a chat to', 'fix the banner'), 'start a chat to fix the banner')
  assert.equal(appendHeard('fix it ', 'now'), 'fix it now')
})

test('only the view that tapped the mic takes the transcript, once', () => {
  assert.equal(takesHeard({ text: 'hi', at: 5 }, 3), true)
  assert.equal(takesHeard({ text: 'hi', at: 5 }, undefined), false)
  assert.equal(takesHeard({ text: 'hi', at: 2 }, 3), false)
  assert.equal(takesHeard(null, 3), false)
})

test('a draft is spoken only while it still holds the last transcript', () => {
  assert.equal(stillSpoken('start a chat to fix the banner', 'fix the banner'), true)
  assert.equal(stillSpoken('start a chat to fix the footer', 'fix the banner'), false)
  assert.equal(stillSpoken('anything', undefined), false)
})
