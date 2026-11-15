import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startTargets, startsAfter, toggleId } from './start-wait'
import type { ChatRow } from './hub-types'

const row = (sessionId: string, cwd: string, live = true, project?: string) => ({ pid: 1, sessionId, cwd, link: '', live, why: [], project }) as unknown as ChatRow
const chats = [row('a', '/g/app'), row('b', '/g/app/web', true, 'app'), row('c', '/g/other'), row('d', '/g/app', false)]

test('startTargets: live chats in the project, by project name', () => {
  assert.deepEqual(startTargets(chats, 'app').map(c => c.sessionId), ['a', 'b'])
  assert.deepEqual(startTargets(chats, 'none'), [])
  assert.deepEqual(startTargets(chats, ''), [])
})

test('startTargets: none for Codex', () => {
  assert.deepEqual(startTargets(chats, 'app', 'codex'), [])
})

test('toggleId adds and removes', () => {
  assert.deepEqual(toggleId(['a'], 'b'), ['a', 'b'])
  assert.deepEqual(toggleId(['a', 'b'], 'a'), ['b'])
})

test('startsAfter reads as a sentence', () => {
  assert.equal(startsAfter([]), '')
  assert.equal(startsAfter(['Auth']), 'Starts after Auth finishes')
  assert.equal(startsAfter(['Auth', 'Billing']), 'Starts after Auth and Billing finish')
  assert.equal(startsAfter(['Auth', 'Billing', 'Copy']), 'Starts after Auth, Billing and Copy finish')
})

test('startTargets: by project path, keeping subfolder chats', () => {
  const more = [...chats, row('e', '/g/apple'), row('f', '/g/app/extension/src')]
  assert.deepEqual(startTargets(more, '/g/app').map(c => c.sessionId), ['a', 'b', 'f'])
})
