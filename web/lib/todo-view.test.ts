import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { TodoList } from './hub-types'
import { filedBy, isLong, shortSha, projectsWithWork, recentDone, shippedOf, shownProjects, counts } from './todo-view'

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

describe('filedBy and isLong', () => {
  it('names you, the chat name, or a fallback', () => {
    assert.equal(filedBy({}), 'you')
    assert.equal(filedBy({ from: 'c1', name: 'Login fix' }), 'Login fix')
    assert.equal(filedBy({ from: 'c1' }, 'Now name'), 'Now name')
    assert.equal(filedBy({ from: 'c1' }), 'a chat')
  })
  it('folds long or many-line text', () => {
    assert.equal(isLong('short'), false)
    assert.equal(isLong('x'.repeat(181)), true)
    assert.equal(isLong('a\nb\nc\nd'), true)
  })
})
