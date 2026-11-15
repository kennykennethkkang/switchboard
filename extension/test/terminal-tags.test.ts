import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TerminalTags, ANSI, restoredOurs } from '../src/hub/terminal-tags'
import type { ChatRow } from '../src/hub/types'

type Fake = { name: string; exitStatus?: unknown; disposed: boolean; pid: number; processId: Promise<number>; dispose(): void }
const term = (name: string, pid = 0): Fake => ({ name, pid, disposed: false, processId: Promise.resolve(pid), dispose() { this.disposed = true } })
const chat = (sessionId: string, name: string, o: Partial<ChatRow> = {}): ChatRow => ({ pid: 0, sessionId, name, cwd: '/w/app', link: '', live: true, why: [], ...o })

describe('terminal tags', () => {
  it('a terminal restored after a reload is ours by its icon id or chat name', () => {
    // revived terminals hand back the icon as a plain { id }, not a ThemeIcon
    assert.equal(restoredOurs({ id: 'radio-tower' }, 'zsh'), true)
    assert.equal(restoredOurs(undefined, 'Claude Code: Deploy Armasu'), true)
    assert.equal(restoredOurs(undefined, 'Codex: x'), true)
    assert.equal(restoredOurs({ id: 'terminal' }, 'zsh'), false)
    assert.equal(restoredOurs(undefined, 'claude'), false)
  })

  it('a restored Claude Code terminal keeps its two-word prefix', () => {
    const tags = new TerminalTags<Fake>()
    const a = term('Claude Code: old name')
    tags.seen(a, true)
    tags.host(a, 's1')
    assert.deepEqual(tags.renames([chat('s1', 'new name')]).map(([, n]) => n), ['Claude Code: new name'])
  })

  it('ours are switchboard, the rest are user', () => {
    const tags = new TerminalTags<Fake>()
    const a = term('Claude: fix login'), mine = term('zsh')
    tags.own(a, 'Claude', 's1')
    tags.seen(a)
    tags.seen(mine)
    assert.equal(tags.ownerOf(a), 'switchboard')
    assert.equal(tags.ownerOf(mine), 'user')
    tags.seen(mine, true)
    assert.equal(tags.ownerOf(mine), 'user', 'a seen terminal keeps its owner')
  })

  it('closeChat disposes only switchboard terminals of that session', () => {
    const tags = new TerminalTags<Fake>()
    const a = term('Claude: x'), b = term('Codex: x'), other = term('Claude: y'), mine = term('zsh', 42)
    tags.own(a, 'Claude', 's1'); tags.own(b, 'Codex', 's1'); tags.own(other, 'Claude', 's2'); tags.seen(mine)
    // a user terminal running the same chat by pid is still never closed
    tags.host(mine, 's1')
    assert.equal(tags.closeChat('s1'), 2)
    assert.deepEqual([a.disposed, b.disposed, other.disposed, mine.disposed], [true, true, false, false])
    assert.equal(tags.closeChat('nope'), 0)
  })

  it('closeEnded closes the terminal of an approved chat once the chat is no longer live', () => {
    let now = 100
    const tags = new TerminalTags<Fake>(() => now)
    const a = term('Claude: a'), b = term('Claude: b'), c = term('Claude: c'), mine = term('zsh')
    tags.own(a, 'Claude', 's1'); tags.own(b, 'Claude', 's2'); tags.own(c, 'Claude', 's3'); tags.seen(mine); tags.host(mine, 's1')
    const approved = new Map([['s1', 200], ['s2', 200], ['s4', 200]])
    // s4 resumed from History after its approval: its new terminal is never closed for that old approval
    now = 300
    const back = term('Codex: d'); tags.own(back, 'Codex', 's4')
    assert.equal(tags.closeEnded([chat('s4', 'd', { live: false })], approved), 0)
    assert.equal(back.disposed, false)
    // s1 still running its last turn: stays; s3 ended but never approved: stays
    assert.equal(tags.closeEnded([chat('s1', 'a'), chat('s2', 'b'), chat('s3', 'c', { live: false })], approved), 0)
    // a failed read lists no chats: nothing closes on that alone
    assert.equal(tags.closeEnded([], approved), 0)
    b.exitStatus = { code: 0 }
    assert.equal(tags.closeEnded([chat('s1', 'a', { live: false })], approved), 2)
    assert.deepEqual([a.disposed, b.disposed, c.disposed, mine.disposed], [true, true, false, false])
  })

  it('a terminal revived after a reload keeps its chat and first-seen time, so Approve still closes it', () => {
    let now = 100
    const before = new TerminalTags<Fake>(() => now)
    const a = term('Claude Code: a', 41), b = term('Claude Code: b', 42)
    before.own(a, 'Claude Code', 's1'); before.own(b, 'Claude Code', 's2')
    const memo = new Map(before.memo().map(([t, m]) => [t.pid, m]))
    // reload: approved at 200 while s1 ran its last turn, then the window came back at 300
    now = 300
    const after = new TerminalTags<Fake>(() => now)
    const a2 = term('Claude Code: a', 41), b2 = term('Claude Code: b', 42), fresh = term('Claude Code: c', 43)
    after.seen(a2, true, memo.get(41)); after.seen(b2, true, memo.get(42)); after.seen(fresh, true, memo.get(43))
    const approved = new Map([['s1', 200]])
    // s1 ended before the reload: not live, so bindLive never ties it; the memo does
    assert.equal(after.closeEnded([chat('s1', 'a', { live: false }), chat('s2', 'b', { live: false })], approved), 1)
    assert.deepEqual([a2.disposed, b2.disposed, fresh.disposed], [true, false, false])
  })

  it('a revived terminal seen before its name came back is claimed later, so Approve still closes it', () => {
    let now = 300
    const tags = new TerminalTags<Fake>(() => now)
    const a = term('zsh', 41), user = term('zsh', 42)
    // the open event fires before VS Code restores the name and icon
    tags.seen(a, false); tags.seen(user, false)
    a.name = 'Claude Code: a'
    now = 400
    tags.claim(a, { sessionId: 's1', at: 100 })
    assert.equal(tags.ownerOf(a), 'switchboard')
    assert.equal(tags.ownerOf(user), 'user')
    assert.equal(tags.closeEnded([chat('s1', 'a', { live: false })], new Map([['s1', 200]])), 1)
    assert.equal(a.disposed, true)
    // a live chat bound by pid, no memo: keeps that chat and its first-seen time
    const b = term('zsh', 43)
    tags.seen(b, false); tags.host(b, 's2'); b.name = 'Claude: b'
    tags.claim(b)
    assert.deepEqual(tags.memo().find(([t]) => t === b)?.[1], { sessionId: 's2', at: 400 })
  })

  it('a revived terminal whose old chat ended moves to the live chat now in it', async () => {
    let now = 300
    const tags = new TerminalTags<Fake>(() => now)
    const a = term('Claude Code: a', 41)
    tags.seen(a, true, { sessionId: 's1', at: 100 })
    now = 400
    await tags.bindLive([chat('s1', 'a', { live: false }), chat('s3', 'b', { pid: 7 })], async pid => pid === 7 ? a : undefined)
    assert.equal(tags.of('s3'), a)
    // Approving the ended s1 must not close the terminal s3 runs in
    assert.equal(tags.closeEnded([chat('s1', 'a', { live: false }), chat('s3', 'b', { pid: 7 })], new Map([['s1', 350]])), 0)
    assert.equal(a.disposed, false)
  })

  it('renames only the active terminal; the others wait until they are active', () => {
    const tags = new TerminalTags<Fake>()
    const a = term('Claude: one'), b = term('Claude: two')
    tags.own(a, 'Claude', 's1'); tags.own(b, 'Claude', 's2')
    const chats = [chat('s1', 'uno'), chat('s2', 'dos')]
    assert.deepEqual(tags.renamesFor(chats, a), [[a, 'Claude: uno']])
    assert.deepEqual(tags.renamesFor(chats, undefined), [])
    tags.renamed(a, 'Claude: uno')
    assert.deepEqual(tags.renamesFor(chats, a), [])
    assert.deepEqual(tags.renamesFor(chats, b), [[b, 'Claude: dos']])
  })

  it('renames a tagged terminal when its chat is renamed, once', () => {
    const tags = new TerminalTags<Fake>()
    const a = term('Claude: app'), mine = term('zsh', 9)
    tags.own(a, 'Claude', 's1'); tags.seen(mine); tags.host(mine, 's2')
    const chats = [chat('s1', 'auth rework'), chat('s2', 'mine renamed')]
    assert.deepEqual(tags.renames(chats), [[a, 'Claude: auth rework']])
    tags.renamed(a, 'Claude: auth rework')
    assert.deepEqual(tags.renames(chats), [], 'no repeat even if VS Code keeps the old name')
    assert.deepEqual(tags.renames([chat('s1', 'auth v2')]), [[a, 'Claude: auth v2']])
  })

  it('binds by pid: unbound ours take the session, user ones only host it', async () => {
    const tags = new TerminalTags<Fake>()
    const ours = term('Claude: app', 100), mine = term('zsh', 200)
    tags.own(ours, 'Claude'); tags.seen(mine)
    const terms = [ours, mine]
    const byPid: Record<number, Fake> = { 1: ours, 2: mine }
    await tags.bindLive([chat('s1', 'a', { pid: 1 }), chat('s2', 'b', { pid: 2 })], async pid => byPid[pid])
    assert.deepEqual(tags.rows(terms, []).map(r => [r.owner, r.sessionId]), [['switchboard', 's1'], ['user', 's2']])
    assert.equal(tags.closeChat('s2'), 0)
  })

  it('rows: running, ended and exited; missing chats get Open', () => {
    const tags = new TerminalTags<Fake>()
    const live = term('Claude: a'), done = term('Claude: b'), dead = term('Claude: c'), mine = term('zsh')
    dead.exitStatus = { code: 0 }
    tags.own(live, 'Claude', 's1'); tags.own(done, 'Claude', 's2'); tags.own(dead, 'Claude', 's3'); tags.seen(mine)
    const gone = term('Claude: d'); tags.own(gone, 'Claude', 's4'); tags.gone(gone)
    const chats = [chat('s1', 'a'), chat('s2', 'b', { live: false }), chat('s3', 'c'), chat('s4', 'd', { live: false }), chat('s5', 'e'), chat('s6', 'far', { cwd: '/elsewhere' })]
    const rows = tags.rows([live, done, dead, mine], chats)
    assert.deepEqual(rows.map(r => [r.owner, r.name, r.state]), [
      ['switchboard', 'Claude: a', 'running'], ['switchboard', 'Claude: b', 'ended'], ['switchboard', 'Claude: c', 'exited'], ['user', 'zsh', 'running'],
    ])
    assert.deepEqual(rows.map(r => r.chat), ['a', 'b', 'c', undefined])
    assert.deepEqual(tags.missing(chats, '/w').map(c => c.sessionId), ['s4', 's5'])
    assert.equal(tags.find(rows[3].id), mine)
  })

  it('of finds the chat terminal, ours first; a restored one with our icon is ours', () => {
    const tags = new TerminalTags<Fake>()
    const mine = term('zsh'), restored = term('Codex: old')
    tags.seen(mine); tags.host(mine, 's1')
    assert.equal(tags.of('s1'), mine)
    tags.seen(restored, true); tags.host(restored, 's1')
    assert.equal(tags.of('s1'), restored)
    assert.deepEqual(tags.renames([chat('s1', 'new')]), [[restored, 'Codex: new']])
  })

  it('ourOf finds a reload-revived Codex terminal by its memo, never a user one', () => {
    const tags = new TerminalTags<Fake>()
    const user = term('zsh'), revived = term('Codex: fix')
    tags.seen(user); tags.host(user, 's1')
    assert.equal(tags.ourOf('s1'), undefined)
    tags.seen(revived, true, { sessionId: 's1', at: 1 })
    assert.equal(tags.ourOf('s1'), revived)
  })

  it('maps every window color to an ansi color', () => {
    assert.equal(ANSI.violet, 'terminal.ansiMagenta')
    assert.equal(Object.keys(ANSI).length, 6)
  })
})
