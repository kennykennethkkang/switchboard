/**
 * Closes the Chrome tabs chats open, once each is done with. One file per tab in ~/.claude/switchboard/tabs, named by
 * Chrome's tab id (claude-in-chrome's tabId is the same number): chat, origin, then "close" when it can go now.
 * The BROWSER script (aws.ts) writes the pages opened with it, noteTab the tabs claude-in-chrome made.
 * macOS only: closing goes through Chrome's AppleScript, which takes no focus.
 */
import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { ChatProgress } from './types'

export const TABS = path.join(os.homedir(), '.claude', 'switchboard', 'tabs')
/** An idle turn may have opened the page for the user to read. */
export const IDLE_MS = 60 * 60_000
/** A window reload ends and resumes its chats. */
export const DEAD_MS = 2 * 60_000

/** origin '*': a claude-in-chrome tab, which the chat drives from site to site. chat '': a chat terminal with no id. */
export type Tab = { id: string; chat: string; origin: string; close: boolean; at: number }
type Payload = Record<string, unknown>

export function readTabs(dir = TABS): Tab[] {
  let names: string[] = []
  try { names = fs.readdirSync(dir) } catch { return [] }
  return names.filter(n => /^\d+$/.test(n)).sort((a, b) => Number(a) - Number(b)).flatMap(id => {
    try {
      const file = path.join(dir, id)
      const [head, ...rest] = fs.readFileSync(file, 'utf8').split('\n')
      const [chat, origin] = head.split('\t')
      return origin ? [{ id, chat, origin, close: rest.includes('close'), at: fs.statSync(file).mtimeMs }] : []
    } catch { return [] }
  })
}

const ASKS = /^(AskUserQuestion|request_user_input)$|switchboard.*\bask$|switchboard__ask$/

function replyText(r: unknown): string {
  if (typeof r === 'string') return r
  if (Array.isArray(r)) return r.map(replyText).join('')
  const o = (r ?? {}) as { text?: unknown; content?: unknown }
  return typeof o.text === 'string' ? o.text : o.content ? replyText(o.content) : ''
}

/** The one blank tab a new group starts on; with any other tab listed the group is not new. */
function freshGroup(text: string): string[] {
  try {
    const { availableTabs: tabs } = JSON.parse(text.split('\n\nTab Context:')[0]) as { availableTabs?: { tabId?: unknown; url?: unknown }[] }
    return tabs?.length === 1 && tabs[0].url === 'chrome://newtab/' && Number.isSafeInteger(tabs[0].tabId) ? [String(tabs[0].tabId)] : []
  } catch { return [] }
}

/** A PostToolUse hook: records the tabs claude-in-chrome made, and marks the pages an answered question named. */
export function noteTab(payload: Payload, dir = TABS): void {
  const tool = String(payload.tool_name ?? ''), chat = String(payload.session_id ?? '')
  if (payload.hook_event_name !== 'PostToolUse' || !/^[\w-]{1,80}$/.test(chat)) return
  if (ASKS.test(tool)) {
    const text = JSON.stringify(payload.tool_input ?? '')
    for (const t of readTabs(dir)) {
      const host = t.origin.replace(/^\w+:\/\//, '')
      const at = t.chat === chat && t.origin !== '*' && host ? text.indexOf(host) : -1
      if (at >= 0 && !/[\w:]/.test(text[at + host.length] ?? '')) fs.appendFileSync(path.join(dir, t.id), 'close\n')
    }
    return
  }
  // Only the tools that make tabs, read by shape: other output carries page text.
  const ids = /claude-in-chrome__tabs_create_mcp$/.test(tool) ? [/^Created new tab\. Tab ID: (\d+)/.exec(replyText(payload.tool_response))?.[1]].filter(id => id !== undefined)
    : /claude-in-chrome__tabs_context_mcp$/.test(tool) && (payload.tool_input as Payload | undefined)?.createIfEmpty === true ? freshGroup(replyText(payload.tool_response)) : []
  if (!ids.length) return
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  for (const id of ids) try { fs.writeFileSync(path.join(dir, id), `${chat}\t*\n`, { flag: 'wx', mode: 0o600 }) } catch { /* already recorded */ }
}

const PAGE = /\b(tabs?|page(?!\.\w)|browser|chrome|sign(?:ed)?[ -]?in|log ?in|https?:\/\/|localhost)/i

/** deadSince: when its chat was first seen not running. */
export function tabDue(t: Tab, live: boolean, p: ChatProgress | undefined, deadSince: number | undefined, now: number): boolean {
  if (t.close) return true
  if (!t.chat) return now - t.at > IDLE_MS
  if (p?.state === 'needs-you') return false
  if (!live) return !p?.limited && deadSince !== undefined && now - deadSince > DEAD_MS
  if (p?.state === 'done') return !p.report?.you?.some(l => PAGE.test(l))
  return p?.state === 'idle' && now - p.at > IDLE_MS
}

const SITE = `function site(u) { const m = /^https?:\\/\\/(?:[^\\/?#\\s]*@)?([^\\/:?#\\s]+)/.exec(u); if (!m) return u.split(':')[0]; return /^[\\d.]+$/.test(m[1]) ? m[1] : m[1].split('.').slice(-2).join('.') }`

/** The BROWSER script's JXA: with no argument the newest tab id, with one and a URL the "id origin" lines of what opened since. */
export const FIND_JXA = `${SITE}
function run(argv) {
  const c = Application('Google Chrome')
  if (!c.running()) return ''
  const tabs = () => { const ids = c.windows.tabs.id().flat(), urls = c.windows.tabs.url().flat(); return ids.map((id, i) => ({ id: Number(id), url: String(urls[i] || '') })) }
  if (!argv.length) return String(Math.max(0, ...tabs().map(t => t.id)))
  const before = Number(argv[0]), url = argv[1], m = /^(https?:\\/\\/)(?:[^\\/?#\\s]*@)?([^\\/?#\\s]+)/.exec(url), origin = m ? m[1] + m[2] : (/^[a-z][a-z0-9+.-]*/i.exec(url) || [''])[0] + '://'
  for (let n = 0; n < 15; n++) {
    const fresh = tabs().filter(t => t.id > before)
    const hit = fresh.filter(t => t.url === url).concat(fresh.filter(t => t.url !== url && site(t.url) === site(url)))
    if (hit.length || (n > 5 && fresh.length === 1)) return (hit.length ? hit : fresh).map(t => t.id + ' ' + origin).join('\\n')
    delay(0.3)
  }
  return ''
}`

// A tab the user took to another site is theirs now; a sign-in that came back to localhost is finished.
export const CLOSE_JXA = `${SITE}
function run(argv) {
  const c = Application('Google Chrome'), out = []
  if (!c.running()) { for (let i = 0; i < argv.length; i += 2) out.push(argv[i] + ' gone'); return out.join('\\n') }
  const wins = c.windows.id(), ids = c.windows.tabs.id(), urls = c.windows.tabs.url()
  // A headless Chrome answers with no windows.
  if (!wins.length) return ''
  const shown = c.frontmost() ? c.windows.activeTab.id().map(String) : []
  for (let i = 0; i < argv.length; i += 2) {
    const id = argv[i], origin = argv[i + 1], w = ids.findIndex(l => l.some(x => String(x) === id))
    if (w < 0) { out.push(id + ' gone'); continue }
    const url = String(urls[w][ids[w].findIndex(x => String(x) === id)] || '')
    const same = origin === '*' || url === '' || site(url) === site(origin) || /^https?:\\/\\/(localhost|127\\.0\\.0\\.1)[:\\/]/.test(url)
    if (!same) { out.push(id + ' moved'); continue }
    if (shown.includes(id)) { out.push(id + ' seen'); continue }
    c.windows.byId(wins[w]).tabs.byId(id).close()
    out.push(id + ' closed')
  }
  return out.join('\\n')
}`

const closeTabs = (args: string[]) => new Promise<string>(resolve => execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', CLOSE_JXA, ...args], { timeout: 60_000 }, (err, out) => resolve(err ? '' : out)))

const seenDead = new Map<string, number>()
let busy = false

/** Every chat refresh: closes what is due; a tab being looked at waits for the next one. */
export async function sweepTabs(s: {
  on: boolean; chats: { sessionId: string; live: boolean; ai?: string }[]; progress: ChatProgress[]; retrying: string[]
  now?: number; dir?: string; dead?: Map<string, number>; close?: (args: string[]) => Promise<string>
}): Promise<string[]> {
  if (!s.on || busy) return []
  const { now = Date.now(), dir = TABS, dead = seenDead, close = closeTabs } = s
  const tabs = readTabs(dir)
  const due = tabs.filter(t => {
    const p = s.progress.find(p => p.sessionId === t.chat)
    // Codex's live is a recent rollout write, so its hooks say more: a row lasts a day past the last one.
    const live = s.retrying.includes(t.chat) || s.chats.some(c => c.sessionId === t.chat && (c.live || (c.ai === 'codex' && !!p)))
    if (live) dead.delete(t.chat)
    else if (!dead.has(t.chat)) dead.set(t.chat, now)
    return tabDue(t, live, p, dead.get(t.chat), now)
  })
  for (const id of dead.keys()) if (!tabs.some(t => t.chat === id)) dead.delete(id)
  if (!due.length) return []
  busy = true
  try {
    const out = await close(due.flatMap(t => [t.id, t.origin]))
    const over = out.split('\n').map(l => l.split(' ')).filter(([id, what]) => ['closed', 'gone', 'moved'].includes(what) && due.some(t => t.id === id))
    for (const [id] of over) fs.rmSync(path.join(dir, id), { force: true })
    return over.filter(([, what]) => what === 'closed').map(([id]) => id)
  } finally { busy = false }
}
