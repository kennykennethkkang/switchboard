import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyHub } from './hub-demo'
import { researchNow, LIVE_MS, SHOW_MS } from './research-now'
import type { ChatProgress, ChatRow, HubState } from './hub-types'

const NOW = 10_000_000
const prog = (id: string, tools: ChatProgress['tools'], more: Partial<ChatProgress> = {}) =>
  ({ sessionId: id, cwd: '/w/Switchboard', state: 'working', roles: [], tasks: [], startedAt: 0, at: NOW, tools, ...more }) as ChatProgress
const hub = (progress: ChatProgress[]): HubState => {
  const h = emptyHub()
  h.chats = [{ sessionId: 'todo', name: 'To-do fix', project: 'Switchboard' } as ChatRow]
  h.progress = progress
  return h
}

test('a researcher searching for a chat shows under that chat, with what it is for', () => {
  const rows = researchNow(hub([prog('todo', [
    { tool: 'Bash', target: 'ls', role: 'lead', at: NOW - 60_000 },
    { tool: 'WebSearch', target: 'tailscale serve https', role: 'researcher', at: NOW - 50_000 },
    { tool: 'WebFetch', target: 'tailscale.com', role: 'researcher', at: NOW - 40_000 },
    { tool: 'WebFetch', target: 'tailscale.com', role: 'researcher', at: NOW - 30_000 },
  ], { asked: ['fix the to-do list'] })]), NOW)
  assert.equal(rows.length, 1)
  assert.deepEqual({ ...rows[0] }, {
    sessionId: 'todo', chat: 'To-do fix', project: 'Switchboard', forAsk: 'fix the to-do list', who: 'researcher',
    doing: 'Its researcher is reading tailscale.com', searches: 1, sources: 1, live: true, at: NOW - 30_000,
  })
})

test('chats with no web work, or only old web work, stay off', () => {
  assert.deepEqual(researchNow(hub([
    prog('a', [{ tool: 'Edit', target: 'x.ts', role: 'lead', at: NOW }]),
    prog('b', [{ tool: 'WebSearch', target: 'q', role: 'lead', at: NOW - SHOW_MS - 1 }]),
  ]), NOW), [])
})

test('quiet research is finished unless a researcher still runs; live rows sort first', () => {
  const old = NOW - LIVE_MS - 1
  const rows = researchNow(hub([
    prog('quiet', [{ tool: 'WebSearch', target: 'q', role: 'lead', at: old - 5 }]),
    prog('held', [{ tool: 'Skill', target: 'deep-research', role: 'lead', at: old }], { roles: [{ id: 'r1', role: 'researcher', state: 'active', startedAt: old }] }),
  ]), NOW)
  assert.deepEqual(rows.map(r => [r.sessionId, r.live, r.doing]), [
    ['held', true, 'The chat is running deep research'],
    ['quiet', false, 'The chat is searching “q”'],
  ])
})
