/**
 * Stops the dev servers and test browsers a chat started, once it ends for good.
 * A process is the chat's only if its claude was an ancestor; recorded while the chat is live,
 * since at SessionEnd the parent is gone and launchd owns the child.
 */
import { createLogger } from '../logger'
import { hub } from './hub-service'
import { listServers } from './local'
import { sharedRun } from './shared-run'
import { sweepTabs } from './tabs'
import type { Server } from './types'

const log = createLogger('Reap')

/** start: ps lstart, so a reused pid running the same command is still told apart. */
export type Proc = { pid: number; ppid: number; command: string; start?: string }
/** By chat: every descendant pid seen while it was live, with its start and command (see ident). */
export type Ran = Map<string, Map<number, string>>
type Chat = { sessionId: string; pid: number; live: boolean; ai?: string }
export type Target = { pid: number; command: string; port?: number }

// Armasu and Switchboard's own app.
const KEEP_PORTS = new Set([3000, 3131])
const KEEP = /app-keeper\.mjs|[/\\]\.claude[/\\]switchboard[/\\]/
// Playwright's Chromium, Chrome for Testing, headless shell, or the real Chrome app run --headless
// (macOS hands link clicks from other apps to a leftover one); the user's Chrome is none of these.
const BROWSER = /ms-playwright|Google Chrome for Testing|chrome-headless-shell|headless_shell|Google Chrome.* --headless/

export function parsePs(out: string): Proc[] {
  const procs: Proc[] = []
  for (const row of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(?:(\w{3} \w{3} [ \d]\d [\d:]{8} \d{4})\s+)?(.+)$/.exec(row)
    if (m) procs.push({ pid: Number(m[1]), ppid: Number(m[2]), ...(m[3] ? { start: m[3] } : {}), command: m[4].trim() })
  }
  return procs
}

const ident = (p: Proc) => p.start ? `${p.start} ${p.command}` : p.command

function under(procs: Proc[], root: number): Set<number> {
  const kids = new Map<number, number[]>()
  for (const p of procs) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p.pid])
  const out = new Set<number>(), todo = [root]
  while (todo.length) for (const k of kids.get(todo.pop()!) ?? []) if (!out.has(k)) { out.add(k); todo.push(k) }
  return out
}

/** Adds each live chat's current descendants; forgets pids that are gone. */
export function remember(ran: Ran, chats: Chat[], procs: Proc[]): void {
  const cmd = new Map(procs.map(p => [p.pid, ident(p)]))
  for (const c of chats) {
    if (!c.live || !c.pid) continue
    const mine = ran.get(c.sessionId) ?? new Map<number, string>()
    for (const pid of under(procs, c.pid)) mine.set(pid, cmd.get(pid)!)
    ran.set(c.sessionId, mine)
  }
  for (const [id, mine] of ran) {
    for (const [pid, command] of mine) if (cmd.get(pid) !== command) mine.delete(pid)
    if (!mine.size && !chats.some(c => c.sessionId === id && c.live)) ran.delete(id)
  }
}

/** What to stop for this chat: its listening servers and main test browsers, past every guard. */
export function targets(id: string, ran: Ran, chats: Chat[], procs: Proc[], servers: Server[]): Target[] {
  const mine = ran.get(id)
  if (!mine) return []
  const now = new Map(procs.map(p => [p.pid, p]))
  const others = new Set<number>()
  for (const c of chats) if (c.live && c.pid && c.sessionId !== id) for (const pid of under(procs, c.pid)) others.add(pid)
  for (const [sid, pids] of ran) if (sid !== id && chats.some(c => c.live && c.sessionId === sid)) for (const pid of pids.keys()) others.add(pid)
  const out: Target[] = []
  for (const [pid, command] of mine) {
    const p = now.get(pid)
    if (!p || ident(p) !== command || others.has(pid) || pid === process.pid || KEEP.test(command)) continue
    const ports = servers.filter(s => s.pid === pid).map(s => s.port)
    if (ports.some(port => KEEP_PORTS.has(port))) continue
    // The browser's own helpers go with it.
    const browser = BROWSER.test(command) && !BROWSER.test(now.get(p.ppid)?.command ?? '')
    if (ports.length || browser) out.push({ pid, command: p.command, ...(ports.length ? { port: ports[0] } : {}) })
  }
  return out
}

type Deps = {
  on: boolean; retrying: string[]; chats: Chat[]; procs: Proc[]; servers: Server[]; ran: Ran
  kill: (pid: number, sig: NodeJS.Signals) => void; alive: (pid: number) => boolean; graceMs: number
}

/** SIGTERM each, SIGKILL whatever still runs after the grace. Skips a chat queued to resume after its limit. */
export async function reapChat(p: { sessionId: string; limited?: unknown }, d: Deps): Promise<Target[]> {
  if (!d.on || p.limited || d.retrying.includes(p.sessionId)) return []
  const list = targets(p.sessionId, d.ran, d.chats, d.procs, d.servers)
  d.ran.delete(p.sessionId)
  const send = (pid: number, sig: NodeJS.Signals) => { try { d.kill(pid, sig) } catch { /* already gone */ } }
  for (const t of list) send(t.pid, 'SIGTERM')
  if (list.length) await new Promise(r => setTimeout(r, d.graceMs))
  for (const t of list) if (d.alive(t.pid)) send(t.pid, 'SIGKILL')
  return list
}

const ran: Ran = new Map()
export const readProcessTable = async (fresh = false) => parsePs(await sharedRun('ps', ['-axo', 'pid=,ppid=,lstart=,command='], { ttlMs: 12_000, timeoutMs: 5000, fresh, partial: true }))
/** Whether this chat started one of these servers. */
export const startedServer = (id: string, servers: Server[]) => servers.some(s => ran.get(id)?.has(s.pid))
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

// ponytail: sampled with the chat refresh (15 s), so a server that daemonizes faster than that is missed.
export async function rememberChats(chats: Chat[]): Promise<void> {
  if (process.platform === 'darwin') {
    const s = hub.get()
    void sweepTabs({ on: s.controls.switchboard.stopServers !== false, chats, progress: s.progress, retrying: hub.retryIds() })
      .then(ids => { if (ids.length) log.info(`Closed ${ids.length} Chrome tab(s) finished chats opened`) }, err => log.warn('Closing tabs failed:', err))
  }
  if (process.platform === 'win32' || !chats.some(c => c.live)) return
  remember(ran, chats, await readProcessTable())
}

/** hub.onEnded: stops what the chat started, when Settings allows. Its servers then show in the stopped list on the next refresh. */
export async function stopChatServers(p: { sessionId: string; limited?: unknown }): Promise<void> {
  if (process.platform === 'win32' || !ran.has(p.sessionId)) return
  const s = hub.get()
  const [procs, servers] = await Promise.all([readProcessTable(true), listServers(true)])
  const done = await reapChat(p, {
    on: s.controls.switchboard.stopServers !== false, retrying: hub.retryIds(), chats: s.chats, procs, servers, ran,
    kill: (pid, sig) => process.kill(pid, sig), alive, graceMs: 3000,
  })
  for (const t of done) log.info(`Stopped ${t.port ? `the server on ${t.port}` : 'a test browser'} (pid ${t.pid}) that chat ${p.sessionId.slice(0, 8)} started`)
  if (done.some(t => t.port)) hub.set({ servers: await listServers(true) })
}
