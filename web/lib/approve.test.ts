/** Approve: which done chats wait for Kenneth, and what the check line and Send back say. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkLine, sendBackText } from './approve'

test('the check line', () => {
  assert.equal(checkLine(undefined), undefined)
  assert.equal(checkLine({ verified: true }), 'Verified')
  assert.equal(checkLine({ verified: false }), 'Unverified')
  assert.equal(checkLine({ verified: false, missing: ['tests', 'lint'] }), 'Unverified: tests, lint')
})

test('send back names what is missing', () => {
  assert.match(sendBackText({ verified: false, missing: ['tests'] }), /missing: tests/)
  assert.match(sendBackText(undefined), /fix what is missing/)
})
