/** Approve: which done chats wait for Kenneth, and what the check line and Send back say. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { approveBlock, checkLine, plainBlock, plainCheck, reviewQueue, sendBackText } from './approve'
import type { Ask, ChatProgress } from './hub-types'

test('the check line', () => {
  assert.equal(checkLine(undefined), undefined)
  assert.equal(checkLine({ verified: true }), 'Verified')
  assert.equal(checkLine({ verified: false }), 'Unverified')
  assert.equal(checkLine({ verified: false, missing: ['tests', 'lint'] }), 'Unverified: tests, lint')
})

test('plain wording for Simple view', () => {
  assert.equal(plainCheck(undefined), undefined)
  assert.equal(plainCheck({ verified: true }), 'Checked and ready')
  assert.equal(plainCheck({ verified: false }), 'Not checked yet')
  assert.equal(plainCheck({ verified: false, missing: ['tests after last edit', 'standup'] }), 'Not checked yet. Still needed: tests run after the last change, a short summary of what it did')
  assert.equal(plainBlock('1 open task'), '1 task is not finished')
  assert.equal(plainBlock('2 open tasks'), '2 tasks are not finished')
  assert.equal(plainBlock('the chat is still working'), 'it is still working')
  assert.equal(plainBlock('subagents still running: q1'), 'its helpers are still running')
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

test('review queue: done chats and the closing question, oldest wait first', () => {
  const p = (sessionId: string, x: Partial<ChatProgress>) => ({ sessionId, cwd: '/r', state: 'working', roles: [], tasks: [], startedAt: 0, at: 0, ...x }) as ChatProgress
  const closing: Ask = { id: 'a', kind: 'question', tool: 'AskUserQuestion', options: [], questions: [{ question: 'Approve this chat as finished?', options: ['Approve', 'Send back'] }] }
  const other = { ...closing, questions: [{ question: 'Which colour?', options: ['Red', 'Blue'] }] }
  assert.deepEqual(reviewQueue([
    p('new-done', { state: 'done', at: 900, finishedAt: 500 }),
    p('working', { state: 'working', at: 1 }),
    p('asks-colour', { state: 'needs-you', at: 2, ask: other }),
    p('sub-closing', { state: 'needs-you', at: 3, ask: { ...closing, sub: true } }),
    p('old-closing', { state: 'needs-you', at: 100, ask: closing }),
    p('old-done', { state: 'done', at: 50 }),
  ]), ['old-done', 'old-closing', 'new-done'])
})
