import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { HubService } from '../src/hub/hub-service'
import { handleHub } from '../src/hub/routes'
import { waitQuestion } from '../src/hub/questions'
import { forgetRung, phoneChange, pickOf, pushText, ring, setDial, type Call } from '../src/hub/phone'
import type { ChatProgress } from '../src/hub/types'

const calls: Call[] = []
let answer = 'So your decision is Blue'
setDial(async c => { calls.push(c); await new Promise(r => setTimeout(r, 5)); return { code: 0, answer } })
const tick = () => new Promise(r => setTimeout(r, 40))

describe('phone line', () => {
  it('rings one call at a time, in order, and a key only once', async () => {
    calls.length = 0
    let live = 0, most = 0
    setDial(async c => { live++; most = Math.max(most, live); calls.push(c); await new Promise(r => setTimeout(r, 5)); live--; return { code: 0, answer } })
    const all = await Promise.all([ring({ key: 'k1', text: 'one' }), ring({ key: 'k2', text: 'two' }), ring({ key: 'k1', text: 'again' })])
    assert.equal(most, 1)
    assert.deepEqual(calls.map(c => c.text), ['one', 'two'])
    assert.equal(all[2], undefined)
  })

  it('picks an option by name, else the words as Other', () => {
    const q = { question: 'Pick', options: ['Red', 'Blue'] }
    assert.equal(pickOf(q, 'So your decision is blue'), 1)
    assert.deepEqual(pickOf(q, 'neither, go green'), { other: 'neither, go green' })
    assert.deepEqual(pickOf({ ...q, multiSelect: true }, 'red and blue'), [0, 1])
    assert.deepEqual(pickOf({ question: 'x', options: ['a', 'b'] }, 'a sandwich'), 0)
  })

  it('says done and needs-you once, not a hub ask', async () => {
    calls.length = 0
    const p = { sessionId: 'pc1', cwd: '/w', state: 'needs-you', tasks: [], question: 'Approve the deploy?' } as unknown as ChatProgress
    phoneChange(p, 'Shop')
    phoneChange(p, 'Shop')
    phoneChange({ ...p, sessionId: 'pc2', ask: { id: 'x', kind: 'question', tool: 'ask', options: [], via: 'hub' } } as ChatProgress, 'Other')
    phoneChange({ ...p, state: 'done', question: undefined, report: { done: ['Shipped the cart'], left: [] } } as ChatProgress, 'Shop')
    await tick()
    assert.equal(calls.length, 2)
    assert.match(calls[0].text, /Shop needs you: Approve the deploy\?/)
    assert.equal(calls[0].say, true)
    assert.match(calls[1].text, /Shop is done/)
    assert.equal(calls[1].say, true)
  })

  it('leaves an AskUserQuestion to the chat own call, but rings the closing Approve once', async () => {
    calls.length = 0
    const q = (sessionId: string, question: string) => ({ sessionId, cwd: '/w', state: 'needs-you', tasks: [], question, ask: { id: `t-${sessionId}`, kind: 'question', tool: 'AskUserQuestion', options: [], questions: [{ question, options: ['Approve', 'Send back'] }] } }) as unknown as ChatProgress
    phoneChange(q('pc3', 'Which layout?'), 'Shop')
    phoneChange(q('pc4', 'Approve this chat as finished?'), 'Shop')
    phoneChange(q('pc4', 'Approve this chat as finished?'), 'Shop')
    await tick()
    assert.deepEqual(calls.map(c => c.text), ['Shop needs you: Approve this chat as finished?'])
  })
})

describe('pushText', () => {
  const chat = (sessionId: string, state: string, question?: string) => ({ sessionId, cwd: '/w', state, tasks: [], question, ...(question ? { ask: { id: 'q', kind: 'question', tool: 'AskUserQuestion', options: [], questions: [{ question, options: ['Approve', 'Send back'] }] } } : {}) }) as unknown as ChatProgress
  const APPROVE = 'Approve this chat as finished?'

  it('pushes at the closing question, not again at the Done its Approve leads to', () => {
    assert.equal(pushText(chat('pt1', 'needs-you', APPROVE), undefined, 100), 'done, waiting for your Approve')
    assert.equal(pushText(chat('pt1', 'done'), 150, 160), undefined)
  })

  it('pushes a Done with no closing question, or one that was never approved', () => {
    assert.equal(pushText(chat('pt2', 'done')), 'finished')
    pushText(chat('pt3', 'needs-you', APPROVE), undefined, 100)
    assert.equal(pushText(chat('pt3', 'done'), undefined, 160), 'finished')
    // An approval from before this closing question, then a Send back.
    pushText(chat('pt4', 'needs-you', APPROVE), 50, 100)
    assert.equal(pushText(chat('pt4', 'done'), 50, 160), 'finished')
  })

  it('pushes a resumed chat that finishes again without asking', () => {
    pushText(chat('pt5', 'needs-you', APPROVE), undefined, 100)
    pushText(chat('pt5', 'done'), 150, 160)
    assert.equal(pushText(chat('pt5', 'done'), 150, 900), 'finished')
  })

  it('pushes nothing for other questions or states', () => {
    assert.equal(pushText(chat('pt6', 'needs-you', 'Which layout?')), undefined)
    assert.equal(pushText(chat('pt6', 'working')), undefined)
  })
})

describe('phone mode in the hub', () => {
  const phoneOn = (h: HubService, on = true) => h.set({ controls: { ...h.get().controls, switchboard: { ...h.get().controls.switchboard, phone: on } } })

  it('mirrors phone into limits.json for the mods', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-'))
    const h = new HubService()
    h.keepRetries(path.join(dir, 'retries-x.json'))
    phoneOn(h)
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'limits.json'), 'utf8')).phone, true)
    phoneOn(h, false)
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'limits.json'), 'utf8')).phone, false)
  })

  it('a switchboard ask is phoned and answered with the pick', async () => {
    calls.length = 0
    answer = 'So your decision is Blue'
    const h = new HubService()
    phoneOn(h)
    h.hook({ session_id: 'ps1', cwd: '/w', hook_event_name: 'SessionStart', source: 'startup' })
    const id = 'f'.repeat(32)
    handleHub(h, 'POST', `/hub/question?token=${h.token}`, JSON.stringify({ id, sessionId: 'ps1', questions: [{ question: 'Pick a color', options: [{ label: 'Red' }, { label: 'Blue' }] }] }))
    assert.deepEqual(await waitQuestion(id, 1000), [1])
    assert.match(calls[0].text, /Pick a color.*Red, Blue/)
    assert.notEqual(calls[0].say, true)
  })

  it('pause start and resume each say one notice', async () => {
    calls.length = 0
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-'))
    const now = Date.UTC(2026, 10, 8, 12), reset = now + 3_600_000
    const h = new HubService()
    h.keepRetries(path.join(dir, 'retries-x.json'))
    phoneOn(h)
    h.set({ chats: [{ pid: 1, sessionId: 'pp1', name: 'pp1', cwd: '/u/w', link: '', live: true, why: [] }] })
    h.hook({ session_id: 'pp1', cwd: '/u/w', hook_event_name: 'SessionStart' }, 1)
    const feed = (pct: number) => h.ingest({ token: h.token, kind: 'live', sessionId: 'pp1', cwd: '/u/w', limits: [{ kind: 'five_hour', percentUsed: pct, resetsAt: new Date(reset).toISOString() }] }, now)
    feed(99)
    feed(99)
    h.pauseTick(reset + 120_000)
    await tick()
    assert.equal(calls.length, 2)
    assert.match(calls[0].text, /paused/i)
    assert.match(calls[1].text, /resum/i)
    assert.ok(calls.every(c => c.say))
  })

  const holdPost = (h: HubService, sessionId: string, resetsAt: number | null, now: number) =>
    h.ingest({ token: h.token, kind: 'hold', sessionId, hold: resetsAt === null ? null : { kind: 'five_hour', percent: 99, resetsAt } }, now)

  it('a pause the mod starts places the paused call once', async () => {
    calls.length = 0
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-'))
    const now = Date.UTC(2026, 10, 8, 14), reset = now + 3_600_000
    const h = new HubService()
    h.keepRetries(path.join(dir, 'retries-x.json'))
    phoneOn(h)
    holdPost(h, 'mh1', reset, now)
    holdPost(h, 'mh2', reset, now)
    holdPost(h, 'mh1', reset, now + 1)
    await tick()
    assert.equal(calls.length, 1)
    assert.match(calls[0].text, /paused/i)
  })

  it('a hold at or before a hand resume does not pause again', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-'))
    const now = Date.UTC(2026, 10, 8, 16), reset = now + 3_600_000
    const h = new HubService()
    h.keepRetries(path.join(dir, 'retries-x.json'))
    holdPost(h, 'rh1', reset, now)
    h.endPause(true, now + 1)
    holdPost(h, 'rh1', reset, now + 2)
    assert.equal(h.get().pause, undefined)
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'limits.json'), 'utf8')).paused, undefined)
    // A later window still pauses.
    holdPost(h, 'rh1', reset + 5 * 3_600_000, now + 3)
    assert.equal(h.get().pause?.resumeAt, reset + 5 * 3_600_000 + 60_000)
  })

  it('two windows on one machine ring a pause and its resume once', async () => {
    calls.length = 0
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-'))
    const now = Date.UTC(2026, 10, 8, 18), reset = now + 3_600_000
    const wins = [new HubService(), new HubService()]
    for (const [i, h] of wins.entries()) {
      h.keepRetries(path.join(dir, `retries-${i}.json`))
      phoneOn(h)
      h.set({ chats: [{ pid: 1, sessionId: 'pw1', name: 'pw1', cwd: '/u/w', link: '', live: true, why: [] }] })
      h.hook({ session_id: 'pw1', cwd: '/u/w', hook_event_name: 'SessionStart' }, 1)
    }
    // Each window has its own seen set in real life; the claim file is what stops the second call.
    for (const h of wins) {
      h.ingest({ token: h.token, kind: 'live', sessionId: 'pw1', cwd: '/u/w', limits: [{ kind: 'five_hour', percentUsed: 99, resetsAt: new Date(reset).toISOString() }] }, now)
      forgetRung()
    }
    for (const h of wins) { h.pauseTick(reset + 120_000); forgetRung() }
    await tick()
    assert.deepEqual(calls.map(c => /resum/i.test(c.text) ? 'resume' : 'pause'), ['pause', 'resume'])
  })

  it('a feed pause in one window and a mod hold in another ring once', async () => {
    calls.length = 0
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-'))
    const now = Date.UTC(2026, 10, 8, 20), reset = now + 3_600_000
    const [a, b] = [new HubService(), new HubService()]
    for (const [i, h] of [a, b].entries()) { h.keepRetries(path.join(dir, `retries-${i}.json`)); phoneOn(h) }
    a.set({ chats: [{ pid: 1, sessionId: 'fx1', name: 'fx1', cwd: '/u/w', link: '', live: true, why: [] }] })
    a.hook({ session_id: 'fx1', cwd: '/u/w', hook_event_name: 'SessionStart' }, 1)
    a.ingest({ token: a.token, kind: 'live', sessionId: 'fx1', cwd: '/u/w', limits: [{ kind: 'five_hour', percentUsed: 99, resetsAt: new Date(reset).toISOString() }] }, now)
    forgetRung()
    holdPost(b, 'fx2', reset, now + 1)
    forgetRung()
    for (const h of [a, b]) { h.pauseTick(reset + 120_000); forgetRung() }
    await tick()
    assert.deepEqual(calls.map(c => /resum/i.test(c.text) ? 'resume' : 'pause'), ['pause', 'resume'])
  })
})
