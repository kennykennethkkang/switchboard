import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TerminalTags, ANSI } from '../src/hub/terminal-tags'
import type { ChatRow } from '../src/hub/types'

type Fake = { name: string; exitStatus?: unknown; disposed: boolean; pid: number; processId: Promise<number>; dispose(): void }
const term = (name: string, pid = 0): Fake => ({ name, pid, disposed: false, processId: Promise.resolve(pid), dispose() { this.disposed = true } })
const chat = (sessionId: string, name: string, o: Partial<ChatRow> = {}): ChatRow => ({ pid: 0, sessionId, name, cwd: '/w/app', link: '', live: true, why: [], ...o })

describe('terminal tags', () => {
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

  it('maps every window color to an ansi color', () => {
    assert.equal(ANSI.violet, 'terminal.ansiMagenta')
    assert.equal(Object.keys(ANSI).length, 6)
  })
})
