/** The chat's step and its time left, from its own pace so far. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { busyLine, eta, projectLeft, say, sayLeft, timeLeft } from './eta'
import type { ChatProgress } from './hub-types'

const MIN = 60e3
const base = { sessionId: 's', cwd: '/r', state: 'working' as const, roles: [], startedAt: 0, at: 0 }

test('eta: average of finished tasks times what is open, less time spent on the current one', () => {
  const p: ChatProgress = { ...base, tasks: [
    { id: '1', subject: 'a', status: 'completed', startedAt: 0, doneAt: 10 * MIN },
    { id: '2', subject: 'b', status: 'completed', startedAt: 10 * MIN, doneAt: 30 * MIN },
    { id: '3', subject: 'c', status: 'in_progress', startedAt: 30 * MIN },
    { id: '4', subject: 'd', status: 'pending' },
  ] }
  const e = eta(p, 35 * MIN)
  assert.equal(e.done, 2)
  assert.equal(e.current?.subject, 'c')
  assert.equal(e.perTaskMs, 15 * MIN)
  assert.equal(e.leftMs, 25 * MIN)
})

test('eta: no finished task means no estimate; untimed tasks spread the chat time', () => {
  assert.equal(eta({ ...base, tasks: [{ id: '1', subject: 'a', status: 'pending' }] }, MIN).leftMs, undefined)
  const old = eta({ ...base, tasks: [{ id: '1', subject: 'a', status: 'completed', doneAt: 20 * MIN }, { id: '2', subject: 'b', status: 'pending' }] }, 20 * MIN)
  assert.equal(old.leftMs, 20 * MIN)
})

test('say rounds to plain words', () => {
  assert.equal(say(20e3), 'under a minute')
  assert.equal(say(4 * MIN), 'about 4 min')
  assert.equal(say(118 * MIN), 'about 2 h')
  assert.equal(say(83 * MIN), 'about 1 h 25 min')
})

const qa = (id: string, mins: number) => ({ id, role: 'qa', state: 'done' as const, startedAt: 0, at: mins * MIN })
const past: ChatProgress = { ...base, sessionId: 'old', state: 'done', tasks: [], roles: [qa('a', 4), qa('b', 6), qa('c', 8), qa('d', 10)] }

test('timeLeft: a running subagent with a few past runs of its role gives a range from them', () => {
  const p: ChatProgress = { ...base, tasks: [], waiting: true, running: ['q'], roles: [{ id: 'q', role: 'qa', state: 'active', startedAt: 0 }] }
  const l = timeLeft(p, [p, past], 2 * MIN)
  assert.ok(l && typeof l === 'object')
  assert.equal(l.lo, 3.5 * MIN)
  assert.equal(l.hi, 6.5 * MIN)
  assert.equal(sayLeft(l), 'about 4 to 7 min left')
})

test('timeLeft: a subagent past the usual run of its role says so instead of a fixed range', () => {
  const p: ChatProgress = { ...base, tasks: [], waiting: true, running: ['q'], roles: [{ id: 'q', role: 'qa', state: 'active', startedAt: 0 }] }
  const l = timeLeft(p, [p, past], 9 * MIN)
  assert.equal(l, 'over')
  assert.equal(sayLeft(l!), 'running longer than usual')
  assert.deepEqual(projectLeft(['over', { lo: MIN, hi: 3 * MIN }]), { lo: MIN, hi: 3 * MIN, open: true })
})

test('timeLeft: too little history, or only shells, says estimating', () => {
  const p: ChatProgress = { ...base, tasks: [], waiting: true, running: ['e'], roles: [{ id: 'e', role: 'engineer', state: 'active', startedAt: 0 }] }
  assert.equal(timeLeft(p, [p, past], MIN), 'estimating')
  const shells: ChatProgress = { ...base, tasks: [], waiting: true, jobs: [{ id: 'j', startedAt: 0 }] }
  assert.equal(timeLeft(shells, [shells], MIN), 'estimating')
  assert.equal(sayLeft('estimating'), 'estimating time left')
})

test('timeLeft: hidden when nothing runs or the chat is not working', () => {
  assert.equal(timeLeft({ ...base, tasks: [] }, [], MIN), undefined)
  const p: ChatProgress = { ...base, state: 'idle', tasks: [{ id: '1', subject: 'a', status: 'completed', startedAt: 0, doneAt: MIN }, { id: '2', subject: 'b', status: 'pending' }] }
  assert.equal(timeLeft(p, [p], 2 * MIN), undefined)
})

test('timeLeft: tasks give a range around their pace; parallel parts take the longest; an unknown part makes it open ended', () => {
  const p: ChatProgress = { ...base, tasks: [
    { id: '1', subject: 'a', status: 'completed', startedAt: 0, doneAt: 10 * MIN },
    { id: '2', subject: 'b', status: 'pending' },
  ], running: ['q', 'e'], roles: [{ id: 'q', role: 'qa', state: 'active', startedAt: 0 }, { id: 'e', role: 'engineer', state: 'active', startedAt: 0 }] }
  const l = timeLeft(p, [p, past], 10 * MIN)
  assert.ok(l && typeof l === 'object')
  assert.deepEqual([l.lo, l.hi, l.open], [7.5 * MIN, 15 * MIN, true])
  assert.equal(sayLeft(l), 'at least 8 min left')
})

test('sayLeft: one number when the ends round the same, hours past an hour', () => {
  assert.equal(sayLeft({ lo: 4.9 * MIN, hi: 5.2 * MIN }), 'about 5 min left')
  assert.equal(sayLeft({ lo: 50 * MIN, hi: 90 * MIN }), 'about 50 min to 1 h 30 min left')
  assert.equal(sayLeft({ lo: 0, hi: 20e3 }), 'under a minute left')
})

test('projectLeft: busy chats run side by side, so the longest one sets it', () => {
  assert.deepEqual(projectLeft([{ lo: MIN, hi: 3 * MIN }, undefined, { lo: 2 * MIN, hi: 9 * MIN }]), { lo: 2 * MIN, hi: 9 * MIN })
  assert.equal(projectLeft(['estimating', undefined]), 'estimating')
  assert.equal(projectLeft([undefined]), undefined)
})

test('busyLine: what still runs, in plain words', () => {
  assert.equal(busyLine({ ...base, tasks: [], running: ['a', 'b', 'c'], jobs: [{ id: 'j', startedAt: 0 }] }), '3 agents, 1 shell running')
  assert.equal(busyLine({ ...base, tasks: [], running: ['a'] }), '1 agent running')
  assert.equal(busyLine({ ...base, tasks: [] }), undefined)
})
