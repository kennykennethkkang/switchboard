/** Approve: which done chats wait for Kenneth, and what the check line and Send back say. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { approveBlock, checkLine, sendBackText } from './approve'
import type { ChatProgress } from './hub-types'

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

test('approveBlock mirrors the extension: working, live subagents, open tasks', () => {
  const now = 1e9
  const base = { sessionId: 's', cwd: '/x', state: 'needs-you', roles: [], tasks: [], startedAt: 0, at: 0 } as ChatProgress
  assert.equal(approveBlock(undefined, now), undefined)
  assert.equal(approveBlock(base, now), undefined)
  assert.equal(approveBlock({ ...base, state: 'working' }, now), 'the chat is still working')
  assert.equal(approveBlock({ ...base, running: ['q1'], roles: [{ id: 'q1', role: 'qa', state: 'active', startedAt: now - 60e3 }] }, now), 'subagents still running: q1')
  assert.equal(approveBlock({ ...base, running: ['q1'], roles: [{ id: 'q1', role: 'qa', state: 'active', startedAt: now - 11 * 60e3 }] }, now), undefined)
  assert.equal(approveBlock({ ...base, tasks: [{ id: '1', subject: 'a', status: 'pending' }] }, now), '1 open task')
  assert.equal(approveBlock({ ...base, tasks: [{ id: '1', subject: 'a', status: 'pending' }, { id: '2', subject: 'b', status: 'in_progress' }] }, now), '2 open tasks')
})
