import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chatShown, isBusy } from './chat-state'
import { buildCourt } from './court-map'
import { nowLanes, hubCounts } from './now'
import { emptyHub } from './hub-demo'
import type { ChatProgress, ChatRow, StuckItem } from './hub-types'

const NOW = 1_800_000_000_000
const prog = (p: Partial<ChatProgress> = {}): ChatProgress => ({ sessionId: 's', cwd: '/x', state: 'working', roles: [], tasks: [], startedAt: NOW - 60e3, at: NOW, ...p })
const item = (sessionId = 's'): StuckItem => ({ id: 'job:s:1', kind: 'job', sessionId, what: 'Background job: no end', since: NOW - 1e6 })
const ask = { id: 'a', tool: 'Bash', kind: 'permission' } as ChatProgress['ask']

const table: Array<[string, ChatProgress | undefined, StuckItem[] | undefined, string]> = [
  ['no progress is idle', undefined, [], 'idle'],
  ['plain working', prog(), [], 'working'],
  ['working with no stuck list at all', prog(), undefined, 'working'],
  ['working with a stuck item', prog(), [item()], 'stuck'],
  ['another chat is stuck, not this one', prog(), [item('other')], 'working'],
  ['waiting on subagents', prog({ waiting: true }), [], 'waiting'],
  ['waiting and stuck is stuck', prog({ waiting: true }), [item()], 'stuck'],
  ['limited', prog({ limited: { at: NOW, error: 'rate_limit' } }), [], 'waiting'],
  ['needs-you', prog({ state: 'needs-you' }), [], 'needs'],
  ['a prompt waiting beats working', prog({ ask }), [], 'needs'],
  ['a question beats stuck', prog({ state: 'needs-you' }), [item()], 'needs'],
  ['done stays done with a hog left behind', prog({ state: 'done' }), [item()], 'done'],
  ['idle stays idle', prog({ state: 'idle' }), [item()], 'idle'],
]
for (const [name, p, stuck, want] of table) test(`chatShown: ${name}`, () => assert.equal(chatShown(p, stuck), want))

test('isBusy: working, waiting and stuck are busy', () => {
  assert.deepEqual(['working', 'waiting', 'stuck', 'needs', 'done', 'idle'].map(s => isBusy(s as never)), [true, true, true, false, false, false])
})

// Each page helper reads the shared rule: the same stuck chat reads the same on all of them.
const row = (id: string): ChatRow => ({ pid: 1, sessionId: id, cwd: '/x', link: '', live: true, why: [], ai: 'claude', name: id })
test('nowLanes lists a stuck chat as working, like the shared rule', () => {
  const p = prog()
  assert.equal(nowLanes([{ chat: row('s'), progress: p }], [], NOW).working.length, 1)
  assert.equal(isBusy(chatShown(p, [item()])), true)
})
test('the court shows a stuck chat as stuck and a waiting one as waiting', () => {
  const stuckHub = { ...emptyHub(), chats: [row('s')], progress: [prog()], stuck: [item()] }
  const yard = (h: typeof stuckHub) => buildCourt(h).nodes.find(n => n.kind === 'courtyard')
  assert.equal(yard(stuckHub)?.state, chatShown(stuckHub.progress[0], stuckHub.stuck))
  assert.equal(yard(stuckHub)?.state, 'stuck')
  const waitHub = { ...stuckHub, progress: [prog({ waiting: true })], stuck: [] }
  assert.equal(yard(waitHub)?.state, 'waiting')
})
test('hubCounts counts a stuck chat once as working', () => {
  const h = { ...emptyHub(), chats: [row('s')], progress: [prog()], stuck: [item()] }
  assert.equal(hubCounts(h, [], NOW).working, 1)
})

import { switcherItems } from './switcher'
test('the switcher reads the shared rule', () => {
  const p = prog()
  const live = (stuck?: StuckItem[]) => switcherItems([{ chat: row('s'), progress: p }], [], [], stuck).find(i => i.kind === 'live') as { stuck?: true }
  assert.equal(live([item()]).stuck, true)
  assert.equal(live([]).stuck, undefined)
  assert.equal(live([item()]).stuck === true, chatShown(p, [item()]) === 'stuck')
})
test('a done or idle chat never reads as stuck, so no page tags it', () => {
  for (const state of ['done', 'idle'] as const) assert.notEqual(chatShown(prog({ state }), [item()]), 'stuck')
})
