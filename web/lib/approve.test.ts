/** Approve: which done chats wait for Kenneth, and what the check line and Send back say. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { awaiting, checkLine, sendBackText } from './approve'
import type { ArchivedChat, ChatProgress } from './hub-types'

const p = (sessionId: string, state: ChatProgress['state']) => ({ sessionId, cwd: '/p', state, roles: [], tasks: [], startedAt: 0, at: 0 }) as ChatProgress
const gone = { sessionId: 'b', archivedAt: 1 } as ArchivedChat

test('done chats not yet in History wait for approval', () => {
  assert.deepEqual(awaiting([p('a', 'done'), p('b', 'done'), p('c', 'working'), p('d', 'idle')], [gone]).map(x => x.sessionId), ['a'])
})

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
