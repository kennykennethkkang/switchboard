/**
 * The chat view: what a chat produced (outputs) and its transcript a page at a time.
 * Transcripts run to hundreds of MB, so both read in fixed windows, never the whole file.
 * Every string goes through redact before it leaves. Served by the panel's chat-get and GET /hub/chat/*.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { redact } from './brain'
import { commitMessage, isTestCommand, standup, testOutcome, toolTarget } from './progress'
import { readRuns } from './runs'
import type { ChatProgress, Report } from './types'
import { codexTranscriptLine } from '../codex-rollout-parser'
import { codexRolloutFile } from '../codex-session-watcher'

const CHUNK = 256 * 1024
const FINAL_MAX = 20_000
const REPORT_MAX = 8000
const ERROR_MAX = 300
const ERRORS = 50
const TESTS = 20
const ANSWER_MAX = 500
const SHOTS = 200
const PAGE = 50
const MESSAGE_MAX = 4000
const RESULT_MAX = 120
const SAFE = /^[A-Za-z0-9_-]{1,80}$/
const EDITS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const AGENTS = new Set(['Agent', 'Task'])
// One line past this is skipped (outputs) or shown as a placeholder (transcript), so a giant line cannot spike the host.
const LINE_MAX = 16 * 1024 * 1024
export const SKIPPED = '{"type":"skipped"}'
const IMAGE = /(?:~|\.{0,2})?\/?(?:[\w.@+-]+\/)*[\w.@+-]+\.(?:png|jpe?g|gif|webp)\b/gi

/** Calls onLine for each complete line from byte from; a partial last line is left for next time, a line over max is skipped. Returns the offset after the last complete line. */
export async function scanLines(file: string, from: number, onLine: (line: string) => void, chunk = CHUNK, max = LINE_MAX): Promise<number> {
  const handle = await fs.promises.open(file, 'r')
  try {
    const size = (await handle.stat()).size
    const buffer = Buffer.alloc(chunk)
    // The current line's earlier pieces, joined once at its newline: concat per chunk is quadratic on one huge line.
    let parts: Buffer[] = [], partLen = 0, skipping = false
    let position = from, done = from
    while (position < size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(chunk, size - position), position)
      if (bytesRead === 0) break
      const at = position
      position += bytesRead
      const data = buffer.subarray(0, bytesRead)
      let start = 0
      for (let nl = data.indexOf(10); nl >= 0; nl = data.indexOf(10, start)) {
        if (!skipping) {
          const piece = data.subarray(start, nl)
          onLine((partLen ? Buffer.concat([...parts, piece], partLen + piece.length) : piece).toString('utf8'))
        }
        parts = []; partLen = 0; skipping = false
        start = nl + 1
        done = at + start
      }
      if (skipping || start === bytesRead) continue
      if (partLen + bytesRead - start > max) { skipping = true; parts = []; partLen = 0; continue }
      parts.push(Buffer.from(data.subarray(start)))
      partLen += bytesRead - start
    }
    return done
  } finally {
    await handle.close()
  }
}

export type Line = { at: number; text: string }

/** Up to n complete lines ending before byte before, oldest first; before: where the next page ends, null at the file start. Text after the last newline is skipped, a line over max comes back as SKIPPED. */
export async function pageBack(file: string, before: number, n: number, win = CHUNK, max = LINE_MAX): Promise<{ lines: Line[]; before: number | null }> {
  const handle = await fs.promises.open(file, 'r')
  try {
    // Newline offsets, newest first: the one ending the newest line, then one more per line, so nothing is ever concatenated.
    const nls: number[] = []
    const buf = Buffer.alloc(win)
    let pos = Math.min(before, (await handle.stat()).size)
    while (pos > 0 && nls.length < n + 1) {
      const s = Math.max(0, pos - win), len = pos - s
      await handle.read(buf, 0, len, s)
      for (let i = buf.lastIndexOf(10, len - 1); i >= 0 && nls.length < n + 1; i = i > 0 ? buf.lastIndexOf(10, i - 1) : -1) nls.push(s + i)
      pos = s
    }
    const count = nls.length > n ? n : nls.length
    const out: Line[] = []
    for (let k = 0; k < count; k++) {
      const start = k + 1 < nls.length ? nls[k + 1] + 1 : 0, end = nls[k]
      if (end - start > max) { out.unshift({ at: start, text: SKIPPED }); continue }
      const b = Buffer.alloc(end - start)
      await handle.read(b, 0, b.length, start)
      out.unshift({ at: start, text: b.toString('utf8') })
    }
    return { lines: out, before: out.length && out[0].at > 0 ? out[0].at : null }
  } finally {
    await handle.close()
  }
}

export type ChatQuestion = { question: string; answer?: string }
export type ChatReport = { id: string; label: string; role?: string; text: string }
export type ChatTest = { command: string; ok: boolean; failed?: number; total?: number; first?: string }
export type ChatError = { tool: string; text: string }
/** What a chat produced. codex: built from hub progress only, there is no transcript to read. */
export type ChatOutputs = {
  final?: string; standup?: Report; commit?: string; questions: ChatQuestion[]; reports: ChatReport[]
  tests: ChatTest[]; errors: ChatError[]; files: string[]; shots: string[]; codex?: true
}
type Deps = { home?: string; scan?: typeof scanLines; runs?: typeof readRuns }

type Obj = Record<string, unknown>
const obj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s)
// Cut first so a huge string never reaches redact whole; the margin catches a key across the cut, then the real cap applies.
const clean = (s: string, n: number) => cut(redact(s.trim().slice(0, n + 64)), n)
const blocks = (content: unknown): Obj[] => (Array.isArray(content) ? content.filter(obj) : [])
const texts = (content: unknown) => typeof content === 'string' ? content : blocks(content).filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text as string).join('\n')

/** The chat's transcript, ~/.claude/projects/<slug>/<session>.jsonl; undefined when there is none or the id is unsafe. */
const found = new Map<string, string>()
export async function transcriptFile(session: string, home = os.homedir()): Promise<string | undefined> {
  if (!SAFE.test(session)) return undefined
  const key = `${home}\n${session}`, hit = found.get(key)
  if (hit && fs.existsSync(hit)) return hit
  const root = path.join(home, '.claude', 'projects')
  for (const slug of await fs.promises.readdir(root).catch(() => [] as string[])) {
    const f = path.join(root, slug, `${session}.jsonl`)
    if (await fs.promises.stat(f).then(s => s.isFile(), () => false)) { found.set(key, f); return f }
  }
  return undefined
}

type Tool = { name: string; cmd?: string; label?: string; role?: string; qs?: string[] }
type Acc = {
  offset: number; id: string; cwd?: string; final?: string; tools: Map<string, Tool>; questions: ChatQuestion[]
  reports: Map<string, ChatReport>; tests: ChatTest[]; errors: ChatError[]; files: Set<string>; shots: Set<string>
}
const fresh = (id: string): Acc => ({ offset: 0, id, tools: new Map(), questions: [], reports: new Map(), tests: [], errors: [], files: new Set(), shots: new Set() })
// Per transcript; a reopen reads only what was appended since.
const accs = new Map<string, Acc>()
const ACCS_MAX = 20
// One read per transcript at a time: two at once would both scan from the same offset into the same totals.
const reading = new Map<string, Promise<Acc>>()

function shotsIn(acc: Acc, text: string, home: string) {
  if (!/\.(?:png|jpe?g|gif|webp)\b/i.test(text)) return
  for (const m of text.matchAll(IMAGE)) {
    const p = m[0].startsWith('~/') ? path.join(home, m[0].slice(2)) : path.isAbsolute(m[0]) ? m[0] : acc.cwd ? path.resolve(acc.cwd, m[0]) : undefined
    if (!p) continue
    acc.shots.delete(p)
    acc.shots.add(p)
    if (acc.shots.size > SHOTS) acc.shots.delete(acc.shots.values().next().value!)
  }
}

function report(acc: Acc, id: string, text: string, t = acc.tools.get(id)) {
  if (!t || !AGENTS.has(t.name) || !text.trim() || text.startsWith('Async agent launched')) return
  acc.reports.delete(id)
  acc.reports.set(id, { id, label: clean(t.label ?? t.role ?? 'subagent', 120), ...(t.role ? { role: clean(t.role, 60) } : {}), text: clean(text, REPORT_MAX) })
}

function line(acc: Acc, raw: string, home: string) {
  let e: Obj
  try { e = JSON.parse(raw) as Obj } catch { return }
  if (e.isSidechain === true || (e.type !== 'user' && e.type !== 'assistant')) return
  if (typeof e.cwd === 'string') acc.cwd = e.cwd
  const content = (e.message as Obj | undefined)?.content
  if (e.type === 'assistant') {
    const t = texts(content)
    if (t.trim()) acc.final = t
    for (const b of blocks(content)) {
      if (b.type !== 'tool_use' || typeof b.id !== 'string' || typeof b.name !== 'string') continue
      const input = obj(b.input) ? b.input : {}
      const tool: Tool = { name: b.name }
      if (b.name === 'Bash' && typeof input.command === 'string') tool.cmd = input.command
      if (AGENTS.has(b.name)) { tool.label = typeof input.description === 'string' ? input.description : undefined; tool.role = typeof input.subagent_type === 'string' ? input.subagent_type : undefined }
      if ((b.name === 'AskUserQuestion' || b.name === 'mcp__switchboard__ask') && Array.isArray(input.questions)) tool.qs = input.questions.filter(obj).map(q => String(q.question ?? '')).filter(Boolean)
      acc.tools.set(b.id, tool)
      const file = input.file_path ?? input.notebook_path
      if (EDITS.has(b.name) && typeof file === 'string') acc.files.add(file)
      shotsIn(acc, JSON.stringify(input), home)
    }
    return
  }
  const said = texts(content)
  if (said.includes('<task-notification>')) {
    for (const n of said.split('<task-notification>').slice(1)) {
      const id = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(n)?.[1], res = /<result>([\s\S]*?)<\/result>/.exec(n)?.[1]
      if (id && res) { report(acc, id, res); acc.tools.delete(id) }
    }
  }
  for (const b of blocks(content)) {
    if (b.type !== 'tool_result' || typeof b.tool_use_id !== 'string') continue
    const id = b.tool_use_id, t = acc.tools.get(id), out = texts(b.content)
    shotsIn(acc, out, home)
    if (!t) continue
    if (t.cmd && isTestCommand(t.cmd)) {
      const { tail: _, ...o } = testOutcome(out)
      acc.tests.push({ command: clean(t.cmd, 160), ok: b.is_error !== true && !o.failed, ...o })
      if (acc.tests.length > TESTS) acc.tests.shift()
    }
    // Done with the call after this, unless it is a background agent whose report comes later in a task notification.
    if (!(AGENTS.has(t.name) && out.startsWith('Async agent launched'))) acc.tools.delete(id)
    if (AGENTS.has(t.name)) report(acc, id, out, t)
    if (b.is_error === true) {
      acc.errors.push({ tool: t.name, text: clean(out, ERROR_MAX) })
      if (acc.errors.length > ERRORS) acc.errors.shift()
      continue
    }
    if (t.qs) {
      const answers = obj(e.toolUseResult) && obj(e.toolUseResult.answers) ? e.toolUseResult.answers : undefined
      for (const q of t.qs) {
        const a = t.name === 'AskUserQuestion' ? answers?.[q] : out
        acc.questions.push({ question: clean(q, ANSWER_MAX), ...(typeof a === 'string' && a.trim() ? { answer: clean(a, ANSWER_MAX) } : {}) })
      }
    }
  }
}

/** Reports from the chat's subagent files whose Agent call the main transcript has no answer for. A file or role that fails to read is skipped. */
async function subReports(file: string, session: string, have: Map<string, ChatReport>, home: string, runs: typeof readRuns): Promise<ChatReport[]> {
  const dir = path.join(file.slice(0, -'.jsonl'.length), 'subagents')
  const metas = new Map<string, { role: string; toolUseId?: string }>()
  for (const n of await fs.promises.readdir(dir).catch(() => [] as string[])) {
    const m = /^agent-([A-Za-z0-9_-]+)\.meta\.json$/.exec(n)
    if (!m) continue
    try {
      const meta = JSON.parse(await fs.promises.readFile(path.join(dir, n), 'utf8')) as Obj
      if (typeof meta.agentType === 'string') metas.set(m[1], { role: meta.agentType, ...(typeof meta.toolUseId === 'string' ? { toolUseId: meta.toolUseId } : {}) })
    } catch { /* skipped */ }
  }
  const out: ChatReport[] = []
  for (const role of new Set([...metas.values()].map(m => m.role))) {
    const list = await runs(session, role, home).catch(() => [])
    for (const r of [...list].reverse()) {
      const id = metas.get(r.id)?.toolUseId ?? r.id
      if (have.has(id) || !r.reportText) continue
      out.push({ id, label: clean(r.title ?? role, 120), role: clean(role, 60), text: clean(r.reportText, REPORT_MAX) })
    }
  }
  return out
}

/** Everything useful the chat produced; null for an unknown session. */
export async function chatOutputs(session: string, deps: Deps = {}): Promise<ChatOutputs | null> {
  const home = deps.home ?? os.homedir(), scan = deps.scan ?? scanLines
  const file = await transcriptFile(session, home)
  if (!file) return null
  const prev = reading.get(file) ?? Promise.resolve(undefined)
  const next = prev.catch(() => undefined).then(async () => {
    const st = await fs.promises.stat(file)
    // A new file under the same name (inode or birth time changed) or a shorter one starts over.
    const id = `${st.ino}:${st.birthtimeMs}`
    let acc = accs.get(file)
    if (!acc || acc.id !== id || st.size < acc.offset) acc = fresh(id)
    accs.delete(file)
    accs.set(file, acc)
    if (accs.size > ACCS_MAX) accs.delete(accs.keys().next().value!)
    const a = acc
    if (st.size > a.offset) a.offset = await scan(file, a.offset, l => line(a, l, home))
    return a
  })
  reading.set(file, next)
  const a = await next.finally(() => { if (reading.get(file) === next) reading.delete(file) })
  const final = a.final ? clean(a.final, FINAL_MAX) : undefined
  const st = a.final ? standup(a.final) : undefined
  const commit = a.final ? commitMessage(a.final) : undefined
  const shots = (await Promise.all([...a.shots].map(p => fs.promises.stat(p).then(s => (s.isFile() ? p : undefined), () => undefined)))).filter((p): p is string => !!p)
  const extra = await subReports(file, session, a.reports, home, deps.runs ?? readRuns)
  const r = (s: string) => redact(s)
  return {
    ...(final ? { final } : {}),
    ...(st ? { standup: { done: st.done.map(r), left: st.left.map(r) } } : {}),
    ...(commit ? { commit: r(commit) } : {}),
    questions: a.questions.map(q => ({ question: r(q.question), ...(q.answer ? { answer: r(q.answer) } : {}) })),
    reports: [...a.reports.values(), ...extra],
    tests: a.tests.map(t => ({ ...t, command: r(t.command), ...(t.first ? { first: r(t.first) } : {}) })),
    errors: [...a.errors],
    files: [...a.files].map(r),
    shots,
  }
}

/** role: you, claude, tool (a call or its result, shown muted) or subagent (a task notification). */
export type ChatMessage = { role: 'you' | 'claude' | 'tool' | 'subagent'; text: string }
/** transcript: unsupported for a Codex chat whose rollout is not on this Mac. codex: read from a Codex rollout. */
export type ChatTranscript = { messages: ChatMessage[]; before: number | null; transcript?: 'unsupported'; codex?: true }

const firstLine = (s: string) => { const t = s.trimStart(), nl = t.indexOf('\n'); return clean(nl < 0 ? t : t.slice(0, nl), RESULT_MAX) }
// The fields toolTarget reads, redacted first: it cuts to 48, which could leave a key's prefix too short to match.
const TARGET_KEYS = ['command', 'pattern', 'file_path', 'notebook_path', 'path', 'subagent_type', 'description', 'url']
const safeInput = (input: Obj): Obj => Object.fromEntries(TARGET_KEYS.flatMap(k => typeof input[k] === 'string' ? [[k, redact((input[k] as string).slice(0, 4096))]] : []))

function codexMessagesOf(raw: string): ChatMessage[] {
  if (raw === SKIPPED) return [{ role: 'tool', text: 'A line over 16 MB was skipped' }]
  return codexTranscriptLine(raw).map(m => ({ role: m.role, text: clean(m.text, m.role === 'tool' ? RESULT_MAX : MESSAGE_MAX) }))
}

function messagesOf(raw: string): ChatMessage[] {
  if (raw === SKIPPED) return [{ role: 'tool', text: 'A line over 16 MB was skipped' }]
  let e: Obj
  try { e = JSON.parse(raw) as Obj } catch { return [] }
  if ((e.type !== 'user' && e.type !== 'assistant') || e.isMeta === true) return []
  const content = (e.message as Obj | undefined)?.content
  const out: ChatMessage[] = []
  if (typeof content === 'string') {
    if (content.includes('<task-notification>')) {
      const tag = (t: string) => new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(content)?.[1]?.trim()
      return [{ role: 'subagent', text: clean([tag('summary'), tag('result')].filter(Boolean).join('\n'), MESSAGE_MAX) }]
    }
    return content.trim() ? [{ role: e.type === 'user' ? 'you' : 'claude', text: clean(content, MESSAGE_MAX) }] : []
  }
  for (const b of blocks(content)) {
    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) out.push({ role: e.type === 'user' ? 'you' : 'claude', text: clean(b.text, MESSAGE_MAX) })
    else if (b.type === 'tool_use' && typeof b.name === 'string') out.push({ role: 'tool', text: redact([b.name, toolTarget(b.name, safeInput(obj(b.input) ? b.input : {}))].filter(Boolean).join(' ')) })
    else if (b.type === 'tool_result') out.push({ role: 'tool', text: `${b.is_error === true ? 'error' : 'result'}: ${firstLine(texts(b.content))}` })
  }
  return out
}

/** Up to 50 messages ending before byte before (default: the end), oldest first; before: for Load earlier, null at the start. Null for an unknown session. */
export async function chatTranscript(session: string, before?: number, deps: { home?: string } = {}): Promise<ChatTranscript | null> {
  const claude = await transcriptFile(session, deps.home)
  const file = claude ?? await codexRolloutFile(session, deps.home && path.join(deps.home, '.codex', 'sessions'))
  if (!file) return null
  const parse = claude ? messagesOf : codexMessagesOf
  const got: ChatMessage[][] = []
  let cur: number | null = before ?? (await fs.promises.stat(file)).size, count = 0, next: number | null = null
  while (cur !== null && count < PAGE) {
    const page = await pageBack(file, cur, PAGE)
    for (let i = page.lines.length - 1; i >= 0 && count < PAGE; i--) {
      const msgs = parse(page.lines[i].text)
      if (!msgs.length) continue
      got.push(msgs)
      count += msgs.length
      if (count >= PAGE) next = page.lines[i].at > 0 ? page.lines[i].at : null
    }
    cur = count < PAGE ? page.before : null
  }
  return { messages: got.reverse().flat(), before: next, ...(claude ? {} : { codex: true as const }) }
}

/** A Codex chat's outputs: only what its hook progress kept. */
export function progressOutputs(p: ChatProgress): ChatOutputs {
  const t = p.tests
  return {
    ...(p.report ? { standup: { done: p.report.done.map(redact), left: p.report.left.map(redact) } } : {}),
    ...(p.commit ? { commit: redact(p.commit) } : {}),
    questions: [], reports: [], errors: [], files: [], shots: [],
    tests: t ? [{ command: redact(t.command), ok: t.ok, ...(t.failed !== undefined ? { failed: t.failed } : {}), ...(t.total !== undefined ? { total: t.total } : {}), ...(t.first ? { first: redact(t.first) } : {}) }] : [],
    codex: true,
  }
}

const SHOT_MAX = 10 * 1024 * 1024
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
/** The image type its first bytes say, PNG, JPEG, GIF or WebP; undefined for anything else. */
function magic(b: Buffer): string | undefined {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.toString('latin1', 0, 6))) return 'image/gif'
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

/** A screenshot the chat's outputs list, as bytes and type; undefined unless it is listed, really an image (after links) and 10 MB or less. */
export async function chatShot(shots: string[], file: string): Promise<{ bytes: Buffer; type: string } | undefined> {
  if (!shots.includes(file) || !IMAGE_EXT.has(path.extname(file).toLowerCase())) return undefined
  const real = await fs.promises.realpath(file).catch(() => undefined)
  if (!real || !IMAGE_EXT.has(path.extname(real).toLowerCase())) return undefined
  const st = await fs.promises.stat(real).catch(() => undefined)
  if (!st?.isFile() || st.size > SHOT_MAX) return undefined
  const bytes = await fs.promises.readFile(real)
  const type = magic(bytes)
  return type ? { bytes, type } : undefined
}
