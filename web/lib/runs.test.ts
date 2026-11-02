/** The node drawer's labels: tool kinds, status tones, durations, token counts and a role's own time left. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clockDur, count, kindOf, roleLeft, runState, statusTone, type RunDetail } from './runs'
import type { ChatProgress } from './hub-types'

const MIN = 60e3

test('kindOf: reads, searches, edits and runs, like the Lanes ticks', () => {
  assert.deepEqual(['Read', 'Grep', 'Edit', 'Write', 'Bash', 'mcp__x__y', 'Agent'].map(kindOf), ['read', 'search', 'edit', 'edit', 'run', 'run', 'other'])
})

test('statusTone: blocked beats concerns beats done', () => {
  assert.equal(statusTone('done with concerns'), 'concerns')
  assert.equal(statusTone('Blocked: needs the key'), 'blocked')
  assert.equal(statusTone('done'), 'done')
  assert.equal(statusTone('in review'), undefined)
  assert.equal(statusTone(), undefined)
})

test('clockDur and count stay short', () => {
  assert.equal(clockDur(45_000), '45s')
  assert.equal(clockDur(10 * MIN + 5000), '10m 05s')
  assert.equal(clockDur(80 * MIN), '1h 20m')
  assert.equal(count(950), '950')
  assert.equal(count(412_300), '412k')
  assert.equal(count(12_600_000), '12.6M')
})

const p = (over: Partial<ChatProgress>): ChatProgress => ({ sessionId: 's', cwd: '/r', state: 'working', roles: [], tasks: [], startedAt: 0, at: 0, ...over })

test('runState: progress first, else whether the transcript finished', () => {
  const run = { id: 'a1', finished: false } as RunDetail
  assert.equal(runState(run), 'active')
  assert.equal(runState({ ...run, finished: true }), 'done')
  assert.equal(runState(run, p({ roles: [{ id: 'a1', role: 'qa', state: 'done', startedAt: 0 }] })), 'done')
})

test('roleLeft: only while that role runs, against its own past runs', () => {
  const past = [10, 12, 14].map((m, i) => ({ id: `d${i}`, role: 'qa', state: 'done' as const, startedAt: 0, at: m * MIN }))
  const now = 5 * MIN
  const chat = p({ roles: [...past, { id: 'q', role: 'qa', state: 'active', startedAt: 0 }, { id: 'e', role: 'engineer', state: 'active', startedAt: 0 }], running: ['q', 'e'] })
  assert.equal(roleLeft(chat, [chat], 'designer', now), undefined)
  const left = roleLeft(chat, [chat], 'qa', now)
  assert.ok(left && typeof left === 'object' && left.hi > 0)
  // The engineer has no history, so it is still estimating; qa's number is not held up by it.
  assert.equal(roleLeft(chat, [chat], 'engineer', now), 'estimating')
})
