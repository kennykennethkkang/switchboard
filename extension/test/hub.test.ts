/**
 * Unit tests for the Hub's state and its two routes.
 *
 * The invariant: nothing reaches the Hub or a chat's inbox without the
 * window's token, and an inbox hands each item over exactly once.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as os from 'node:os'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { CONTINUE, HubService, continueText } from '../src/hub/hub-service'
import { commandProblem, handleHub as route, handleHubRequest, type HubReply } from '../src/hub/routes'
import { board, suggest } from '../src/hub/brain'

// Only /hub/ask answers later, and its test awaits it.
const handleHub = (...a: Parameters<typeof route>) => route(...a) as HubReply | undefined

const live = (token: string, sessionId: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ token, kind: 'live', sessionId, cwd: '/w', limits: [{ kind: 'five_hour', percentUsed: 41 }], tokens: 82000, ...extra })

describe('hub holds', () => {
  it('says whether this window holds a chat, so the app sends its commands here', async () => {
    const hub = new HubService()
    hub.holds = async id => id === 'mine'
    const ask = (id: string, token = hub.token) => route(hub, 'GET', `/hub/holds?session=${id}&token=${token}`, '') as Promise<HubReply>
    assert.equal((await ask('mine')).status, 204)
    assert.equal((await ask('theirs')).status, 404)
    assert.equal((await ask('mine', 'wrong')).status, 403)
  })
})

describe('hub feed', () => {
  it('ignores a post without the token', () => {
    const hub = new HubService()
    const reply = handleHub(hub, 'POST', '/hub', live('wrong', 's1'))
    assert.equal(reply?.status, 403)
    assert.equal(hub.get().live.length, 0)
  })

  it('merges a live post and replaces the same session on the next one', () => {
    const hub = new HubService()
    handleHub(hub, 'POST', '/hub', live(hub.token, 's1'))
    handleHub(hub, 'POST', '/hub', live(hub.token, 's1', { tokens: 90000 }))
    assert.equal(hub.get().live.length, 1)
    assert.equal(hub.get().live[0].tokens, 90000)
  })

  it('keeps both limits and a resetsAt sent as epoch seconds', () => {
    const hub = new HubService()
    handleHub(hub, 'POST', '/hub', live(hub.token, 's1', { limits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: 1794066000 }, { kind: 'seven_day', percentUsed: 18, resetsAt: '2026-11-10T09:00:00Z' }] }))
    assert.deepEqual(hub.get().live[0].limits, [{ kind: 'five_hour', percentUsed: 42, resetsAt: '1794066000' }, { kind: 'seven_day', percentUsed: 18, resetsAt: '2026-11-10T09:00:00Z' }])
  })

  it('keeps each chat\'s cache-keeper state, latest post wins, and refuses a malformed one', () => {
    const hub = new HubService()
    const post = (extra: Record<string, unknown>, at = 1000) => hub.ingest({ token: hub.token, kind: 'cache', sessionId: 's1', cwd: '/w', state: 'warm', warmUntil: 5000, tokens: 312000, pings: 0, ...extra }, at)
    assert.equal(post({}), true)
    assert.equal(post({ pings: 1, warmUntil: 9000 }, 2000), true)
    assert.deepEqual(hub.get().cache, [{ sessionId: 's1', state: 'warm', warmUntil: 9000, tokens: 312000, pings: 1, at: 2000 }])
    assert.equal(post({ state: 'hot' }), false)
    assert.equal(post({ sessionId: undefined }), false)
    assert.equal(post({ state: 'cold' }, 3000), true)
    assert.equal(hub.get().cache?.[0].state, 'cold')
    // A chat quiet for four hours drops off.
    hub.ingest({ token: hub.token, kind: 'cache', sessionId: 's2', state: 'warm', warmUntil: 1, tokens: 1, pings: 0 }, 3000 + 4 * 3600_000)
    assert.deepEqual(hub.get().cache?.map(c => c.sessionId), ['s2'])
  })

  it('takes the old feed kinds and keeps nothing of them, so an older mod is not sent looking again', () => {
    const hub = new HubService()
    const before = JSON.stringify(hub.get())
    for (const kind of ['diet', 'guard', 'agent']) assert.equal(hub.ingest({ token: hub.token, kind, detail: 'x' }), true)
    assert.equal(JSON.stringify(hub.get()), before)
  })

  it('drops a live session silent for ten minutes', () => {
    const hub = new HubService()
    hub.ingest(JSON.parse(live(hub.token, 'old')), 0)
    hub.ingest(JSON.parse(live(hub.token, 'new')), 11 * 60 * 1000)
    assert.deepEqual(hub.get().live.map(s => s.sessionId), ['new'])
  })

  it('answers a bad body and an unknown route plainly', () => {
    const hub = new HubService()
    assert.equal(handleHub(hub, 'POST', '/hub', '{nope')?.status, 400)
    assert.equal(handleHub(hub, 'GET', '/hub/other', '')?.status, 404)
    assert.equal(handleHub(hub, 'POST', '/hooks', '{}'), undefined)
  })
})

describe('hub inbox', () => {
  it('hands each queued item over once, to its own chat only', () => {
    const hub = new HubService()
    hub.queue('s1', { kind: 'prompt', text: 'run the tests' })
    hub.queue('s2', { kind: 'rc' })
    const first = handleHub(hub, 'GET', `/hub/inbox?session=s1&token=${hub.token}`, '')
    assert.equal(first?.status, 200)
    const items = JSON.parse(first!.body)
    assert.equal(items.length, 1)
    assert.equal(items[0].text, 'run the tests')
    assert.deepEqual(JSON.parse(handleHub(hub, 'GET', `/hub/inbox?session=s1&token=${hub.token}`, '')!.body), [])
    assert.equal(JSON.parse(handleHub(hub, 'GET', `/hub/inbox?session=s2&token=${hub.token}`, '')!.body)[0].kind, 'rc')
  })

  it('refuses the inbox without the token', () => {
    const hub = new HubService()
    hub.queue('s1', { kind: 'prompt', text: 'x' })
    assert.equal(handleHub(hub, 'GET', '/hub/inbox?session=s1&token=nope', '')?.status, 403)
    assert.equal(hub.take('s1').length, 1)
  })
})

describe('message box reach', () => {
  const row = (ai?: 'claude' | 'codex') => ({ pid: 1, sessionId: 's1', cwd: '/w', link: '', live: true, why: [], ai })
  it('counts a Claude chat as taking messages only while its mod polls the inbox', () => {
    const hub = new HubService()
    assert.equal(hub.takes(row(), false, 1_000), false)
    hub.take('s1', 1_000)
    assert.equal(hub.takes(row('claude'), false, 5_000), true)
    assert.equal(hub.takes(row(), false, 20_000), false)
  })

  it('counts a Codex chat as taking messages only with a terminal tied to it', () => {
    const hub = new HubService()
    hub.take('s1', 1_000)
    assert.equal(hub.takes(row('codex'), false, 1_000), false)
    assert.equal(hub.takes(row('codex'), true, 1_000), true)
  })

  it('never counts a chat that is not live', () => {
    const hub = new HubService()
    hub.take('s1', 1_000)
    assert.equal(hub.takes({ ...row('claude'), live: false }, false, 1_000), false)
    assert.equal(hub.takes({ ...row('codex'), live: false }, true, 1_000), false)
  })
})

describe('keep working', () => {
  it('queues a compaction for one chat', () => {
    const hub = new HubService()
    hub.queue('s1', { kind: 'compact' })
    assert.equal(hub.take('s1')[0].kind, 'compact')
  })
})

describe('contract', () => {
  it('keeps the extension and webview copies of the hub types identical', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const body = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf8')
    assert.equal(body('../src/hub/types.ts'), body('../../web/lib/hub-types.ts'))
  })
})


describe('handoff', () => {
  it('tells the mod which way a full chat goes, to the token holder only', () => {
    const h = new HubService()
    h.set({ keep: { ...h.get().keep, onFull: 'fresh', freshBranch: true } })
    assert.equal(handleHub(h, 'GET', '/hub/keep?token=nope', '')?.status, 403)
    const ok = handleHub(h, 'GET', `/hub/keep?token=${h.token}`, '')
    assert.deepEqual(JSON.parse(ok!.body), { onFull: 'fresh', freshBranch: true })
  })

  it('passes on a handoff whose note sits in the handoffs folder, and refuses others', () => {
    const h = new HubService()
    const seen: unknown[] = []
    h.onHandoff(x => seen.push(x))
    const home = os.homedir().replace(/\\/g, '/')
    assert.ok(h.ingest({ token: h.token, kind: 'handoff', sessionId: 's1', cwd: '/u/Armasu', note: `${home}/.claude/handoffs/Armasu/202610231015-s1.md`, branch: 'claude/x' }))
    assert.equal(h.ingest({ token: h.token, kind: 'handoff', sessionId: 's1', cwd: '/u/Armasu', note: '/etc/passwd' }), false)
    assert.equal(h.ingest({ token: h.token, kind: 'handoff', sessionId: 's1', cwd: '/u/Armasu', note: `${home}/.claude/handoffs/../../x.md` }), false)
    assert.deepEqual(seen, [{ sessionId: 's1', cwd: '/u/Armasu', note: `${home}/.claude/handoffs/Armasu/202610231015-s1.md`, branch: 'claude/x' }])
  })
})

describe('brain routes', () => {
  const seed = (hub: HubService) => {
    hub.set({ projects: [{ name: 'A', path: '/a', kind: 'repo', isOpen: true }, { name: 'B', path: '/b', kind: 'repo', isOpen: false }] })
    handleHub(hub, 'POST', '/hub', JSON.stringify({ token: hub.token, kind: 'live', sessionId: 'x', cwd: '/a', label: 'Shop', prompt: 'the shop', file: '/a/shop.ts' }))
    handleHub(hub, 'POST', '/hub', JSON.stringify({ token: hub.token, kind: 'live', sessionId: 'y', cwd: '/b', label: 'Far', prompt: 'far away' }))
  }

  it('refuses a brief without the token', () => {
    const hub = new HubService()
    assert.equal((handleHub(hub, 'GET', '/hub/brief?cwd=/a&token=no', '') as { status: number }).status, 403)
  })

  it('briefs a chat on its own project only', () => {
    const hub = new HubService()
    seed(hub)
    const reply = handleHub(hub, 'GET', `/hub/brief?cwd=/a&session=me&token=${hub.token}`, '') as { body: string }
    assert.match(reply.body, /Shop/)
    assert.doesNotMatch(reply.body, /Far|far away/)
  })

  it('records the latest file and keeps when it changed', () => {
    const hub = new HubService()
    seed(hub)
    const first = hub.get().live.find(s => s.sessionId === 'x')!.fileAt
    handleHub(hub, 'POST', '/hub', JSON.stringify({ token: hub.token, kind: 'live', sessionId: 'x', cwd: '/a', file: '/a/shop.ts' }))
    assert.equal(hub.get().live.find(s => s.sessionId === 'x')!.fileAt, first)
    assert.equal(board(hub.get()).length, 2)
  })

  it('asks with only the asking project on the board, and not when Ask is off', async () => {
    const hub = new HubService()
    seed(hub)
    let seen = ''
    const fake = async (_q: string, ctx: string) => { seen = ctx; return 'ok' }
    const reply = await handleHub(hub, 'GET', `/hub/ask?cwd=/a&q=who&token=${hub.token}`, '', fake)
    assert.equal(reply?.body, 'ok')
    assert.match(seen, /Shop/)
    assert.doesNotMatch(seen, /Far/)
    hub.set({ controls: { ...hub.get().controls, switchboard: { ...hub.get().controls.switchboard, askBrain: false } } })
    seen = ''
    const off = await handleHub(hub, 'GET', `/hub/ask?cwd=/a&q=who&token=${hub.token}`, '', fake)
    assert.match(off!.body, /off/)
    assert.equal(seen, '')
  })

  it('suggests a dev server that stopped, until it is back', () => {
    const hub = new HubService()
    const dev = { pid: 1, command: 'next dev', port: 3000, folder: '/a' }
    hub.set({ servers: [dev] })
    hub.set({ servers: [] })
    const servers = () => suggest(hub.get(), hub.stopped()).filter(s => s.kind === 'server').length
    assert.equal(servers(), 1)
    hub.set({ servers: [dev] })
    assert.equal(servers(), 0)
  })
})

describe('hub state and command routes', () => {
  it('answers the memory graph only with the token', async () => {
    const h = new HubService()
    const health = { dangling: [], orphans: [], duplicates: [], contradictions: [], superseded: [], invalid: [], stale: [], loops: [] }
    const graph = async () => ({ nodes: [{ id: 'project:/w', kind: 'project' as const, label: 'w' }], edges: [], health })
    const ask = (token: string) => route(h, 'GET', `/hub/graph?token=${token}`, '', undefined, undefined, graph) as HubReply | Promise<HubReply>
    assert.equal((await ask('wrong')).status, 403)
    const ok = await ask(h.token)
    assert.equal(ok.status, 200)
    assert.equal(JSON.parse(ok.body).nodes[0].label, 'w')
  })

  it('answers the state only with the token', () => {
    const h = new HubService()
    assert.equal((handleHub(h, 'GET', '/hub/state?token=wrong', '') as { status: number }).status, 403)
    const ok = handleHub(h, 'GET', `/hub/state?token=${h.token}`, '') as { status: number; body: string }
    assert.equal(ok.status, 200)
    assert.deepEqual(JSON.parse(ok.body).chats, [])
    // The phone secret stays in the VS Code panel, never in the browser's state.
    h.set({ phoneUrls: { wifi: 'http://192.168.1.5:3131/?k=secret' }, thisWindow: '/g/switchboard' })
    const again = handleHub(h, 'GET', `/hub/state?token=${h.token}`, '') as { body: string }
    assert.equal(JSON.parse(again.body).phoneUrls, null)
    // The browser app is no window, so it gets no "this window" tag.
    assert.equal(JSON.parse(again.body).thisWindow, undefined)
    assert.doesNotMatch(again.body, /secret/)
    // A read marks the hub as watched, so its chats keep refreshing with no panel open.
    assert.ok(h.stateReadAt > 0)
  })

  it('answers the mic level, state and last transcript in a small read, only with the token', () => {
    const h = new HubService()
    assert.equal((handleHub(h, 'GET', '/hub/voice?token=wrong', '') as { status: number }).status, 403)
    h.voiceLevel = 0.4
    h.set({ voice: 'listening', heard: { text: 'what is running', at: 5 } })
    const ok = handleHub(h, 'GET', `/hub/voice?token=${h.token}`, '') as { status: number; body: string }
    assert.equal(ok.status, 200)
    assert.deepEqual(JSON.parse(ok.body), { voice: 'listening', level: 0.4, heard: { text: 'what is running', at: 5 } })
  })

  it('takes the token from the x-switchboard-token header, and still from the query for older callers', async () => {
    const h = new HubService()
    h.runner = () => true
    const req = (url: string, token?: string, method = 'GET', body = '') => handleHubRequest(h, { method, url, headers: token === undefined ? {} : { 'x-switchboard-token': token } }, body)
    assert.equal((await req('/hub/state', h.token))?.status, 200)
    assert.equal((await req('/hub/state', 'wrong'))?.status, 403)
    assert.equal((await req('/hub/state'))?.status, 403)
    assert.equal((await req(`/hub/state?token=${h.token}`))?.status, 200)
    // A wrong header is not rescued by a right query.
    assert.equal((await req(`/hub/state?token=${h.token}`, 'wrong'))?.status, 403)
    assert.equal((await req('/hub/command', h.token, 'POST', '{"type":"hub-aws-check"}'))?.status, 204)
    assert.equal((await req('/hub/inbox?session=s1', h.token))?.status, 200)
  })

  it('hands a hub command to the runner and refuses anything else', () => {
    const h = new HubService()
    const seen: unknown[] = []
    h.runner = c => { seen.push(c); return true }
    const post = (body: string) => (handleHub(h, 'POST', `/hub/command?token=${h.token}`, body) as { status: number }).status
    assert.equal(post(JSON.stringify({ type: 'hub-aws-check' })), 204)
    assert.equal(post(JSON.stringify({ type: 'ready' })), 400)
    assert.equal(post('not json'), 400)
    assert.equal((handleHub(h, 'POST', '/hub/command?token=no', '{"type":"hub-aws-check"}') as { status: number }).status, 403)
    assert.deepEqual(seen, [{ type: 'hub-aws-check' }])
  })

  it('refuses a command whose fields are the wrong shape, and says why', () => {
    const h = new HubService()
    const seen: unknown[] = []
    h.runner = c => { seen.push(c); return true }
    const post = (c: unknown) => handleHub(h, 'POST', `/hub/command?token=${h.token}`, JSON.stringify(c)) as { status: number; body: string }
    const missing = post({ type: 'hub-send' })
    assert.equal(missing.status, 400)
    assert.match(missing.body, /sessionId/)
    assert.equal(post({ type: 'hub-send', sessionId: 's1', text: 7 }).status, 400)
    assert.equal(post({ type: 'hub-keep', onFull: 'later' }).status, 400)
    assert.equal(post({ type: 'hub-switchboard', key: '__proto__', value: true }).status, 400)
    assert.equal(post({ type: 'hub-layout', layout: 'x' }).status, 400)
    assert.equal(post({ type: 'hub-nope' }).status, 400)
    assert.equal(post({ type: 'hub-new-chat', path: '/a', remote: false, ai: 'gemini' }).status, 400)
    assert.equal(post({ type: 'hub-star', sessionId: 's1', ai: 'toString', on: true }).status, 400)
    assert.equal(post({ type: 'hub-resume', sessionId: 's1' }).status, 400)
    assert.equal(post({ type: 'hub-focus-chat' }).status, 400)
    assert.equal(post({ type: 'hub-open-note', note: '/etc/passwd' }).status, 400)
    assert.deepEqual(seen, [])
    assert.equal(post({ type: 'hub-keep', onFull: 'fresh' }).status, 204)
    assert.equal(post({ type: 'hub-new-chat', path: '/a', remote: false }).status, 204)
    assert.equal(post({ type: 'hub-setting', key: 'model', value: null }).status, 204)
    assert.equal(post({ type: 'hub-new-chat', path: '/a', remote: false, ai: 'codex' }).status, 204)
    assert.equal(post({ type: 'hub-star', sessionId: 's1', ai: 'claude', on: true }).status, 204)
    assert.equal(post({ type: 'hub-focus-chat', sessionId: 'abc' }).status, 204)
    assert.equal(post({ type: 'hub-open-note', sessionId: 'abc' }).status, 204)
    assert.equal(seen.length, 7)
    assert.equal(post({ type: 'hub-aws-window', profile: 3 }).status, 400)
    assert.equal(post({ type: 'hub-aws-add', profile: 'a' }).status, 400)
    assert.equal(post({ type: 'hub-aws-window', profile: null }).status, 204)
    assert.equal(post({ type: 'hub-aws-login', profile: 'live', chrome: 'Default' }).status, 204)
    assert.equal(post({ type: 'hub-aws-rename', profile: 'live', to: 'main' }).status, 204)
    assert.equal(post({ type: 'hub-aws-label', profile: 'live', label: 'Me' }).status, 204)
    assert.equal(post({ type: 'hub-aws-add', profile: 'a', region: 'us-west-1' }).status, 204)
    assert.equal(post({ type: 'hub-aws-check' }).status, 204)
  })

  it('answers 400 with the reason when the runner refuses a command', () => {
    const h = new HubService()
    h.runner = () => 'Remote Control could not read settings.json'
    const r = handleHub(h, 'POST', `/hub/command?token=${h.token}`, '{"type":"hub-rc","on":true}') as { status: number; body: string }
    assert.equal(r.status, 400)
    assert.equal(r.body, 'Remote Control could not read settings.json')
  })

  it('answers 400 with the reason when the runner refuses later', async () => {
    const h = new HubService()
    h.runner = async () => 'that terminal is not running Codex'
    const r = await handleHub(h, 'POST', `/hub/command?token=${h.token}`, '{"type":"hub-send","sessionId":"s1","text":"hi"}')
    assert.equal(r?.status, 400)
    assert.equal(r?.body, 'that terminal is not running Codex')
  })

  it('passes ultrathink and ultracode through to the chat word for word', async () => {
    const h = new HubService()
    const text = 'ultrathink about this, then ultracode the fix'
    let got = ''
    h.runner = c => { const m = c as { type: string; sessionId: string; text: string }; if (m.type === 'hub-send') { h.queue(m.sessionId, { kind: 'prompt', text: m.text }); got = m.text } return true }
    const r = await handleHub(h, 'POST', `/hub/command?token=${h.token}`, JSON.stringify({ type: 'hub-send', sessionId: 's1', text }))
    assert.equal(r?.status, 204)
    assert.equal(got, text)
    assert.deepEqual(h.take('s1').map(i => (i as { text?: string }).text), [text])
  })

  it('has no hub-close command: only a handoff queues a close', () => {
    const h = new HubService()
    h.runner = () => true
    const r = handleHub(h, 'POST', `/hub/command?token=${h.token}`, '{"type":"hub-close","sessionId":"s1"}') as { status: number; body: string }
    assert.equal(r.status, 400)
    assert.match(r.body, /unknown command/)
  })

  it('has none of the commands nothing sent', () => {
    const h = new HubService()
    h.runner = () => true
    for (const type of ['hub-refresh', 'hub-stop-server', 'hub-vscode', 'hub-open-project', 'hub-clone']) {
      const r = handleHub(h, 'POST', `/hub/command?token=${h.token}`, JSON.stringify({ type })) as { status: number; body: string }
      assert.match(r.body, /unknown command/, type)
    }
  })

  it('answers 500 with the message when the runner throws', () => {
    const h = new HubService()
    h.runner = () => { throw new Error('boom') }
    const r = handleHub(h, 'POST', `/hub/command?token=${h.token}`, '{"type":"hub-aws-check"}') as { status: number; body: string }
    assert.equal(r.status, 500)
    assert.equal(r.body, 'boom')
  })

  it('answers 503 while no runner is set', () => {
    const h = new HubService()
    assert.equal((handleHub(h, 'POST', `/hub/command?token=${h.token}`, '{"type":"hub-aws-check"}') as { status: number }).status, 503)
  })
})

describe('close after handoff', () => {
  const note = `${os.homedir()}/.claude/handoffs/Armasu/1-old.md`
  it('closes the old chat once a new chat posts from the same folder', () => {
    const h = new HubService()
    h.ingest({ token: h.token, kind: 'live', sessionId: 'old', cwd: '/u/Armasu', limits: [] }, 1)
    h.ingest({ token: h.token, kind: 'handoff', sessionId: 'old', cwd: '/u/Armasu', note }, 2)
    // No close is armed until the fresh chat's terminal exists.
    h.ingest({ token: h.token, kind: 'live', sessionId: 'early', cwd: '/u/Armasu', limits: [] }, 3)
    assert.deepEqual(h.take('old'), [])
    h.closeAfterFresh('old', '/u/Armasu', 3)
    h.ingest({ token: h.token, kind: 'live', sessionId: 'old', cwd: '/u/Armasu', limits: [] }, 3)
    assert.deepEqual(h.take('old'), [])
    const closing: string[] = []
    h.onClosing(id => closing.push(id))
    h.ingest({ token: h.token, kind: 'live', sessionId: 'new', cwd: '/u/Armasu', limits: [] }, 4)
    assert.deepEqual(h.take('old').map(i => i.kind), ['close'])
    assert.deepEqual(closing, ['old'])
    h.ingest({ token: h.token, kind: 'live', sessionId: 'newer', cwd: '/u/Armasu', limits: [] }, 5)
    assert.deepEqual(h.take('old'), [])
  })

  it('stops waiting for the fresh chat after 30 minutes and leaves the old one to close by hand', () => {
    const h = new HubService()
    h.closeAfterFresh('old', '/u/Armasu', 1000)
    h.ingest({ token: h.token, kind: 'live', sessionId: 'new', cwd: '/u/Armasu', limits: [] }, 1000 + 31 * 60_000)
    assert.deepEqual(h.take('old'), [])
  })

  it('matches the fresh chat\'s folder whatever its case and slashes on Windows', () => {
    const real = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      const h = new HubService()
      h.closeAfterFresh('old', 'C:\\Users\\A\\Armasu', 1)
      h.ingest({ token: h.token, kind: 'live', sessionId: 'new', cwd: 'c:/users/a/armasu/', limits: [] }, 2)
      assert.deepEqual(h.take('old').map(i => i.kind), ['close'])
    } finally { Object.defineProperty(process, 'platform', { value: real }) }
  })

  it('leaves alone a chat already open in the folder before the handoff', () => {
    const h = new HubService()
    h.ingest({ token: h.token, kind: 'live', sessionId: 'second', cwd: '/u/Armasu', limits: [] }, 1)
    h.ingest({ token: h.token, kind: 'handoff', sessionId: 'old', cwd: '/u/Armasu', note }, 2)
    h.closeAfterFresh('old', '/u/Armasu', 2)
    h.ingest({ token: h.token, kind: 'live', sessionId: 'second', cwd: '/u/Armasu', limits: [] }, 3)
    assert.deepEqual(h.take('old'), [])
    h.ingest({ token: h.token, kind: 'live', sessionId: 'new', cwd: '/u/Armasu', limits: [] }, 4)
    assert.deepEqual(h.take('old').map(i => i.kind), ['close'])
  })

  it('leaves a chat in another folder alone', () => {
    const h = new HubService()
    h.ingest({ token: h.token, kind: 'handoff', sessionId: 'old', cwd: '/u/Armasu', note }, 2)
    h.closeAfterFresh('old', '/u/Armasu', 2)
    h.ingest({ token: h.token, kind: 'live', sessionId: 'other', cwd: '/u/switchboard', limits: [] }, 4)
    assert.deepEqual(h.take('old'), [])
  })

  it('passes a plan along, refuses one outside a plain .md path, and always continues in a fresh chat', () => {
    const h = new HubService()
    assert.equal(h.get().keep.onFull, 'fresh')
    assert.deepEqual(h.get().archive, [])
    const got: unknown[] = []
    h.onHandoff(x => got.push(x.plan))
    assert.equal(h.ingest({ token: h.token, kind: 'handoff', sessionId: 'a', cwd: '/u/Armasu', note, plan: '/u/Armasu/docs/p.md' }), true)
    assert.equal(h.ingest({ token: h.token, kind: 'handoff', sessionId: 'a', cwd: '/u/Armasu', note, plan: '/u/../etc/p.md' }), false)
    assert.equal(h.ingest({ token: h.token, kind: 'handoff', sessionId: 'a', cwd: '/u/Armasu', note, plan: 'docs/p.md' }), false)
    assert.equal(h.ingest({ token: h.token, kind: 'handoff', sessionId: 'a', cwd: '/u/Armasu', note }), true)
    assert.deepEqual(got, ['/u/Armasu/docs/p.md', undefined])
  })

  it('tells the panel when a close failed', () => {
    const h = new HubService()
    const failed: string[] = []
    h.onCloseFailed(id => failed.push(id))
    assert.equal(h.ingest({ token: h.token, kind: 'close-failed', sessionId: 'old' }), true)
    assert.deepEqual(failed, ['old'])
  })

  it('tells the panel when a chat took a message from Switchboard, so its terminal comes up', () => {
    const h = new HubService()
    const prompted: string[] = []
    h.onPrompted(id => prompted.push(id))
    assert.equal(h.ingest({ token: h.token, kind: 'prompted', sessionId: 'c1' }), true)
    assert.equal(h.ingest({ token: h.token, kind: 'prompted' }), false)
    assert.deepEqual(prompted, ['c1'])
  })

  it('passes dev-start and dev-stop from another window on, a folder only', () => {
    const h = new HubService()
    const got: string[] = []
    h.onDev(d => got.push(`${d.kind} ${d.folder}`))
    assert.equal(h.ingest({ token: h.token, kind: 'dev-start', folder: '/r/QR-Test' }), true)
    assert.equal(h.ingest({ token: h.token, kind: 'dev-stop', folder: '/r/QR-Test' }), true)
    assert.equal(h.ingest({ token: h.token, kind: 'dev-start' }), false)
    assert.equal(h.ingest({ token: 'nope', kind: 'dev-start', folder: '/r/QR-Test' }), false)
    assert.deepEqual(got, ['start /r/QR-Test', 'stop /r/QR-Test'])
    assert.equal(commandProblem({ type: 'hub-dev-start', folder: '/r/QR-Test' }), undefined)
    assert.equal(commandProblem({ type: 'hub-dev-stop', folder: '/r/QR-Test' }), undefined)
    assert.equal(commandProblem({ type: 'hub-awake', on: true }), undefined)
    assert.match(commandProblem({ type: 'hub-dev-start' }) ?? '', /folder/)
  })
})

describe('jev runs', () => {
  const hook = (h: HubService, session_id: string, hook_event_name: string, extra: Record<string, unknown> = {}, now = 1) =>
    h.hook({ session_id, cwd: '/u/Armasu', hook_event_name, ...extra }, now)
  const run = { preset: 'triage-comments', items: 24, seconds: 7.2, costUsd: 0.0061, errors: 0 }

  it('keeps a run and draws it on the chat that ran jev.py', () => {
    const h = new HubService()
    hook(h, 'a', 'SessionStart', {}, 1)
    hook(h, 'b', 'SessionStart', {}, 2)
    hook(h, 'a', 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'python3 ~/.claude/skills/claude-x-jev/scripts/jev.py ask --preset triage-comments' } }, 3)
    hook(h, 'b', 'PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/u/x.ts' } }, 4)
    assert.equal(h.ingest({ token: h.token, kind: 'jev', ...run }, 5), true)
    assert.deepEqual(h.get().jev, [{ sessionId: 'a', preset: 'triage-comments', items: 24, seconds: 7.2, costUsd: 0.0061, at: 5 }])
    const a = h.get().progress.find(p => p.sessionId === 'a')!
    assert.deepEqual(a.roles, [{ id: 'jev', role: 'jev', state: 'done', startedAt: 5 }])
    assert.deepEqual(a.tools?.at(-1), { tool: 'triage-comments', target: '24 items · $0.0061', role: 'jev', at: 5 })
    assert.equal(h.get().progress.find(p => p.sessionId === 'b')!.roles.length, 0)
  })

  it('uses the session id when the mod sends one, and falls back to the newest chat', () => {
    const h = new HubService()
    hook(h, 'a', 'SessionStart', {}, 1)
    hook(h, 'b', 'SessionStart', {}, 2)
    h.ingest({ token: h.token, kind: 'jev', ...run, sessionId: 'a' }, 3)
    h.ingest({ token: h.token, kind: 'jev', ...run, preset: undefined }, 4)
    assert.deepEqual(h.get().jev.map(r => r.sessionId), ['b', 'a'])
    assert.equal(h.get().progress.find(p => p.sessionId === 'b')!.tools?.at(-1)?.tool, 'jev')
  })

  it('picks the chat in the posted folder when the session is not here, and draws on none when no chat is there', () => {
    const h = new HubService()
    h.hook({ session_id: 'arm', cwd: '/u/Armasu', hook_event_name: 'SessionStart' }, 1)
    h.hook({ session_id: 'flow', cwd: '/u/switchboard', hook_event_name: 'SessionStart' }, 2)
    h.ingest({ token: h.token, kind: 'jev', ...run, sessionId: 'elsewhere', cwd: '/u/Armasu/web' }, 3)
    assert.equal(h.get().jev[0].sessionId, 'arm')
    h.ingest({ token: h.token, kind: 'jev', ...run, sessionId: 'elsewhere', cwd: '/u/other' }, 4)
    assert.equal(h.get().jev.length, 2)
    assert.equal(h.get().jev[0].sessionId, undefined)
    assert.equal(h.get().progress.find(p => p.sessionId === 'flow')!.roles.length, 0)
  })

  it('takes a credits-only post, refuses a bad run, and keeps at most 50 runs', () => {
    const h = new HubService()
    assert.equal(h.ingest({ token: h.token, kind: 'jev', run: false, creditsLeftUsd: 3 }), true)
    assert.deepEqual(h.get().jev, [])
    assert.equal(h.ingest({ token: h.token, kind: 'jev', items: 'x', costUsd: 1, seconds: 1 }), true)
    assert.deepEqual(h.get().jev, [])
    for (let i = 0; i < 60; i++) h.ingest({ token: h.token, kind: 'jev', ...run, preset: 'p;rm -rf' }, i)
    assert.equal(h.get().jev.length, 50)
    assert.equal(h.get().jev[0].preset, undefined)
  })
})

describe('handoff waits for running subagents', () => {
  const note = `${os.homedir()}/.claude/handoffs/Armasu/1-old.md`
  const hook = (h: HubService, hook_event_name: string, extra: Record<string, unknown> = {}, now = 1) =>
    h.hook({ session_id: 'old', cwd: '/u/Armasu', hook_event_name, ...extra }, now)

  it('holds the handoff while a subagent runs, says so, then passes it on when the last one stops', () => {
    const h = new HubService()
    const got: string[] = []
    h.onHandoff(x => got.push(x.sessionId))
    h.set({ chats: [{ pid: 1, sessionId: 'old', name: 'Fix login', cwd: '/u/Armasu', link: '', live: true, why: [] }] })
    hook(h, 'SessionStart', {}, 1)
    hook(h, 'SubagentStart', { agent_type: 'engineer', agent_id: 'e1' }, 2)
    hook(h, 'SubagentStart', { agent_type: 'qa', agent_id: 'q1' }, 3)
    hook(h, 'Stop', {}, 4)
    h.ingest({ token: h.token, kind: 'handoff', sessionId: 'old', cwd: '/u/Armasu', note }, 5)
    assert.deepEqual(got, [])
    assert.deepEqual(h.get().waits, [{ sessionId: 'old', tasks: 2, next: 'v2', since: 5 }])
    hook(h, 'SubagentStop', { agent_type: 'engineer', agent_id: 'e1' }, 6)
    assert.deepEqual(got, [])
    assert.equal(h.get().waits[0].tasks, 1)
    hook(h, 'SubagentStop', { agent_type: 'qa', agent_id: 'q1' }, 7)
    assert.deepEqual(got, ['old'])
    assert.deepEqual(h.get().waits, [])
  })

  it('goes ahead after 30 minutes even if a subagent never reported back', () => {
    const h = new HubService()
    const got: string[] = []
    h.onHandoff(x => got.push(x.sessionId))
    hook(h, 'SubagentStart', { agent_type: 'engineer', agent_id: 'e1' }, 1)
    h.ingest({ token: h.token, kind: 'handoff', sessionId: 'old', cwd: '/u/Armasu', note }, 2)
    h.set({}, 2 + 29 * 60_000)
    assert.deepEqual(got, [])
    h.set({}, 2 + 30 * 60_000)
    assert.deepEqual(got, ['old'])
  })

  it('names each subagent still running at the cap, so the fresh chat can check it', () => {
    const h = new HubService()
    const got: Array<string[] | undefined> = []
    h.onHandoff(x => got.push(x.running))
    hook(h, 'SubagentStart', { agent_type: 'engineer', agent_id: 'e1' }, 1)
    h.ingest({ token: h.token, kind: 'handoff', sessionId: 'old', cwd: '/u/Armasu', note }, 2)
    h.set({}, 2 + 30 * 60_000)
    assert.deepEqual(got, [['engineer e1']])
  })

  it('passes it on once the lead stops its last subagent with TaskStop', () => {
    const h = new HubService()
    const got: string[] = []
    h.onHandoff(x => got.push(x.sessionId))
    hook(h, 'SubagentStart', { agent_type: 'engineer', agent_id: 'e1' }, 1)
    h.ingest({ token: h.token, kind: 'handoff', sessionId: 'old', cwd: '/u/Armasu', note }, 2)
    hook(h, 'PostToolUse', { tool_name: 'TaskStop', tool_input: { task_id: 'e1' }, tool_response: { task_id: 'e1' } }, 3)
    assert.deepEqual(got, ['old'])
  })

  it('stops waiting when the chat is about to compact, naming what still runs', () => {
    const h = new HubService()
    const got: Array<string[] | undefined> = []
    h.onHandoff(x => got.push(x.running))
    hook(h, 'SubagentStart', { agent_type: 'engineer', agent_id: 'e1' }, 1)
    h.ingest({ token: h.token, kind: 'handoff', sessionId: 'old', cwd: '/u/Armasu', note }, 2)
    h.ingest({ token: h.token, kind: 'live', sessionId: 'old', cwd: '/u/Armasu', tokens: 900, compactAt: 1000, limits: [] }, 3)
    assert.deepEqual(got, [])
    h.ingest({ token: h.token, kind: 'live', sessionId: 'old', cwd: '/u/Armasu', tokens: 970, compactAt: 1000, limits: [] }, 4)
    assert.deepEqual(got, [['engineer e1']])
  })

  it('goes at once when Kenneth asks for the handoff, before or after the note arrives', () => {
    const h = new HubService()
    const got: string[] = []
    h.onHandoff(x => got.push(x.sessionId))
    hook(h, 'SubagentStart', { agent_type: 'engineer', agent_id: 'e1' }, 1)
    h.ingest({ token: h.token, kind: 'handoff', sessionId: 'old', cwd: '/u/Armasu', note }, 2)
    h.handoffNow('old', 3)
    assert.deepEqual(got, ['old'])
    h.handoffNow('new', 4)
    h.hook({ session_id: 'new', cwd: '/u/Armasu', hook_event_name: 'SubagentStart', agent_type: 'qa', agent_id: 'q1' }, 5)
    h.ingest({ token: h.token, kind: 'handoff', sessionId: 'new', cwd: '/u/Armasu', note }, 6)
    assert.deepEqual(got, ['old', 'new'])
  })

  it('goes at once when the mod says Kenneth asked for it in another window', () => {
    const h = new HubService()
    const got: string[] = []
    h.onHandoff(x => got.push(x.sessionId))
    hook(h, 'SubagentStart', { agent_type: 'engineer', agent_id: 'e1' }, 1)
    h.ingest({ token: h.token, kind: 'handoff', sessionId: 'old', cwd: '/u/Armasu', note, force: true }, 2)
    assert.deepEqual(got, ['old'])
  })

  it('does not close the old chat while a subagent of it still runs', () => {
    const h = new HubService()
    hook(h, 'SessionStart', {}, 1)
    h.ingest({ token: h.token, kind: 'handoff', sessionId: 'old', cwd: '/u/Armasu', note }, 2)
    h.closeAfterFresh('old', '/u/Armasu', 2)
    hook(h, 'SubagentStart', { agent_type: 'engineer', agent_id: 'e1' }, 3)
    h.ingest({ token: h.token, kind: 'live', sessionId: 'new', cwd: '/u/Armasu', limits: [] }, 4)
    assert.deepEqual(h.take('old'), [])
    hook(h, 'SubagentStop', { agent_type: 'engineer', agent_id: 'e1' }, 5)
    assert.deepEqual(h.take('old').map(i => i.kind), ['close'])
  })
})


describe('hub token', () => {
  it('refuses a token with the right length but other bytes instead of throwing', () => {
    const hub = new HubService()
    assert.equal(hub.isToken('é'.repeat(hub.token.length)), false)
    assert.equal(hub.isToken(hub.token), true)
  })
})

describe('device route', () => {
  const ask = { id: 'ab'.repeat(16), ip: '192.168.1.50', ua: 'iPhone Safari', network: 'Wi-Fi', port: 3131 }
  const post = (h: HubService, body: unknown, token = h.token) => handleHub(h, 'POST', `/hub/device?token=${token}`, JSON.stringify(body))!.status
  it('hands a well formed ask or its end to the window', () => {
    const h = new HubService()
    const seen: unknown[] = []
    h.onDevice = d => { seen.push(d) }
    assert.equal(post(h, ask), 204)
    assert.equal(post(h, { ...ask, network: 'Tailscale' }), 204)
    assert.equal(post(h, { id: ask.id, done: true }), 204)
    assert.deepEqual(seen, [ask, { ...ask, network: 'Tailscale' }, { id: ask.id, done: true }])
  })
  it('refuses a wrong token, a bad shape or no listener', () => {
    const h = new HubService()
    const seen: unknown[] = []
    h.onDevice = d => { seen.push(d) }
    assert.equal(post(h, ask, 'nope'), 403)
    for (const bad of [{ ...ask, id: 'short' }, { ...ask, network: 'LTE' }, { ...ask, port: '3131' }, { ...ask, port: 0 }, { ...ask, ua: 'x'.repeat(200) }, { ...ask, ip: 5 }, { id: ask.id, done: false }, null, 'x']) assert.equal(post(h, bad), 400, JSON.stringify(bad))
    assert.equal(handleHub(h, 'POST', `/hub/device?token=${h.token}`, '{')!.status, 400)
    assert.equal(handleHub(h, 'GET', `/hub/device?token=${h.token}`, '')!.status, 404)
    assert.deepEqual(seen, [])
    assert.equal(post(new HubService(), ask), 503)
  })
  it('keeps the asks out of the browser state', () => {
    const h = new HubService()
    h.set({ devices: [{ id: ask.id, ip: ask.ip, ua: ask.ua, network: 'Wi-Fi' }] })
    const r = handleHub(h, 'GET', `/hub/state?token=${h.token}`, '') as { body: string }
    assert.equal(JSON.parse(r.body).devices, undefined)
  })
})

describe('usage limit retry', () => {
  const hit = { session_id: 's1', cwd: '/r', hook_event_name: 'StopFailure', error: 'rate_limit', last_assistant_message: 'API Error: Rate limit reached' }
  const texts = (h: HubService, now: number) => h.take('s1', now).filter(i => i.kind === 'prompt').map(i => (i as { text: string }).text)

  it('queues one continue prompt a minute after the known reset', () => {
    const h = new HubService()
    const reset = new Date(10 * 60_000).toISOString()
    h.ingest({ token: h.token, kind: 'live', sessionId: 's1', cwd: '/r', limits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: reset }] }, 0)
    h.hook(hit, 1000)
    assert.deepEqual(texts(h, 10 * 60_000), [])
    const got = texts(h, 11 * 60_000)
    assert.equal(got.length, 1)
    assert.match(got[0], /^Switchboard: the usage limit reset\. Continue where you left off/)
    assert.deepEqual(texts(h, 12 * 60_000), [])
  })

  it('reads a reset sent as epoch seconds or ms too', () => {
    const t = 1794066000_000
    for (const resetsAt of [t / 1000 + 600, String(t + 600_000)]) {
      const h = new HubService()
      h.ingest({ token: h.token, kind: 'live', sessionId: 's1', cwd: '/r', limits: [{ kind: 'five_hour', percentUsed: 100, resetsAt }] }, t)
      h.hook(hit, t + 1000)
      assert.deepEqual(texts(h, t + 10 * 60_000), [])
      assert.equal(texts(h, t + 11 * 60_000).length, 1, String(resetsAt))
    }
  })

  it('retries after 30 minutes with no known reset, and not for a mirror', () => {
    const h = new HubService()
    h.hook(hit, 0)
    assert.deepEqual(texts(h, 29 * 60_000), [])
    assert.equal(texts(h, 30 * 60_000).length, 1)
    const m = new HubService()
    m.hook(hit, 0, true)
    assert.deepEqual(texts(m, 60 * 60_000), [])
  })

  it('is dropped when the chat moves on, kept through an end (to resume) and a prompt that may fail', () => {
    const moved = new HubService()
    moved.hook(hit, 0)
    moved.hook({ session_id: 's1', cwd: '/r', hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} }, 1)
    assert.deepEqual(texts(moved, 60 * 60_000), [])
    const ended = new HubService()
    ended.hook(hit, 0)
    ended.hook({ session_id: 's1', cwd: '/r', hook_event_name: 'SessionEnd' }, 1)
    assert.deepEqual(ended.goneDue(() => false, 60 * 60_000), [{ sessionId: 's1', cwd: '/r' }])
    const h = new HubService()
    h.hook(hit, 0)
    h.hook({ session_id: 's1', cwd: '/r', hook_event_name: 'UserPromptSubmit' }, 1)
    assert.equal(texts(h, 60 * 60_000).length, 1)
  })

  const kept = (file: string) => { const h = new HubService(); h.keepRetries(file); return h }

  it('resumes a gone chat once when due; a live or polling chat keeps the inbox path', () => {
    const h = new HubService()
    h.hook(hit, 0)
    assert.deepEqual(h.goneDue(() => false, 29 * 60_000), [], 'not due yet')
    assert.deepEqual(h.goneDue(() => true, 30 * 60_000), [], 'process still live')
    h.take('s1', 30 * 60_000 - 5000)
    assert.deepEqual(h.goneDue(() => false, 30 * 60_000), [], 'mod polled a moment ago')
    assert.ok(h.retrying())
    assert.deepEqual(h.goneDue(() => false, 31 * 60_000), [{ sessionId: 's1', cwd: '/r' }])
    assert.deepEqual(h.goneDue(() => false, 32 * 60_000), [], 'never twice')
    assert.ok(!h.retrying())
    assert.deepEqual(texts(h, 33 * 60_000), [], 'the resume carries the prompt, not the inbox')
  })

  it('outlives a window reload through its file, and leaves it once sent or resumed', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-retry-')), 'retries.json')
    const t = Date.now()
    kept(file).hook(hit, t)
    const back = kept(file)
    assert.deepEqual(texts(back, t + 29 * 60_000), [])
    assert.equal(texts(back, t + 30 * 60_000).length, 1)
    assert.deepEqual(texts(kept(file), t + 60 * 60_000), [])
    kept(file).hook(hit, t)
    kept(file).hook({ session_id: 's1', cwd: '/r', hook_event_name: 'SessionEnd' }, t + 1)
    assert.deepEqual(kept(file).goneDue(() => false, t + 60 * 60_000), [{ sessionId: 's1', cwd: '/r' }])
    assert.deepEqual(kept(file).goneDue(() => false, t + 60 * 60_000), [])
  })

  it('a reload drops a retry from an older window: with no folder it cannot be resumed and would hold auto-start', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-retry-')), 'retries.json')
    fs.writeFileSync(file, JSON.stringify({ s1: Date.now() }))
    assert.ok(!kept(file).retrying())
  })

  it('a reload finds a retry\'s folder in the session transcript, and drops one it cannot', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-retry-'))
    const file = path.join(dir, 'retries.json')
    fs.mkdirSync(path.join(dir, 'projects', '-r'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'projects', '-r', 's1.jsonl'), `${JSON.stringify({ type: 'summary' })}\n${JSON.stringify({ cwd: '/r', sessionId: 's1' })}\n`)
    const due = Date.now() - 1000
    fs.writeFileSync(file, JSON.stringify({ s1: { due }, s2: { due } }))
    const h = new HubService()
    h.keepRetries(file, path.join(dir, 'projects'))
    assert.deepEqual(h.retryIds(), ['s1'])
    assert.deepEqual(h.goneDue(() => false, Date.now() + 60_000).map(r => r.cwd), ['/r'])
  })

  it('a save keeps a retry another window wrote to the same file, and still drops its own cleared ones', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-retry-')), 'retries.json')
    const h = kept(file)
    h.hook(hit, 0)
    const other = { due: Date.now(), cwd: '/o' }
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), other }))
    h.hook({ session_id: 's1', cwd: '/r', hook_event_name: 'SessionEnd', reason: 'clear' }, 1)
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { other })
  })

  it('a retry another window resumed and removed from the file is not written back', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-retry-')), 'retries.json')
    const h = kept(file)
    h.hook(hit, 0)
    fs.writeFileSync(file, '{}')
    h.hook({ ...hit, session_id: 's2' }, 1)
    assert.ok(!JSON.parse(fs.readFileSync(file, 'utf8')).s1)
    assert.ok(!h.retryIds().includes('s1'))
  })

  it('a chat cleared or logged out drops its retry: the process goes on under a new id', () => {
    for (const reason of ['clear', 'logout']) {
      const h = new HubService()
      h.hook(hit, 0)
      h.hook({ session_id: 's1', cwd: '/r', hook_event_name: 'SessionEnd', reason }, 1)
      assert.ok(!h.retrying(), reason)
    }
  })

  it('a reload forgets a retry a day overdue: that chat is gone', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-retry-')), 'retries.json')
    fs.writeFileSync(file, JSON.stringify({ s1: Date.now() - 25 * 3600_000, s2: 'x' }))
    assert.deepEqual(kept(file).take('s1').filter(i => i.kind === 'prompt'), [])
  })

  it('sends none while Claude Code continues by itself (autoContinueAtUsageLimit), still warns', () => {
    const h = new HubService()
    h.set({ keep: { ...h.get().keep, autoContinue: true } }, 0)
    h.hook(hit, 0)
    assert.equal(h.get().progress[0].limited?.error, 'rate_limit')
    assert.deepEqual(texts(h, 60 * 60_000), [])
  })

  const start = (agent_id: string, agent_type: string) => ({ session_id: 's1', cwd: '/r', hook_event_name: 'SubagentStart', agent_id, agent_type })
  const cutOff = (h: HubService) => {
    h.hook(start('a1', 'engineer'), 0)
    h.hook(start('a2', 'qa'), 0)
    h.hook({ session_id: 's1', cwd: '/r', hook_event_name: 'SubagentStop', agent_id: 'a2', agent_type: 'qa' }, 1)
    h.hook(hit, 2)
  }

  it('names the subagents the limit cut off, to resume with SendMessage', () => {
    const h = new HubService()
    cutOff(h)
    const got = texts(h, 60 * 60_000)
    assert.equal(got.length, 1)
    assert.match(got[0], /^Switchboard: the usage limit reset\. Continue where you left off/)
    assert.match(got[0], /a1 \(engineer\)/)
    assert.doesNotMatch(got[0], /a2/, 'a finished one is not listed')
    assert.match(got[0], /SendMessage/)
  })

  it('keeps the subagents through a reload and a resume of a gone chat', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-retry-')), 'retries.json')
    const t = Date.now()
    const h = kept(file)
    h.hook(start('a1', 'engineer'), t)
    h.hook(hit, t + 1)
    h.hook({ session_id: 's1', cwd: '/r', hook_event_name: 'SessionEnd' }, t + 2)
    const [r] = kept(file).goneDue(() => false, t + 60 * 60_000)
    assert.deepEqual(r.agents, [{ id: 'a1', type: 'engineer' }])
    assert.match(continueText(r.agents), /a1 \(engineer\)/)
    assert.equal(continueText(undefined), CONTINUE)
  })

  it('still sends the subagent note when Claude Code continues by itself', () => {
    const h = new HubService()
    h.set({ keep: { ...h.get().keep, autoContinue: true } }, 0)
    cutOff(h)
    const got = texts(h, 60 * 60_000)
    assert.equal(got.length, 1)
    assert.doesNotMatch(got[0], /Continue where you left off/)
    assert.match(got[0], /a1 \(engineer\).*SendMessage/)
  })
})

describe('usage limit pause', () => {
  const now = Date.UTC(2026, 10, 7, 12)
  const reset = now + 2 * 3_600_000
  const setup = (pauseAt?: number | null) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pause-'))
    const h = new HubService()
    h.keepRetries(path.join(dir, 'retries-x.json'))
    h.set({ controls: { ...h.get().controls, switchboard: { ...h.get().controls.switchboard, ...(pauseAt !== undefined ? { pauseAt } : {}) } } })
    const chats = [['a', 3], ['b', 1], ['c', 2]] as const
    h.set({ chats: chats.map(([sessionId], i) => ({ pid: i + 1, sessionId, name: sessionId, cwd: '/u/w', link: '', live: true, why: [] })) })
    for (const [id, at] of chats) h.hook({ session_id: id, cwd: '/u/w', hook_event_name: 'SessionStart' }, at)
    // c holds a running subagent.
    h.hook({ session_id: 'c', cwd: '/u/w', hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 't1', tool_input: { subagent_type: 'engineer' } }, 4)
    h.hook({ session_id: 'c', cwd: '/u/w', hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'engineer' }, 5)
    const feed = (pct: number, at = now) => h.ingest({ token: h.token, kind: 'live', sessionId: 'a', cwd: '/u/w', limits: [{ kind: 'five_hour', percentUsed: pct, resetsAt: new Date(reset).toISOString() }] }, at)
    return { h, dir, feed }
  }

  it('queues every live chat at the threshold and writes limits.json', () => {
    const { h, dir, feed } = setup()
    feed(98)
    assert.equal(h.get().pause, undefined)
    feed(99)
    assert.equal(h.get().pause?.percent, 99)
    assert.equal(h.get().pause?.resumeAt, reset + 60_000)
    assert.deepEqual(h.get().pause?.chats.map(c => c.sessionId).sort(), ['a', 'b', 'c'])
    const file = JSON.parse(fs.readFileSync(path.join(dir, 'limits.json'), 'utf8'))
    assert.equal(file.paused, true)
    assert.equal(file.windows[0].percentUsed, 99)
  })

  it('writes pauseAt and pauseOff to limits.json for the mod', () => {
    const { h, dir, feed } = setup(null)
    feed(99)
    const read = () => JSON.parse(fs.readFileSync(path.join(dir, 'limits.json'), 'utf8'))
    assert.equal(read().pauseAt, null)
    assert.equal(read().pauseOff, undefined)
    const on = setup()
    on.feed(99)
    on.h.endPause(true, now + 1)
    const file = JSON.parse(fs.readFileSync(path.join(on.dir, 'limits.json'), 'utf8'))
    assert.equal(file.pauseAt, 99)
    assert.equal(file.pauseOff, reset + 60_000)
  })

  it("a chat's own hold joins the pause and leaves it", () => {
    const { h } = setup(null)
    assert.equal(h.ingest({ token: h.token, kind: 'hold', sessionId: 'b', hold: { kind: 'five_hour', percent: 99, resetsAt: reset } }, now), true)
    assert.deepEqual(h.get().pause, { kind: 'five_hour', percent: 99, resumeAt: reset + 60_000, chats: [{ sessionId: 'b', name: 'b' }] })
    h.ingest({ token: h.token, kind: 'hold', sessionId: 'a', hold: { kind: 'five_hour', percent: 99, resetsAt: reset } }, now)
    h.ingest({ token: h.token, kind: 'hold', sessionId: 'b', hold: null }, now)
    assert.deepEqual(h.get().pause?.chats.map(c => c.sessionId), ['a'])
    h.ingest({ token: h.token, kind: 'hold', sessionId: 'a', hold: null }, now)
    assert.equal(h.get().pause, undefined)
  })

  it('resumes subagent holders first, then in queue order, with the pause prompt', () => {
    const { h, feed } = setup()
    feed(99)
    assert.equal(h.pausedQueue()[0].sessionId, 'c')
    assert.equal(h.take('a', reset).length, 0)
    const sent = h.take('a', reset + 60_000)
    assert.match(sent[0].kind === 'prompt' ? sent[0].text : '', /^Usage limit reset\. Continue where you stopped/)
    h.pauseTick(reset + 60_000)
    assert.equal(h.get().pause, undefined)
  })

  it('queues a chat that exits on the limit while paused or out of usage, not one the user closed', () => {
    const { h, dir, feed } = setup()
    const tx = (name: string, last: object) => {
      const f = path.join(dir, `${name}.jsonl`)
      fs.writeFileSync(f, [{ type: 'user', message: {} }, last, { type: 'system', subtype: 'x' }].map(x => JSON.stringify(x)).join('\n') + '\n')
      return f
    }
    const limitTx = tx('limit', { type: 'assistant', isApiErrorMessage: true, error: 'rate_limit', message: { content: [{ type: 'text', text: "You've hit your 5-hour limit" }] } })
    const okTx = tx('ok', { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } })
    feed(99)
    h.hook({ session_id: 'd', cwd: '/u/d', hook_event_name: 'SessionStart' }, now + 1)
    h.hook({ session_id: 'd', cwd: '/u/d', hook_event_name: 'SessionEnd', reason: 'other', transcript_path: limitTx }, now + 2)
    assert.ok(h.pausedQueue().some(q => q.sessionId === 'd' && q.cwd === '/u/d'))
    h.hook({ session_id: 'e', cwd: '/u/e', hook_event_name: 'SessionStart' }, now + 3)
    h.hook({ session_id: 'e', cwd: '/u/e', hook_event_name: 'SessionEnd', reason: 'prompt_input_exit', transcript_path: limitTx }, now + 4)
    assert.ok(!h.retryIds().includes('e'), '/exit')
    h.hook({ session_id: 't', cwd: '/u/t', hook_event_name: 'SessionStart' }, now + 5)
    h.hook({ session_id: 't', cwd: '/u/t', hook_event_name: 'SessionEnd', reason: 'other', transcript_path: okTx }, now + 6)
    assert.ok(!h.retryIds().includes('t'), 'a closed tab')
    h.hook({ session_id: 'n', cwd: '/u/n', hook_event_name: 'SessionStart' }, now + 7)
    h.hook({ session_id: 'n', cwd: '/u/n', hook_event_name: 'SessionEnd', reason: 'other' }, now + 8)
    assert.ok(!h.retryIds().includes('n'), 'no transcript')
    const out = new HubService()
    out.hook({ session_id: 'f', cwd: '/r', hook_event_name: 'StopFailure', error: 'rate_limit', last_assistant_message: 'resets 11:50pm (America/Los_Angeles)' }, now)
    out.hook({ session_id: 'g', cwd: '/g', hook_event_name: 'SessionStart' }, now + 1)
    out.hook({ session_id: 'g', cwd: '/g', hook_event_name: 'SessionEnd', reason: 'other', transcript_path: limitTx }, now + 2)
    assert.deepEqual(out.goneDue(() => false, now + 2), [], 'not before the reset')
    assert.ok(out.goneDue(() => false, now + 86_400_000).some(r => r.sessionId === 'g'))
    const calm = new HubService()
    calm.hook({ session_id: 'g', cwd: '/g', hook_event_name: 'SessionStart' }, now)
    calm.hook({ session_id: 'g', cwd: '/g', hook_event_name: 'SessionEnd', reason: 'other', transcript_path: limitTx }, now + 1)
    assert.ok(!calm.retrying(), 'no limit, no queue')
    const late = new HubService()
    late.hook({ session_id: 'f', cwd: '/r', hook_event_name: 'StopFailure', error: 'rate_limit', last_assistant_message: 'resets 5am (America/Los_Angeles)' }, Date.UTC(2026, 10, 7, 12))
    late.hook({ session_id: 'f', cwd: '/r', hook_event_name: 'UserPromptSubmit' }, Date.UTC(2026, 10, 7, 13, 1))
    late.hook({ session_id: 'u', cwd: '/u', hook_event_name: 'SessionStart' }, Date.UTC(2026, 10, 7, 18))
    late.hook({ session_id: 'u', cwd: '/u', hook_event_name: 'SessionEnd', reason: 'other', transcript_path: limitTx }, Date.UTC(2026, 10, 7, 18, 1))
    assert.ok(!late.retryIds().includes('u'), 'past the reset: a close is a close')
  })

  it('a resume sticks across a window reload', () => {
    const { h, dir, feed } = setup()
    feed(99)
    h.endPause(true, now + 1)
    const again = new HubService()
    again.keepRetries(path.join(dir, 'retries-x.json'))
    again.ingest({ token: again.token, kind: 'live', sessionId: 'a', cwd: '/u/w', limits: [{ kind: 'five_hour', percentUsed: 99, resetsAt: new Date(reset).toISOString() }] }, now + 2)
    assert.equal(again.get().pause, undefined)
    const file = JSON.parse(fs.readFileSync(path.join(dir, 'limits.json'), 'utf8'))
    assert.equal(file.pauseOff, reset + 60_000)
    assert.equal(file.paused, undefined)
  })

  it('a resume in one window holds in another that loaded the pause', () => {
    const { h, dir, feed } = setup()
    feed(99)
    const b = new HubService()
    b.keepRetries(path.join(dir, 'retries-y.json'))
    assert.equal(b.get().pause?.resumeAt, reset + 60_000)
    h.endPause(true, now + 1)
    b.ingest({ token: b.token, kind: 'live', sessionId: 'z', cwd: '/u/z', limits: [{ kind: 'five_hour', percentUsed: 99.5, resetsAt: new Date(reset).toISOString() }] }, now + 2 * 60_000)
    assert.equal(b.get().pause, undefined)
    const file = JSON.parse(fs.readFileSync(path.join(dir, 'limits.json'), 'utf8'))
    assert.equal(file.pauseOff, reset + 60_000)
    assert.equal(file.paused, undefined)
    assert.equal(file.pause, undefined)
  })

  it('codex limits never pause or get kept', () => {
    const { h } = setup()
    h.ingest({ token: h.token, kind: 'live', sessionId: 'cx', cwd: '/u/c', limits: [{ kind: 'codex_five_hour', percentUsed: 100, resetsAt: new Date(reset).toISOString() }] }, now)
    assert.equal(h.get().pause, undefined)
    assert.equal(h.get().limitsKept, undefined)
    assert.equal(h.get().live[0].limits[0].kind, 'codex_five_hour')
  })

  it('codex limits are kept apart, survive a reload, and never reach the Claude pause', () => {
    const { h, dir } = setup()
    const codex = [{ kind: 'codex_five_hour', percentUsed: 100, resetsAt: new Date(reset).toISOString() }]
    h.ingest({ token: h.token, kind: 'live', sessionId: 'cx', cwd: '/u/c', limits: codex }, now)
    assert.deepEqual(h.get().codexKept?.map(l => l.kind), ['codex_five_hour'])
    assert.equal(fs.existsSync(path.join(dir, 'codex-limits.json')), true)
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'limits.json'), 'utf8')).windows, undefined)
    const again = new HubService()
    again.keepRetries(path.join(dir, 'retries-x.json'))
    assert.deepEqual(again.get().codexKept?.map(l => l.kind), ['codex_five_hour'])
    assert.equal(again.get().pause, undefined)
    assert.equal(again.get().limitsKept, undefined)
  })

  it('off, or after Cancel, does not pause again until the reset', () => {
    const off = setup(null)
    off.feed(100)
    assert.equal(off.h.get().pause, undefined)
    const { h, feed } = setup()
    feed(99)
    h.endPause(false, now + 1)
    assert.equal(h.pausedQueue().length, 0)
    feed(100, now + 2)
    assert.equal(h.get().pause, undefined)
  })

  it('never closes a handed-off chat while it waits on its limit', () => {
    const { h, feed } = setup(null)
    feed(50)
    h.hook({ session_id: 'b', cwd: '/u/w', hook_event_name: 'StopFailure', error: 'rate_limit', last_assistant_message: "You've hit your 5-hour limit · resets 11:50pm (America/Los_Angeles)" }, now)
    assert.equal(h.get().limitsKept?.out?.resetsAt !== undefined, true)
    h.closeAfterFresh('b', '/u/w', now)
    h.ingest({ token: h.token, kind: 'live', sessionId: 'fresh', cwd: '/u/w', limits: [] }, now + 1)
    assert.ok(!h.take('b', now + 2).some(i => i.kind === 'close'))
    // Without the limit it closes as before.
    h.closeAfterFresh('a', '/u/w', now)
    h.ingest({ token: h.token, kind: 'live', sessionId: 'fresh2', cwd: '/u/w', limits: [] }, now + 3)
    assert.ok(h.take('a', now + 4).some(i => i.kind === 'close'))
  })
})

describe('chat links', () => {
  const MIN = 60_000, now = 1_000_000_000
  const setup = () => {
    const h = new HubService()
    h.set({ chats: ['a', 'b', 'c'].map((sessionId, i) => ({ pid: i + 1, sessionId, name: sessionId, cwd: '/u/w', link: '', live: true, why: [] })) }, now)
    const post = (body: Record<string, unknown>, at = now) => h.ingest({ token: h.token, ...body }, at)
    return { h, post }
  }

  it('takes a link, upserts it by from and target set, and drops it on link-end', () => {
    const { h, post } = setup()
    assert.equal(post({ kind: 'link', from: 'a', to: ['b', 'c'], reason: 'needs the schema', auto: false, since: now - 5 }), true)
    post({ kind: 'link', from: 'a', to: ['c', 'b'], reason: 'still the schema', auto: false, since: now })
    assert.deepEqual(h.get().links, [{ from: 'a', to: ['c', 'b'], reason: 'still the schema', auto: false, since: now }])
    post({ kind: 'link', from: 'a', to: ['b'], reason: 'r', auto: false, since: now })
    assert.equal(post({ kind: 'link-end', from: 'a', to: ['b', 'c'] }), true)
    assert.deepEqual(h.get().links?.map(l => l.to), [['b']])
    assert.equal(post({ kind: 'link', from: 'a', to: [] }), false)
    assert.equal(post({ kind: 'link', to: ['b'] }), false)
  })

  it('keeps a link to an ended target so its outcome stays readable, drops it once the waiting chat is gone', () => {
    const { h, post } = setup()
    post({ kind: 'link', from: 'a', to: ['b', 'c'], reason: 'r', auto: false, since: now })
    post({ kind: 'link', from: 'c', to: ['b'], reason: 'r', auto: false, since: now })
    const rows = h.get().chats
    h.set({ chats: rows.map(c => (c.sessionId === 'b' ? { ...c, live: false } : c)) }, now + 1)
    assert.deepEqual(h.get().links?.map(l => l.from), ['a', 'c'])
    h.set({ chats: rows.map(c => (c.sessionId === 'a' ? { ...c, live: false } : c)) }, now + 2)
    assert.deepEqual(h.get().links?.map(l => l.from), ['c'])
    // No row yet, as just after a reload: kept.
    h.set({ chats: [] }, now + 3)
    assert.deepEqual(h.get().links?.map(l => l.from), ['c'])
  })

  it('drops a link whose waiter has no row and no live entry after two minutes', () => {
    const { h, post } = setup()
    post({ kind: 'link', from: 'z', to: ['b'], reason: 'r', auto: false, since: now })
    h.set({}, now + MIN)
    assert.deepEqual(h.get().links?.map(l => l.from), ['z'])
    h.set({}, now + 3 * MIN)
    assert.deepEqual(h.get().links, [])
  })

  it('keeps an auto link while the target edit is fresh, at most 15 minutes', () => {
    const { h, post } = setup()
    post({ kind: 'live', sessionId: 'b', cwd: '/u/w', file: '/u/w/x.ts' }, now)
    post({ kind: 'link', from: 'a', to: ['b'], reason: '/u/w/x.ts', auto: true, since: now })
    h.set({}, now + 9 * MIN)
    assert.equal(h.get().links?.length, 1)
    h.set({}, now + 10 * MIN)
    assert.deepEqual(h.get().links, [])
    post({ kind: 'live', sessionId: 'b', cwd: '/u/w', file: '/u/w/y.ts' }, now + 11 * MIN)
    post({ kind: 'live', sessionId: 'b', cwd: '/u/w', file: '/u/w/x.ts' }, now + 12 * MIN)
    post({ kind: 'link', from: 'a', to: ['b'], reason: '/u/w/x.ts', auto: true, since: now + 12 * MIN - 6 * MIN }, now + 12 * MIN)
    assert.equal(h.get().links?.length, 1)
    h.set({}, now + 21 * MIN)
    assert.deepEqual(h.get().links, [])
  })

  it('Kenneth\'s unlink leaves a tombstone for five minutes; link-end does not; a new link clears it', () => {
    const { h, post } = setup()
    h.link({ from: 'a', to: ['b', 'c'], reason: 'r', auto: false, since: now }, now)
    h.unlink('a', ['b'], now)
    assert.deepEqual(h.get().unlinks, [{ from: 'a', to: 'b', at: now }])
    post({ kind: 'link-end', from: 'a', to: ['c'] }, now)
    assert.deepEqual(h.get().unlinks?.map(u => u.to), ['b'])
    h.set({}, now + 5 * MIN)
    assert.deepEqual(h.get().unlinks, [])
    h.unlink('a', ['b'], now + 6 * MIN)
    h.link({ from: 'a', to: ['b'], reason: 'r', auto: false, since: now }, now + 6 * MIN)
    assert.deepEqual(h.get().unlinks, [])
  })

  it('keeps links and unlinks across a window reload', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'links-'))
    try {
      const file = path.join(dir, 'retries-x.json')
      const h = new HubService()
      h.keepRetries(file)
      h.link({ from: 'a', to: ['b', 'c'], reason: 'r', auto: false, since: Date.now() - 60 * MIN })
      h.unlink('a', ['c'])
      const again = new HubService()
      again.keepRetries(file)
      // Rows come back after the reload; the link holds meanwhile, however old.
      again.set({ chats: [] })
      assert.deepEqual(again.get().links?.map(l => l.to), [['b']])
      assert.deepEqual(again.get().unlinks?.map(u => u.to), ['c'])
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('a card link and unlink, as Kenneth made them', () => {
    const { h } = setup()
    h.link({ from: 'a', to: ['b'], reason: 'Kenneth linked these in Switchboard', auto: false, since: now }, now)
    assert.equal(h.get().links?.length, 1)
    h.unlink('a', ['b'], now)
    assert.deepEqual(h.get().links, [])
    // One target at a time from a link to several.
    h.link({ from: 'a', to: ['b', 'c'], reason: 'r', auto: false, since: now }, now)
    h.unlink('a', ['b'], now)
    assert.deepEqual(h.get().links?.map(l => l.to), [['c']])
    h.unlink('a', ['c'], now)
    assert.deepEqual(h.get().links, [])
  })
})

describe('indefinite-done', () => {
  it('tells the window, and refuses a post without a session id', () => {
    const h = new HubService()
    const seen: unknown[] = []
    h.onIndefiniteDone(d => seen.push(d))
    assert.ok(h.ingest({ token: h.token, kind: 'indefinite-done', sessionId: 's1' }))
    assert.ok(h.ingest({ token: h.token, kind: 'indefinite-done', sessionId: 's2', usage: 'used $1.20 over 2h', reason: 'budget reached (not a success)', junk: 1 }))
    assert.equal(h.ingest({ token: h.token, kind: 'indefinite-done' }), false)
    assert.deepEqual(seen, [{ sessionId: 's1' }, { sessionId: 's2', usage: 'used $1.20 over 2h', reason: 'budget reached (not a success)' }])
  })

  it('the Run indefinitely command needs a session id and a flag', () => {
    assert.equal(commandProblem({ type: 'hub-indefinite', sessionId: 'x', on: true }), undefined)
    assert.ok(commandProblem({ type: 'hub-indefinite', sessionId: 'x' }))
  })

  it('checks the budget, check-back and feature commands', () => {
    assert.equal(commandProblem({ type: 'hub-budget', sessionId: 'x', maxHours: 2, maxCostUsd: null, gate: 'pnpm test' }), undefined)
    assert.ok(commandProblem({ type: 'hub-budget', sessionId: 'x', maxHours: '2' }))
    assert.equal(commandProblem({ type: 'hub-checkback', sessionId: 'x', everyMin: 30 }), undefined)
    assert.ok(commandProblem({ type: 'hub-checkback', sessionId: 'x', everyMin: 5 }))
    assert.equal(commandProblem({ type: 'hub-snapshot-restore', id: 'a' }), undefined)
    assert.equal(commandProblem({ type: 'hub-health-fix' }), undefined)
    assert.equal(commandProblem({ type: 'hub-pipeline-seed', slug: 's', path: '/p', run: 'r' }), undefined)
    assert.ok(commandProblem({ type: 'hub-pipeline-save', path: '/p', run: 'r' }))
  })
})
