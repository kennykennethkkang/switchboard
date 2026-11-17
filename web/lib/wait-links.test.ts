import { test } from 'node:test'
import assert from 'node:assert/strict'
import { baseName } from './path'
import { chipText, linkChips, waitTargets } from './wait-links'
import type { ChatLink, ChatRow } from './hub-types'

const row = (sessionId: string, name: string, cwd = '/w', live = true) => ({ pid: 1, sessionId, name, cwd, link: '', live, why: [] }) as unknown as ChatRow
const chats = [row('a', 'Auth'), row('b', 'Billing'), row('c', 'Copy'), row('d', 'Docs', '/other'), row('e', 'Ended', '/w', false)]
const links: ChatLink[] = [
  { from: 'a', to: ['b'], reason: 'needs the API first', auto: false, since: 1 },
  { from: 'c', to: ['a'], reason: 'src/auth/session.ts', auto: true, since: 2 },
]

test('linkChips: out with the file of an auto link, in from the waiter', () => {
  assert.deepEqual(linkChips(links, chats, 'a'), [{ dir: 'out', id: 'b', name: 'Billing', file: undefined }, { dir: 'in', id: 'c', name: 'Copy' }])
  assert.deepEqual(linkChips(links, chats, 'c').map(chipText), ['Waiting on Auth · session.ts'])
  assert.deepEqual(linkChips(links, chats, 'b').map(chipText), ['Auth waits on this'])
  assert.deepEqual(linkChips(undefined, chats, 'a'), [])
})

test('waitTargets: live chats in the same project, not itself or one it already waits on', () => {
  assert.deepEqual(waitTargets(chats, chats[0], [links[0]]).map(c => c.sessionId), ['c'])
  assert.deepEqual(waitTargets(chats, chats[2], [links[0]]).map(c => c.sessionId), ['a', 'b'])
})

test('waitTargets: leaves out chats that wait on this one, directly or through others', () => {
  const chain: ChatLink[] = [{ from: 'b', to: ['c'], reason: 'r', auto: false, since: 1 }, { from: 'c', to: ['a'], reason: 'r', auto: false, since: 1 }]
  assert.deepEqual(waitTargets(chats, chats[0], chain).map(c => c.sessionId), [])
  assert.deepEqual(waitTargets(chats, chats[1], chain).map(c => c.sessionId), ['a'])
})

test('waitTargets: a Codex chat can wait too, through the switchboard MCP chats_wait', () => {
  assert.deepEqual(waitTargets(chats, { ...chats[0], ai: 'codex' } as ChatRow, []).map(c => c.sessionId), ['b', 'c'])
})

test('baseName', () => assert.equal(baseName('C:\\x\\y.ts'), 'y.ts'))
