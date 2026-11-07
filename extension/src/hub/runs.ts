/**
 * One role's runs in one chat, for the node drawer: read on demand from the subagent transcripts,
 * ~/.claude/projects/<slug>/<session>/subagents/agent-<id>.jsonl and its .meta.json.
 * Text goes through redact and is cut short. Served where hub state is, token gated: the panel's runs-get and GET /hub/runs
 * (the Mac's app and the paired phone).
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { redact } from './brain'
import { repoTop } from './projects'
import { toolTarget } from './progress'
import { transcriptFile } from './chat-view'

export type RunReport = { status?: string; changed: string[]; checked: string[]; open: string[] }
export type RunFile = { path: string; added: number; removed: number }
export type RunCall = { at: number; tool: string; target?: string }
/** by: qa when the message names qa, else the lead (a nudge or a new ask). */
export type RunLoop = { at: number; by: 'qa' | 'lead'; text: string }
export type RunTokens = { input: number; output: number; cacheRead: number; cacheWrite: number }
/** An Agent call the run made: the role it went to and the brief. */
export type RunDispatch = { at: number; role: string; title?: string; brief: string }
/** file: the transcript, for VS Code to open. calls: the newest 200, oldest first; callCount: all of them. */
export type RunDetail = {
  id: string; role: string; title?: string; model?: string; startedAt: number; endedAt: number; finished: boolean
  brief: string; report?: RunReport; reportText?: string; files: RunFile[]; calls: RunCall[]; callCount: number
  loops: RunLoop[]; tokens: RunTokens; costUsd?: number; file: string; dispatches?: RunDispatch[]
}
type Meta = { agentType?: unknown; description?: unknown; model?: unknown; finished?: unknown }

const BRIEF_MAX = 6000
const REPORT_MAX = 8000
const ITEM_MAX = 400
const ITEMS_MAX = 40
const LOOP_MAX = 600
const CALLS_MAX = 200
const DISPATCH_MAX = 2000
const DISPATCHES_MAX = 30
// A transcript past this is skipped rather than parsed on the hook server's thread.
const FILE_MAX = 60 * 1024 * 1024
const SENT = 'The coordinator sent a message while you were working:'
const EDITS = new Set(['Edit', 'Write', 'MultiEdit'])

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s)
const clean = (s: string, n: number) => cut(redact(s.trim()), n)
const lines = (s: unknown) => (typeof s === 'string' && s ? s.split('\n').length : 0)
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// List prices per million tokens by model family, hard coded: update them when Anthropic's change. Cache writes are 1.25x input.
const PRICES: Array<[RegExp, number, number, number]> = [
  [/fable|mythos/, 10, 50, 0.25],
  [/opus-5-5/, 4, 20, 0.2],
  [/opus/, 5, 25, 0.5],
  [/sonnet-5/, 2, 10, 0.2],
  [/sonnet/, 3, 15, 0.3],
  [/haiku-5/, 0.1, 0.5, 0.01],
  [/haiku/, 1, 5, 0.1],
]
const priceOf = (model: string) => PRICES.find(([re]) => re.test(model))

/** Text of a user or assistant message: the string, or its text blocks joined. */
function textOf(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content) || content.some(b => obj(b) && b.type === 'tool_result')) return undefined
  const t = content.filter(b => obj(b) && b.type === 'text' && typeof b.text === 'string').map(b => (b as { text: string }).text).join('\n')
  return t || undefined
}

// The section word, then an optional note in brackets ("Changed (agent-flow)"), which is dropped.
const SECTION = /^\s*(#{1,6}\s+|\*\*)?(status|changed or found|changes|changed|findings|found|checks|checked|verified|verification|tests|tested|open items|open questions|open|remaining|left|screenshots?(?: paths)?)\b(?:\s*\([^)]*\))?(\*\*)?\s*(:)?\s*(?:\*\*)?\s*:?\s*(.*)$/i
type Key = 'status' | 'changed' | 'checked' | 'open' | 'skip'
function keyOf(w: string): Key {
  const k = w.toLowerCase()
  if (k === 'status') return 'status'
  if (/^(check|verif|test)/.test(k)) return 'checked'
  if (/^(open|remaining|left)/.test(k)) return 'open'
  return k.startsWith('screenshot') ? 'skip' : 'changed'
}

/** Status, Changed (or Found), Checked and Open from a role's final message; any heading style, bullets or same-line text. */
export function parseReport(text: string): RunReport | undefined {
  const out: RunReport = { changed: [], checked: [], open: [] }
  let at: Key | null = null, found = false, fence = false
  const add = (k: Key, s: string) => {
    const v = s.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/\*\*/g, '').trim()
    if (!v || k === 'skip') return
    if (k === 'status') { out.status ??= cut(v.replace(/[.:]$/, ''), 80); return }
    if (out[k].length < ITEMS_MAX) out[k].push(cut(v, ITEM_MAX))
  }
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) { fence = !fence; continue }
    const m = fence ? null : SECTION.exec(line)
    // A heading has a marker, a colon, or nothing else on the line; "Open the file" is text.
    if (m && (m[1] || m[4] || !m[5])) {
      at = keyOf(m[2]); found = true
      if (m[5]) add(at, m[5])
    } else if (!fence && /^\s*#{1,6}\s/.test(line)) at = null
    else if (at && line.trim()) add(at, line)
  }
  return found ? out : undefined
}

/** The deepest folder holding every one of dirs. */
function commonDir(dirs: string[]): string {
  if (!dirs.length) return ''
  const parts = dirs.map(d => d.split('/'))
  let n = 0
  while (parts.every(p => n < p.length && p[n] === parts[0][n])) n++
  return parts[0].slice(0, n).join('/')
}

/** What a transcript has said so far; feed adds lines to it, so a growing file is read once. */
type Acc = {
  usage: Map<string, { u: Record<string, unknown>; model: string }>
  calls: RunCall[]; dispatches: RunDispatch[]; loops: RunLoop[]; files: Map<string, RunFile>; cwds: Set<string>
  pending: Map<string, { name: string; input: Record<string, unknown>; cwd: string }>
  brief: string; model?: string; last?: string; start: number; end: number; callCount: number; firstCwd?: string
}
const newAcc = (): Acc => ({ usage: new Map(), calls: [], dispatches: [], loops: [], files: new Map(), cwds: new Set(), pending: new Map(), brief: '', start: 0, end: 0, callCount: 0 })

/** One transcript as the drawer shows it. Pure; readRuns does the disk.
 * root: the repo the chat works in; file paths are shown relative to it, else to the folder every call ran under. */
export function parseRun(raw: string, meta: Meta, id: string, file: string, root?: string): RunDetail {
  return summary(feed(newAcc(), raw), meta, id, file, root)
}

/** Whole lines of raw into a. */
function feed(a: Acc, raw: string): Acc {
  const { usage, calls, dispatches, loops, files, cwds, pending } = a
  // Keyed by the absolute path; a relative one is taken from the folder its call ran in.
  const touch = (p: string, cwd: string, added: number, removed: number) => {
    const abs = path.posix.resolve(cwd || '/', p)
    const f = files.get(abs) ?? { path: abs, added: 0, removed: 0 }
    f.added += added; f.removed += removed; files.set(abs, f)
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let e: Record<string, unknown>
    try { e = JSON.parse(line) } catch { continue }
    if (typeof e.cwd === 'string' && e.cwd) a.firstCwd ??= e.cwd
    if ((e.type !== 'user' && e.type !== 'assistant') || !obj(e.message)) continue
    const t = Date.parse(String(e.timestamp ?? '')) || 0
    if (t) { a.start ||= t; a.end = Math.max(a.end, t) }
    const cwd = typeof e.cwd === 'string' ? e.cwd : ''
    if (cwd) cwds.add(cwd)
    const msg = e.message, content = msg.content
    if (e.type === 'user') {
      const text = textOf(content)
      if (text !== undefined && !a.brief) a.brief = text
      else if (text?.startsWith(SENT)) {
        const why = text.slice(SENT.length).trim()
        loops.push({ at: t, by: /\bqa\b/i.test(why) ? 'qa' : 'lead', text: clean(why, LOOP_MAX) })
      }
      if (!Array.isArray(content)) continue
      for (const b of content) {
        if (!obj(b) || b.type !== 'tool_result' || typeof b.tool_use_id !== 'string') continue
        const call = pending.get(b.tool_use_id)
        pending.delete(b.tool_use_id)
        if (!call || b.is_error === true) continue
        const p = call.input.file_path
        if (typeof p !== 'string') continue
        const res = obj(e.toolUseResult) ? e.toolUseResult : undefined
        const hunks = Array.isArray(res?.structuredPatch) ? res.structuredPatch as Array<{ lines?: unknown }> : []
        const patch = hunks.flatMap(h => Array.isArray(h.lines) ? h.lines.filter((l): l is string => typeof l === 'string') : [])
        if (patch.length) touch(p, call.cwd, patch.filter(l => l.startsWith('+')).length, patch.filter(l => l.startsWith('-')).length)
        else if (call.name === 'Write') touch(p, call.cwd, lines(call.input.content), 0)
        else if (call.name === 'Edit') touch(p, call.cwd, lines(call.input.new_string), lines(call.input.old_string))
        else if (Array.isArray(call.input.edits)) for (const x of call.input.edits) if (obj(x)) touch(p, call.cwd, lines(x.new_string), lines(x.old_string))
      }
      continue
    }
    if (typeof msg.model === 'string' && msg.model.startsWith('claude')) a.model ??= msg.model
    // One API message comes back as several entries, each carrying the same usage.
    if (obj(msg.usage)) usage.set(typeof msg.id === 'string' ? msg.id : `${usage.size}`, { u: msg.usage, model: typeof msg.model === 'string' ? msg.model : '' })
    if (!Array.isArray(content)) continue
    for (const b of content) {
      if (!obj(b)) continue
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) a.last = b.text
      if (b.type !== 'tool_use' || typeof b.name !== 'string') continue
      const input = obj(b.input) ? b.input : {}
      a.callCount++
      const target = toolTarget(b.name, input)
      calls.push(target ? { at: t, tool: b.name, target: redact(target) } : { at: t, tool: b.name })
      if (calls.length > CALLS_MAX) calls.shift()
      if (b.name === 'Agent' || b.name === 'Task') {
        const desc = typeof input.description === 'string' && input.description.trim() ? clean(input.description, 120) : undefined
        dispatches.push({ at: t, role: typeof input.subagent_type === 'string' ? input.subagent_type : 'general-purpose', ...(desc ? { title: desc } : {}), brief: clean(String(input.prompt ?? ''), DISPATCH_MAX) })
        if (dispatches.length > DISPATCHES_MAX) dispatches.shift()
      }
      if (EDITS.has(b.name) && typeof b.id === 'string') pending.set(b.id, { name: b.name, input, cwd })
    }
  }
  return a
}

/** The drawer's view of a; copies, so later feeds leave it alone. */
function summary(a: Acc, meta: Meta, id: string, file: string, root?: string): RunDetail {
  const { model, last } = a
  const base = root ?? commonDir([...a.cwds])
  const tokens: RunTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  let cost = 0, priced = false
  for (const { u, model: m } of a.usage.values()) {
    const n = (k: string) => (typeof u[k] === 'number' ? u[k] as number : 0)
    const x = { input: n('input_tokens'), output: n('output_tokens'), cacheRead: n('cache_read_input_tokens'), cacheWrite: n('cache_creation_input_tokens') }
    tokens.input += x.input; tokens.output += x.output; tokens.cacheRead += x.cacheRead; tokens.cacheWrite += x.cacheWrite
    const p = priceOf(m || model || '')
    if (p) { priced = true; cost += (x.input * p[1] + x.output * p[2] + x.cacheRead * p[3] + x.cacheWrite * p[1] * 1.25) / 1e6 }
  }
  return {
    id, role: typeof meta.agentType === 'string' ? meta.agentType : '',
    ...(typeof meta.description === 'string' && meta.description.trim() ? { title: clean(meta.description, 120) } : {}),
    ...(model || typeof meta.model === 'string' ? { model: model ?? String(meta.model) } : {}),
    startedAt: a.start, endedAt: a.end, finished: meta.finished === true,
    brief: clean(a.brief, BRIEF_MAX),
    ...(last ? { report: parseReport(redact(last)), reportText: clean(last, REPORT_MAX) } : {}),
    files: [...a.files.values()].map(f => ({ ...f, path: relTo(base, f.path) })), calls: [...a.calls], callCount: a.callCount, loops: [...a.loops], tokens, ...(priced ? { costUsd: cost } : {}), file,
    ...(a.dispatches.length ? { dispatches: [...a.dispatches] } : {}),
  }
}

const relTo = (base: string, p: string) => (base && base !== '/' && p.startsWith(base + '/') ? p.slice(base.length + 1) : p)

const SAFE = /^[A-Za-z0-9_-]{1,80}$/
// Parsed runs by transcript, with what was read so far. A file that grew is read from where it stopped, so a working
// lead's big transcript costs only its new lines each 15 s; one that shrank or was replaced is read again.
// shortcut: a same-inode rewrite that ends up longer reads as an append; transcripts are append only.
type Entry = { key: string; meta: string; run: RunDetail; acc?: Acc; ino: number; offset: number }
const cache = new Map<string, Entry>()
const CACHE_MAX = 300

/** Every run of role in the chat session, newest first; the lead's is the chat transcript itself. Throws on an id that could leave the folder. */
export async function readRuns(session: string, role: string, home = os.homedir()): Promise<RunDetail[]> {
  if (!SAFE.test(session) || !SAFE.test(role)) throw new Error('bad session or role')
  if (role === 'lead') return readLead(session, home)
  const root = path.join(home, '.claude', 'projects')
  const out: RunDetail[] = []
  for (const slug of await fs.promises.readdir(root).catch(() => [] as string[])) {
    const dir = path.join(root, slug, session, 'subagents')
    const names = await fs.promises.readdir(dir).catch(() => [] as string[])
    for (const n of names) {
      const m = /^agent-([A-Za-z0-9_-]+)\.jsonl$/.exec(n)
      if (!m) continue
      const file = path.join(dir, n)
      let meta: Meta, metaText: string
      try { metaText = await fs.promises.readFile(file.replace(/\.jsonl$/, '.meta.json'), 'utf8'); meta = JSON.parse(metaText) as Meta } catch { continue }
      if (meta.agentType !== role) continue
      const run = await readOne(file, meta, m[1], metaText)
      if (run) out.push(run)
    }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt)
}

/** The lead is the chat's own transcript, <slug>/<session>.jsonl, read as one run. */
async function readLead(session: string, home: string): Promise<RunDetail[]> {
  const file = await transcriptFile(session, home)
  const run = file && await readOne(file, { agentType: 'lead' }, session, 'lead')
  return run ? [run] : []
}

async function readOne(file: string, meta: Meta, id: string, metaText: string): Promise<RunDetail | undefined> {
  const st = await fs.promises.lstat(file).catch(() => undefined)
  if (!st?.isFile()) return undefined
  const key = `${st.ino}:${st.mtimeMs}:${st.size}`, hit = cache.get(file)
  if (hit?.key === key && hit.meta === metaText) return hit.run
  const grew = hit?.acc && hit.ino === st.ino && st.size > hit.offset
  let acc = hit?.key === key ? hit.acc : grew ? hit!.acc : undefined, offset = acc ? hit!.offset : 0
  let run: RunDetail
  if (st.size - offset > FILE_MAX) {
    acc = undefined; offset = 0
    run = { ...parseRun('', meta, id, file), startedAt: st.birthtimeMs, endedAt: st.mtimeMs, brief: 'This transcript is too big to read here. Open it instead.' }
  } else {
    acc ??= newAcc()
    if (st.size > offset) {
      const buf = Buffer.alloc(st.size - offset), fh = await fs.promises.open(file, 'r')
      const n = await fh.read(buf, 0, buf.length, offset).then(r => r.bytesRead).finally(() => fh.close())
      // Whole lines only; a line still being written waits for the next read.
      const end = buf.subarray(0, n).lastIndexOf(0x0a) + 1
      feed(acc, buf.subarray(0, end).toString('utf8'))
      offset += end
    }
    run = summary(acc, meta, id, file, acc.firstCwd ? repoTop(acc.firstCwd) : undefined)
  }
  cache.delete(file)
  cache.set(file, { key, meta: metaText, run, acc, ino: st.ino, offset })
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
  return run
}
