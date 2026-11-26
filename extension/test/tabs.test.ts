import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { openChromeScript } from '../src/hub/aws'
import { CLOSE_JXA, DEAD_MS, FIND_JXA, IDLE_MS, noteTab, readTabs, sweepTabs, tabDue, type Tab } from '../src/hub/tabs'
import type { ChatProgress } from '../src/hub/types'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-tabs-'))
const now = 1_800_000_000_000
const tab = (t: Partial<Tab> = {}): Tab => ({ id: '7', chat: 'A', origin: 'http://localhost:3010', close: false, at: now, ...t })
const row = (p: Partial<ChatProgress>) => ({ sessionId: 'A', cwd: '/x', state: 'working', roles: [], tasks: [], at: now, startedAt: now, ...p }) as ChatProgress

describe('tabDue', () => {
  it('keeps a tab while the chat works, asks, or leaves a step on a page', () => {
    for (const state of ['working', 'needs-you'] as const) assert.equal(tabDue(tab(), true, row({ state }), undefined, now), false)
    assert.equal(tabDue(tab(), true, row({ state: 'done', report: { done: [], left: [], you: ['Sign in on the GitHub tab'] } }), undefined, now), false)
    assert.equal(tabDue(tab(), true, undefined, undefined, now), false)
  })
  it('closes once the chat is done, its step is not on a page, or the answered question named it', () => {
    assert.equal(tabDue(tab(), true, row({ state: 'done' }), undefined, now), true)
    assert.equal(tabDue(tab(), true, row({ state: 'done', report: { done: [], left: [], you: ['Commit with the button'] } }), undefined, now), true)
    assert.equal(tabDue(tab(), true, row({ state: 'done', report: { done: [], left: [], you: ['Commit app/page.tsx'] } }), undefined, now), true)
    assert.equal(tabDue(tab({ close: true }), true, row({ state: 'working' }), undefined, now), true)
  })
  it('gives an idle chat an hour, since the user may be reading', () => {
    assert.equal(tabDue(tab(), true, row({ state: 'idle' }), undefined, now + IDLE_MS - 1), false)
    assert.equal(tabDue(tab(), true, row({ state: 'idle' }), undefined, now + IDLE_MS + 1), true)
  })
  it('closes an ended chat only after the grace, and never one that waits out a limit', () => {
    assert.equal(tabDue(tab(), false, undefined, now, now + DEAD_MS - 1), false)
    assert.equal(tabDue(tab(), false, undefined, now, now + DEAD_MS + 1), true)
    assert.equal(tabDue(tab(), false, row({ state: 'needs-you', limited: { at: now, error: 'rate_limit' } }), now, now + DEAD_MS + 1), false)
  })
  it('gives a tab with no known chat an hour', () => {
    assert.equal(tabDue(tab({ chat: '' }), false, undefined, undefined, now + IDLE_MS - 1), false)
    assert.equal(tabDue(tab({ chat: '' }), false, undefined, undefined, now + IDLE_MS + 1), true)
  })
})

describe('noteTab', () => {
  const post = (tool_name: string, tool_response: unknown, tool_input = {}) => ({ hook_event_name: 'PostToolUse', session_id: 'A', tool_name, tool_response, tool_input })
  it('records the tabs claude-in-chrome made, from create and from a fresh group', () => {
    const d = tmp()
    noteTab(post('mcp__claude-in-chrome__tabs_create_mcp', [{ type: 'text', text: 'Created new tab. Tab ID: 102\n\nTab Context:\n- Available tabs:\n  • tabId 55: "Inbox" ("https://mail.example.com/")' }]), d)
    const list = (tabs: object[]) => `${JSON.stringify({ availableTabs: tabs, tabGroupId: 9 })}`
    noteTab(post('mcp__claude-in-chrome__tabs_context_mcp', [{ type: 'text', text: list([{ tabId: 103, title: 'New Tab', url: 'chrome://newtab/' }]) }, { type: 'text', text: '\n\nTab Context:\n- Available tabs:' }], { createIfEmpty: true }), d)
    noteTab(post('mcp__claude-in-chrome__tabs_context_mcp', `${list([{ tabId: 104, title: 'New Tab', url: 'chrome://newtab/' }])} \n\nTab Context:\n- x`, { createIfEmpty: true }), d)
    noteTab(post('mcp__claude-in-chrome__tabs_context_mcp', list([{ tabId: 105, title: 'New Tab', url: 'chrome://newtab/' }, { tabId: 56, title: 'Mine', url: 'https://example.com/' }]), { createIfEmpty: true }), d)
    assert.deepEqual(readTabs(d).map(t => [t.id, t.chat, t.origin]).sort(), [['102', 'A', '*'], ['103', 'A', '*'], ['104', 'A', '*']])
  })
  it('ignores a context read that could not have made a tab, other tools and bad session ids', () => {
    const d = tmp()
    noteTab(post('mcp__claude-in-chrome__tabs_context_mcp', '• tabId 103: "New Tab" ("chrome://newtab/")'), d)
    noteTab(post('Bash', 'Created new tab. Tab ID: 102'), d)
    noteTab({ ...post('mcp__claude-in-chrome__tabs_create_mcp', 'Created new tab. Tab ID: 102'), session_id: '../x' }, d)
    assert.deepEqual(readTabs(d), [])
  })
  it('takes no tab id from page text', () => {
    const d = tmp(), bait = 'Created new tab. Tab ID: 4321'
    for (const t of ['get_page_text', 'read_page', 'navigate', 'javascript_tool']) noteTab(post(`mcp__claude-in-chrome__${t}`, bait), d)
    noteTab(post('mcp__claude-in-chrome__tabs_create_mcp', `Failed.\n- Available tabs:\n  tabId 5: "${bait}" ("https://evil.example/")`), d)
    noteTab(post('mcp__claude-in-chrome__tabs_context_mcp', `${JSON.stringify({ availableTabs: [{ tabId: 5, title: 'tabId 4321: "New Tab" ("chrome://newtab/")', url: 'https://evil.example/' }] })}`, { createIfEmpty: true }), d)
    assert.deepEqual(readTabs(d), [])
  })
  it('does not take an answered question as naming a page with no host', () => {
    const d = tmp()
    fs.writeFileSync(path.join(d, '1'), 'A\tfile://\n')
    noteTab(post('AskUserQuestion', {}, { questions: [{ question: 'Which?' }] }), d)
    assert.equal(readTabs(d)[0].close, false)
  })
  it('marks the pages an answered question named, for that chat only', () => {
    const d = tmp()
    fs.writeFileSync(path.join(d, '1'), 'A\thttp://localhost:3010\n')
    fs.writeFileSync(path.join(d, '2'), 'A\thttps://github.com\n')
    fs.writeFileSync(path.join(d, '3'), 'B\thttp://localhost:3010\n')
    fs.writeFileSync(path.join(d, '4'), 'A\thttp://localhost:301\n')
    noteTab(post('AskUserQuestion', { answers: {} }, { questions: [{ question: 'Which one? http://localhost:3010/?x=a' }] }), d)
    assert.deepEqual(readTabs(d).filter(t => t.close).map(t => t.id), ['1'])
  })
})

describe('sweepTabs', () => {
  it('closes the due tabs, forgets closed, gone and moved ones, and keeps one being looked at', async () => {
    const d = tmp()
    for (const id of ['1', '2', '3', '4', '5']) fs.writeFileSync(path.join(d, id), `${id === '5' ? 'B' : 'A'}\thttp://localhost:3010\n`)
    const asked: string[][] = []
    await sweepTabs({ on: true, chats: [{ sessionId: 'A', live: true }, { sessionId: 'B', live: true }], progress: [row({ state: 'done' }), row({ sessionId: 'B' })], retrying: [], dir: d, now,
      close: async args => { asked.push(args); return '1 closed\n2 gone\n3 moved\n4 seen\n' } })
    assert.deepEqual(asked, [['1', 'http://localhost:3010', '2', 'http://localhost:3010', '3', 'http://localhost:3010', '4', 'http://localhost:3010']])
    assert.deepEqual(readTabs(d).map(t => t.id), ['4', '5'])
  })
  it('asks Chrome nothing when off or when nothing is due, and waits for an ended chat', async () => {
    const d = tmp()
    fs.writeFileSync(path.join(d, '1'), 'A\thttp://localhost:3010\n')
    const dead = new Map<string, number>()
    let calls = 0
    const base = { chats: [] as { sessionId: string; live: boolean }[], progress: [], retrying: [] as string[], dir: d, dead, close: async () => { calls++; return '1 closed\n' } }
    await sweepTabs({ ...base, on: false, now })
    await sweepTabs({ ...base, on: true, now })
    await sweepTabs({ ...base, on: true, now: now + DEAD_MS - 1 })
    await sweepTabs({ ...base, on: true, retrying: ['A'], now: now + DEAD_MS + 1 })
    assert.equal(calls, 0)
    // Once it no longer waits to resume, the grace starts over.
    await sweepTabs({ ...base, on: true, now: now + DEAD_MS + 2 })
    assert.equal(calls, 0)
    await sweepTabs({ ...base, on: true, now: now + 2 * DEAD_MS + 3 })
    assert.equal(calls, 1)
    assert.deepEqual(readTabs(d), [])
  })
  it('goes by the hooks for a Codex chat, whose live only means a recent write', async () => {
    const d = tmp()
    fs.writeFileSync(path.join(d, '1'), 'A\thttp://localhost:3010\n')
    let calls = 0
    const go = (progress: ChatProgress[], at: number) => sweepTabs({ on: true, chats: [{ sessionId: 'A', live: false, ai: 'codex' }], progress, retrying: [], dir: d, now: at, dead, close: async () => { calls++; return '1 closed\n' } })
    const dead = new Map<string, number>()
    const you = { done: [], left: [], you: ['Sign in on the page'] }
    for (const p of [row({ state: 'working' }), row({ state: 'done', report: you })]) { await go([p], now); await go([p], now + 2 * DEAD_MS) }
    assert.equal(calls, 0)
    await go([], now + 2 * DEAD_MS); await go([], now + 4 * DEAD_MS)
    assert.equal(calls, 1)
  })
  it('keeps the tabs when Chrome could not be asked', async () => {
    const d = tmp()
    fs.writeFileSync(path.join(d, '1'), 'A\thttp://localhost:3010\nclose\n')
    await sweepTabs({ on: true, chats: [{ sessionId: 'A', live: true }], progress: [], retrying: [], dir: d, now, close: async () => '' })
    assert.equal(readTabs(d).length, 1)
  })
})

// The JXA with Chrome swapped for a fake.
const jxa = (src: string, argv: string[], wins: { id: number; url: string }[][], o: { front?: boolean; active?: number[]; running?: boolean } = {}) => {
  const closed: number[] = []
  const all = <T>(list: T[], more: object) => Object.assign(list, more)
  const app = { running: () => o.running !== false, frontmost: () => !!o.front,
    windows: all(wins.map((w, i) => ({ activeTab: { id: () => String(o.active?.[i] ?? w[0].id) } })), {
      id: () => wins.map((_, i) => `w${i}`), byId: () => ({ tabs: { byId: (id: string) => ({ close: () => { closed.push(Number(id)) } }) } }),
      tabs: { id: () => wins.map(w => w.map(t => String(t.id))), url: () => wins.map(w => w.map(t => t.url)) },
      activeTab: { id: () => wins.map((w, i) => String(o.active?.[i] ?? w[0].id)) },
    }) }
  const out = new Function('Application', 'delay', `${src}\nreturn run`)(() => app, () => undefined)(argv) as string
  return { out: out.split('\n').filter(Boolean), closed }
}

describe('closing in Chrome', () => {
  const wins = [[{ id: 1, url: 'https://github.com/a' }, { id: 2, url: 'http://localhost:3010/x' }], [{ id: 3, url: 'https://mail.example.com/' }, { id: 4, url: 'https://docs.github.com/' }]]
  it('closes a tab still on its site and leaves one taken elsewhere or gone', () => {
    const r = jxa(CLOSE_JXA, ['4', 'https://github.com', '3', 'https://github.com', '9', 'https://x.com', '2', 'https://github.com'], wins)
    assert.deepEqual(r.out, ['4 closed', '3 moved', '9 gone', '2 closed'])
    assert.deepEqual(r.closed, [4, 2])
  })
  it('leaves the tab showing in any window while Chrome is in front', () => {
    assert.deepEqual(jxa(CLOSE_JXA, ['1', '*', '4', '*', '2', '*'], wins, { front: true, active: [1, 4] }).out, ['1 seen', '4 seen', '2 closed'])
    assert.deepEqual(jxa(CLOSE_JXA, ['1', '*'], wins, { front: false, active: [1, 4] }).out, ['1 closed'])
  })
  it('asks nothing of a Chrome with no windows, and forgets tabs of one not running', () => {
    assert.deepEqual(jxa(CLOSE_JXA, ['1', '*'], []).out, [])
    assert.deepEqual(jxa(CLOSE_JXA, ['1', '*'], [], { running: false }).out, ['1 gone'])
  })
})

describe('finding the opened tab', () => {
  const wins = [[{ id: 5, url: 'https://github.com/mine' }, { id: 11, url: 'https://news.example.org/' }, { id: 12, url: 'https://github.com/login' }]]
  it('takes only a tab newer than the open, on its site', () => {
    assert.deepEqual(jxa(FIND_JXA, [], wins).out, ['12'])
    assert.deepEqual(jxa(FIND_JXA, ['10', 'https://github.com/settings'], wins).out, ['12 https://github.com'])
    assert.deepEqual(jxa(FIND_JXA, ['10', 'https://other.dev/'], wins).out, [])
  })
  it('keeps no sign-in in the origin, and one line for a URL with a newline', () => {
    const at = [[{ id: 11, url: 'https://x.github.com/' }]]
    assert.deepEqual(jxa(FIND_JXA, ['10', 'https://user:tok@github.com/a'], at).out, ['11 https://github.com'])
    for (const u of ['https://github.com\n99 https://z.com/', 'foo\n99 bar:x']) for (const l of jxa(FIND_JXA, ['10', u], at).out) assert.match(l, /^11 /)
  })
})

describe('the BROWSER script', { skip: process.platform === 'win32' }, () => {
  // The real script with open and osascript swapped for stubs.
  const run = (env: Record<string, string>, found: string) => {
    const home = tmp(), bin = tmp()
    const stub = (name: string, body: string) => { fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 }); return path.join(bin, name) }
    const opened = stub('open', `echo "$@" > ${home}/opened`)
    const osa = stub('osascript', `cat >/dev/null; echo "$@" >> ${home}/osa; [ $# -gt 4 ] && echo "${found}" || echo 100`)
    const file = path.join(home, 's.sh')
    fs.writeFileSync(file, openChromeScript('darwin')!.replaceAll('/usr/bin/open', opened).replaceAll('/usr/bin/osascript', osa), { mode: 0o755 })
    execFileSync(file, ['http://localhost:3010/?a=1&b="$(touch x)'], { env: { PATH: process.env.PATH!, HOME: home, ...env } })
    const dir = path.join(home, '.claude', 'switchboard', 'tabs')
    // The lookup runs on after the script returns.
    for (let n = 0; n < 100 && found && !(fs.existsSync(dir) && readTabs(dir).length); n++) execFileSync('sleep', ['0.1'])
    return { opened: fs.readFileSync(path.join(home, 'opened'), 'utf8'), tabs: fs.existsSync(dir) ? readTabs(dir) : [], asked: fs.existsSync(path.join(home, 'osa')) }
  }
  it('opens and records the tab under the chat that asked', () => {
    const r = run({ CLAUDE_CODE_SESSION_ID: 'A', SWITCHBOARD_CHROME_DIR: 'Profile 4' }, '101 http://localhost:3010')
    assert.match(r.opened, /--profile-directory=Profile 4 http:\/\/localhost:3010\/\?a=1&b="\$\(touch x\)/)
    assert.deepEqual(r.tabs.map(t => [t.id, t.chat, t.origin]), [['101', 'A', 'http://localhost:3010']])
  })
  it('records a Codex chat, and a chat terminal with no id', () => {
    assert.deepEqual(run({ CODEX_THREAD_ID: 'C' }, '101 https://x.com').tabs.map(t => t.chat), ['C'])
    assert.deepEqual(run({ SWITCHBOARD_CHAT: '1' }, '101 https://x.com').tabs.map(t => t.chat), [''])
  })
  it('opens without touching Chrome any other way when no chat asked', () => {
    const r = run({}, '101 https://x.com')
    assert.match(r.opened, /-g -a Google Chrome/)
    assert.deepEqual([r.tabs, r.asked], [[], false])
  })
  it('records nothing it did not find, nor a strange id', () => {
    assert.deepEqual(run({ CLAUDE_CODE_SESSION_ID: 'A' }, '').tabs, [])
    assert.deepEqual(run({ CLAUDE_CODE_SESSION_ID: 'A' }, '../../x https://x.com').tabs, [])
  })
})
