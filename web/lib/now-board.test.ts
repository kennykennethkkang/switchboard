import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chatMeta, cookTitle, layoutOf, needChip, nextCardIndex, nextRows, nextTag } from './now-board'
import { finishUp, openCount } from './todo'
import type { ChatRow, TodoList } from './hub-types'

test('layoutOf: the line board unless ?layout=classic', () => {
  assert.equal(layoutOf(''), 'line')
  assert.equal(layoutOf('?layout=classic'), 'classic')
  assert.equal(layoutOf('?layout=stations'), 'line')
  assert.equal(layoutOf('?x=1&layout=classic'), 'classic')
  assert.equal(layoutOf('?layout=focus'), 'line')
})

test('nextRows: hand steps first, prerequisite above its item, count matches the Plan count', () => {
  const list: TodoList = {
    todo: [
      { id: 'a', text: 'CSV export', at: 1 },
      { id: 'b', text: 'Stripe key', at: 2, before: 'a', chat: 'c1' },
      { id: 'h', text: 'Test on phone', at: 3, why: 'you' },
    ],
    suggested: [{ id: 's', text: 'Vercel secret', at: 4, why: 'you' }, { id: 'x', text: 'Later thing', at: 5, why: 'scope' }],
  }
  const rows = nextRows(list, chat => chat === 'c1')
  assert.deepEqual(rows.map(r => r.t.id), ['s', 'h', 'a'])
  assert.equal(rows.length, openCount(list) + finishUp(list).length - 1)
  assert.deepEqual(nextRows(list, () => false).map(r => r.t.id), ['s', 'h', 'b', 'a'])
  assert.deepEqual(nextRows(undefined, () => false), [])
})

test('chatMeta: usage cost wins over the live row, time falls back to progress start', () => {
  const chat = { sessionId: 'c', cwd: '/x', link: '', live: true, why: [], pid: 1 } as ChatRow
  assert.deepEqual(chatMeta({ ...chat, costUsd: 3.4, elapsedMs: 95 * 60e3 }, undefined), { cost: '$3.40', time: '1h 35m' })
  const live = [{ sessionId: 'c', costUsd: 1.844 }] as never
  assert.deepEqual(chatMeta(chat, { startedAt: 0 } as never, live, 30 * 60e3), { cost: '$1.84', time: '30m' })
  assert.deepEqual(chatMeta(chat, undefined), {})
})

test('cookTitle: the to-do text when it extends the chat name, else the name', () => {
  const list: TodoList = { todo: [{ id: 'a', text: 'Add CSV export to the receipts page', at: 1, chat: 'c1' }] }
  assert.equal(cookTitle('Add CSV export to the', 'c1', list), 'Add CSV export to the receipts page')
  assert.equal(cookTitle('Receipts CSV', 'c1', list), 'Receipts CSV')
  assert.equal(cookTitle('Add CSV export to the', 'c2', list), 'Add CSV export to the')
  assert.equal(cookTitle('x', 'c1', undefined), 'x')
})

test('needChip: only more than one waiting card gets a chip', () => {
  assert.equal(needChip(0), undefined)
  assert.equal(needChip(1), undefined)
  assert.equal(needChip(3), '3 need you')
})

test('nextCardIndex: the first card below the edge, wrapping to the first', () => {
  assert.equal(nextCardIndex([-300, -10, 120, 400], 40), 2)
  assert.equal(nextCardIndex([-300, -10, 42], 40), 2)
  assert.equal(nextCardIndex([-300, -10, 41], 40), 0)
  assert.equal(nextCardIndex([], 40), -1)
})

test('nextTag: a stopped item says so, held items say why, else the To-do number', () => {
  const row = (t: Partial<TodoList['todo'][number]>, you = false) => ({ t: { id: 'a', text: 'x', at: 1, ...t }, you, running: false })
  assert.deepEqual(nextTag(row({ stopped: true })), { tag: 'Stopped', kind: 'stopped' })
  assert.deepEqual(nextTag(row({}), undefined, 'stopped'), { tag: 'Stopped', kind: 'stopped' })
  assert.deepEqual(nextTag(row({}), undefined, 'ok'), { tag: 'Needs your OK', kind: 'held' })
  assert.deepEqual(nextTag(row({ why: 'blocked' })), { tag: 'Blocked', kind: 'held' })
  assert.deepEqual(nextTag(row({}, true)), { tag: 'Your step', kind: 'you' })
  assert.deepEqual(nextTag(row({}), 3), { tag: 'To-do 3' })
  assert.deepEqual(nextTag(row({})), { tag: 'To-do' })
})
