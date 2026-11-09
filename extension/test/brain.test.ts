/**
 * Unit tests for the brain: the board, its four rules and the brief a new chat gets.
 *
 * The invariant: a chat learns only its own project, and a brief carries no key.
 */

import { describe, it } from 'node:test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import assert from 'node:assert/strict'
import { board, brief, editGuard, noteEdit, quickAskArgs, redact, suggest, waitsOn, withBrief } from '../src/hub/brain'
import { emptyHub } from '../src/hub/hub-service'
import type { ChatProgress, HubState, SessionLive, StarredChat } from '../src/hub/types'

const NOW = 10_000_000
const chat = (sessionId: string, cwd: string, extra: Partial<SessionLive> = {}): SessionLive =>
  ({ sessionId, cwd, limits: [], at: NOW - 1000, ...extra })

const state = (live: SessionLive[], extra: Partial<HubState> = {}): HubState => ({
  ...emptyHub(),
  live,
  projects: [{ name: 'Armasu', path: '/w/Armasu', kind: 'repo', isOpen: true }, { name: 'switchboard', path: '/w/switchboard', kind: 'repo', isOpen: false }],
  ...extra,
})

describe('brain board', () => {
  it('groups live chats by project, a subfolder under its project', () => {
    const b = board(state([chat('a', '/w/Armasu'), chat('b', '/w/Armasu/app', { prompt: 'fix the bag' }), chat('c', '/w/switchboard')]))
    assert.deepEqual(b.map(p => [p.project, p.chats.length]), [['Armasu', 2], ['switchboard', 1]])
    assert.equal(b[0].chats.find(c => c.sessionId === 'b')?.prompt, 'fix the bag')
  })

  it('names a subfolder of a git repo by the repo, even when the subfolder is listed', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-brain-'))
    try {
      const repo = path.join(tmp, 'switchboard'), sub = path.join(repo, 'extension')
      fs.mkdirSync(path.join(repo, '.git'), { recursive: true })
      fs.mkdirSync(sub)
      const b = board(state([chat('a', sub), chat('b', repo)], { projects: [{ name: 'extension', path: sub, kind: 'project', isOpen: false }] }))
      assert.deepEqual(b.map(p => [p.project, p.chats.length]), [['switchboard', 2]])
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('names a folder outside every project by its last part', () => {
    assert.equal(board(state([chat('a', '/tmp/scratch')]))[0].project, 'scratch')
  })
})

describe('brain rules', () => {
  it('flags two chats on one file within the hour, not after it', () => {
    const near = suggest(state([chat('a', '/w/Armasu', { file: '/w/Armasu/x.ts', fileAt: NOW - 60_000 }), chat('b', '/w/Armasu', { file: '/w/Armasu/x.ts', fileAt: NOW - 120_000 })]), [], NOW)
    assert.deepEqual(near.filter(s => s.kind === 'clash').map(s => s.sessions), [['a', 'b']])
    const old = suggest(state([chat('a', '/w/Armasu', { file: '/w/Armasu/x.ts', fileAt: NOW - 2 * 3600_000 }), chat('b', '/w/Armasu', { file: '/w/Armasu/x.ts', fileAt: NOW })]), [], NOW)
    assert.equal(old.filter(s => s.kind === 'clash').length, 0)
  })

  it('flags a chat past 85% of its compaction point', () => {
    const s = suggest(state([chat('a', '/w/Armasu', { tokens: 86, compactAt: 100 }), chat('b', '/w/Armasu', { tokens: 80, compactAt: 100 })]), [], NOW)
    assert.deepEqual(s.filter(x => x.kind === 'full').map(x => x.sessions), [['a']])
  })

  it('offers the next open task only when no chat names it', () => {
    const plan = { name: 'p.md', tasks: [{ title: '21 The brain', done: 4, total: 4 }, { title: '22 Ship it', done: 0, total: 3 }] }
    const free = suggest(state([chat('a', '/w/Armasu', { prompt: 'look at the logo' })], { plan }), [], NOW)
    assert.equal(free.find(x => x.kind === 'task')?.task, '22 Ship it')
    const taken = suggest(state([chat('a', '/w/Armasu', { prompt: 'carry on with Task 22' })], { plan }), [], NOW)
    assert.equal(taken.filter(x => x.kind === 'task').length, 0)
  })

  it('flags a dev server that stopped', () => {
    const s = suggest(state([]), [{ pid: 1, command: 'next', port: 3000, folder: '/w/Armasu' }], NOW)
    assert.equal(s.find(x => x.kind === 'server')?.folder, '/w/Armasu')
  })
})

describe('brain brief', () => {
  const plan = { name: 'p.md', tasks: [{ title: '22 Ship it', done: 0, total: 3 }] }
  const live = [
    chat('me', '/w/Armasu'),
    chat('other', '/w/Armasu', { label: 'Shop', prompt: 'key sk-abcdefghijklmnopqrstuv in the shop', file: '/w/Armasu/app/shop.ts', fileAt: NOW - 1000 }),
    chat('far', '/w/switchboard', { prompt: 'secret switchboard work', file: '/w/switchboard/x.ts' }),
  ]
  const servers = [{ pid: 2, command: 'next dev', port: 3000, folder: '/w/Armasu' }]

  it('lists the other chats, their files, the next task and the dev site', () => {
    const text = brief(state(live, { plan, servers }), '/w/Armasu', 'me', NOW)
    assert.match(text, /Shop/)
    assert.match(text, /app\/shop\.ts/)
    assert.match(text, /22 Ship it/)
    assert.match(text, /localhost:3000/)
  })

  it('carries the recent plan decisions for the open project', () => {
    const text = brief(state(live, { plan: { ...plan, decisions: ['Gate: off by default'] }, servers }), '/w/Armasu', 'me', NOW)
    assert.match(text, /Recent decisions: Gate: off by default/)
    assert.doesNotMatch(brief(state(live, { plan: { ...plan, decisions: ['Gate: off by default'] }, servers }), '/w/switchboard', 'far', NOW), /Recent decisions/)
  })

  it('names the starred chats of the same project, with their last prompt or note', () => {
    const star = (sessionId: string, name: string, cwd: string, digest: Partial<StarredChat['digest']>) => ({ sessionId, ai: 'claude' as const, name, cwd, starredAt: 1, live: false, digest: { resume: '', ...digest } })
    const starred = [star('s1', 'boardChat', '/w/Armasu', { lastPrompt: 'add codex' }), star('s2', 'Far', '/w/switchboard', { note: 'elsewhere' }), star('me', 'Self', '/w/Armasu', { note: 'x' })]
    const text = brief(state([], { starred }), '/w/Armasu', 'me', NOW)
    assert.match(text, /Starred: boardChat: "add codex"/)
    assert.doesNotMatch(text, /Far|Self/)
  })

  it('tells a chat nothing about another project, and removes keys', () => {
    const text = brief(state(live, { plan, servers }), '/w/Armasu', 'me', NOW)
    assert.doesNotMatch(text, /switchboard/)
    assert.doesNotMatch(text, /sk-abc/)
    assert.match(text, /\[removed\]/)
  })

  it('lists the project\'s open to-do items with their ids, never another project\'s', () => {
    const todos = { '/w/Armasu': { todo: [{ id: 'ab12cd34', text: 'Add CSV export', at: 1 }] }, '/w/switchboard': { todo: [{ id: 'ff00ff00', text: 'Far item', at: 1 }] } }
    const text = brief(state([chat('me', '/w/Armasu')], { todos }), '/w/Armasu/app', 'me', NOW)
    assert.match(text, /Open to-do[^\n]*todo_done[^\n]*\n- ab12cd34: Add CSV export/)
    assert.doesNotMatch(text, /ff00ff00/)
  })

  it('leaves Kenneth\'s own hand steps out of the open to-do', () => {
    const todos = { '/w/Armasu': { todo: [{ id: 'ab12cd34', text: 'Add CSV export', at: 1 }, { id: 'cc00cc00', text: 'Reload the window', at: 1, why: 'you' as const }] } }
    const text = brief(state([chat('me', '/w/Armasu')], { todos }), '/w/Armasu/app', 'me', NOW)
    assert.match(text, /ab12cd34/)
    assert.doesNotMatch(text, /cc00cc00/)
  })

  it('stays under 1,200 characters', () => {
    const many = Array.from({ length: 40 }, (_, i) => chat(`s${i}`, '/w/Armasu', { prompt: 'x'.repeat(200), file: `/w/Armasu/f${i}.ts`, fileAt: NOW }))
    assert.ok(brief(state(many, { plan, servers }), '/w/Armasu', 'me', NOW).length <= 1200)
  })

  it('is empty for a chat alone with nothing to say', () => {
    assert.equal(brief(state([chat('me', '/w/Armasu')]), '/w/Armasu', 'me', NOW), '')
  })
})

describe('quickAskArgs', () => {
  it('saves no session and runs no hooks', () => {
    const args = quickAskArgs('hi')
    assert.ok(args.includes('--no-session-persistence'))
    assert.deepEqual(JSON.parse(args[args.indexOf('--settings') + 1]), { disableAllHooks: true })
    assert.equal(args.at(-1), 'hi')
  })
})

describe('withBrief', () => {
  it('puts the brief in front of a Codex first message only while Brief is on', () => {
    const s: HubState = { ...emptyHub(), projects: [{ name: 'Armasu', path: '/u/Armasu', kind: 'repo', isOpen: true }], servers: [{ pid: 1, command: 'node', port: 4211, folder: '/u/Armasu' }] }
    assert.match(withBrief(s, '/u/Armasu', 'fix it'), /^Switchboard brief for Armasu[\s\S]*\n\nfix it$/)
    const off = { ...s, controls: { ...s.controls, switchboard: { ...s.controls.switchboard, brief: false } } }
    assert.equal(withBrief(off, '/u/Armasu', 'fix it'), 'fix it')
    assert.equal(withBrief(off, '/u/Armasu', undefined), '')
  })
})

describe('redact', () => {
  it('survives a token millions of characters long and removes it', () => {
    for (const s of ['a'.repeat(8e6), `sk-${'a'.repeat(8e6)}`, `eyJ${'a'.repeat(8e6)}`]) {
      const out = redact(`before ${s} after`)
      assert.equal(out, 'before [removed] after')
    }
  })

  it('still removes ordinary keys', () => {
    assert.equal(redact(`key sk-${'b'.repeat(20)} end`), 'key [removed] end')
  })

  it('removes AWS secrets and keeps their key names', () => {
    const sec = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', tok = 'IQoJb3JpZ2luX2VjEXAMPLE+/=token'
    assert.equal(redact(`aws_secret_access_key = ${sec}`), 'aws_secret_access_key = [removed]')
    assert.equal(redact(`AWS_SECRET_ACCESS_KEY=${sec} next`), 'AWS_SECRET_ACCESS_KEY=[removed] next')
    assert.equal(redact(`aws_session_token = ${tok}`), 'aws_session_token = [removed]')
    assert.equal(redact(`export AWS_SESSION_TOKEN="${tok}"`), 'export AWS_SESSION_TOKEN="[removed]"')
    assert.equal(redact('id ASIAABCDEFGHIJKLMNOP.'), 'id [removed].')
    assert.equal(redact(`{"AccessKeyId":"ASIAABCDEFGHIJKLMNOP","SecretAccessKey":"${sec}", "SessionToken" : "${tok}"}`),
      '{"AccessKeyId":"[removed]","SecretAccessKey":"[removed]", "SessionToken" : "[removed]"}')
    assert.equal(redact('the aws_secret_access_key setting'), 'the aws_secret_access_key setting')
    assert.equal(redact('Set aws_session_token: to refresh'), 'Set aws_session_token: to refresh')
  })

  it('stays fast on a long run of spaces', () => {
    const text = `${' '.repeat(200_000)}x`
    const t = performance.now()
    assert.equal(redact(text), text)
    assert.ok(performance.now() - t < 50, `took ${Math.round(performance.now() - t)} ms`)
  })

  it('removes a private key cut off before its END line', () => {
    const body = Array.from({ length: 25 }, () => 'A'.repeat(64)).join('\n')
    const pem = `-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----`
    assert.equal(redact(`before ${pem.slice(0, 300)}`), 'before [removed]')
    assert.equal(redact(`a ${pem} b`), 'a [removed] b')
  })
})

describe('edit guard', () => {
  const MIN = 60_000
  const prog = (sessionId: string, extra: Partial<ChatProgress> = {}): ChatProgress =>
    ({ sessionId, cwd: '/w/Armasu', state: 'working', roles: [], tasks: [], startedAt: NOW - 3600_000, at: NOW - 1000, ...extra })
  const st = (progress = [prog('them'), prog('me')]) => state([chat('them', '/w/Armasu', { label: 'Bag fix' })], { progress })
  // them edited src/x.ts three minutes ago
  const edited = (at = NOW - 3 * MIN) => { const m = new Map<string, number>(); noteEdit(m, 'them', '/w/Armasu', '/w/Armasu/src/x.ts', at); return m }

  it('stops the first edit of a file another open chat in the project edited lately', () => {
    const why = editGuard(st(), edited(), new Map(), 'me', '/w/Armasu', '/w/Armasu/src/x.ts', NOW)
    assert.equal(why, 'Another open chat (Bag fix) edited src/x.ts 3 min ago. Re-read the file before changing it, keep your edit from clobbering theirs, or use a worktree. Retry this edit to go ahead.')
  })

  it('lets a retry through within two minutes, and stops it again after', () => {
    const tried = new Map<string, number>(), edits = edited(NOW - MIN)
    assert.ok(editGuard(st(), edits, tried, 'me', '/w/Armasu', '/w/Armasu/src/x.ts', NOW))
    assert.equal(editGuard(st(), edits, tried, 'me', '/w/Armasu', '/w/Armasu/src/x.ts', NOW + MIN), undefined)
    assert.ok(editGuard(st(), edits, tried, 'me', '/w/Armasu', '/w/Armasu/src/x.ts', NOW + 3 * MIN))
  })

  it('lets the chat with the newest edit keep going', () => {
    const edits = edited()
    noteEdit(edits, 'me', '/w/Armasu', '/w/Armasu/src/x.ts', NOW - MIN)
    assert.equal(editGuard(st(), edits, new Map(), 'me', '/w/Armasu', '/w/Armasu/src/x.ts', NOW), undefined)
  })

  it('takes a relative path from the chat folder', () => {
    assert.ok(editGuard(st(), edited(), new Map(), 'me', '/w/Armasu/src', 'x.ts', NOW))
  })

  it('leaves the deny to chat-wait only for a Claude chat with the mod on', () => {
    const mod = (enabled: boolean) => [{ kind: 'mod' as const, name: 'chat-wait@kenneth-mods', enabled }]
    const on = { ...st(), installed: mod(true) }
    assert.equal(editGuard(on, edited(), new Map(), 'me', '/w/Armasu', '/w/Armasu/src/x.ts', NOW), undefined)
    assert.ok(editGuard({ ...st(), installed: mod(false) }, edited(), new Map(), 'me', '/w/Armasu', '/w/Armasu/src/x.ts', NOW))
    // Codex chats and role runs never run the mod.
    const codex = { ...on, chats: [{ sessionId: 'me', cwd: '/w/Armasu', ai: 'codex', live: true } as never] }
    assert.ok(editGuard(codex, edited(), new Map(), 'me', '/w/Armasu', '/w/Armasu/src/x.ts', NOW))
    assert.ok(editGuard(on, edited(), new Map(), 'me', '/w/Armasu', '/w/Armasu/src/x.ts', NOW, true))
  })

  it('a link the chat posted skips the guard only for that auto link file', () => {
    const linked = (auto: boolean, reason: string) => ({ ...st(), links: [{ from: 'me', to: ['them'], reason, auto, since: NOW - MIN }] })
    assert.equal(editGuard(linked(true, '/w/Armasu/src/x.ts'), edited(), new Map(), 'me', '/w/Armasu', '/w/Armasu/src/x.ts', NOW), undefined)
    assert.ok(editGuard(linked(true, '/w/Armasu/src/y.ts'), edited(), new Map(), 'me', '/w/Armasu', '/w/Armasu/src/x.ts', NOW))
    assert.ok(editGuard(linked(false, 'needs the API'), edited(), new Map(), 'me', '/w/Armasu', '/w/Armasu/src/x.ts', NOW))
  })

  it('waitsOn follows links transitively', () => {
    const links = [{ from: 'a', to: ['b'], reason: '', auto: false, since: 0 }, { from: 'b', to: ['x', 'c'], reason: '', auto: false, since: 0 }, { from: 'c', to: ['a'], reason: '', auto: false, since: 0 }]
    assert.equal(waitsOn(links, 'a', 'c'), true)
    assert.equal(waitsOn(links, 'b', 'b'), true)
    assert.equal(waitsOn(links.slice(0, 2), 'c', 'a'), false)
    assert.equal(waitsOn(undefined, 'a', 'b'), false)
  })

  it('lets the edit through otherwise', () => {
    const go = (progress?: ChatProgress[], self = 'me', file = '/w/Armasu/src/x.ts', edits = edited()) =>
      editGuard(st(progress), edits, new Map(), self, '/w/Armasu', file, NOW)
    assert.equal(go(undefined, 'them'), undefined, 'own edit')
    assert.equal(go([prog('them', { cwd: '/w/switchboard' }), prog('me')]), undefined, 'other project')
    assert.equal(go(undefined, 'me', '/w/Armasu/src/x.ts', edited(NOW - 11 * MIN)), undefined, 'too old')
    assert.equal(go(undefined, 'me', '/w/Armasu/src/y.ts'), undefined, 'other file')
    assert.equal(go(undefined, 'me', '/w/Armasu/lib/src/x.ts'), undefined, 'same last two parts')
    assert.equal(go([prog('them', { state: 'done' }), prog('me')]), undefined, 'done chat')
    assert.equal(go([prog('me')]), undefined, 'closed chat')
  })
})
