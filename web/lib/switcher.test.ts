/** The quick switcher: live chats and History versions, matched by substring first, then loosely. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultCommands, matchName, rankItems, switcherItems, type Command } from './switcher'
import { demoHub } from './hub-demo'
import { liveChats } from './archive'
import type { ChatProgress, ChatState } from './hub-types'

test('matches a substring first, then letters in order, and says which letters', () => {
  assert.deepEqual(matchName('Fix login redirect', 'login'), [4, 5, 6, 7, 8])
  assert.deepEqual(matchName('Fix login redirect', 'LOGIN'), [4, 5, 6, 7, 8])
  assert.deepEqual(matchName('Fix login redirect', 'flr'), [0, 4, 10])
  assert.equal(matchName('Fix login redirect', 'xyz'), null)
  assert.deepEqual(matchName('Anything', ''), [])
  // Letters, not UTF-16 units: the rocket is one letter, so 'Fix' starts at 2.
  const name = '\u{1F680} Fix login', hits = matchName(name, 'fix')!
  assert.deepEqual(hits, [2, 3, 4])
  assert.equal([...name].filter((_, i) => hits.includes(i)).join(''), 'Fix')
})

test('lists live chats, then every History version, and ranks a name that starts with the query first', () => {
  const h = demoHub(0)
  const cards = liveChats(h.chats, h.archive).map(chat => ({ chat, progress: h.progress.find(p => p.sessionId === chat.sessionId) }))
  const items = switcherItems(cards, h.archive)
  assert.equal(items.filter(i => i.kind === 'live').length, cards.length)
  assert.deepEqual(items.filter(i => i.kind === 'history').map(i => `${i.name} v${i.version}`), ['Fix login redirect v3', 'Fix login redirect v2', 'Fix login redirect v1', 'Cookie banner copy v1'])
  const ranked = rankItems(items, 'login')
  assert.ok(ranked.length >= 4)
  assert.equal(ranked[0].item.kind, 'live')
  assert.equal(ranked[0].item.version, 4)
  assert.deepEqual(rankItems(items, 'outfit').map(r => r.item.kind === 'command' ? r.item.label : r.item.name), ['Outfit picker copy'])
  assert.equal(rankItems(items, '').length, items.length)
})

const cmds: Command[] = [
  { id: 'go:now', label: 'Now', group: 'Go to' },
  { id: 'do:new', label: 'New chat', group: 'Do', keywords: 'start spawn' },
  { id: 'go:settings', label: 'Settings', group: 'Go to', keywords: 'gear prefs' },
]

test('empty query: Go to commands, live chats, Do commands, then History', () => {
  const h = demoHub(0)
  const cards = liveChats(h.chats, h.archive).map(chat => ({ chat, progress: h.progress.find(p => p.sessionId === chat.sessionId) }))
  const items = switcherItems(cards, h.archive, cmds)
  const kinds: string[] = rankItems(items, '').map(r => r.item.kind === 'command' ? r.item.group : r.item.kind)
  const firstOf = (k: string) => kinds.indexOf(k), lastOf = (k: string) => kinds.lastIndexOf(k)
  assert.ok(lastOf('Go to') < firstOf('live') && lastOf('live') < firstOf('Do') && lastOf('Do') < firstOf('history'))
  assert.deepEqual(items.filter(i => i.kind === 'command').map(i => i.id), ['go:now', 'go:settings', 'do:new'])
  // No commands: same as before.
  assert.deepEqual(switcherItems(cards, h.archive), items.filter(i => i.kind !== 'command'))
})

test('commands match on label, then on keywords, with no letters marked for a keyword hit', () => {
  const items = switcherItems([], [], cmds)
  assert.deepEqual(rankItems(items, 'sett').map(r => [r.item.id, r.hits]), [['go:settings', [0, 1, 2, 3]]])
  assert.deepEqual(rankItems(items, 'gear').map(r => [r.item.id, r.hits]), [['go:settings', []]])
  assert.deepEqual(rankItems(items, 'spawn').map(r => r.item.id), ['do:new'])
  // A label hit beats a keyword hit.
  const both = switcherItems([], [], [{ id: 'a', label: 'Plan', group: 'Go to', keywords: 'chat' }, { id: 'b', label: 'Chats', group: 'Go to' }])
  assert.deepEqual(rankItems(both, 'chat').map(r => r.item.id), ['b', 'a'])
})

test('defaultCommands: pages always, conditional Do commands only when they apply', () => {
  const h = demoHub(0)
  const cards = liveChats(h.chats, h.archive).map(chat => ({ chat, progress: h.progress.find(p => p.sessionId === chat.sessionId) }))
  const base = defaultCommands({ cards: [], repoChanges: false, vscode: false })
  assert.deepEqual(base.map(c => c.id), ['go:now', 'go:chats', 'go:plan', 'go:live', 'go:ship', 'go:map-board', 'go:map-flow', 'go:map-memory', 'go:usage', 'go:settings', 'do:new', 'do:check-updates', 'do:sign-in', 'do:awake', 'do:calls'])
  assert.deepEqual(base.filter(c => c.id.startsWith('go:')).map(c => c.label), ['Now', 'Chats', 'Plan', 'Live', 'Ship', 'Map: Agents', 'Map: Code', 'Map: Memory', 'Usage', 'Settings'])
  assert.ok(base.every(c => c.group === (c.id.startsWith('go:') ? 'Go to' : 'Do')))

  const all = defaultCommands({ cards, repoChanges: true, vscode: true, awake: true, calls: false })
  const ids = all.map(c => c.id)
  assert.ok(ids.includes('do:commit') && ids.includes('do:push') && ids.includes('do:open-diff') && ids.includes('do:phone'))
  assert.deepEqual(['do:check-updates', 'do:sign-in', 'do:commit', 'do:push', 'do:open-diff'].map(id => all.find(c => c.id === id)?.label), ['Check for updates', 'Sign in', 'Commit', 'Push: open the Git panel', 'Open diff'])
  assert.equal(all.find(c => c.id === 'do:awake')!.hint, 'On')
  assert.equal(all.find(c => c.id === 'do:calls')!.hint, 'Off')
  const done = cards.filter(c => c.progress?.state === 'done')
  assert.ok(done.length > 0, 'demo has a done chat')
  const approve = all.filter(c => c.id.startsWith('do:approve:'))
  assert.deepEqual(approve.map(c => c.id), done.map(c => `do:approve:${c.chat.sessionId}`))
  assert.ok(approve.every(c => c.label.startsWith('Approve ') && c.label.length > 8))
})

test('switcherItems: done chats read Ready for your OK, as on Now', () => {
  const c = (id: string, state: ChatState, more: Partial<ChatProgress> = {}) => ({ chat: { pid: 1, sessionId: id, cwd: '/x/p', link: '', live: true, why: [] }, progress: { sessionId: id, cwd: '/x/p', state, roles: [], tasks: [], startedAt: 0, at: 0, ...more } as ChatProgress })
  const items = switcherItems([c('d', 'done'), c('w', 'working')], [])
  assert.deepEqual(items.map(i => i.kind === 'live' && i.chip), ['Ready for your OK', undefined])
})

test('defaultCommands: Simple view leaves out the pages it hides', () => {
  const ids = defaultCommands({ cards: [], repoChanges: false, vscode: false, simple: true }).filter(c => c.group === 'Go to').map(c => c.id)
  assert.deepEqual(ids, ['go:now', 'go:chats', 'go:plan', 'go:usage', 'go:settings'])
})
