/**
 * What the Hub reads off this machine: the newest plan, dev servers, git,
 * installed plugins and skills, and connections. The parsers are pure
 * (tested); the readers run a command or read a file and never throw.
 */
import { isTempDir } from './temp'
import { execFile, spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { ChangedFile, Connection, GitState, Installed, PhoneUrls, PlanView, Server } from './types'
import { DEFAULT_RELAY_PORT } from '../constants'
import { tryLock } from '../fs-utils'
import { codexOf, modelOf } from './roles'
import { digest, needsApproval, readSweep } from '../../kit/sweep.mjs'
import { newerVersion } from './self-update'
import { macNames, phoneCode, type MacNames } from './lan'
import { sharedRun } from './shared-run'
import { editor } from '../editor'
import { RESEARCH_ROOT, ensureResearchRoot } from './research'
import { insidePath } from './windows'

const HOME = os.homedir()
const CLAUDE = path.join(HOME, '.claude')
// Runtimes that serve dev work; Discord, OneDrive, the editor and the like are left out.
const DEV = /^(node|python[\d.]*|bun|deno|ruby|php|uvicorn|gunicorn)$/i

export function run(file: string, args: string[], timeoutMs = 5000): Promise<string> {
  return new Promise(resolve => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 4 << 20, windowsHide: true }, (err, stdout) => resolve(err && !stdout ? '' : String(stdout)))
  })
}

async function readJson(file: string): Promise<Record<string, unknown> | undefined> {
  try { return JSON.parse(await fs.promises.readFile(file, 'utf8')) } catch { return undefined }
}

// ─── Plan ────────────────────────────────────────────────────────────────────

const plain = (s: string) => s.replace(/\*\*|__|`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim().slice(0, 120)

export function parsePlan(name: string, text: string): PlanView {
  const tasks: PlanView['tasks'] = []
  const decisions: string[] = []
  let inDecisions = false
  for (const row of text.split('\n')) {
    // A decision is a list item or table row under a "## Decisions" heading; other layouts are missed.
    if (/^##\s/.test(row)) { inDecisions = /^##\s+Decisions/i.test(row); continue }
    if (/^###\s+Task\s/.test(row)) inDecisions = false
    if (inDecisions) {
      const cells = row.startsWith('|') ? row.split('|').slice(1, -1).map(c => c.trim()) : []
      if (cells.length >= 2 && !/^-+$/.test(cells[0]) && cells[0] !== 'Question') decisions.push(plain(`${cells[0]}: ${cells[1]}`))
      const item = /^\s*(?:[-*]|\d+[.)])\s+(.+)$/.exec(row)
      if (item && !/^\[( |x|X)\]/.test(item[1])) decisions.push(plain(item[1]))
      continue
    }
    const head = /^###\s+Task\s+(\d+):\s*(.+)$/.exec(row)
    if (head) { tasks.push({ title: `${head[1]} ${head[2].trim()}`, done: 0, total: 0 }); continue }
    const box = /^\s*- \[( |x|X)\]/.exec(row)
    const task = tasks[tasks.length - 1]
    if (box && task) { task.total += 1; if (box[1] !== ' ') task.done += 1 }
  }
  return decisions.length ? { name, tasks, decisions: decisions.slice(-5) } : { name, tasks }
}

/** The plan most recently changed under docs/superpowers/plans in the window's folder. */
/** The newest plan in <folder>/docs/superpowers/plans by mtime, as an absolute path. */
export async function newestPlanFile(folder: string): Promise<string | undefined> {
  const dir = path.join(folder, 'docs', 'superpowers', 'plans')
  let names: string[] = []
  try { names = (await fs.promises.readdir(dir)).filter(n => n.endsWith('.md')) } catch { return undefined }
  let newest: { file: string; mtime: number } | undefined
  for (const name of names) {
    const file = path.join(dir, name)
    const st = await fs.promises.stat(file).catch(() => undefined)
    if (st && (!newest || st.mtimeMs > newest.mtime)) newest = { file, mtime: st.mtimeMs }
  }
  return newest?.file
}

export async function newestPlan(workspace: string | undefined): Promise<PlanView | null> {
  const file = workspace ? await newestPlanFile(workspace) : undefined
  return file ? parsePlan(path.basename(file), await fs.promises.readFile(file, 'utf8')) : null
}

// ─── Dev servers ─────────────────────────────────────────────────────────────

export function parseLsof(out: string): Omit<Server, 'folder'>[] {
  const found: Omit<Server, 'folder'>[] = []
  let pid = 0
  let command = ''
  for (const row of out.split('\n')) {
    if (row.startsWith('p')) pid = Number(row.slice(1))
    else if (row.startsWith('c')) command = row.slice(1)
    else if (row.startsWith('n')) {
      const port = Number(/:(\d+)$/.exec(row)?.[1])
      if (port && DEV.test(command) && !found.some(s => s.port === port)) found.push({ pid, command, port })
    }
  }
  return found.sort((a, b) => a.port - b.port)
}

export function parseNetstat(netstat: string, tasklistCsv: string): Omit<Server, 'folder'>[] {
  const names = new Map<number, string>()
  for (const row of tasklistCsv.split(/\r?\n/).slice(1)) {
    const cells = row.split('","').map(c => c.replace(/^"|"$/g, ''))
    if (cells.length > 1) names.set(Number(cells[1]), cells[0].replace(/\.exe$/i, ''))
  }
  const found: Omit<Server, 'folder'>[] = []
  for (const row of netstat.split(/\r?\n/)) {
    const m = /^\s*TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i.exec(row)
    if (!m) continue
    const port = Number(m[1]), pid = Number(m[2]), command = names.get(pid) ?? ''
    if (DEV.test(command) && !found.some(s => s.port === port)) found.push({ pid, command, port })
  }
  return found.sort((a, b) => a.port - b.port)
}

const lastTwo = (p: string) => p.split(/[\\/]/).filter(Boolean).slice(-2).join('/')

/** What lsof printed; '' or part of it when it failed. */
export const readListeners = (fresh = false) => sharedRun('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn'], { ttlMs: 12_000, timeoutMs: 5000, fresh, partial: true })

export async function listServers(fresh = false): Promise<Server[]> {
  if (process.platform === 'win32') {
    const list = parseNetstat(await run('netstat', ['-ano', '-p', 'tcp']), await run('tasklist', ['/fo', 'csv']))
    return list.map(s => ({ ...s, folder: '' }))
  }
  const list = parseLsof(await readListeners(fresh))
  for (const pid of serverFolders.keys()) if (!list.some(s => s.pid === pid)) serverFolders.delete(pid)
  return Promise.all(list.map(async s => {
    let cwd = serverFolders.get(s.pid)
    if (cwd === undefined) {
      const out = await run('lsof', ['-a', '-p', String(s.pid), '-d', 'cwd', '-Fn'])
      cwd = out.split('\n').find(l => l.startsWith('n'))?.slice(1) ?? ''
      serverFolders.set(s.pid, cwd)
    }
    return { ...s, folder: lastTwo(cwd), ...(cwd ? { cwd } : {}) }
  }))
}
// A server's cwd by pid: asked once per process, not on every refresh.
const serverFolders = new Map<number, string>()

// ─── Git ─────────────────────────────────────────────────────────────────────

export function parseGitStatus(out: string): GitState {
  const state: GitState = { changed: 0, staged: 0, untracked: 0 }
  for (const row of out.split('\n')) {
    if (row.startsWith('# branch.head ')) state.branch = row.slice(14).trim()
    else if (row.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(row)
      if (m) { state.ahead = Number(m[1]); state.behind = Number(m[2]) }
    } else if (row.startsWith('1 ') || row.startsWith('2 ') || row.startsWith('u ')) {
      state.changed += 1
      if (row[2] !== '.') state.staged += 1
    } else if (row.startsWith('? ')) state.untracked += 1
  }
  return state
}

export async function gitState(workspace: string | undefined): Promise<GitState | null> {
  if (!workspace) return null
  const out = await run('git', ['-C', workspace, 'status', '--porcelain=v2', '--branch'])
  return out ? parseGitStatus(out) : null
}

// ─── A chat's changes ────────────────────────────────────────────────────────

const DIFF_LINES = 300
const DIFF_BYTES = 24 * 1024
const FILES_MAX = 60
const UNTRACKED_BYTES = 256 * 1024

/** A relative path that stays inside the chat's folder. */
export function insideCwd(cwd: string, file: string): boolean {
  const api = process.platform === 'win32' ? path.win32 : path
  if (!file || api.isAbsolute(file)) return false
  return insidePath(cwd, api.resolve(cwd, file))
}

const capped = (lines: string[]): Pick<ChangedFile, 'diff' | 'note'> => {
  const text = lines.join('\n')
  return lines.length > DIFF_LINES || text.length > DIFF_BYTES
    ? { note: `This diff is too big to show here (${lines.length} lines). Open it in ${editor.name}.` }
    : { diff: text }
}

/**
 * Each changed file from `git diff HEAD --numstat` and `git diff HEAD` (run with --relative in the
 * chat's folder), then the untracked files; diffs start at the first hunk and are capped.
 */
export function parseChanges(numstat: string, diff: string, untracked: { path: string; text?: string; binary?: boolean; link?: boolean }[]): ChangedFile[] {
  // Keyed by the whole header: with --no-renames it is `a/<path> b/<path>`, looked up by numstat's path, so " b/" in a name cannot split it.
  const parts = new Map<string, { head: string[]; body: string[] }>()
  let cur: { head: string[]; body: string[] } | undefined
  for (const row of diff.split('\n')) {
    if (row.startsWith('diff --git ')) { cur = { head: [], body: [] }; parts.set(row.slice(11), cur); continue }
    if (!cur) continue
    if (cur.body.length || row.startsWith('@@')) cur.body.push(row)
    else cur.head.push(row)
  }
  const files: ChangedFile[] = []
  for (const row of numstat.split('\n')) {
    const m = /^(-|\d+)\t(-|\d+)\t(.+)$/.exec(row)
    if (!m) continue
    const file = m[3], part = parts.get(`a/${file} b/${file}`), head = part?.head ?? []
    const status = head.some(h => h.startsWith('new file')) ? 'added' : head.some(h => h.startsWith('deleted file')) ? 'deleted' : 'modified'
    const binary = m[1] === '-' || head.some(h => h.startsWith('Binary files'))
    const body = part?.body ?? []
    while (body.length && body[body.length - 1] === '') body.pop()
    files.push({ path: file, added: Number(m[1]) || 0, removed: Number(m[2]) || 0, status, ...(binary ? { note: 'Binary file: no text diff.' } : capped(body)) })
  }
  for (const u of untracked) {
    if (u.link) { files.push({ path: u.path, added: 0, removed: 0, status: 'untracked', note: 'Symlink, or a path that leads outside this folder: not shown.' }); continue }
    if (u.binary || u.text === undefined) { files.push({ path: u.path, added: 0, removed: 0, status: 'untracked', note: u.binary ? 'Binary file: no text diff.' : `This file is too big to show here. Open it in ${editor.name}.` }); continue }
    const lines = u.text.replace(/\n$/, '').split('\n')
    files.push({ path: u.path, added: lines.length, removed: 0, status: 'untracked', ...capped(lines.map(l => `+${l}`)) })
  }
  return files.filter(f => insideCwd('/c', f.path)).slice(0, FILES_MAX)
}

/**
 * The file's real path when it is a plain file (no symlink at the end) whose real path stays inside the folder's
 * real path, so a link in the path never leads out; undefined otherwise. Check this before reading or opening one.
 */
export async function safeFile(cwd: string, file: string): Promise<string | undefined> {
  if (!insideCwd(cwd, file)) return undefined
  try {
    const full = path.join(cwd, file)
    if ((await fs.promises.lstat(full)).isSymbolicLink()) return undefined
    const [real, root] = await Promise.all([fs.promises.realpath(full), fs.promises.realpath(cwd)])
    return insidePath(root, real) ? real : undefined
  } catch { return undefined }
}

/** The uncommitted changes in a chat's folder, tracked and untracked, only below that folder. */
export async function readChanges(cwd: string): Promise<ChangedFile[]> {
  const git = (...args: string[]) => run('git', ['-C', cwd, '-c', 'core.quotePath=false', ...args], 10000)
  const [numstat, diff, others] = await Promise.all([
    git('diff', 'HEAD', '--relative', '--no-renames', '--numstat'),
    git('diff', 'HEAD', '--relative', '--no-renames', '--no-color', '--no-ext-diff'),
    git('ls-files', '--others', '--exclude-standard'),
  ])
  const untracked = await Promise.all(others.split('\n').filter(f => f && insideCwd(cwd, f)).slice(0, FILES_MAX).map(async f => {
    try {
      const full = await safeFile(cwd, f)
      if (!full) return { path: f, link: true }
      if ((await fs.promises.stat(full)).size > UNTRACKED_BYTES) return { path: f }
      const buf = await fs.promises.readFile(full)
      return buf.includes(0) ? { path: f, binary: true } : { path: f, text: buf.toString('utf8') }
    } catch { return { path: f } }
  }))
  return parseChanges(numstat, diff, untracked)
}

// ─── The browser version ─────────────────────────────────────────────────────

// The standalone app (app/) is the only browser page with live data; it writes its address to web.url.
// The dev web (next dev) only ever shows sample data, and port 3000 belongs to another project.
const WEB_FILE = path.join(os.homedir(), '.claude', 'switchboard', 'web.url')
const announced = async () => (await fs.promises.readFile(WEB_FILE, 'utf8').catch(() => '')).trim() || undefined

/** True when the address answers /hub/state the way the app's own page asks for it. */
export async function servesLive(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/hub/state`, { headers: { 'x-switchboard': '1' }, signal: AbortSignal.timeout(800) })
    return r.ok && (r.headers.get('content-type') ?? '').includes('json')
  } catch { return false }
}

/** The first address with Switchboard's live page, or null when the app is not running. 3131 is tried too: web.url may name a copy that has gone. */
export async function webUrl(probe = servesLive, read = announced): Promise<string | null> {
  const urls = [await read(), 'http://127.0.0.1:3131', `http://127.0.0.1:${DEFAULT_RELAY_PORT}`].filter((u): u is string => !!u && !/:(3000|3010)$/.test(u))
  for (const url of new Set(urls)) if (await probe(url)) return url
  return null
}

const LAN_FILE = path.join(os.homedir(), '.claude', 'switchboard', 'web.lan')
const SECRET_FILE = path.join(os.homedir(), '.claude', 'switchboard', 'phone.secret')
const port = (u: string) => { try { return new URL(u).port } catch { return '' } }
const readTrim = (file: string) => async () => (await fs.promises.readFile(file, 'utf8').catch(() => '')).trim() || undefined

/** The phone link through tailscale serve (http while the tailnet has no certs), only when the running app was started with --lan (web.lan names its port).
 * Only problem when tailscale cannot serve it, empty before the first read, null when the app has no phone access. */
export async function phoneUrls(web: string | null, read = readTrim(LAN_FILE), secret = readTrim(SECRET_FILE), names: () => MacNames = macNames): Promise<PhoneUrls | null> {
  const lan = web ? await read() : undefined
  if (!lan || port(lan) !== port(web!)) return null
  const k = await secret()
  if (!k) return {}
  const n = names()
  if (!n.tailscale) return n.problem ? { problem: n.problem } : {}
  return { tailscaleName: `${n.https ? 'https' : 'http'}://${n.tailscale}/?k=${k}`, code: phoneCode(k) }
}

// VS Code's own binary runs as plain node (ELECTRON_RUN_AS_NODE), so no node on PATH is needed.
// Detached so the app outlives VS Code.
// The app's folder is its workspace; a computer with only the vsix has no checkout, so home then.
// The keeper (keeper/app-keeper.mjs) starts it again from the same launch, recorded in app.args.
const launchOf = (root: string, lan: boolean, app: string) => ({ cwd: fs.existsSync(root) ? root : HOME, args: [app, '-p', '3131', '--no-open', ...(lan ? ['--lan'] : [])] })
function spawnApp(root: string, lan: boolean, app: string): number | undefined {
  const { cwd, args } = launchOf(root, lan, app)
  const child = spawn(process.execPath, args, { cwd, detached: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  child.unref()
  return child.pid
}

const STAGE = path.join(os.homedir(), '.claude', 'switchboard', 'app')
const files = (dir: string) => (fs.readdirSync(dir, { recursive: true }) as string[]).filter(f => fs.statSync(path.join(dir, f)).isFile()).sort()
const sameTree = (a: string, b: string) => {
  try {
    const fa = files(a)
    return fa.join('\n') === files(b).join('\n') && fa.every(f => fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))))
  } catch { return false }
}

/** The bundled app copied out of the versioned extension folder, which VS Code deletes after an update while the
 * detached app still serves its webview files from disk. Copied again only when the bundle differs.
 * A running app keeps its old server code until it is restarted; only a fresh start picks up the copy. */
function stageApp(bundle: string, stage: string, version?: string): string {
  const src = path.dirname(bundle)
  // A window still on an older version never copies over a newer one.
  if (!(version && newerVersion(stagedVersion(stage) ?? '0', version)) && !sameTree(src, stage)) {
    fs.rmSync(stage, { recursive: true, force: true })
    fs.cpSync(src, stage, { recursive: true })
    if (version) fs.writeFileSync(`${stage}.version`, version)
  }
  return path.join(stage, path.basename(bundle))
}
// Beside the copy, not in it, so sameTree still compares only the bundle's files.
const stagedVersion = (stage: string) => { try { return fs.readFileSync(`${stage}.version`, 'utf8').trim() || undefined } catch { return undefined } }

/** One restart across windows: they all activate at once after an update. A lock older than a minute is left over. */
const lockRestart = (stage: string) => tryLock(`${stage}.lock`)

const NOT_RUNNING = 'the browser app is not running'
let starting: { p: Promise<{ url: string } | { problem: string }>; refresh: boolean } | undefined
// The app this extension started, so Phone or an update may restart it. A file, so it survives reloads and every
// window sees it. An app started by hand is never in it and is left alone.
const PID_FILE = path.join(os.homedir(), '.claude', 'switchboard', 'app.pid')
// Listening pids on a port. A pid that is gone or was reused by something else is not here.
const portListeners = async (p: string) => process.platform === 'win32'
  ? (await run('netstat', ['-ano', '-p', 'tcp'])).split(/\r?\n/).flatMap(row => {
    const m = /^\s*TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i.exec(row)
    return m && m[1] === p ? [Number(m[2])] : []
  })
  : (await run('lsof', ['-nP', `-iTCP:${p}`, '-sTCP:LISTEN', '-t'])).split('\n').filter(Boolean).map(Number)

type WebDeps = {
  find?: () => Promise<string | null>
  start?: (root: string, lan: boolean, app: string) => number | undefined | void
  /** The app.js shipped in the vsix (dist/app); the checkout's build is the fallback. */
  bundle?: string
  /** Where the bundled app is copied to and run from. */
  stage?: string
  stop?: (pid: number) => void
  lan?: (web: string) => Promise<unknown>
  listeners?: (port: string) => Promise<number[]>
  pidFile?: string
  tries?: number
  waitMs?: number
  /** Only restart our running app when this version is newer than its copy's; never start one. */
  refresh?: boolean
  /** This extension's version; the copy records the one it came from. */
  version?: string
  /** A same-version rebuild restarts the app too; off for a dev host, which would take turns with the installed build. */
  rebuilds?: boolean
  command?: (pid: number) => Promise<string>
}

/** The app's address, started in the background from root first when it is not running. One start at a time.
 * phone starts it with --lan, restarting an app this extension started without it. Our app running a copy that
 * differs from a bundle no older than it is restarted, keeping --lan, so an update reaches the browser and the phone. */
export function ensureWeb(root: string, phone = false, deps: WebDeps = {}): Promise<{ url: string } | { problem: string }> {
  const { find = () => webUrl(), start = spawnApp, stop = (pid: number) => process.kill(pid), lan = (w: string) => phoneUrls(w),
    listeners = portListeners, pidFile = PID_FILE, tries = 25, waitMs = 200, bundle, stage = STAGE, refresh = false, version, rebuilds = true, command = (pid: number) => process.platform === 'win32'
      ? run('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`])
      : run('ps', ['-o', 'command=', '-p', String(pid)]) } = deps
  const wait = async (done: () => Promise<boolean>) => {
    for (let i = 0; i < tries; i++) {
      await new Promise(r => setTimeout(r, waitMs))
      if (await done()) return true
    }
    return false
  }
  // Ours: the pid file's pid, else a listener running our copy (an app started before the pid file covered --lan).
  const ours = async (url: string) => {
    const pid = Number(await fs.promises.readFile(pidFile, 'utf8').catch(() => ''))
    const on = await listeners(port(url))
    if (pid > 0 && on.includes(pid)) return pid
    const app = ` ${path.join(stage, 'app.js')} `
    for (const p of on) if ((process.platform === 'win32' ? (await command(p)).toLowerCase().replace(/\\/g, '/') : await command(p)).includes(process.platform === 'win32' ? app.toLowerCase().replace(/\\/g, '/') : app)) return p
    return undefined
  }
  const remember = (pid: number | undefined) => {
    try {
      if (pid) { fs.mkdirSync(path.dirname(pidFile), { recursive: true }); fs.writeFileSync(pidFile, String(pid)) } else fs.rmSync(pidFile, { force: true })
    } catch { /* Phone then shows the stop message */ }
  }
  const argsFile = path.join(path.dirname(pidFile), 'app.args')
  const recorded = () => { try { return JSON.parse(fs.readFileSync(argsFile, 'utf8')) as { args?: string[] } } catch { return undefined } }
  const record = (launch: { cwd: string; args: string[] }) => {
    try { fs.mkdirSync(path.dirname(argsFile), { recursive: true }); fs.writeFileSync(argsFile, JSON.stringify(launch)) } catch { /* keeper waits for the next start */ }
  }
  // A click never takes a refresh's answer: it waits for it, then asks again.
  if (starting?.refresh && !refresh) return starting.p.then(() => ensureWeb(root, phone, deps))
  if (starting) return starting.p
  let unlock: (() => void) | undefined
  const p = (async () => {
    let running = await find()
    if (!running && refresh) return { problem: NOT_RUNNING }
    let restart: string | undefined
    const hasLan = !!running && !!(await lan(running))
    // An app from before app.args existed: record it so the keeper can bring it back.
    if (running && !recorded() && fs.existsSync(path.join(stage, 'app.js'))) record(launchOf(root, hasLan, path.join(stage, 'app.js')))
    let stale = false
    // Newer than the copy, or the same version reinstalled with rebuilt files.
    const staged = stagedVersion(stage)
    if (running && version && bundle && fs.existsSync(bundle) && (newerVersion(version, staged) || (rebuilds && staged === version))) {
      stale = !sameTree(path.dirname(bundle), stage)
      // Same app files: only the label moves on, no restart.
      if (!stale) try { fs.writeFileSync(`${stage}.version`, version) } catch { /* checked again next time */ }
    }
    let pid = running && ((phone && !hasLan) || stale) ? await ours(running) : undefined
    if (pid && !(unlock = lockRestart(stage))) pid = undefined
    if (refresh && !pid) return { url: running! }
    // Nothing running (a reboot, a crash): the last start's --lan still holds.
    const lanNow = phone || hasLan || (!running && !!recorded()?.args?.includes('--lan'))
    if (pid) {
      try { stop(pid) } catch { /* already gone */ }
      remember(undefined)
      // Not find(): it falls back to whatever answers on 3001.
      const p = port(running!)
      if (!(await wait(async () => !(await listeners(p)).includes(pid)))) return { problem: 'the browser app did not stop for the phone restart' }
      restart = p
      running = null
    }
    if (running) return { url: running }
    const built = path.join(root, 'app', 'dist', 'app.js')
    let app = built
    // A failed copy falls back to the checkout's build.
    if (bundle && fs.existsSync(bundle)) try { app = stageApp(bundle, stage, version) } catch { /* checkout */ }
    if (!fs.existsSync(app)) return { problem: `the browser app is not built: ${built} is missing. Run pnpm build:app in ${root}` }
    const started = start(root, lanNow, app)
    record(launchOf(root, lanNow, app))
    let url: string | null = null
    // After a restart, only our port counts.
    if (await wait(async () => !!(url = await find()) && (!restart || port(url) === restart))) {
      // Several windows start at once after a reboot; only the one whose app got the port writes its pid.
      if (started && (await listeners(port(url!))).includes(started)) remember(started)
      return { url: url! }
    }
    return { problem: 'the browser app did not start on port 3131' }
  })().finally(() => { starting = undefined; unlock?.() })
  starting = { p, refresh }
  return p
}

/** A refresh that also starts the app when it is down: after a reboot or a crash, and where launchd does not keep it up. */
export async function keepWeb(root: string, deps: WebDeps & { installed?: boolean } = {}): Promise<{ url: string } | { problem: string }> {
  const r = await ensureWeb(root, false, { ...deps, refresh: true })
  if (!('problem' in r) || r.problem !== NOT_RUNNING) return r
  // A dev host never starts it: that is the installed build's job, like the keeper.
  if (deps.installed === false) return r
  // Keep Switchboard app running off (app.nokeep beside app.pid): a stopped app stays stopped.
  if (fs.existsSync(path.join(path.dirname(deps.pidFile ?? PID_FILE), 'app.nokeep'))) return r
  // Held but not answering as live (a window hub refusing): a second app would only die on EADDRINUSE.
  if ((await (deps.listeners ?? portListeners)('3131')).length) return { problem: 'port 3131 is taken but does not answer' }
  return ensureWeb(root, false, { ...deps, refresh: false })
}

/**
 * keepWeb again while it answers a problem. Right after an update every window reloads at once: the app's /hub/state
 * only proxies to a window, so it fails as not live and keepWeb gives up on a held 3131. Every retryMs, retries times.
 */
export async function keepWebRetrying(root: string, deps: Parameters<typeof keepWeb>[1] & { retries?: number; retryMs?: number } = {}): Promise<{ url: string } | { problem: string }> {
  const { retries = 8, retryMs = 15_000 } = deps
  for (let i = 0; ; i++) {
    const r = await keepWeb(root, deps)
    if (!('problem' in r) || i >= retries) return r
    await new Promise(res => setTimeout(res, retryMs))
  }
}

// ─── Installed and connections ───────────────────────────────────────────────

async function skillName(dir: string): Promise<string> {
  const text = await fs.promises.readFile(path.join(dir, 'SKILL.md'), 'utf8').catch(() => '')
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
  return /^name:\s*["']?([^"'#\r\n]+?)["']?\s*(?:#.*)?$/m.exec(front)?.[1] ?? path.basename(dir)
}

const DESC_MAX = 160
const cut = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, DESC_MAX) : undefined)
/** A SKILL.md's frontmatter description, one line. */
// A frontmatter description, plain or a YAML block (>- or |) of indented lines.
function frontDescription(text: string): string | undefined {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
  const m = /^description:[ \t]*(.*)$/m.exec(front)
  if (!m) return undefined
  if (!/^[>|][-+]?$/.test(m[1].trim())) return cut(m[1].trim().replace(/^["']|["']$/g, ''))
  const rest = front.slice(m.index + m[0].length).split(/\r?\n/).slice(1)
  const end = rest.findIndex(l => !/^\s/.test(l))
  return cut((end < 0 ? rest : rest.slice(0, end)).join(' '))
}

async function skillDescription(dir: string): Promise<string | undefined> {
  return frontDescription(await fs.promises.readFile(path.join(dir, 'SKILL.md'), 'utf8').catch(() => ''))
}

const paths = (v: unknown) => [v].flat().filter((d): d is string => typeof d === 'string')
const mdNames = async (dir: string) => (await fs.promises.readdir(dir).catch(() => [] as string[])).filter(n => n.endsWith('.md')).map(n => n.slice(0, -3))

/** The plugin:name entries Claude Code lists: skills in <root>/skills plus plugin.json's skills paths, and commands. */
async function pluginNames(root: string, manifest: Record<string, unknown> | undefined): Promise<string[]> {
  const out: string[] = []
  for (const dir of new Set([path.join(root, 'skills'), ...paths(manifest?.skills).map(d => path.resolve(root, d))])) {
    // A declared path can be one skill folder or a folder of them. existsSync follows symlinked skill folders.
    const folders = fs.existsSync(path.join(dir, 'SKILL.md')) ? [dir]
      : (await fs.promises.readdir(dir).catch(() => [] as string[])).filter(n => !n.startsWith('.')).map(n => path.join(dir, n))
    for (const f of folders) if (fs.existsSync(path.join(f, 'SKILL.md'))) out.push(await skillName(f))
  }
  // plugin.json commands replaces commands/: a path, a list of paths, or a map keyed by name.
  const cmds = manifest?.commands
  if (cmds && typeof cmds === 'object' && !Array.isArray(cmds)) out.push(...Object.keys(cmds))
  else for (const p of cmds ? paths(cmds).map(c => path.resolve(root, c)) : [path.join(root, 'commands')]) out.push(...(p.endsWith('.md') ? [path.basename(p, '.md')] : await mdNames(p)))
  return [...new Set(out)]
}

/** Every plugin in enabledPlugins or installed_plugins.json, with its user (else first) install folder. */
async function plugins(claude: string): Promise<{ id: string; on: boolean; dir?: string; manifest?: Record<string, unknown> }[]> {
  const enabled = ((await readJson(path.join(claude, 'settings.json')))?.enabledPlugins ?? {}) as Record<string, boolean>
  const installs = ((await readJson(path.join(claude, 'plugins', 'installed_plugins.json')))?.plugins ?? {}) as Record<string, { scope?: string; installPath?: string }[]>
  // Installed but never named in enabledPlugins counts as off.
  return Promise.all([...new Set([...Object.keys(enabled), ...Object.keys(installs)])].map(async id => {
    const entries = installs[id] ?? []
    const dir = (entries.find(e => e.scope === 'user') ?? entries[0])?.installPath
    return { id, on: enabled[id] === true, dir, manifest: dir ? await readJson(path.join(dir, '.claude-plugin', 'plugin.json')) : undefined }
  }))
}

/** MCP servers that enabled plugins bring: <root>/.mcp.json and plugin.json mcpServers (a map or a path to one). */
export async function pluginMcp(claude = CLAUDE): Promise<Connection[]> {
  const out: Connection[] = []
  const names = (v: unknown) => { const o = (v ?? {}) as Record<string, unknown>; return Object.keys((o.mcpServers ?? o) as object) }
  for (const p of await plugins(claude)) {
    if (!p.on || !p.dir) continue
    const declared = p.manifest?.mcpServers
    const files = [path.join(p.dir, '.mcp.json'), ...paths(declared).map(f => path.resolve(p.dir!, f))]
    // Inline maps, alone or mixed into an array with file paths.
    const found = (Array.isArray(declared) ? declared : [declared]).flatMap(d => d && typeof d === 'object' ? Object.keys(d) : [])
    for (const f of files) found.push(...names(await readJson(f)))
    for (const name of new Set(found)) out.push({ kind: 'mcp', name, status: 'on', detail: p.id.split('@')[0] })
  }
  return out
}

/** Skill name to where it came from, per kit/setup.json: switchboard for Kenneth's own, the author for a bundled third-party one, owner/repo for a fetched one. Beside dist/ in the VSIX, two up from src/hub in tests. */
// Third-party skills shipped in "own": their author, not switchboard. Keep in step with NOTICE.
const OWN_AUTHORS: Record<string, string> = Object.fromEntries([
  ...['accessibility', 'click-path-audit', 'e2e-testing'].map(n => [n, 'ECC (Affaan Mustafa)']),
  ...['accessible-motion', 'hover-interactions', 'page-transitions', 'scroll-animations'].map(n => [n, 'Dylan Tarre']),
])

function kitSources(): Record<string, string> {
  for (const f of [path.join(__dirname, '..', 'kit', 'setup.json'), path.join(__dirname, '..', '..', 'kit', 'setup.json')]) {
    try {
      const k = JSON.parse(fs.readFileSync(f, 'utf8')) as { own?: string[]; skills?: { repo: string; names: string[] }[]; tools?: { skill?: { repo: string; name: string } }[] }
      return Object.fromEntries([
        ...(k.own ?? []).map(n => [n, OWN_AUTHORS[n] ?? 'switchboard']),
        ...(k.skills ?? []).flatMap(r => r.names.map(n => [n, r.repo])),
        ...(k.tools ?? []).flatMap(t => t.skill ? [[t.skill.name, t.skill.repo]] : []),
      ])
    } catch { /* next */ }
  }
  return {}
}

// Built-in tools that load whole into every chat (Artifact 12.7k tokens, the rest 0.8k to 2k), off until a first message needs one.
// about: what Jev and the chat read; now: what a chat that started without it does, a headless call when unset.
export const BUILTINS: Record<string, { about: string; now?: string }> = {
  Artifact: { about: 'publish an HTML page to claude.ai, or upload an image or file into a Claude Docs document' },
  Workflow: { about: 'run a scripted multi-agent workflow, only when the user asks for one', now: 'use Agent subagents' },
  ScheduleWakeup: { about: 'self-paced /loop: wake up later and check again', now: 'use CronCreate or Monitor' },
  ReportFindings: { about: 'typed findings list for the built-in code review', now: 'give the findings as text' },
  SendFeedback: { about: 'draft feedback about Claude Code itself', now: 'give the user the text to send' },
}

// What Jev reads for the servers Set up adds; any other server goes by its name.
const MCP_ABOUT: Record<string, string> = {
  posthog: 'PostHog product analytics', composio: 'actions in outside apps (Gmail, Slack, Notion and others)',
  scrapling: 'scrape web pages past bot protection', cloudflare: 'Cloudflare API and docs',
  'claude.ai Claude Docs': 'write, edit and share Claude Docs documents', 'claude.ai Google Drive': 'read and edit Google Drive files',
}

/** Claude Code's own heavy tools and the user's MCP servers and claude.ai connectors, for smart select. switchboard is never off. */
async function extras(claude: string): Promise<Installed[]> {
  const j = await fs.promises.readFile(`${claude}.json`, 'utf8').then(t => JSON.parse(t) as { mcpServers?: object; claudeAiMcpEverConnected?: unknown }).catch(() => undefined)
  const ai = Array.isArray(j?.claudeAiMcpEverConnected) ? j.claudeAiMcpEverConnected.filter((n): n is string => typeof n === 'string' && n.startsWith('claude.ai ')) : []
  const servers = [...Object.keys(j?.mcpServers ?? {}).filter(n => n !== 'switchboard'), ...ai]
  return [
    ...Object.entries(BUILTINS).map(([name, b]): Installed => ({ kind: 'builtin', name, enabled: true, source: 'Claude Code', description: b.about })),
    ...servers.map((n): Installed => ({ kind: 'mcp', name: `mcp:${n}`, enabled: true, source: 'user', ...(MCP_ABOUT[n] ? { description: MCP_ABOUT[n] } : {}) })),
  ]
}

/** sources: skill name to its source label; the rest are the user's. */
export async function installed(claude = CLAUDE, sources = kitSources()): Promise<Installed[]> {
  const out: Installed[] = []
  for (const p of await plugins(claude)) {
    const skills = p.dir ? await pluginNames(p.dir, p.manifest) : []
    const description = cut(p.manifest?.description)
    out.push({ kind: p.id.endsWith('@kenneth-mods') ? 'mod' : 'plugin', name: p.id, enabled: p.on, source: p.id.split('@')[1], ...(skills.length ? { skills } : {}), ...(description ? { description } : {}), ...(p.dir ? { path: p.dir } : {}) })
  }
  const list = (dir: string) => fs.promises.readdir(path.join(claude, dir)).catch(() => [] as string[])
  for (const [dir, enabled] of [['skills', true], ['skills-archive', false]] as const) {
    for (const name of await list(dir)) {
      if (name.startsWith('.') || !fs.existsSync(path.join(claude, dir, name, 'SKILL.md'))) continue
      const description = enabled ? await skillDescription(path.join(claude, dir, name)) : undefined
      out.push({ kind: 'skill', name, enabled, source: sources[name] ?? 'user', ...(description ? { description } : {}) })
    }
  }
  for (const f of await list('agents')) {
    if (!f.endsWith('.md')) continue
    const text = await fs.promises.readFile(path.join(claude, 'agents', f), 'utf8').catch(() => '')
    const model = modelOf(text)
    const cx = codexOf(text)
    out.push({ kind: 'role', name: f.slice(0, -3), enabled: true, ...(model ? { model } : {}), ...(cx ? { codex: true } : {}), ...(cx?.model ? { codexModel: cx.model } : {}), ...(cx?.effort ? { codexEffort: cx.effort } : {}) })
  }
  for (const f of await list('jev-presets')) if (f.endsWith('.json')) out.push({ kind: 'preset', name: f.slice(0, -5), enabled: true })
  out.push(...await extras(claude))
  // Only tools held at intake are hashed, so this stays cheap.
  const sweep = readSweep(path.dirname(claude))
  for (const i of out) {
    const rec = sweep[i.name]
    if (!rec?.hold || (i.kind !== 'plugin' && i.kind !== 'skill')) continue
    const dir = i.kind === 'plugin' ? i.path : path.join(claude, i.enabled ? 'skills' : 'skills-archive', i.name)
    if (needsApproval(rec, dir && fs.existsSync(dir) ? digest(dir) : undefined)) i.held = true
  }
  return out
}

/** A design file's frontmatter description, else its first heading. */
async function mdTitle(file: string): Promise<string | undefined> {
  const text = await fs.promises.readFile(file, 'utf8').catch(() => '')
  return frontDescription(text) ?? cut(/^#+\s+(.+)$/m.exec(text)?.[1])
}

/**
 * A project's own skills (.claude/skills, then .agents/skills, first name wins; symlinks followed) and its
 * design references: design-md/<brand>/ (DESIGN.md, else its first .md), docs/design/*.md, DESIGN.md.
 */
export async function projectInventory(folder: string, lib = LIBRARY): Promise<Installed[]> {
  const out: Installed[] = []
  const ls = (rel: string) => fs.promises.readdir(path.join(folder, rel)).catch(() => [] as string[])
  const seen = new Set<string>()
  for (const rel of ['.claude/skills', '.agents/skills']) {
    for (const name of (await ls(rel)).sort()) {
      const dir = path.join(folder, rel, name)
      if (name.startsWith('.') || seen.has(name) || !fs.existsSync(path.join(dir, 'SKILL.md'))) continue
      seen.add(name)
      const description = await skillDescription(dir)
      out.push({ kind: 'skill', name, enabled: true, source: 'project', ...(description ? { description } : {}) })
    }
  }
  const asset = async (name: string, rel: string) => {
    const description = await mdTitle(path.join(folder, rel))
    out.push({ kind: 'asset', name, enabled: true, source: 'project', path: rel, ...(description ? { description } : {}) })
  }
  const brands = (await ls('design-md')).sort(), copies = libraryCopies(brands, lib)
  for (const brand of brands) {
    if (brand.startsWith('.') || copies.has(brand) || !fs.statSync(path.join(folder, 'design-md', brand), { throwIfNoEntry: false })?.isDirectory()) continue
    const mds = (await ls(`design-md/${brand}`)).filter(n => n.endsWith('.md')).sort()
    const pick = mds.includes('DESIGN.md') ? 'DESIGN.md' : mds[0]
    if (pick) await asset(brand, `design-md/${brand}/${pick}`)
  }
  for (const f of (await ls('docs/design')).filter(n => n.endsWith('.md')).sort()) await asset(f.slice(0, -3), `docs/design/${f}`)
  if (fs.existsSync(path.join(folder, 'DESIGN.md'))) await asset('DESIGN', 'DESIGN.md')
  return out
}

// The bundled design library (kit/design-md), copied here so chats can read it by absolute path.
export const LIBRARY = path.join(CLAUDE, 'switchboard', 'design-md')

/** Brands of a project's design-md that are a copy of the library, which the library already lists by absolute path. */
// ponytail: more than 3 brands also in the library counts as a copy; a project that chose a few keeps them.
export function libraryCopies(brands: string[], lib = LIBRARY): Set<string> {
  const have = new Set(fs.existsSync(lib) ? fs.readdirSync(lib) : [])
  const same = brands.filter(b => have.has(b))
  return new Set(same.length > 3 ? same : [])
}

// The running copy; libraryInventory waits on it, since a copy empties the folder first.
let syncing: Promise<unknown> = Promise.resolve()

/** Replaces dir with src when their VERSION stamps differ; true when it copied. Stamp written last, so a cut copy retries. */
export function syncLibrary(src: string, dir = LIBRARY): Promise<boolean> {
  const run = copyLibrary(src, dir)
  syncing = run.catch(() => false)
  return run
}

async function copyLibrary(src: string, dir: string): Promise<boolean> {
  const stamp = (d: string) => fs.promises.readFile(path.join(d, 'VERSION'), 'utf8').catch(() => undefined)
  const v = await stamp(src)
  if (!v || await stamp(dir) === v) return false
  await fs.promises.rm(dir, { recursive: true, force: true })
  await fs.promises.cp(src, dir, { recursive: true, filter: f => path.basename(f) !== 'VERSION' })
  await fs.promises.writeFile(path.join(dir, 'VERSION'), v)
  return true
}

/** Library brands with a DESIGN.md, off by default in a chat's tool pick. */
export async function libraryInventory(dir = LIBRARY): Promise<Installed[]> {
  await syncing
  const out: Installed[] = []
  for (const brand of (await fs.promises.readdir(dir).catch(() => [] as string[])).sort()) {
    const file = path.join(dir, brand, 'DESIGN.md')
    if (brand.startsWith('.') || !fs.existsSync(file)) continue
    const description = await mdTitle(file)
    out.push({ kind: 'asset', name: brand, enabled: true, source: 'library', path: file, ...(description ? { description } : {}) })
  }
  return out
}

/** -Users-k-Documents-GitHub-Armasu -> Armasu (the folder name Claude Code made from the path). */
export function decodeProjectDir(dir: string): string {
  const parts = dir.split('-').filter(Boolean)
  return parts[parts.length - 1] ?? dir
}

/** Folders to open: git repos under the roots, every folder Claude Code has run in that still exists, and the research folder always. */
export async function projectFolders(repoRoots: string[], research = RESEARCH_ROOT): Promise<{ repos: string[]; claude: string[] }> {
  const repos: string[] = []
  for (const root of repoRoots) {
    const names = await fs.promises.readdir(root).catch(() => [] as string[])
    for (const n of names.sort((a, b) => a.localeCompare(b))) if (fs.existsSync(path.join(root, n, '.git'))) repos.push(path.join(root, n))
  }
  const global = await readJson(path.join(HOME, '.claude.json'))
  // Scratch and temp folders are where chats ran, not projects to come back to.
  const claude = Object.keys((global?.projects ?? {}) as object)
    .filter(p => p !== HOME && !isTempDir(p) && fs.existsSync(p))
  // A home that cannot hold the folder must not take the whole project list with it.
  let root: string | undefined
  try { root = ensureResearchRoot(research) } catch { /* no research row */ }
  return { repos, claude: !root || claude.includes(root) ? claude : [...claude, root] }
}

export async function connections(repoRoots: string[]): Promise<Connection[]> {
  const out: Connection[] = []
  const global = await readJson(path.join(HOME, '.claude.json'))
  for (const name of Object.keys((global?.mcpServers ?? {}) as object)) out.push({ kind: 'mcp', name, status: 'on', detail: 'user' })
  for (const c of await pluginMcp()) if (!out.some(o => o.name === c.name)) out.push(c)
  for (const [proj, v] of Object.entries((global?.projects ?? {}) as Record<string, { mcpServers?: object }>)) {
    for (const name of Object.keys(v.mcpServers ?? {})) out.push({ kind: 'mcp', name, status: 'on', detail: path.basename(proj) })
  }
  let projects: string[] = []
  try { projects = await fs.promises.readdir(path.join(CLAUDE, 'projects')) } catch { /* none */ }
  // Dir names are the cwd with / and . as -, so the temp prefix still reads; bench-kit needs its own check.
  for (const p of projects) if (!p.startsWith('.') && !p.includes('-claude-bench-kit') && !isTempDir(p.replace(/-/g, '/'))) out.push({ kind: 'project', name: decodeProjectDir(p), status: 'on', detail: 'Claude Code history' })
  let windows: string[] = []
  try { windows = (await fs.promises.readdir(path.join(CLAUDE, 'switchboard'))).filter(n => /-\d+\.json$/.test(n)) } catch { /* none */ }
  for (const w of windows) {
    const f = await readJson(path.join(CLAUDE, 'switchboard', w))
    if (typeof f?.workspace === 'string') out.push({ kind: 'window', name: path.basename(f.workspace), status: 'on', detail: 'Switchboard window' })
  }
  for (const root of repoRoots) {
    let names: string[] = []
    try { names = await fs.promises.readdir(root) } catch { continue }
    for (const n of names) {
      if (fs.existsSync(path.join(root, n, '.git'))) out.push({ kind: 'repo', name: n, status: 'on', detail: path.basename(root) })
    }
  }
  return out
}
