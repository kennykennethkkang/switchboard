import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guidedHome, readyChat, ticked } from './simple-home'
import type { HubState } from './hub-types'

const run = { github: true, claude: true, project: true, chat: false, approved: false }

test('guidedHome: checklist first until 5 of 5 or hidden', () => {
  assert.equal(guidedHome(run), true)
  assert.equal(guidedHome({ ...run, dismissed: true }), false)
  assert.equal(guidedHome({ ...run, chat: true, approved: true }), false)
  assert.equal(guidedHome(undefined), false)
})

test('readyChat: the first open chat in Done, else none', () => {
  const hub = (states: [string, string][]) => ({
    chats: states.map(([id]) => ({ sessionId: id, name: `chat ${id}`, cwd: '/x/proj' })),
    progress: states.map(([sessionId, state]) => ({ sessionId, state })),
  }) as unknown as Pick<HubState, 'chats' | 'progress'>
  assert.deepEqual(readyChat(hub([['a', 'working'], ['b', 'done']])), { id: 'b', name: 'chat b' })
  assert.equal(readyChat(hub([['a', 'working']])), undefined)
  assert.equal(readyChat({ ...hub([]), progress: [{ sessionId: 'gone', state: 'done' }] } as never), undefined)
})

test('readyChat: an unnamed chat reads as its project', () => {
  const hub = { chats: [{ sessionId: 'a', cwd: '/x/proj' }], progress: [{ sessionId: 'a', state: 'done' }] } as unknown as Pick<HubState, 'chats' | 'progress'>
  assert.equal(readyChat(hub)?.name, 'proj')
})

test('ticked: chats and approvals that exist tick their steps', () => {
  const hub = (chats: number, approved: boolean) => ({ chats: Array(chats).fill({}), archive: approved ? [{ approvedAt: 1 }] : [{}] }) as unknown as Pick<HubState, 'chats' | 'archive'>
  assert.deepEqual(ticked(run, hub(0, false)), run)
  assert.equal(ticked(run, hub(2, false))?.chat, true)
  assert.equal(ticked(run, hub(0, true))?.approved, true)
  assert.equal(ticked(undefined, hub(1, true)), undefined)
})
