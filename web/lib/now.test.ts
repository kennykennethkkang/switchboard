/** The Now page: lanes, the day's numbers and each lane row. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayNumbers, hubCounts, laneRow, nowLanes, picked } from './now'
import type { ArchivedChat, ChatProgress, ChatRow, ChatState, HubState } from './hub-types'

const now = new Date(2026, 10, 9, 15).getTime()
const H = 3600_000
const chat = (id: string, name?: string): ChatRow => ({ pid: 1, sessionId: id, name, cwd: '/x/switchboard', link: '', live: true, why: [] })
const prog = (id: string, state: ChatState, at: number, more: Partial<ChatProgress> = {}): ChatProgress =>
  ({ sessionId: id, cwd: '/x/switchboard', state, roles: [], tasks: [], startedAt: at - H, at, ...more })
const card = (id: string, state?: ChatState, at = now, more?: Partial<ChatProgress>) => ({ chat: chat(id, id.toUpperCase()), progress: state && prog(id, state, at, more) })

test('nowLanes: working newest first; done is chats approved today, newest first', () => {
  const cards = [card('w1', 'working', now - 2 * H), card('w2', 'working', now - H), card('d1', 'done', now - H), card('n', 'needs-you'), card('i', 'idle'), card('none')]
  const arch = (id: string, approvedAt?: number): ArchivedChat => ({ sessionId: id, ai: 'claude', name: id, origin: id, version: 1, cwd: '/x/switchboard', project: 'switchboard', archivedAt: now - 30 * H, ...(approvedAt ? { approvedAt } : {}) })
  const { working, done } = nowLanes(cards, [arch('a1', now - 3 * H), arch('a2', now - H), arch('old', now - 30 * H), arch('ended')], now)
  assert.deepEqual(working.map(c => c.chat.sessionId), ['w2', 'w1'])
  // Cards in state done are Needs you, not Done today.
  assert.deepEqual(done.map(a => a.sessionId), ['a2', 'a1'])
})

test('dayNumbers: tasks, working chats, approved today and tokens', () => {
  const today = { done: ['a', 'b', 'c'], approve: [], needs: [], working: ['x', 'y'], tokens: 12_000 }
  assert.deepEqual(dayNumbers(today, { done: 12, total: 17, chats: 3, text: '' }), { done: 12, total: 17, working: 2, approved: 3, tokens: 12_000 })
  assert.deepEqual(dayNumbers({ ...today, tokens: undefined, working: [] }, { done: 0, total: 0, chats: 0, text: '' }), { done: 0, total: 0, working: 0, approved: 3 })
})

test('laneRow: name, active role, task count and the step in progress', () => {
  const c = card('w', 'working', now, {
    roles: [{ id: '1', role: 'researcher', state: 'done', startedAt: 0 }, { id: '2', role: 'engineer', state: 'active', startedAt: 1 }],
    tasks: [{ id: 'a', subject: 'Read', status: 'completed' }, { id: 'b', subject: 'Edit usage-meter.ts', status: 'in_progress' }, { id: 'c', subject: 'Test', status: 'pending' }],
  })
  assert.deepEqual(laneRow(c), { id: 'w', name: 'W', project: 'switchboard', role: 'engineer', done: 1, total: 3, step: 'Edit usage-meter.ts' })
  // No name: the project; no tasks or roles: nothing made up.
  assert.deepEqual(laneRow({ chat: chat('z'), progress: prog('z', 'done', now) }), { id: 'z', name: 'switchboard', project: 'switchboard', role: undefined, done: 0, total: 0, step: undefined })
})

test('picked: keeps items whose chat is in a picked project, and ones no chat maps', () => {
  const a = { chat: { ...chat('a'), cwd: '/x/armasu' } }, b = { chat: chat('b') }
  const items = [{ sessionId: 'a' }, { sessionId: 'b' }, { sessionId: 'gone' }]
  assert.deepEqual(picked(items, [a, b], ['armasu']).map(i => i.sessionId), ['a', 'gone'])
  assert.equal(picked(items, [a, b], []), items)
})

test('hubCounts: one rule for needs you, working and done today', () => {
  const arch: ArchivedChat = { sessionId: 'a1', ai: 'claude', name: 'a1', origin: 'a1', version: 1, cwd: '/x/switchboard', project: 'switchboard', archivedAt: now - H, approvedAt: now - H }
  const cs = [card('w', 'working'), card('n', 'needs-you'), card('d', 'done'), card('i', 'idle')]
  const hub = { chats: cs.map(c => c.chat), progress: cs.flatMap(c => c.progress ? [c.progress] : []), archive: [arch], stuck: [{}], learnReady: [{}, {}], researchOffers: [{}] } as unknown as HubState
  assert.deepEqual(hubCounts(hub, [], now), { needs: 6, working: 1, done: 1 })
  assert.deepEqual(hubCounts(hub, ['other'], now), { needs: 4, working: 0, done: 0 })
})
