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

export type RunReport = { status?: string; changed: string[]; checked: string[]; open: string[] }
export type RunFile = { path: string; added: number; removed: number }
export type RunCall = { at: number; tool: string; target?: string }
/** by: qa when the message names qa, else the lead (a nudge or a new ask). */
export type RunLoop = { at: number; by: 'qa' | 'lead'; text: string }
export type RunTokens = { input: number; output: number; cacheRead: number; cacheWrite: number }
/** file: the transcript, for VS Code to open. calls: the newest 200, oldest first; callCount: all of them. */
export type RunDetail = {
  id: string; role: string; title?: string; model?: string; startedAt: number; endedAt: number; finished: boolean
  brief: string; report?: RunReport; reportText?: string; files: RunFile[]; calls: RunCall[]; callCount: number
  loops: RunLoop[]; tokens: RunTokens; costUsd?: number; file: string
}
type Meta = { agentType?: unknown; description?: unknown; model?: unknown; finished?: unknown }

const BRIEF_MAX = 6000
const REPORT_MAX = 8000
const ITEM_MAX = 400
const ITEMS_MAX = 40
const LOOP_MAX = 600
const CALLS_MAX = 200
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

/** One transcript as the drawer shows it. Pure; readRuns does the disk.
 * root: the repo the chat works in; file paths are shown relative to it, else to the folder every call ran under. */
export function parseRun(raw: string, meta: Meta, id: string, file: string, root?: string): RunDetail {
  const usage = new Map<string, { u: Record<string, unknown>; model: string }>()
  const calls: RunCall[] = [], loops: RunLoop[] = [], files = new Map<string, RunFile>(), cwds = new Set<string>()
  const pending = new Map<string, { name: string; input: Record<string, unknown>; cwd: string }>()
  let brief = '', model: string | undefined, last: string | undefined, start = 0, end = 0, callCount = 0
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
    if ((e.type !== 'user' && e.type !== 'assistant') || !obj(e.message)) continue
    const t = Date.parse(String(e.timestamp ?? '')) || 0
    if (t) { start ||= t; end = Math.max(end, t) }
    const cwd = typeof e.cwd === 'string' ? e.cwd : ''
    if (cwd) cwds.add(cwd)
    const msg = e.message, content = msg.content
    if (e.type === 'user') {
      const text = textOf(content)
      if (text !== undefined && !brief) brief = text
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
    if (typeof msg.model === 'string' && msg.model.startsWith('claude')) model ??= msg.model
    // One API message comes back as several entries, each carrying the same usage.
    if (obj(msg.usage)) usage.set(typeof msg.id === 'string' ? msg.id : `${usage.size}`, { u: msg.usage, model: typeof msg.model === 'string' ? msg.model : '' })
    if (!Array.isArray(content)) continue
    for (const b of content) {
      if (!obj(b)) continue
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) last = b.text
      if (b.type !== 'tool_use' || typeof b.name !== 'string') continue
      const input = obj(b.input) ? b.input : {}
      callCount++
      const target = toolTarget(b.name, input)
      calls.push(target ? { at: t, tool: b.name, target: redact(target) } : { at: t, tool: b.name })
      if (calls.length > CALLS_MAX) calls.shift()
      if (EDITS.has(b.name) && typeof b.id === 'string') pending.set(b.id, { name: b.name, input, cwd })
    }
  }
  const base = root ?? commonDir([...cwds])
  const tokens: RunTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  let cost = 0, priced = false
  for (const { u, model: m } of usage.values()) {
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
    startedAt: start, endedAt: end, finished: meta.finished === true,
    brief: clean(brief, BRIEF_MAX),
    ...(last ? { report: parseReport(redact(last)), reportText: clean(last, REPORT_MAX) } : {}),
    files: [...files.values()].map(f => ({ ...f, path: relTo(base, f.path) })), calls, callCount, loops, tokens, ...(priced ? { costUsd: cost } : {}), file,
  }
}

const relTo = (base: string, p: string) => (base && base !== '/' && p.startsWith(base + '/') ? p.slice(base.length + 1) : p)

const SAFE = /^[A-Za-z0-9_-]{1,80}$/
// Parsed runs by transcript; one is parsed again only when it or its meta changes. The 15 s refresh then costs a stat per file.
const cache = new Map<string, { key: string; run: RunDetail }>()
const CACHE_MAX = 300

/** Every run of role in the chat session, newest first. Throws on an id that could leave the folder. */
export async function readRuns(session: string, role: string, home = os.homedir()): Promise<RunDetail[]> {
  if (!SAFE.test(session) || !SAFE.test(role)) throw new Error('bad session or role')
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
      const st = await fs.promises.lstat(file).catch(() => undefined)
      if (!st?.isFile()) continue
      const key = `${st.mtimeMs}:${st.size}:${metaText}`, hit = cache.get(file)
      if (hit?.key === key) { out.push(hit.run); continue }
      let run: RunDetail
      if (st.size > FILE_MAX) run = { ...parseRun('', meta, m[1], file), startedAt: st.birthtimeMs, endedAt: st.mtimeMs, brief: 'This transcript is too big to read here. Open it instead.' }
      else {
        const raw = await fs.promises.readFile(file, 'utf8')
        const cwd = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(raw)?.[1]
        run = parseRun(raw, meta, m[1], file, cwd ? repoTop(JSON.parse(`"${cwd}"`) as string) : undefined)
      }
      cache.delete(file)
      cache.set(file, { key, run })
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
      out.push(run)
    }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt)
}
