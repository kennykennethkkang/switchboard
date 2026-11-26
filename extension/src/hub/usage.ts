import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { writeJsonAtomic } from '../fs-utils'
import { projectName } from './projects'
import { costOf, costSplit, type UsageTokens } from './pricing'

export type UsageRow = UsageTokens & { day: string; ai: 'claude' | 'codex'; model: string; project: string; role: string; calls: number; searches: number; costUsd: number; split: { input: number; output: number; cacheRead: number; cacheWrite: number; search: number }; savedUsd: number; unpriced?: true }
export type UsageChat = { sessionId: string; ai: 'claude' | 'codex'; label: string; project: string; startedAt: number; lastAt: number; agents: number; models: string[]; days: Record<string, { costUsd: number; tokens: number; calls: number }> }
export type UsageReport = { at: number; from: string; rows: UsageRow[]; chats: UsageChat[]; since?: number }
type RecordTuple = [id: string, at: number, model: string, input: number, output: number, cacheRead: number, cacheWrite: number, thinking: number, write5m: number, write1h: number, searches: number, speed?: string]
type ParserState = { project?: string; cwd?: string; model?: string; role?: string; sessionId?: string; label?: string; lastTotal?: string; counter?: number; agentType?: string; metaRead?: boolean }
type FileCache = { offset: number; mtimeMs: number; records: RecordTuple[]; pending?: string; state: ParserState }
type Cache = { version: 2; files: Record<string, FileCache>; writtenAt: number }
const DAY = 86_400_000
const IDLE_MS = 10 * 60_000
const dayKey = (n: number) => { const d = new Date(n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const obj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null
const cleanN = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : 0
const cleanLabel = (s: string) => s.replace(/<[^>]*>/g, '').replace(/^\s*(?:\[[^\]]*\]\s*)+/, '').trim().slice(0, 80)
const TEMP = /^(\/private)?\/(tmp|var\/folders)\//
/** Test and script runs in temp folders are one row; a folder that was renamed or deleted reads as the part under its last living parent. */
export function projectOf(cwd: string): string {
  if (TEMP.test(cwd)) return 'Temporary runs'
  let dir = cwd
  while (!fs.existsSync(dir) && !fs.existsSync(path.dirname(dir))) dir = path.dirname(dir)
  return projectName(dir)
}
const contentText = (v: unknown): string => typeof v === 'string' ? v : Array.isArray(v) ? v.map(x => typeof x === 'string' ? x : obj(x) && typeof x.text === 'string' ? x.text : '').join('\n') : ''

const isEntry = (v: unknown): v is FileCache => obj(v) && Number.isSafeInteger(v.offset) && v.offset >= 0 && typeof v.mtimeMs === 'number' && obj(v.state) && ['project', 'cwd', 'model', 'role', 'sessionId', 'label', 'agentType'].every(k => v.state[k] === undefined || typeof v.state[k] === 'string') && (v.pending === undefined || typeof v.pending === 'string') && Array.isArray(v.records)
  && v.records.every((r: unknown) => Array.isArray(r) && typeof r[0] === 'string' && typeof r[2] === 'string' && [1, 3, 4, 5, 6, 7, 8, 9, 10].every(i => Number.isFinite(r[i])))

export class UsageScanner {
  private cache: Cache = { version: 2, files: {}, writtenAt: 0 }
  private loaded = false
  private running?: Promise<UsageReport>
  private latest?: UsageReport
  private unsaved = false
  private idle?: NodeJS.Timeout
  constructor(private readonly claudeRoot = path.join(os.homedir(), '.claude', 'projects'), private readonly days = 30, private readonly codexRoot = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions'), private readonly cachePath = path.join(os.homedir(), '.claude', 'switchboard', 'usage', 'cache.json')) {}
  report(now = Date.now()): Promise<UsageReport> {
    if (this.latest && now - this.latest.at < 60_000) return Promise.resolve(this.latest)
    return this.running ??= this.scan(now).finally(() => { this.running = undefined })
  }
  /** 0.21.153 kept the cache beside the window files, where every hook, mod and window parsed its 27 MB. */
  async moveOldCache(): Promise<void> {
    const old = path.join(path.dirname(path.dirname(this.cachePath)), 'usage-cache.json')
    if (!fs.existsSync(old)) return
    try {
      await fs.promises.mkdir(path.dirname(this.cachePath), { recursive: true })
      if (fs.existsSync(this.cachePath)) await fs.promises.rm(old)
      else await fs.promises.rename(old, this.cachePath)
    } catch { /* another window moved it */ }
  }
  private async scan(now: number): Promise<UsageReport> {
    if (!this.loaded) {
      this.loaded = true
      await this.moveOldCache()
      try { const c = JSON.parse(await fs.promises.readFile(this.cachePath, 'utf8')) as Cache; if (c.version === 2 && obj(c.files)) this.cache = { version: 2, files: Object.fromEntries(Object.entries(c.files).filter(([, f]) => isEntry(f))), writtenAt: cleanN(c.writtenAt) } } catch {}
    }
    const from = new Date(now)
    from.setHours(0, 0, 0, 0)
    from.setDate(from.getDate() - this.days + 1)
    const since = from.getTime()
    const files = [...await this.claudeFiles(), ...await this.codexFiles()]
    const live = new Set(files)
    let changed = false
    for (const file of files) {
      let stat: fs.Stats
      try { stat = await fs.promises.stat(file) } catch { continue }
      if (stat.mtimeMs < since) { if (this.cache.files[file]) { delete this.cache.files[file]; changed = true }; continue }
      let entry = this.cache.files[file]
      // Same size, new mtime: rewritten in place, so read it again.
      if (!entry || stat.size < entry.offset || (stat.size === entry.offset && stat.mtimeMs !== entry.mtimeMs)) { entry = { offset: 0, mtimeMs: 0, records: [], state: {} }; this.cache.files[file] = entry; changed = true }
      if (entry.offset === stat.size) { entry.mtimeMs = stat.mtimeMs; continue }
      const isCodex = file.startsWith(path.resolve(this.codexRoot) + path.sep)
      if (!isCodex && file.includes(`${path.sep}subagents${path.sep}`) && !entry.state.metaRead) {
        entry.state.metaRead = true
        try { const meta = JSON.parse(await fs.promises.readFile(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')); if (typeof meta.agentType === 'string') entry.state.agentType = meta.agentType } catch {}
      }
      let cursor = entry.offset
      let carry = entry.pending ? Buffer.from(entry.pending, 'base64') : Buffer.alloc(0)
      const recordIndex = new Map(entry.records.map((record, index) => [record[0], index]))
      let handle: fs.promises.FileHandle
      try { handle = await fs.promises.open(file, 'r') } catch { continue }
      try {
        while (cursor < stat.size) {
          const buf = Buffer.alloc(Math.min(1 << 20, stat.size - cursor))
          const { bytesRead } = await handle.read(buf, 0, buf.length, cursor)
          if (!bytesRead) break
          const start = cursor
          cursor += bytesRead
          const chunk = carry.length ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead)
          let lineStart = 0, nl: number
          while ((nl = chunk.indexOf(10, lineStart)) >= 0) {
            const line = chunk.subarray(lineStart, nl).toString('utf8')
            if (isCodex) codexLine(line, file, start + lineStart - carry.length, entry)
            else claudeLine(line, file, entry, recordIndex)
            lineStart = nl + 1
          }
          carry = Buffer.from(chunk.subarray(lineStart))
          await Promise.resolve()
        }
        entry.offset = cursor
        entry.pending = carry.length ? carry.toString('base64') : undefined
        entry.mtimeMs = stat.mtimeMs
        changed = true
      } finally { await handle.close() }
    }
    for (const file of Object.keys(this.cache.files)) if (!live.has(file)) { delete this.cache.files[file]; changed = true }
    for (const entry of Object.values(this.cache.files)) if (entry.records.some(r => r[1] < since)) { entry.records = entry.records.filter(r => r[1] >= since); changed = true }
    this.unsaved ||= changed
    if (now - this.cache.writtenAt >= 5 * 60_000) this.save(now)
    const report = makeReport(Object.entries(this.cache.files).flatMap(([file, entry]) => entry.records.map(record => ({ file, entry, record }))), now, since)
    this.latest = report
    clearTimeout(this.idle)
    this.idle = setTimeout(() => this.drop(), IDLE_MS)
    this.idle.unref?.()
    return report
  }
  private save(now: number): void {
    if (!this.unsaved) return
    this.unsaved = false
    this.cache.writtenAt = now
    try { writeJsonAtomic(this.cachePath, this.cache) } catch {}
  }
  /** The records are over 100 MB in memory; they go once the Usage page is left, and the next visit reads the file. */
  drop(now = Date.now()): void {
    if (this.running) return
    this.save(now)
    this.cache = { version: 2, files: {}, writtenAt: 0 }
    this.loaded = false
  }
  private async claudeFiles(): Promise<string[]> {
    const out: string[] = []
    const walk = async (dir: string) => {
      let entries: fs.Dirent[]
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) { const p = path.join(dir, e.name); if (e.isDirectory()) await walk(p); else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p) }
    }
    await walk(this.claudeRoot)
    return out.sort()
  }
  private async codexFiles(): Promise<string[]> {
    const out: string[] = []
    const walk = async (dir: string, depth: number) => {
      if (depth > 3) return
      let entries: fs.Dirent[]
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) { const p = path.join(dir, e.name); if (e.isDirectory()) await walk(p, depth + 1); else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p) }
    }
    await walk(this.codexRoot, 0)
    return out.sort()
  }
}

function claudeLine(line: string, file: string, entry: FileCache, recordIndex: Map<string, number>): void {
  let e: Record<string, any>
  try { e = JSON.parse(line) } catch { return }
  const state = entry.state, m = e.message, u = m?.usage
  if ((e.type === 'custom-title' || e.type === 'ai-title') && typeof (e.customTitle ?? e.aiTitle) === 'string') state.label = cleanLabel(e.customTitle ?? e.aiTitle)
  if (e.type === 'user' && !state.label) state.label = cleanLabel(contentText(m?.content))
  // A chat belongs to the folder it started in, not one it cd'd to.
  if (typeof e.cwd === 'string' && !state.cwd) { state.cwd = e.cwd; state.project = projectOf(e.cwd) }
  if (e.type !== 'assistant' || !u || m.model === '<synthetic>') return
  const at = Date.parse(e.timestamp)
  if (!Number.isFinite(at)) return
  state.counter = (state.counter ?? 0) + 1
  const id = typeof m.id === 'string' ? `c:${m.id}` : `c:${file}:${state.counter}`
  const model = typeof m.model === 'string' ? m.model : 'unknown'
  const idx = recordIndex.get(id)
  const tuple: RecordTuple = [id, at, model, cleanN(u.input_tokens), cleanN(u.output_tokens), cleanN(u.cache_read_input_tokens), cleanN(u.cache_creation_input_tokens), cleanN(u.output_tokens_details?.thinking_tokens), cleanN(u.cache_creation?.ephemeral_5m_input_tokens), cleanN(u.cache_creation?.ephemeral_1h_input_tokens), cleanN(u.server_tool_use?.web_search_requests), e.speed]
  if (idx === undefined) { recordIndex.set(id, entry.records.length); entry.records.push(tuple) }
  else entry.records[idx] = tuple
}
function codexLine(line: string, file: string, offset: number, entry: FileCache): void {
  let e: Record<string, any>
  try { e = JSON.parse(line) } catch { return }
  const state = entry.state, payload = e.payload
  if (e.type === 'session_meta') { state.cwd = payload?.cwd || state.cwd; state.project = state.cwd ? projectOf(state.cwd) : state.project; state.sessionId = payload?.id || state.sessionId }
  if (e.type === 'turn_context') { state.model = payload?.model || state.model; state.cwd = payload?.cwd || state.cwd; state.project = state.cwd ? projectOf(state.cwd) : state.project }
  if ((e.type === 'response_item' && payload?.type === 'message' && payload.role === 'user') || (e.type === 'event_msg' && payload?.type === 'user_message')) {
    const text = contentText(payload.content ?? payload.message).trim()
    const match = /^You are (the engineer|qa)\./.exec(text)
    if (match) state.role = match[1] === 'the engineer' ? 'engineer-codex' : 'qa-codex'
    if (!state.label) state.label = cleanLabel(text)
  }
  if (e.type !== 'event_msg' || payload?.type !== 'token_count') return
  const info = payload.info, usage = info?.last_token_usage, total = info?.total_token_usage
  if (!usage || !total) return
  const totalKey = JSON.stringify(total)
  if (totalKey === state.lastTotal) return
  state.lastTotal = totalKey
  state.counter = (state.counter ?? 0) + 1
  const at = Date.parse(e.timestamp)
  if (!Number.isFinite(at)) return
  const input = Math.max(0, cleanN(usage.input_tokens) - cleanN(usage.cached_input_tokens) - cleanN(usage.cache_write_input_tokens))
  entry.records.push([`x:${file}:${offset}`, at, state.model ?? 'unknown', input, cleanN(usage.output_tokens), cleanN(usage.cached_input_tokens), cleanN(usage.cache_write_input_tokens), cleanN(usage.reasoning_output_tokens), 0, 0, 0])
}
function makeReport(records: { file: string; entry: FileCache; record: RecordTuple }[], now: number, since: number): UsageReport {
  const unique = new Map<string, { file: string; entry: FileCache; record: RecordTuple }>()
  for (const item of records) { const [id, at] = item.record; if (at >= since && at <= now && !unique.has(`${id.startsWith('c:') ? 'claude' : 'codex'}:${id}`)) unique.set(`${id.startsWith('c:') ? 'claude' : 'codex'}:${id}`, item) }
  const rowMap = new Map<string, UsageRow>(), chats = new Map<string, UsageChat>(), agentRuns = new Map<string, Set<string>>()
  for (const { file, entry, record: r } of unique.values()) {
    const [id, at, model, input, output, cacheRead, cacheWrite, thinking, write5m, write1h, searches, speed] = r
    const ai = id.startsWith('c:') ? 'claude' : 'codex'
    const state = entry.state, project = state.project ?? path.basename(path.dirname(file)), role = ai === 'claude' ? (file.includes(`${path.sep}subagents${path.sep}`) ? state.agentType ?? 'subagent' : 'lead') : state.role ?? 'lead'
    const sessionId = ai === 'codex' ? state.sessionId ?? path.basename(file, '.jsonl') : path.basename(file.split(`${path.sep}subagents${path.sep}`)[0], '.jsonl')
    const t = { input, output, cacheRead, cacheWrite, thinking }
    const price = { cacheWrite5m: write5m || undefined, cacheWrite1h: write1h || undefined, searches, speed }
    const split = costSplit(model, t, price)
    const costUsd = split && split.input + split.output + split.cacheRead + split.cacheWrite + split.search
    const day = dayKey(at), key = [day, ai, model, project.toLowerCase(), role].join('|')
    const row = rowMap.get(key) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0, day, ai, model, project, role, calls: 0, searches: 0, costUsd: 0, split: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, search: 0 }, savedUsd: 0 }
    row.input += input; row.output += output; row.cacheRead += cacheRead; row.cacheWrite += cacheWrite; row.thinking += thinking; row.calls++; row.searches += searches
    if (costUsd === undefined) row.unpriced = true
    else {
      row.costUsd += costUsd
      row.split.input += split?.input ?? 0; row.split.output += split?.output ?? 0; row.split.cacheRead += split?.cacheRead ?? 0; row.split.cacheWrite += split?.cacheWrite ?? 0; row.split.search += split?.search ?? 0
    }
    row.savedUsd += (costOf(model, { input: cacheRead, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 }, { speed }) ?? 0) - (costOf(model, { input: 0, output: 0, cacheRead, cacheWrite: 0, thinking: 0 }, { speed }) ?? 0)
    rowMap.set(key, row)
    if (ai === 'codex' && role !== 'lead') continue
    const ck = `${ai}:${sessionId}`, chat = chats.get(ck) ?? { sessionId, ai, label: sessionId.slice(0, 8), project, startedAt: at, lastAt: at, agents: 0, models: [], days: {} }
    // A subagent's first prompt is its brief, not the chat's name.
    if (role === 'lead' && state.label) chat.label = state.label
    chat.startedAt = Math.min(chat.startedAt, at); chat.lastAt = Math.max(chat.lastAt, at); if (!chat.models.includes(model)) chat.models.push(model)
    if (ai === 'claude' && role !== 'lead') { const runs = agentRuns.get(ck) ?? new Set<string>(); runs.add(file); agentRuns.set(ck, runs); chat.agents = runs.size }
    const d = chat.days[day] ?? { costUsd: 0, tokens: 0, calls: 0 }; d.costUsd += costUsd ?? 0; d.tokens += input + output + cacheRead + cacheWrite; d.calls++; chat.days[day] = d; chats.set(ck, chat)
  }
  const rows = [...rowMap.values()], spellings = new Map<string, Map<string, number>>()
  for (const r of rows) { const k = r.project.toLowerCase(), m = spellings.get(k) ?? new Map(); m.set(r.project, (m.get(r.project) ?? 0) + r.calls); spellings.set(k, m) }
  for (const r of rows) r.project = [...spellings.get(r.project.toLowerCase())!.entries()].sort((a, b) => b[1] - a[1])[0][0]
  return { at: now, from: dayKey(since), rows, chats: [...chats.values()].sort((a, b) => totalCost(b) - totalCost(a)).slice(0, 200) }
}
const totalCost = (c: UsageChat) => Object.values(c.days).reduce((n, d) => n + d.costUsd, 0)
