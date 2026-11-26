import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHECK_BACK_MAX, CHECK_BACK_TEXT, checkBackText, dueCheckBacks, hasOpenWork } from '../src/hub/checkback'

const MIN = 60_000
const chat = (o: object = {}) => ({ sessionId: 'a', status: 'idle', updatedAt: 0, takes: true, open: true, ...o })

test('check-back: due once idle for the interval with open work', () => {
  const s = { a: { everyMin: 10 as const, count: 0 } }
  assert.deepEqual(dueCheckBacks(9 * MIN, [chat()], s), [])
  assert.deepEqual(dueCheckBacks(10 * MIN, [chat()], s), ['a'])
})

test('check-back: lastAt resets the clock, count caps at 12', () => {
  assert.deepEqual(dueCheckBacks(15 * MIN, [chat()], { a: { everyMin: 10, count: 1, lastAt: 10 * MIN } }), [])
  assert.deepEqual(dueCheckBacks(20 * MIN, [chat()], { a: { everyMin: 10, count: 1, lastAt: 10 * MIN } }), ['a'])
  assert.deepEqual(dueCheckBacks(99 * MIN, [chat()], { a: { everyMin: 10, count: CHECK_BACK_MAX } }), [])
})

test('check-back: skips busy, closed, unowned, no-work and unset chats', () => {
  const s = { a: { everyMin: 10 as const, count: 0 } }
  for (const o of [{ status: 'busy' }, { stopped: true }, { takes: false }, { open: false }, { updatedAt: undefined }]) assert.deepEqual(dueCheckBacks(60 * MIN, [chat(o)], s), [])
  assert.deepEqual(dueCheckBacks(60 * MIN, [chat()], {}), [])
})

test('check-back: a custom prompt fires with no open work; the default text needs it', () => {
  assert.deepEqual(dueCheckBacks(30 * MIN, [chat({ open: false })], { a: { everyMin: 30, count: 0, text: 'check the inbox' } }), ['a'])
  assert.deepEqual(dueCheckBacks(30 * MIN, [chat({ open: false })], { a: { everyMin: 30, count: 0 } }), [])
  assert.equal(checkBackText({ everyMin: 30, count: 0, text: 'check the inbox' }), 'check the inbox')
  assert.equal(checkBackText({ everyMin: 30, count: 0 }), CHECK_BACK_TEXT)
})

test('hasOpenWork: an open task, a running agent or a background job', () => {
  assert.equal(hasOpenWork(undefined), false)
  assert.equal(hasOpenWork({ tasks: [{ status: 'completed' }], running: [], jobs: [] } as never), false)
  assert.equal(hasOpenWork({ tasks: [{ status: 'pending' }] } as never), true)
  assert.equal(hasOpenWork({ tasks: [], jobs: [{}] } as never), true)
  assert.equal(hasOpenWork({ tasks: [], running: ['x'] } as never), true)
})
