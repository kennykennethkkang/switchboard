import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { TodoItem, TodoList } from './hub-types'
import { isLong, shortSha, projectsWithWork, recentDone, shippedOf, shownProjects, counts, statusOf, waitOf, titleOf } from './todo-view'

const DAY = 864e5, now = 100 * DAY
const lists: Record<string, TodoList> = {
  '/a': { todo: [{ id: '1', text: 'x', at: 0 }], suggested: [{ id: '2', text: 'y', at: 0 }] },
  '/b': { todo: [], ticked: [{ id: '3', text: 'old', at: now - 30 * DAY }] },
  '/c': { todo: [{ id: '4', text: 'x', at: 0 }, { id: '5', text: 'x', at: 0 }, { id: '6', text: 'x', at: 0 }] },
  '/d': { todo: [], suggested: [{ id: '7', text: 'reload', at: 0, why: 'you' }] },
}

describe('projectsWithWork', () => {
  it('drops empty projects and sorts busiest first', () => {
    assert.deepEqual(projectsWithWork(lists).map(p => p.folder), ['/c', '/a', '/d'])
  })
})

describe('shownProjects', () => {
  it('lists projects with work and ignores the fallback', () => {
    assert.deepEqual(shownProjects(lists, '/b', now), ['/c', '/a', '/d'])
  })
  it('keeps a project whose only rows are done within the week, after the busy ones', () => {
    const l = { ...lists, '/e': { todo: [], ticked: [{ id: '8', text: 'shipped', at: now - DAY }] } }
    assert.deepEqual(shownProjects(l, '/b', now), ['/c', '/a', '/d', '/e'])
  })
  it('falls back to the picked project when nothing has work', () => {
    assert.deepEqual(shownProjects({ '/b': lists['/b'] }, '/b', now), ['/b'])
    assert.deepEqual(shownProjects({}), [])
  })
})

describe('counts', () => {
  it('splits open, suggested and hand steps', () => {
    assert.deepEqual(counts(lists['/a']), { open: 1, suggested: 1, you: 0 })
    assert.deepEqual(counts(lists['/d']), { open: 0, suggested: 0, you: 1 })
    assert.deepEqual(counts(undefined), { open: 0, suggested: 0, you: 0 })
  })
})

describe('recentDone', () => {
  it('hides ticked rows older than the window', () => {
    const l: TodoList = { todo: [], ticked: [{ id: 'o', text: 'o', at: now - 9 * DAY }, { id: 'n', text: 'n', at: now - DAY }, { id: 'm', text: 'm', at: now - 2 * DAY }] }
    assert.deepEqual(recentDone(l, now).map(t => t.id), ['n', 'm'])
  })
})

describe('shippedOf', () => {
  it('returns the commit only when it has a sha', () => {
    assert.deepEqual(shippedOf({ shipped: { sha: 'abc1234', subject: 'Fix' } }), { sha: 'abc1234', subject: 'Fix' })
    assert.equal(shippedOf({ shipped: { sha: '', subject: 'Fix' } }), undefined)
    assert.equal(shippedOf({}), undefined)
    assert.equal(shortSha({ sha: 'abcdef1234567', subject: '' }), 'abcdef1')
    assert.equal(shortSha({ sha: 'CHANGELOG', subject: '' }), 'CHANGELOG')
  })
})

describe('isLong', () => {
  it('folds long or many-line text', () => {
    assert.equal(isLong('short'), false)
    assert.equal(isLong('x'.repeat(181)), true)
    assert.equal(isLong('a\nb\nc\nd'), true)
  })
})

describe('statusOf', () => {
  const t = 1000, no = () => false
  const item = (id: string, more: Partial<TodoItem> = {}): TodoItem => ({ id, text: `do ${id}`, at: 1, ...more })
  const status = (x: TodoItem, list?: TodoList, live: (c?: string) => boolean = no) => statusOf(x, live, t, list)

  it('an open item with nothing in its way is ready', () => {
    assert.equal(status(item('a')), 'ready')
    assert.equal(status(item('a', { notBefore: t })), 'ready')
    assert.equal(status(item('a', { needsOk: false, notBefore: 0 })), 'ready')
  })
  it('running is an item in a live chat, whatever else it carries', () => {
    assert.equal(status(item('a', { chat: 'live', stopped: true, needsOk: true }), undefined, c => c === 'live'), 'running')
  })
  it('suggestions are the inbox and finished rows are done', () => {
    const list: TodoList = { todo: [item('o')], suggested: [item('s')], ticked: [{ id: 'd', text: 'done', at: 1 }] }
    assert.equal(status(list.suggested![0], list), 'inbox')
    assert.equal(status(list.ticked![0], list), 'done')
    assert.equal(status(list.todo[0], list), 'ready')
  })
  it('waiting carries its reason: OK, date, blocked, hand step, stopped', () => {
    const why = (x: TodoItem) => { assert.equal(status(x), 'waiting'); return waitOf(x, no, t)?.why }
    assert.equal(why(item('a', { needsOk: true })), 'ok')
    assert.equal(why(item('a', { notBefore: t + 1 })), 'date')
    assert.equal(why(item('a', { why: 'blocked' })), 'blocked')
    assert.equal(why(item('a', { why: 'you' })), 'you')
    assert.equal(why(item('a', { stopped: true })), 'stopped')
    assert.equal(why(item('a', { chat: 'gone' })), 'stopped')
    assert.equal(waitOf(item('a', { notBefore: t + 9 }), no, t)?.until, t + 9)
  })
  it('an item behind a held prerequisite waits after it; behind a ready one, or a running one, it does not', () => {
    const list: TodoList = { todo: [item('x'), item('p', { before: 'x', needsOk: true }), item('y'), item('q', { before: 'y' }), item('z'), item('r', { before: 'z', chat: 'live' })] }
    assert.equal(status(list.todo[0], list), 'waiting')
    assert.deepEqual([waitOf(list.todo[0], no, t, list)?.why, waitOf(list.todo[0], no, t, list)?.on?.id], ['after', 'p'])
    assert.equal(status(list.todo[2], list), 'ready')
    assert.equal(status(list.todo[4], list, c => c === 'live'), 'ready')
  })
  it('a prerequisite link to an item that is done, or to nothing, changes nothing; a loop does not hang', () => {
    const list: TodoList = { todo: [item('p', { before: 'gone' }), item('a', { before: 'b' }), item('b', { before: 'a' })], ticked: [{ id: 'gone', text: 'gone', at: 1 }] }
    assert.equal(status(list.todo[0], list), 'ready')
    assert.equal(status(list.todo[1], list), 'ready')
  })
})

describe('titleOf', () => {
  it('shows the title, else the text cut to 60 characters', () => {
    assert.equal(titleOf({ text: 'x'.repeat(100), short: 'Keep worktrees' }), 'Keep worktrees')
    assert.equal(titleOf({ text: 'Fix it' }), 'Fix it')
    const long = titleOf({ text: 'word '.repeat(30) })
    assert.ok(long.length <= 60)
    assert.match(long, /\.\.\.$/)
  })
  it('drops a trailing colon, semicolon or comma', () => {
    assert.equal(titleOf({ text: 'Make the export match what accounting asked for: one row per line item, split tax' }), 'Make the export match what accounting asked for')
    assert.equal(titleOf({ text: 'x'.repeat(80), short: 'Fix the picker;' }), 'Fix the picker')
    assert.equal(titleOf({ text: 'Fix it: now' }), 'Fix it: now')
  })
})
