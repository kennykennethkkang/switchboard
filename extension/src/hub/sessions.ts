/**
 * Running Claude Code chats, read from ~/.claude/sessions/<pid>.json, as the
 * Chats rows: connected to Remote Control or not, the link into the Claude app,
 * and why a chat may be missing there. Also the Remote Control server command.
 * Key files beside them are never opened. Called from hub-panel.ts.
 */
import * as fs from 'fs'
import { execFile } from 'child_process'
import * as os from 'os'
import * as path from 'path'
import { containerChats, DATA } from './devcontainer'
import { ask } from './projects'
import { sharedRun } from './shared-run'
import type { ChatRow } from './types'

const DIR = path.join(os.homedir(), '.claude', 'sessions')
const QUIET_MS = 30 * 60 * 1000
const CHAT_LINK = (bridge?: string) => (bridge ? `https://claude.ai/code/${bridge}` : 'https://claude.ai/code')
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

export function newer(a: string, b: string): boolean {
  const x = a.split('.').map(Number), y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  }
  return false
}

/** started: whether the session has a prompt in its transcript yet. A file marked container: its pid is inside the container, so the row gets pid 0. */
export function chatRows(files: Record<string, unknown>[], alive: (pid: number, f: Record<string, unknown>) => boolean, now = Date.now(), started: (f: { sessionId: string; cwd: string }) => boolean = () => true): ChatRow[] {
  const all = files.flatMap(f => {
    const pid = f.pid, sessionId = str(f.sessionId)
    if (typeof pid !== 'number' || !sessionId) return []
    // sdk-cli without a bridge is a headless `claude -p` (bench runs); with one but nothing said yet, Remote Control's idle standby.
    if (f.entrypoint === 'sdk-cli' && (!str(f.bridgeSessionId) || !started({ sessionId, cwd: str(f.cwd) ?? '' }))) return []
    const updatedAt = typeof f.updatedAt === 'number' ? f.updatedAt : undefined, box = f.container === true
    return [{ pid: box ? 0 : pid, ...(box ? { container: true as const } : {}), sessionId, name: str(f.name), cwd: str(f.cwd) ?? '', status: str(f.status), statusAt: typeof f.statusUpdatedAt === 'number' ? f.statusUpdatedAt : undefined, waitingFor: str(f.waitingFor), version: str(f.version), kind: str(f.kind), updatedAt, bridgeId: str(f.bridgeSessionId), live: alive(pid, f) }]
  })
  // A killed chat that was resumed leaves its old file: dead rows drop when the session runs elsewhere, else the newest stays.
  // Several live rows are real (the Claude panel and a terminal), so they all stay.
  const running = new Set(all.filter(r => r.live).map(r => r.sessionId))
  const dead = new Map<string, (typeof all)[number]>()
  for (const r of all) if (!r.live && !running.has(r.sessionId) && (r.updatedAt ?? 0) >= (dead.get(r.sessionId)?.updatedAt ?? -1)) dead.set(r.sessionId, r)
  const rows = all.filter(r => r.live || dead.get(r.sessionId) === r)
  const newest = rows.map(r => r.version).filter((v): v is string => !!v).reduce<string | undefined>((m, v) => (!m || newer(v, m) ? v : m), undefined)
  return rows.map(r => {
    const why: string[] = []
    if (!r.bridgeId) why.push('not connected')
    if (!r.live) why.push('process gone')
    if (r.updatedAt !== undefined && now - r.updatedAt > QUIET_MS) why.push(`quiet for ${Math.round((now - r.updatedAt) / 60_000)} min`)
    if (r.version && newest && newer(newest, r.version)) why.push(`older Claude Code (${r.version})`)
    if (r.kind && r.kind !== 'interactive') why.push('not an interactive chat')
    return { ...r, link: CHAT_LINK(r.bridgeId), why }
  })
}

/** Live chats Remote Control should connect; a connected chat is never sent rc, which would disconnect it. */
export const rcTargets = (rows: ChatRow[]) => rows.filter(r => r.live && !r.bridgeId).map(r => r.sessionId)

/** The machine's one Remote Control server, started in ~/Documents/GitHub by the kit's LaunchAgent or the gear switch. */
export const RC_NAME = 'Mac'

/** same-dir: phone chats start in the GitHub folder and can work in any repo under it. */
export const rcServerCommand = () => `claude remote-control --name '${RC_NAME}' --spawn same-dir --permission-mode ${ask.claude ? 'default' : ask.auto ? 'auto' : 'bypassPermissions'}`

/** `pgrep -f` pattern for a Remote Control server named `name`, as the kit's LaunchAgent starts it. */
export const rcPattern = (name: string) => `remote-control --name ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`

/** Windows has no pgrep -f: every process as "pid command line", as the kit's rc-servers.mjs lists them. */
const PS_LIST = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }'
/** Whether a PS_LIST listing holds the server; cmd.exe and claude both carry its command line. */
export const rcInList = (ps: string, name = RC_NAME) => new RegExp(rcPattern(name), 'm').test(ps.replace(/\r/g, ''))

const psList = () => new Promise<string>((resolve, reject) =>
  execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', PS_LIST], { windowsHide: true, timeout: 15_000, maxBuffer: 8 << 20 }, (err, out) => (err ? reject(err) : resolve(String(out)))))

const pgrep = (fresh = false) => sharedRun('pgrep', ['-f', rcPattern(RC_NAME)], {
  ttlMs: 12_000, timeoutMs: 2000, fresh,
  run: (file, args, timeoutMs) => new Promise<string>((resolve, reject) => execFile(file, args, { timeout: timeoutMs }, (err, out) => {
    if (!err) resolve(String(out).trim() ? '1' : '0')
    else if (String((err as NodeJS.ErrnoException).code) === '1') resolve('0')
    else reject(err)
  })),
}).then(value => value === '1')

let rcSeen = false, listing = false
/** The Remote Control server running as a process, whoever started it. */
export function rcRunning(platform: NodeJS.Platform = process.platform): boolean {
  // Answers the last listing, since powershell takes a second and this runs on every refresh; rcRunningNow waits.
  if (!listing) {
    listing = true
    const now = platform === 'win32' ? psList().then(out => rcInList(out)) : pgrep()
    now.then(on => { rcSeen = on }, () => {}).finally(() => { listing = false })
  }
  return rcSeen
}

/** rcRunning from a fresh listing, for the on/off switch. */
export async function rcRunningNow(platform: NodeJS.Platform = process.platform, list = psList): Promise<boolean> {
  try { rcSeen = platform === 'win32' ? rcInList(await list()) : await pgrep(true) } catch { /* keep the last answer */ }
  return rcSeen
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' } }

async function readFiles(dir: string): Promise<Record<string, unknown>[]> {
  const names = await fs.promises.readdir(dir).catch(() => [] as string[])
  const files: Record<string, unknown>[] = []
  for (const n of names) {
    if (!/^\d+\.json$/.test(n)) continue
    try { files.push(JSON.parse(await fs.promises.readFile(path.join(dir, n), 'utf8'))) } catch { /* mid-write */ }
  }
  return files
}

// Every refresh reads chats, so Docker is asked at most every 10 s, and never with no container chat files.
let boxes: { at: number; live: Promise<Set<string>> } | undefined
const liveBoxes = () => {
  if (!boxes || Date.now() - boxes.at > 10_000) boxes = { at: Date.now(), live: containerChats().catch(() => new Set<string>()) }
  return boxes.live
}

export async function readChats(): Promise<ChatRow[]> {
  // Claude in a container writes its session file to DATA/sessions (CLAUDE_CONFIG_DIR) with a pid from in there.
  const [files, box] = await Promise.all([readFiles(DIR), readFiles(path.join(DATA, 'sessions'))])
  const live = box.length ? await liveBoxes() : new Set<string>()
  return chatRows([...files, ...box.map(f => ({ ...f, container: true }))], (pid, f) => f.container === true ? live.has(`${f.cwd}\n${pid}`) : alive(pid), Date.now(), hasTranscript)
}

export const transcriptOf = ({ sessionId, cwd }: { sessionId: string; cwd: string }) => path.join(os.homedir(), '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`)
const hasTranscript = (f: { sessionId: string; cwd: string }) => {
  try { return fs.statSync(transcriptOf(f)).size > 0 } catch { return false }
}
