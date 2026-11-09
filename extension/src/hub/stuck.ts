/**
 * What looks stuck in a chat: a quiet subagent, a background job with no output or end, a process in the chat's
 * tree eating CPU or memory. Pure, so the tests drive it with fake clocks and fake ps output; hub-panel.ts samples.
 */
import type { BgJob, ChatProgress, ChatRow, StuckItem } from './types'

// When something counts as stuck. Tune here.
export const STUCK = {
  agentQuietMs: 10 * 60_000, // a running subagent with no tool call
  jobQuietMs: 15 * 60_000, // a background job whose output file stopped growing
  jobAgeMs: 30 * 60_000, // a background job with no output file to watch
  cpuPct: 80, // percent of one core...
  cpuForMs: 5 * 60_000, // ...held this long
  rssBytes: 2 * 1024 ** 3,
  sampleMs: 30_000, // while some chat works
  idleSampleMs: 5 * 60_000, // while every chat is idle, for hogs left behind
  snoozeMs: 30 * 60_000,
  stopWaitMs: 5000, // SIGTERM, then SIGKILL after this
  startSlackMs: 3000, // etime has 1 s steps and two samples differ a little
}

// Dev servers and watchers print nothing while idle, so quiet is not stuck; CPU and memory still catch them.
const SERVER = /\b(next|vite|nuxt|astro|remix|webpack(-dev-server)?|nodemon|uvicorn|gunicorn|flask) (dev|run|serve|start|--|-p|--port|app|\S+:\S+)|\b(npm|pnpm|yarn|bun)( run)? (dev|start|serve|backend|frontend|watch)\b|\bhttp\.server\b|\b(dev|preview) server\b/i
const isServer = (j: BgJob) => SERVER.test(`${j.command ?? ''} ${j.label ?? ''}`)

/** One ps row. rss in bytes, start in ms since the epoch. */
export type Proc = { pid: number; ppid: number; cpu: number; rss: number; start: number; command: string }

/** ps etime: [[dd-]hh:]mm:ss, in seconds. */
const etime = (s: string) => {
  const [d, rest] = s.includes('-') ? s.split('-') : ['0', s]
  return Number(d) * 86400 + rest.split(':').reduce((t, x) => t * 60 + Number(x), 0)
}

/** `ps -A -o pid,ppid,pcpu,rss,etime,command`, sampled at now. */
export function parsePs(out: string, now: number): Proc[] {
  return out.split('\n').flatMap(line => {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+([\d:-]+)\s+(.*)$/.exec(line)
    // Whole seconds: etime has no finer steps. detect() still pins each pid's first start, since truncation can tip a second either way.
    return m ? [{ pid: +m[1], ppid: +m[2], cpu: +m[3], rss: +m[4] * 1024, start: Math.round((now - etime(m[5]) * 1000) / 1000) * 1000, command: m[6] }] : []
  })
}

/** Ancestors of pid, nearest first; empty when it is gone. A parent never starts after its child, so a reused pid breaks the chain. */
function chain(byPid: Map<number, Proc>, pid: number): number[] {
  const out: number[] = []
  let p = byPid.get(pid)
  while (p && p.ppid > 0 && out.length < 64) {
    const up = byPid.get(p.ppid)
    if (!up || up.start > p.start + STUCK.startSlackMs) break
    out.push(up.pid)
    p = up
  }
  return out
}

const byPid = (procs: Proc[]) => new Map(procs.map(p => [p.pid, p]))
/** root's descendants, root left out. */
const under = (procs: Proc[], root: number) => { const m = byPid(procs); return procs.filter(p => p.pid !== root && chain(m, p.pid).includes(root)) }

/** Why pid may not be stopped, or undefined: it must be the same process (start time) and sit under the chat's claude. */
export function canStop(procs: Proc[], target: { pid: number; start: number }, root: number, guard: Set<number>): string | undefined {
  if (target.pid === root) return 'that is the chat itself'
  if (guard.has(target.pid)) return 'that process is protected'
  const p = procs.find(x => x.pid === target.pid)
  if (!p || Math.abs(p.start - target.start) > STUCK.startSlackMs) return 'that process already ended'
  if (!chain(byPid(procs), p.pid).includes(root)) return 'that process is not under the chat'
  // SIGTERM to a parent reaches its children anyway (pnpm forwards it), so a protected one anywhere under it rules it out.
  return under(procs, p.pid).some(x => guard.has(x.pid)) ? 'a protected process runs under it' : undefined
}

type StopDeps = { list: () => Promise<Proc[]>; kill: (pid: number, sig: 'SIGTERM' | 'SIGKILL') => void; wait: (ms: number) => Promise<void> }

/** SIGTERM to target and everything under it (deepest first), then SIGKILL to what is left after 5 s, checked again.
 * Answers once SIGTERM went (problem: why not); done settles after the SIGKILL step. */
export async function stopTree(target: { pid: number; start: number }, root: number, guard: Set<number>, d: StopDeps): Promise<{ problem?: string; done?: Promise<void> }> {
  const pick = (ps: Proc[]) => {
    const no = canStop(ps, target, root, guard)
    if (no) return { no, pids: [], ps }
    const m = byPid(ps)
    const kids = under(ps, target.pid).filter(p => !guard.has(p.pid)).sort((a, b) => chain(m, b.pid).length - chain(m, a.pid).length)
    return { no, pids: [...kids.map(p => p.pid), target.pid], ps }
  }
  const first = pick(await d.list())
  if (first.no) return { problem: first.no }
  const send = (pids: number[], sig: 'SIGTERM' | 'SIGKILL') => { for (const pid of pids) { try { d.kill(pid, sig) } catch { /* gone */ } } }
  send(first.pids, 'SIGTERM')
  const done = d.wait(STUCK.stopWaitMs).then(d.list).then(ps => {
    // Only the ones still there, still the same process and still under the chat.
    const starts = new Map(first.ps.map(p => [p.pid, p.start]))
    send(first.pids.filter(pid => { const p = ps.find(x => x.pid === pid); return p && Math.abs(p.start - starts.get(pid)!) <= STUCK.startSlackMs && chain(byPid(ps), pid).includes(root) }), 'SIGKILL')
  })
  return { done }
}

/** Kept between samples: when each hot process (by pid and start) first went over the line, and each pid's start as first read. */
export type Watch = { hot: Map<string, number>; starts: Map<number, number> }
export const newWatch = (): Watch => ({ hot: new Map(), starts: new Map() })

/** Whether a sample is due: every 30 s while a chat works, every 5 min while all are idle. */
export const sampleDue = (last: number | undefined, working: boolean, now: number) => last === undefined || now - last >= (working ? STUCK.sampleMs : STUCK.idleSampleMs)

/** procs with each pid's start pinned to its first reading, so ids, keys and the shown start stay put across samples. A pid that moved past the slack is a new process. */
function pinStarts(procs: Proc[], w: Watch): Proc[] {
  const out = procs.map(p => {
    const was = w.starts.get(p.pid)
    if (was !== undefined && Math.abs(was - p.start) <= STUCK.startSlackMs) return was === p.start ? p : { ...p, start: was }
    w.starts.set(p.pid, p.start)
    return p
  })
  const live = new Set(procs.map(p => p.pid))
  for (const pid of w.starts.keys()) if (!live.has(pid)) w.starts.delete(pid)
  return out
}

const SECRET: [RegExp, string][] = [
  [/(:\/\/)[^\s/@]+@/g, '$1***@'],
  [/\b(Bearer|Basic)\s+\S+/gi, '$1 ***'],
  [/\b(sk-|gh[pousr]_|xox[abpr]-|AKIA)[\w-]{6,}/g, '***'],
  [/\b(\w*(?:token|secret|passw(?:or)?d|pwd|api[_-]?key|auth)\w*)(\s*[=:]\s*|\s+)("[^"]*"|'[^']*'|\S+)/gi, '$1$2***'],
  // A long run of letters and digits with both in it: a key or hash, not a path name.
  [/(?=[\w+/=-]*\d)(?=[\w+/=-]*[A-Za-z])\b[\w+/-]{32,}={0,2}/g, '***'],
]
/** A command as it may go over the LAN: secrets out first, then one line cut to 120 code points. */
export const redact = (cmd: string) => Array.from(SECRET.reduce((s, [re, to]) => s.replace(re, to), cmd).replace(/[\x00-\x1f\x7f]+/g, ' ').trim()).slice(0, 120).join('')

/** The text before the first quote, or eval's quoting hides it; short ones would match anything. */
const key = (cmd?: string) => { const k = cmd?.split(/["'\n]/)[0].trim(); return k && k.length >= 6 ? k : undefined }

type Input = { progress: ChatProgress[]; chats: ChatRow[]; procs?: Proc[]; outAt: Map<string, number | undefined>; finished: Set<string> }

/** Every stuck item now. outAt: each job's output file mtime (undefined: none found). finished: job ids a transcript says ended. */
export function detect(input: Input, w: Watch, now: number): StuckItem[] {
  const items: StuckItem[] = []
  // No ps this time (it failed): keep the pinned starts for the next one.
  const procs = input.procs ? pinStarts(input.procs, w) : []
  const lastCall = (p: ChatProgress, role?: string) => { const t = [...(p.tools ?? [])].reverse().find(c => !role || c.role === role); return t ? `${t.tool}${t.target ? ` ${t.target}` : ''}` : undefined }
  const seen = new Set<string>()
  for (const c of input.chats.filter(c => c.live)) {
    const p = input.progress.find(x => x.sessionId === c.sessionId)
    const mine = under(procs, c.pid)
    const folded = new Set<number>()
    if (p && p.state !== 'needs-you' && !p.asks?.length) {
      for (const id of p.running ?? []) {
        const r = p.roles.find(x => x.id === id)
        const at = r ? r.at ?? r.startedAt : undefined
        if (r && at !== undefined && now - at >= STUCK.agentQuietMs) items.push({ id: `agent:${c.sessionId}:${id}`, kind: 'agent', sessionId: c.sessionId, what: `${r.role} subagent: no tool call`, since: at, ...opt('last', lastCall(p, r.role)) })
      }
    }
    for (const j of [...(p?.jobs ?? []), ...(p?.subJobs ?? [])]) {
      if (input.finished.has(j.id) || isServer(j)) continue
      const out = input.outAt.get(j.id)
      const since = out ?? j.startedAt
      if (now - j.startedAt < STUCK.jobQuietMs || now - since < (out === undefined ? STUCK.jobAgeMs : STUCK.jobQuietMs)) continue
      const shell = shellOf(j, mine)
      const sub = shell ? [shell, ...under(mine, shell.pid)] : []
      sub.forEach(x => folded.add(x.pid))
      items.push({
        id: `job:${c.sessionId}:${j.id}`, kind: 'job', sessionId: c.sessionId, since,
        what: `${j.agent ? 'Subagent background' : 'Background'} job${j.label ? ` "${j.label}"` : ''}: ${out === undefined ? 'no end' : 'no new output'}`,
        ...(shell ? { pid: shell.pid, started: shell.start, cpu: Math.max(...sub.map(x => x.cpu)), rss: sub.reduce((t, x) => t + x.rss, 0) } : {}),
        ...opt('command', j.command ? redact(j.command) : shell && redact(shell.command)), ...opt('last', p && lastCall(p)),
      })
    }
    for (const x of mine) {
      const k = `${x.pid}:${x.start}`
      seen.add(k)
      const over = x.cpu >= STUCK.cpuPct || x.rss >= STUCK.rssBytes
      if (!over) { w.hot.delete(k); continue }
      if (!w.hot.has(k)) w.hot.set(k, now)
      const since = w.hot.get(k)!
      if (folded.has(x.pid) || (x.rss < STUCK.rssBytes && now - since < STUCK.cpuForMs)) continue
      items.push({ id: `proc:${c.sessionId}:${k}`, kind: 'process', sessionId: c.sessionId, what: x.rss >= STUCK.rssBytes ? 'Process using a lot of memory' : 'Process using a lot of CPU', since, cpu: x.cpu, rss: x.rss, pid: x.pid, started: x.start, command: redact(x.command), ...opt('last', p && lastCall(p)) })
    }
  }
  // A failed ps keeps the timers; a process missing from a real one has ended.
  if (input.procs) for (const k of w.hot.keys()) if (!seen.has(k)) w.hot.delete(k)
  return items
}

const opt = <K extends string>(k: K, v: string | undefined) => (v ? { [k]: v } : {}) as Partial<Record<K, string>>

/** The topmost process in the chat's tree running the job's command. */
function shellOf(j: BgJob, mine: { pid: number; ppid: number; command: string; start: number; cpu: number; rss: number }[]) {
  const k = key(j.command)
  const hits = k ? mine.filter(x => x.command.includes(k)) : []
  return hits.find(x => !hits.some(y => y.pid === x.ppid))
}

/** items without the snoozed ones; a snooze past its 30 min is dropped. snoozes: id to when it was dismissed. */
export function snoozed<T extends { id: string }>(items: T[], snoozes: Map<string, number>, now: number): T[] {
  for (const [id, at] of snoozes) if (now - at >= STUCK.snoozeMs) snoozes.delete(id)
  return items.filter(i => !snoozes.has(i.id))
}

/** How long an item has to look stuck before it shows; auto-fix waits twice this. */
const limit = (i: StuckItem) => i.kind === 'agent' ? STUCK.agentQuietMs : i.kind === 'process' ? STUCK.cpuForMs : i.what.endsWith('no end') ? STUCK.jobAgeMs : STUCK.jobQuietMs

/** Items stuck for twice their threshold and not fixed yet; each comes back once (done keeps the ids). */
export function fixDue<T extends StuckItem>(items: T[], done: Set<string>, now: number): T[] {
  const out = items.filter(i => !done.has(i.id) && now - i.since >= 2 * limit(i))
  for (const i of out) done.add(i.id)
  return out
}

/** The note Fix types into the chat. stopped: its process was stopped first. loop: the call the chat keeps repeating. */
export function fixText(i: StuckItem, now: number, stopped = false, loop?: string): string {
  const text = fixBody(i, now, stopped)
  return loop ? `${text} The chat has repeated ${loop} six times in a row; break that loop.` : text
}

function fixBody(i: StuckItem, now: number, stopped: boolean): string {
  const min = Math.max(1, Math.round((now - i.since) / 60_000))
  if (i.kind === 'agent') {
    const role = i.what.split(' subagent')[0]
    return `Subagent ${role} (${i.id.split(':').pop()}) has been quiet ${min} min. Check its last output; if it is waiting or looping, SendMessage it to continue with a narrower next step, or stop it and redo the step yourself.`
  }
  const cmd = i.kind === 'process' ? `pid ${i.pid}${i.command ? `: ${i.command}` : ''}` : i.command
  const head = `${i.what} for ${min} min${cmd ? ` (${cmd})` : ''}.`
  const rerun = 'If it is still needed, rerun it with a timeout, or with run_in_background and a check on its output.'
  return stopped ? `Switchboard stopped ${head[0].toLowerCase()}${head.slice(1)} ${rerun}` : `${head} Stop it (TaskStop or KillShell), then rerun it with a timeout if it is still needed.`
}

/** What the chat waits on Kenneth for, or undefined: a prompt or needs-you. A loop is no wait; see loops. */
export function waitsOnUser(p?: ChatProgress): string | undefined {
  if (!p) return undefined
  const a = p.asks?.[0] ?? p.ask
  if (a) return a.kind === 'permission' ? `permission for ${a.tool}${a.preview ? `: ${a.preview}` : ''}` : `an answer: ${a.questions?.[0]?.question ?? a.preview ?? a.tool}`
  return p.state === 'needs-you' ? `an answer: ${p.question ?? 'it needs you'}` : undefined
}

// Waiting on a job is fine however often it repeats.
const POLL = /^(BashOutput|TaskOutput|Monitor|ScheduleWakeup)\b|^Bash (sleep|wait)\b/

/** The call a chat repeated six times running, polls left out, or undefined. Fix mentions it to the lead. */
export function loops(p?: ChatProgress): string | undefined {
  const last = (p?.tools ?? []).slice(-6).map(t => `${t.tool}${t.target ? ` ${t.target}` : ''}`)
  return last.length === 6 && last.every(t => t === last[0]) && !POLL.test(last[0]) ? last[0] : undefined
}
