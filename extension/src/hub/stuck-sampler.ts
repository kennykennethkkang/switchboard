/**
 * The stuck check's reads: one ps for every chat, job output file times, and the transcript lines that say a job ended.
 * hub-panel.ts calls sampleStuck every 30 s while a chat works, and stopStuck for Stop process.
 */
import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { hub } from './hub-service'
import { finishedJobs } from './progress'
import { readChats } from './sessions'
import { listServers } from './local'
import { STUCK, detect, newWatch, parsePs, stopTree, type Proc } from './stuck'
import type { ChatProgress, StuckItem } from './types'

const ps = (now: number) => new Promise<Proc[]>((resolve, reject) =>
  execFile('ps', ['-A', '-o', 'pid,ppid,pcpu,rss,etime,command'], { timeout: 5000, maxBuffer: 16 << 20 }, (err, out) => (err ? reject(err) : resolve(parsePs(String(out), now)))))

/** The last ps run's time and the running total, for the log. */
export const psCost = { runs: 0, ms: 0, lastMs: 0 }
const watch = newWatch()

// Claude Code keeps a chat's task output under <tmp>/claude-<uid>/<project slug>/<session>/tasks and its transcripts under
// ~/.claude/projects/<slug>; the slug is the folder the chat started in, which a subfolder cwd may not match, so the session finds it.
const TMP = path.join(process.platform === 'darwin' ? '/private/tmp' : os.tmpdir(), `claude-${process.getuid?.() ?? ''}`)
const PROJECTS = path.join(os.homedir(), '.claude', 'projects')
const slug = (p: string) => p.replace(/[^a-zA-Z0-9]/g, '-')
const dirs = new Map<string, string | undefined>()
function sessionDir(root: string, cwd: string, session: string, leaf: string): string | undefined {
  const k = `${root}\n${session}`
  if (dirs.has(k)) return dirs.get(k)
  const named = path.join(root, slug(cwd))
  let hit: string | undefined
  if (fs.existsSync(path.join(named, leaf))) hit = named
  else { try { hit = fs.readdirSync(root).map(d => path.join(root, d)).find(d => fs.existsSync(path.join(d, leaf))) } catch { /* none */ } }
  if (hit) dirs.set(k, hit)
  return hit
}

// Transcripts are read from where the last read stopped, so a long chat costs only its new lines.
const tails = new Map<string, { at: number; ids: Set<string> }>()
function endedIn(file: string): Set<string> {
  const t = tails.get(file) ?? { at: 0, ids: new Set<string>() }
  tails.set(file, t)
  try {
    const size = fs.statSync(file).size
    if (size <= t.at) return t.ids
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(size - t.at)
      fs.readSync(fd, buf, 0, buf.length, t.at)
      const text = buf.toString('utf8'), cut = text.lastIndexOf('\n') + 1
      t.at += Buffer.byteLength(text.slice(0, cut))
      for (const id of finishedJobs(text.slice(0, cut))) t.ids.add(id)
    } finally { fs.closeSync(fd) }
  } catch { /* gone or unreadable: nothing ended there */ }
  return t.ids
}

function jobFacts(all: ChatProgress[], now: number) {
  const outAt = new Map<string, number | undefined>(), finished = new Set<string>()
  for (const p of all) for (const j of [...(p.jobs ?? []), ...(p.subJobs ?? [])]) {
    // Only jobs old enough to count; the rest cost nothing.
    if (now - j.startedAt < STUCK.jobQuietMs) continue
    const tmp = j.task ? sessionDir(TMP, p.cwd, p.sessionId, path.join(p.sessionId, 'tasks')) : undefined
    try { outAt.set(j.id, tmp ? fs.statSync(path.join(tmp, p.sessionId, 'tasks', `${j.task}.output`)).mtimeMs : undefined) } catch { outAt.set(j.id, undefined) }
    const proj = sessionDir(PROJECTS, p.cwd, p.sessionId, `${p.sessionId}.jsonl`)
    const file = proj && (j.agent ? path.join(proj, p.sessionId, 'subagents', `agent-${j.agent}.jsonl`) : path.join(proj, `${p.sessionId}.jsonl`))
    if (file && endedIn(file).has(j.id)) finished.add(j.id)
  }
  return { outAt, finished }
}

/** Every stuck item now; the ps part is skipped when ps fails. */
export async function sampleStuck(now = Date.now()): Promise<StuckItem[]> {
  const s = hub.get()
  const t = performance.now()
  const procs = await ps(now).catch(() => undefined)
  psCost.lastMs = performance.now() - t
  psCost.runs++
  psCost.ms += psCost.lastMs
  return detect({ progress: s.progress, chats: s.chats, procs, ...jobFacts(s.progress, now) }, watch, now)
}

// VS Code and its helpers, never stopped whatever the tree says.
const EDITOR = /Visual Studio Code|Code Helper|Code - Insiders|Cursor Helper|\bElectron\b/

/** Stop process: only the item's own process, found again under its chat's claude with the same start time. A string is why not. */
export async function stopStuck(sessionId: string, id: string): Promise<string | undefined> {
  const item = hub.get().stuck?.find(i => i.id === id && i.sessionId === sessionId)
  if (!item?.pid || item.started === undefined) return 'that item has no process to stop'
  // Read fresh: the cached chat row may be minutes old and its pid reused.
  const chats = await readChats().catch(() => [])
  const chat = chats.find(c => c.sessionId === sessionId && c.live)
  if (!chat) return 'that chat is not running'
  const [procs, servers] = await Promise.all([ps(Date.now()), listServers().catch(() => [])])
  const guard = new Set([process.pid, process.ppid, ...chats.map(c => c.pid), ...servers.filter(s => s.port === 3000).map(s => s.pid), ...procs.filter(p => EDITOR.test(p.command)).map(p => p.pid)])
  const r = await stopTree({ pid: item.pid, start: item.started }, chat.pid, guard, {
    list: () => ps(Date.now()),
    kill: (pid, sig) => process.kill(pid, sig),
    wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
  })
  return r.problem
}
