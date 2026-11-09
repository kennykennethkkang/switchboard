import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { aiPath, busiestTodo, moved, finishUp, inside, openCount, openElsewhere, ordered, runCount, runIds, runLanded, runTargets, withHome } from './todo'
import type { ChatRow, TodoItem } from './hub-types'

const t = (id: string, before?: string): TodoItem => ({ id, text: id, at: 1, ...(before ? { before } : {}) })

describe('todo panel helpers', () => {
  it('adds an empty list for the chat\'s folder only when no listed project holds it', () => {
    const lists = { '/r/a': { todo: [t('x')] } }
    assert.equal(withHome(lists, '/r/a/web'), lists)
    assert.deepEqual(withHome(lists, '/r/b'), { ...lists, '/r/b': { todo: [] } })
    assert.deepEqual(withHome(undefined, '/r/b'), { '/r/b': { todo: [] } })
    assert.deepEqual(withHome(undefined), {})
  })
  it('lists Kenneth\'s hand steps from the tray, then older accepted ones', () => {
    const you = (id: string): TodoItem => ({ id, text: id, at: 1, why: 'you' })
    const steps = finishUp({ todo: [t('a'), you('old')], suggested: [you('s1'), you('s2'), { ...t('s3'), why: 'later' }] })
    assert.deepEqual(steps.map(x => x.id), ['s1', 's2', 'old'])
    assert.deepEqual(finishUp({ todo: [t('a')] }), [])
  })
  it('puts each prerequisite indented directly above its item; one whose item is gone stands alone', () => {
    const rows = ordered([t('a'), t('b'), t('p', 'b'), t('pp', 'p'), t('q', 'gone')])
    assert.deepEqual(rows.map(r => [r.t.id, r.depth]), [['a', 0], ['pp', 2], ['p', 1], ['b', 0], ['q', 0]])
    assert.deepEqual(ordered([t('x', 'y'), t('y', 'x')]).map(r => r.t.id).sort(), ['x', 'y'])
  })
  it('counts what a run does: the picked items and their open prerequisites', () => {
    const list = [t('a'), t('b'), t('p', 'b'), t('pp', 'p')]
    assert.equal(runCount(list, ['b']), 3)
    assert.equal(runCount(list, ['a', 'p']), 3)
    assert.equal(runCount(list, ['gone']), 0)
  })
  it('counts open items in other projects, leaving out hand steps that show under Finish up', () => {
    const you: TodoItem = { ...t('y'), why: 'you' }
    assert.equal(openElsewhere({ '/a': { todo: [t('1'), t('2'), you] }, '/b': { todo: [t('3')] }, '/c': { todo: [] } }, '/b'), 2)
    assert.equal(openElsewhere(undefined, '/b'), 0)
    assert.equal(openCount({ todo: [t('1'), you] }), 1)
    assert.equal(openCount(undefined), 0)
  })
  it('offers running chats in the project that take messages', () => {
    const c = (sessionId: string, cwd: string, live = true, takes = true): ChatRow => ({ pid: 1, sessionId, cwd, link: '', live, why: [], takes })
    const chats = [c('in', '/u/app/web'), c('root', '/u/app'), c('other', '/u/apple'), c('dead', '/u/app', false), c('mute', '/u/app', true, false)]
    assert.deepEqual(runTargets(chats, '/u/app').map(x => x.sessionId), ['in', 'root'])
    assert.equal(inside('C:\\u\\app', 'c:/u/app/x'), true)
  })
})

describe('run landed', () => {
  const todo: TodoItem[] = [{ id: 'a', text: 'A', at: 1, chat: 's1' }, { id: 'b', text: 'B', at: 1 }]
  it('counts an item already in the chat it was sent to as sent', () => {
    assert.equal(runLanded(todo, ['a'], new Map([['a', 's1']]), 's1'), true)
    assert.equal(runLanded(todo, ['b'], new Map(), 's1'), false)
  })
  it('waits for a new chat to take the items, even ones that were in an ended chat', () => {
    const was = new Map([['a', 's1']])
    assert.equal(runLanded(todo, ['a'], was), false)
    assert.equal(runLanded([{ ...todo[0], chat: 'new' }], ['a'], was), true)
    assert.equal(runLanded([], ['a'], was), true)
  })
  it('runs the picked items with their open prerequisites', () => {
    const list: TodoItem[] = [{ id: 'a', text: 'A', at: 1 }, { id: 'p', text: 'P', at: 1, before: 'a' }, { id: 'pp', text: 'PP', at: 1, before: 'p' }, { id: 'x', text: 'X', at: 1 }]
    assert.deepEqual([...runIds(list, ['a', 'gone'])].sort(), ['a', 'p', 'pp'])
    assert.equal(runCount(list, ['a']), 3)
  })
})

describe('aiPath and moved', () => {
  const chat = (sessionId: string, more: Partial<ChatRow> = {}): ChatRow => ({ pid: 1, sessionId, cwd: '/r', link: '', live: true, why: [], ...more })
  const arch = (v: number, ai: 'claude' | 'codex') => ({ sessionId: `v${v}`, ai, name: 'x', origin: 'Fix', version: v, cwd: '/r', project: 'r', archivedAt: v })
  it('names the AI, and the change when a handoff moved it', () => {
    assert.equal(aiPath('c', [chat('c')]), 'Claude')
    assert.equal(aiPath('c', [chat('c', { ai: 'codex' })]), 'Codex')
    assert.equal(aiPath('c', [chat('c', { ai: 'codex', chain: 'Fix' })], [arch(2, 'claude'), arch(1, 'claude')]), 'Claude to Codex')
    assert.equal(aiPath('v2', [], [arch(1, 'codex'), arch(2, 'claude')]), 'Codex to Claude')
    assert.equal(aiPath('nope', [chat('c')]), undefined)
  })
  it('moves an id up, down or to a place, clamped', () => {
    assert.deepEqual(moved(['a', 'b', 'c'], 'c', 1), ['a', 'c', 'b'])
    assert.deepEqual(moved(['a', 'b', 'c'], 'a', 9), ['b', 'c', 'a'])
    assert.deepEqual(moved(['a', 'b', 'c'], 'b', -3), ['b', 'a', 'c'])
    assert.deepEqual(moved(['a'], 'z', 0), ['a'])
  })
})

describe('busiestTodo', () => {
  const item = (id: string, why?: 'you'): TodoItem => ({ id, text: id, ...(why ? { why } : {}) }) as TodoItem
  it('picks the project with the most open items plus your steps; none open gives undefined', () => {
    assert.equal(busiestTodo({ '/a': { todo: [item('1')] }, '/b': { todo: [item('2'), item('3', 'you')] }, '/c': { todo: [] } }), '/b')
    assert.equal(busiestTodo({ '/a': { todo: [] } }), undefined)
  })
})
