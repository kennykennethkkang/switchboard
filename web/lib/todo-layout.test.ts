import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { TodoItem, TodoList } from './hub-types'
import { rowsOf, splitA, countA, stepTo, closedOf, toggled, waitText, snoozeTo, snoozed, liveSnoozes, splitKnown, DAY } from './todo-layout'

const now = 100 * DAY, no = () => false
const item = (id: string, more: Partial<TodoItem> = {}): TodoItem => ({ id, text: `do ${id}`, at: 1, ...more })
const ids = (rows: Array<{ t: TodoItem }>) => rows.map(r => r.t.id)

describe('rowsOf', () => {
  const list: TodoList = {
    todo: [item('r'), item('s', { stopped: true }), item('ok', { needsOk: true }), item('d', { notBefore: now + DAY }), item('y', { why: 'you' }), item('run', { chat: 'live' })],
    suggested: [item('s1'), item('s2')], ticked: [{ id: 'x', text: 'x', at: now - DAY }, { id: 'old', text: 'old', at: now - 30 * DAY }],
  }
  const live = (c?: string) => c === 'live'
  it('gives each open item its status and wait, suggestions as inbox, done from the last week', () => {
    const r = rowsOf(list, live, now, no)
    assert.deepEqual(r.open.map(x => [x.t.id, x.status, x.wait?.why]), [['r', 'ready', undefined], ['s', 'waiting', 'stopped'], ['ok', 'waiting', 'ok'], ['d', 'waiting', 'date'], ['y', 'waiting', 'you'], ['run', 'running', undefined]])
    assert.deepEqual(ids(r.inbox), ['s1', 's2'])
    assert.deepEqual(r.done.map(t => t.id), ['x'])
  })
  it('a snoozed suggestion leaves the inbox', () => {
    assert.deepEqual(ids(rowsOf(list, live, now, id => id === 's1').inbox), ['s2'])
  })
  it('a prerequisite sits above the item it comes before', () => {
    const l: TodoList = { todo: [item('a'), item('p', { before: 'a' })] }
    assert.deepEqual(ids(rowsOf(l, no, now, no).open), ['p', 'a'])
    assert.equal(rowsOf(l, no, now, no).open[0].depth, 1)
  })
})

describe('layouts', () => {
  const list: TodoList = {
    todo: [item('r'), item('s', { stopped: true }), item('ok', { needsOk: true }), item('d', { notBefore: now + DAY }), item('y', { why: 'you' }), item('run', { chat: 'live' })],
    suggested: [item('s1')],
  }
  const rows = rowsOf(list, c => c === 'live', now, no)
  it('A: approvals and suggestions are decided first, a stopped item stays startable in the queue', () => {
    const a = splitA(rows)
    assert.deepEqual(ids(a.decide), ['ok', 's1'])
    assert.deepEqual(ids(a.queue), ['r', 's'])
    assert.deepEqual(ids(a.running), ['run'])
    assert.deepEqual(ids(a.waiting), ['d', 'y'])
  })
  it('counts each section across projects, for the chips', () => {
    assert.deepEqual(countA([rows, rows]), { decide: 4, running: 2, queue: 4, waiting: 4 })
    assert.deepEqual(countA([]), { decide: 0, running: 0, queue: 0, waiting: 0 })
  })
})

describe('stepTo', () => {
  // run sits between a and b in the list but not in the queue, so one step skips it.
  const all = ['a', 'run', 'b', 'c'], shown = ['a', 'b', 'c']
  it('moves next to the neighbour you can see', () => {
    assert.equal(stepTo(all, shown, 'b', -1), 0)
    assert.equal(stepTo(all, shown, 'a', 1), 2)
  })
  it('the ends go nowhere', () => {
    assert.equal(stepTo(all, shown, 'a', -1), undefined)
    assert.equal(stepTo(all, shown, 'c', 1), undefined)
    assert.equal(stepTo(all, shown, 'zz', 1), undefined)
  })
})

describe('closed sections', () => {
  it('reads a stored list and shrugs off junk', () => {
    assert.deepEqual(closedOf('["queue","waiting"]'), ['queue', 'waiting'])
    assert.deepEqual(closedOf(null), [])
    assert.deepEqual(closedOf('{bad'), [])
    assert.deepEqual(closedOf('{"a":1}'), [])
    assert.deepEqual(closedOf('["queue",3]'), ['queue'])
  })
  it('toggles one section', () => {
    assert.deepEqual(toggled(['queue'], 'waiting'), ['queue', 'waiting'])
    assert.deepEqual(toggled(['queue', 'waiting'], 'queue'), ['waiting'])
  })
})

describe('waitText', () => {
  const day = (at: number) => `day${at}`
  it('says why an item waits, in words a new user reads', () => {
    assert.equal(waitText({ why: 'ok' }, day).label, 'Needs your OK')
    assert.equal(waitText({ why: 'date', until: 7 }, day).label, 'Starts day7')
    assert.equal(waitText({ why: 'stopped' }, day).label, 'Stopped')
    assert.match(waitText({ why: 'stopped' }, day).detail ?? '', /chat ended/)
    assert.equal(waitText({ why: 'you' }, day).label, 'Your step')
    assert.equal(waitText({ why: 'blocked' }, day).label, 'Blocked')
    assert.equal(waitText({ why: 'after', on: item('p', { short: 'Fix login' }) }, day).label, 'Waiting')
    assert.match(waitText({ why: 'after', on: item('p', { short: 'Fix login' }) }, day).detail ?? '', /after "Fix login" is done/)
  })
})

describe('snooze', () => {
  it('tomorrow is a day on, next week seven', () => {
    assert.equal(snoozeTo(now, 'tomorrow'), now + DAY)
    assert.equal(snoozeTo(now, 'week'), now + 7 * DAY)
  })
  it('a snooze holds until its time, then lets go', () => {
    const m = { a: now + 1, b: now - 1 }
    assert.equal(snoozed(m, 'a', now), true)
    assert.equal(snoozed(m, 'b', now), false)
    assert.equal(snoozed(m, 'zz', now), false)
    assert.deepEqual(liveSnoozes(m, now), { a: now + 1 })
  })
})

describe('splitKnown', () => {
  it('folders outside the known projects go to Other folders; without a list nothing does', () => {
    assert.deepEqual(splitKnown(['/a', '/b', '/c'], ['/a', '/c']), { main: ['/a', '/c'], other: ['/b'] })
    assert.deepEqual(splitKnown(['/a', '/b'], undefined), { main: ['/a', '/b'], other: [] })
    assert.deepEqual(splitKnown(['/a/sub'], ['/a']), { main: ['/a/sub'], other: [] })
  })
})
