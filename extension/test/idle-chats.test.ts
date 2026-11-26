import './temp-home'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { IDLE_CHAT_MS, idleChats, idleOffer, idleText } from '../src/hub/idle-chats'
import type { ChatProgress, ChatRow, TodoItem } from '../src/hub/types'

const NOW = 1_800_000_000_000, OLD = NOW - IDLE_CHAT_MS - 1
const chat = (o: Partial<ChatRow> = {}): ChatRow => ({ pid: 11, sessionId: 'a', name: 'One', cwd: '/p', status: 'idle', updatedAt: OLD, link: '', live: true, why: [], ...o })
const prog = (o: Partial<ChatProgress> = {}): ChatProgress => ({ sessionId: 'a', cwd: '/p', state: 'idle', roles: [], tasks: [], startedAt: 0, at: OLD, ...o })
const run = (c: Partial<ChatRow> = {}, p: Partial<ChatProgress> | null = {}, o: { todos?: TodoItem[]; holds?: boolean; ours?: boolean } = {}) =>
  idleChats({ chats: [chat(c)], progress: p ? [prog(p)] : [], todos: o.todos ?? [], holds: () => !!o.holds, ours: () => o.ours !== false, now: NOW }).length

describe('idleChats', () => {
  it('lists a chat idle for three hours', () => assert.equal(run(), 1))
  it('leaves a fresh, busy, dead, Codex or unknown chat', () => {
    for (const c of [{ updatedAt: NOW - 60_000 }, { updatedAt: undefined }, { status: 'busy' }, { status: 'waiting' }, { live: false }, { pid: 0 }, { ai: 'codex' as const }]) assert.equal(run(c), 0, JSON.stringify(c))
    assert.equal(run({}, null), 0)
    assert.equal(run({}, { at: NOW - 60_000 }), 0)
  })
  it('leaves a chat that owes or waits for something', () => {
    const ask = { id: 'q', kind: 'question' as const, tool: 'AskUserQuestion', options: ['x'] }
    const job = { id: 'j', command: 'x', startedAt: 0 } as never
    for (const p of [{ state: 'done' as const }, { state: 'needs-you' as const, ask }, { state: 'working' as const }, { ask }, { asks: [ask] }, { waiting: true }, { limited: { at: 1, error: 'x' } }, { jobs: [job] }, { subJobs: [job] },
      { tasks: [{ id: '1', subject: 's', status: 'pending' } as never] }]) assert.equal(run({}, p), 0, JSON.stringify(p))
    assert.equal(run({}, {}, { todos: [{ id: 't', text: 'x', at: 1, chat: 'a' }] }), 0)
    assert.equal(run({}, {}, { holds: true }), 0)
    assert.equal(run({}, {}, { ours: false }), 0)
  })
})

describe('idleText', () => {
  it('names the chats and the memory', () => {
    assert.equal(idleText([chat()], new Map([[11, 1024 ** 3 / 2]])), '1 chat has sat idle for 3 hours or more and holds 0.5 GB: One.')
    const four = [1, 2, 3, 4].map(n => chat({ pid: n, sessionId: String(n), name: `C${n}` }))
    assert.equal(idleText(four, new Map()), '4 chats have sat idle for 3 hours or more: C1, C2, C3 and 1 more.')
  })
})

describe('idleOffer', () => {
  const make = (picks: (string | undefined)[], lists: ChatRow[][]) => {
    const did: string[] = [], t = { now: NOW, asked: 0 }
    let n = 0
    const tick = idleOffer({ list: () => lists[Math.min(n++, lists.length - 1)], rss: async () => new Map(), now: () => t.now,
      ask: async () => { t.asked++; return picks.shift() }, suspend: id => did.push(`s:${id}`), close: id => did.push(`c:${id}`) })
    return { tick, did, t }
  }
  it('acts only on chats still idle when the button is pressed', async () => {
    const b = chat({ sessionId: 'b' })
    const { tick, did } = make(['Suspend'], [[chat(), b], [b]])
    await tick()
    assert.deepEqual(did, ['s:b'])
  })
  it('judges a slow list when it answers, not when it was asked', async () => {
    let busy = false
    const did: string[] = []
    const tick = idleOffer({ list: async () => { await new Promise(r => setTimeout(r, 20)); return busy ? [] : [chat()] }, rss: async () => new Map(), now: () => NOW,
      ask: async () => { setTimeout(() => { busy = true }, 5); return 'Suspend' }, suspend: id => did.push(id), close: () => {} })
    await tick()
    assert.deepEqual(did, [])
  })
  it('closes on Close', async () => {
    const { tick, did } = make(['Close'], [[chat()]])
    await tick()
    assert.deepEqual(did, ['c:a'])
  })
  it('stays quiet for three hours after Not now or a dismissed notice', async () => {
    for (const pick of ['Not now', undefined]) {
      const { tick, did, t } = make([pick, pick], [[chat()]])
      await tick(); await tick()
      assert.equal(t.asked, 1)
      t.now += IDLE_CHAT_MS
      await tick()
      assert.equal(t.asked, 2)
      assert.deepEqual(did, [])
    }
  })
  it('shows one notice at a time', async () => {
    let done: (v?: string) => void = () => {}
    let asked = 0
    const tick = idleOffer({ list: () => [chat()], rss: async () => new Map(), ask: () => { asked++; return new Promise<string | undefined>(r => { done = r }) }, suspend: () => {}, close: () => {}, now: () => NOW })
    const first = tick()
    await tick()
    await new Promise(r => setTimeout(r, 5))
    assert.equal(asked, 1)
    done(); await first
  })
})
