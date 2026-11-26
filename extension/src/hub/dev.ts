/**
 * The Dev button: each project's dev command, its port, its Tailscale link, and Keep awake.
 * Pure parts are tested; the readers run tailscale, ps or caffeinate and never throw.
 */
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as http from 'http'
import * as os from 'os'
import * as path from 'path'
import { run } from './local'
import { invalidateSharedRun, sharedRun } from './shared-run'
import { tailscaleBin } from './lan'
import { projectName } from './projects'
import type { ScreenSnap } from './screen'
import type { OwnedStuck } from './stuck'
import type { DevProject, Server } from './types'
import { insidePath, samePath } from './windows'
import { processAlive } from './process-alive'

const DIR = path.join(os.homedir(), '.claude', 'switchboard')
const SHIFT = 10000
// The browser app (local.ts spawnApp) runs from the switchboard folder; it is never that project's dev server.
// Skipped by port, so a hand-run copy on another port shows as switchboard's server; check the pid's args if that bites.
const APP_PORT = 3131

/** `<pm> run dev` when package.json has a dev script; the lockfile names the package manager. */
export function devCommand(pkg: unknown, files: string[]): string | undefined {
  const dev = (pkg as { scripts?: Record<string, unknown> } | undefined)?.scripts?.dev
  if (typeof dev !== 'string') return undefined
  const pm = files.includes('pnpm-lock.yaml') ? 'pnpm' : files.includes('yarn.lock') ? 'yarn' : files.some(f => f === 'bun.lockb' || f === 'bun.lock') ? 'bun' : 'npm'
  return `${pm} run dev`
}

const flag = (port: number, https: boolean) => `--${https ? 'https' : 'http'}=${port + SHIFT}`
// localhost, not 127.0.0.1: Vite and others listen on [::1] only, and tailscale tries both for a name.
export const serveArgs = (port: number, https: boolean) => ['serve', '--bg', flag(port, https), `http://localhost:${port}`]
export const offArgs = (port: number, https: boolean) => ['serve', flag(port, https), 'off']
export const devLink = (dns: string, port: number, https: boolean) => `${https ? 'https' : 'http'}://${dns.replace(/\.$/, '')}:${port + SHIFT}`

/** The ports `tailscale serve status --json` lists. */
export function servedPorts(json: string): Set<number> {
  try { return new Set(Object.keys(JSON.parse(json).TCP ?? {}).map(Number)) } catch { return new Set() }
}

export type Win = { pid: number; port: number; hubToken: string; workspace: string; /** VS Code trusts its workspace; an older window writes none. */ trusted?: boolean }
const inside = (dir: string, folder: string) => insidePath(dir, folder) || samePath(dir, folder)

/** The window whose workspace is or holds the folder (the deepest one); undefined when that is this window or none holds it. */
export function devHome(wins: Win[], folder: string, self: number): Win | undefined {
  const home = wins.filter(w => inside(w.workspace, folder)).sort((a, b) => b.workspace.length - a.workspace.length)[0]
  return home && home.pid !== self ? home : undefined
}

/** No window is or holds the folder, so a chat for it needs its own window. Not the folder a move is closing. */
export function needsWindow(wins: Win[], folder: string, moving = readMoving()): boolean {
  return !!folder && (!moving || !samePath(folder, moving)) && !wins.some(w => inside(w.workspace, folder))
}

// close-for-move.ts's flag: that folder's window was closed on purpose.
function readMoving(): string | undefined {
  try { return path.resolve(fs.readFileSync(path.join(os.homedir(), '.claude', 'close-window-for-move'), 'utf8').trim()) } catch { return undefined }
}

export type Tailnet = { dns: string; https: boolean; served: Set<number> }

/** One row per folder with a dev command; running when a dev server's cwd is inside (never the app on 3131). */
export function devRows(folders: string[], read: (folder: string) => { command: string } | undefined, servers: Server[], ts: Tailnet | null): DevProject[] {
  const rows: DevProject[] = []
  for (const folder of new Set(folders)) {
    const command = read(folder)?.command
    if (!command) continue
    const port = servers.find(s => s.port !== APP_PORT && s.cwd && inside(folder, s.cwd))?.port
    const link = port && ts?.served.has(port + SHIFT) ? devLink(ts.dns, port, ts.https) : undefined
    rows.push({ folder, project: path.basename(folder), repo: projectName(folder), command, ...(port ? { port } : {}), ...(link ? { link } : {}) })
  }
  return rows
}

/** The listed row for exactly this folder; a free path from a request never matches. */
export const knownDev = (rows: DevProject[] | undefined, folder: string) => rows?.find(r => r.folder === folder)

export function readDev(folder: string): { command: string } | undefined {
  try {
    const command = devCommand(JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')), fs.readdirSync(folder))
    return command ? { command } : undefined
  } catch { return undefined }
}

// Shared by every window, so the browser app's Plan page can follow the window Kenneth used last.
const FOCUSED = 'focused.json'
export function writeFocused(workspace: string, dir = DIR): void {
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, FOCUSED), JSON.stringify({ workspace, at: Date.now() })) } catch { /* the next focus writes it */ }
}
export function readFocused(dir = DIR): string | undefined {
  try { const v = JSON.parse(fs.readFileSync(path.join(dir, FOCUSED), 'utf8')); return typeof v?.workspace === 'string' ? v.workspace : undefined } catch { return undefined }
}

/** Every live window's discovery file. */
export function readWindows(dir = DIR): Win[] {
  const out: Win[] = []
  for (const n of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    // <workspace hash>-<pid>.json; this folder holds much bigger files too.
    if (!/-\d+\.json$/.test(n)) continue
    try {
      const w = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))
      if (typeof w.port !== 'number' || typeof w.pid !== 'number' || typeof w.hubToken !== 'string' || typeof w.workspace !== 'string') continue
      if (!processAlive(w.pid)) continue
      out.push(w)
    } catch { /* mid-write or a closed window */ }
  }
  return out
}

/** A JSON POST to a loopback port on its own socket. fetch pools sockets, and when the window behind one dies,
 * undici on macOS can throw an uncaught setTypeOfService EINVAL writing to it.
 * Resolves the status and body; rejects when nothing answers, and with a TimeoutError after ms. */
export function postLocal(port: number, path: string, body: unknown, ms: number, headers: Record<string, string> = {}): Promise<{ status: number; ok: boolean; text: string }> {
  let timer: NodeJS.Timeout | undefined
  return new Promise<{ status: number; ok: boolean; text: string }>((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', c => { text += c })
      res.on('end', () => { const status = res.statusCode ?? 0; resolve({ status, ok: status >= 200 && status < 300, text }) })
      res.on('error', reject)
      res.on('close', () => reject(new Error('closed mid-answer')))
    })
    req.on('error', reject)
    timer = setTimeout(() => { reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' })); req.destroy() }, ms)
    req.end(data)
  }).finally(() => clearTimeout(timer))
}

/** Posts to another window's hub; false when it did not take it. */
export async function postWindow(w: Win, body: Record<string, unknown>): Promise<boolean> {
  try { return (await postLocal(w.port, '/hub', { token: w.hubToken, ...body }, 2000)).ok } catch { return false }
}

/** GET path from another window's hub: the parsed JSON on a 200, else undefined (no answer, timeout, bad JSON). */
function getWindow(w: Win, path: string, ms: number): Promise<unknown> {
  return new Promise(resolve => {
    const done = (v?: unknown) => { clearTimeout(timer); resolve(v) }
    const req = http.request({ host: '127.0.0.1', port: w.port, path, method: 'GET', agent: false, headers: { 'x-switchboard-token': w.hubToken } }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', c => { text += c })
      res.on('end', () => { try { done(res.statusCode === 200 ? JSON.parse(text) : undefined) } catch { done() } })
      res.on('error', () => done())
    })
    const timer = setTimeout(() => { req.destroy(); done() }, ms)
    req.on('error', () => done())
    req.end()
  })
}

/** The stuck items of the chats another window owns, or undefined when it does not answer. */
export async function readOwnedStuck(w: Win, ms = 2000): Promise<OwnedStuck | undefined> {
  const v = await getWindow(w, '/hub/stuck', ms) as OwnedStuck | undefined
  return Array.isArray(v?.owned) && Array.isArray(v?.stuck) ? v : undefined
}

/** A chat's screen from whichever of wins holds its terminal (only that one answers 200). */
export async function readScreenElsewhere(session: string, wins: Win[], ms = 2000): Promise<(ScreenSnap & { typing: boolean }) | undefined> {
  const q = `/hub/chat/screen?${new URLSearchParams({ session, ansi: '1' })}`
  const all = await Promise.all(wins.map(w => getWindow(w, q, ms) as Promise<(ScreenSnap & { typing: boolean }) | undefined>))
  return all.find(s => typeof s?.text === 'string')
}

/** Runs a hub-* command in another window, as its panel would; false when it did not take it.
 * A refusal with a reason was shown there, and a slow answer is still running there: both count as taken, or it would run twice. */
export async function postCommand(w: Win, command: { type: string }, ms = 2000): Promise<boolean> {
  try {
    const r = await postLocal(w.port, `/hub/command?token=${encodeURIComponent(w.hubToken)}`, command, ms)
    return r.ok || (r.status === 400 && !!r.text)
  } catch (err) { return (err as Error).name === 'TimeoutError' }
}

// A reloading window drops its file (dispose) and its host pid, so for a few seconds no window holds its folder.
// It leaves <pid>.reloading naming its workspace; a chat for that folder waits for it instead of opening elsewhere.
const RELOAD_MS = 20_000

/** Call right before reloadWindow. */
export function markReloading(dir = DIR, pid = process.pid): void {
  // old markers are otherwise only cleared while a chat waits on a reload
  reloading(dir)
  const w = readWindows(dir).find(x => x.pid === pid)
  if (w) try { fs.writeFileSync(path.join(dir, `${pid}.reloading`), w.workspace) } catch { /* then it just opens here */ }
}

function reloading(dir: string): string[] {
  const out: string[] = []
  for (const n of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!n.endsWith('.reloading')) continue
    const f = path.join(dir, n)
    try {
      if (Date.now() - fs.statSync(f).mtimeMs > RELOAD_MS) fs.rmSync(f, { force: true })
      else out.push(fs.readFileSync(f, 'utf8'))
    } catch { /* gone meanwhile */ }
  }
  return out
}

/** Runs the command in the window that holds the folder (devHome), waiting up to 20s for one that is mid-reload.
 * False when this window holds it, none does, or it never took it. */
export async function sendHome(folder: string, command: { type: string }, self = process.pid, dir = DIR, every = 500, waitMs = 0): Promise<boolean> {
  // waitMs: a window just asked to open the folder; wait that long for it to list itself.
  // A window on a parent folder (all of ~/Documents/GitHub) would take it first, so only the folder's own window counts then.
  const until = Date.now() + waitMs
  for (;;) {
    const wins = readWindows(dir).filter(w => !waitMs || samePath(w.workspace, folder))
    const home = devHome(wins, folder, self)
    if (home && await postCommand(home, command)) return true
    if (!home && wins.some(w => inside(w.workspace, folder))) return false
    if (!reloading(dir).some(ws => inside(ws, folder)) && Date.now() >= until) return false
    await new Promise(r => setTimeout(r, every))
  }
}

/** This Mac's tailnet name, whether it can serve https, and what it serves; null without tailscale or when it is down. */
export async function tailnet(): Promise<Tailnet | null> {
  const bin = tailscaleBin()
  if (!bin) return null
  try {
    const s = JSON.parse(await sharedRun(bin, ['status', '--json'], { ttlMs: 60_000, timeoutMs: 5000 }))
    if (s.BackendState !== 'Running' || !s.Self?.DNSName) return null
    return { dns: s.Self.DNSName, https: (s.CertDomains ?? []).length > 0, served: servedPorts(await sharedRun(bin, ['serve', 'status', '--json'], { ttlMs: 60_000, timeoutMs: 5000 })) }
  } catch { return null }
}

export async function serve(port: number, https: boolean, on: boolean): Promise<void> {
  const bin = tailscaleBin()
  if (bin) {
    await run(bin, on ? serveArgs(port, https) : offArgs(port, https), 15000)
    invalidateSharedRun(bin, ['serve', 'status', '--json'])
  }
}

// Keep awake: one caffeinate for every window, found through its pid file.
const AWAKE_FILE = path.join(DIR, 'awake.pid')

// -w on the VS Code app (the extension host's parent), not the host: an extension update restarts the host.
export const awakeArgs = (owner = process.ppid) => ['-dis', '-w', String(owner)]

/** Our caffeinate's pid; a stale file (VS Code quit, pid reused, say by Claude Code's `caffeinate -i -t 300`) is deleted. */
export async function awakePid(file = AWAKE_FILE): Promise<number | undefined> {
  const pid = Number(await fs.promises.readFile(file, 'utf8').catch(() => ''))
  if (!(pid > 0)) return undefined
  if (/(^|\/)caffeinate -dis -w \d+$/.test((await run('ps', ['-p', String(pid), '-o', 'args='])).trim())) return pid
  fs.rmSync(file, { force: true })
  return undefined
}

// One toggle at a time in this window, so a double click cannot start two caffeinates.
let awakeQueue: Promise<unknown> = Promise.resolve()

/** Starts or ends the caffeinate; a string is why it could not. */
export function setAwake(on: boolean): Promise<string | undefined> {
  const next = awakeQueue.then(() => toggleAwake(on))
  awakeQueue = next.catch(() => undefined)
  return next
}

async function toggleAwake(on: boolean): Promise<string | undefined> {
  if (process.platform !== 'darwin') return 'Keep awake needs macOS'
  const pid = await awakePid()
  if (!on) {
    if (pid) try { process.kill(pid) } catch { /* already gone */ }
    fs.rmSync(AWAKE_FILE, { force: true })
    return undefined
  }
  if (pid) return undefined
  const child = spawn('caffeinate', awakeArgs(), { stdio: 'ignore' })
  // Without a listener a spawn error would crash the extension host.
  child.on('error', () => fs.rmSync(AWAKE_FILE, { force: true }))
  if (!child.pid) return 'caffeinate did not start'
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(AWAKE_FILE, String(child.pid))
  return undefined
}
