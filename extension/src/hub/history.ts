/**
 * Usage history for the Hub: tokens per day and per session from Claude Code's
 * transcripts (~/.claude/projects/<project>/<session>.jsonl and their subagents).
 *
 * Reads each file once and then only what was appended (a per-file byte offset),
 * yielding between chunks so the extension host never stalls on 1 GB of logs. The offsets and totals are saved
 * for every window, so a reload reads only what was appended since, not the two weeks again.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { SYSTEM_CONTENT_PREFIXES } from '../constants'
import { projectName } from './projects'
import type { DayUsage, SessionRow } from './types'
import { UsageScanner, type UsageReport } from './usage'

const DAY_MS = 86_400_000
const CHUNK = 1 << 20
const LABEL_MAX = 80
const SESSIONS_MAX = 30
const SAVE_EVERY_MS = 5 * 60_000
// Under the five minutes an open view waits between scans, so the totals go in between.
const IDLE_MS = 60_000
const SAVE_VERSION = 1

type Day = { reread: number; written: number; io: number; calls: number }
type SavedMessage = [id: string, day: string, reread: number, written: number, io: number, at: number]
type Tally = {
  offset: number
  mtimeMs: number
  sessionKey: string
  isMain: boolean
  days: [string, Day][]
  label?: string
  title?: string
  project?: string
  reread: number
  calls: number
  startedAt?: number
  lastAt?: number
  messages: SavedMessage[]
  fileKey: string
}

type SavedTally = Omit<Tally, 'fileKey'>
type Saved = { version: number; savedAt: number; files: Record<string, SavedTally> }

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const isDay = (v: unknown): v is [string, Day] => Array.isArray(v) && typeof v[0] === 'string' && !!v[1] && [v[1].reread, v[1].written, v[1].io, v[1].calls].every(num)
const isMessage = (v: unknown): v is SavedMessage => Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string' && v.length === 6 && v.slice(2).every(num)
const isTally = (v: unknown): v is SavedTally => {
  const t = v as SavedTally
  return !!t && num(t.offset) && num(t.mtimeMs) && num(t.reread) && num(t.calls) && typeof t.sessionKey === 'string' && typeof t.isMain === 'boolean'
    && Array.isArray(t.days) && Array.isArray(t.messages)
    && [t.label, t.title, t.project].every(x => x === undefined || typeof x === 'string') && [t.startedAt, t.lastAt].every(x => x === undefined || num(x))
}

/** Local calendar day, YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const yieldToHost = () => new Promise<void>(resolve => setImmediate(resolve))

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const block = content.find(b => b && typeof b === 'object' && (b as { type?: string }).type === 'text')
    return typeof block?.text === 'string' ? block.text : ''
  }
  return ''
}

export class HistoryScanner {
  private readonly tallies = new Map<string, Tally>()
  private owners?: Map<string, string>
  private readonly messageIndexes = new Map<string, Map<string, number>>()
  private readonly reports: UsageScanner
  private running?: Promise<{ history: DayUsage[]; sessions: SessionRow[] }>
  private loaded = false
  private savedAt = 0
  private unsaved = false
  private idle?: NodeJS.Timeout

  constructor(
    private readonly root = path.join(os.homedir(), '.claude', 'projects'),
    private readonly days = 14,
    codexRoot = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions'),
    cachePath = path.join(os.homedir(), '.claude', 'switchboard', 'usage', 'cache.json'),
    /** Where the scan is kept between reloads; none: never saved. */
    private readonly savePath?: string,
  ) { this.reports = new UsageScanner(root, 30, codexRoot, cachePath) }

  moveOldCache(): Promise<void> { return this.reports.moveOldCache() }
  report(now = Date.now()): Promise<UsageReport> { return this.reports.report(now) }

  // Overlapping scans share tally offsets, so they share one run.
  scan(now = Date.now()): Promise<{ history: DayUsage[]; sessions: SessionRow[] }> {
    return this.running ??= this.doScan(now).finally(() => { this.running = undefined })
  }

  private async doScan(now: number): Promise<{ history: DayUsage[]; sessions: SessionRow[] }> {
    const since = now - this.days * DAY_MS
    await this.load(since)
    let changed = false
    for (const file of (await this.files()).sort((a, b) => a.path.localeCompare(b.path))) {
      let stat: fs.Stats
      try { stat = await fs.promises.stat(file.path) } catch { continue }
      if (stat.mtimeMs < since) continue
      let tally = this.tallies.get(file.path)
      if (!tally || stat.size < tally.offset) {
        tally = { offset: 0, mtimeMs: 0, sessionKey: file.sessionKey, isMain: file.isMain, days: [], reread: 0, calls: 0, messages: [], fileKey: file.path }
        this.tallies.set(file.path, tally)
        this.messageIndexes.delete(file.path)
      }
      if (stat.size === tally.offset && stat.mtimeMs === tally.mtimeMs) continue
      await this.read(file.path, tally, stat.size)
      tally.mtimeMs = stat.mtimeMs
      changed = true
    }
    this.unsaved ||= changed
    if (this.unsaved) await this.save(now, since)
    clearTimeout(this.idle)
    this.idle = setTimeout(() => this.drop(), IDLE_MS)
    this.idle.unref?.()
    return { history: this.history(now), sessions: this.sessions(since) }
  }

  private async load(since: number): Promise<void> {
    if (this.loaded || !this.savePath) return
    this.loaded = true
    let saved: Saved
    try { saved = JSON.parse(await fs.promises.readFile(this.savePath, 'utf8')) as Saved } catch { return }
    if (saved?.version !== SAVE_VERSION || typeof saved.files !== 'object' || !saved.files) return
    this.owners = new Map()
    for (const [file, t] of Object.entries(saved.files).sort(([a], [b]) => a.localeCompare(b))) {
      if (!isTally(t)) { this.unsaved = true; continue }
      if (t.mtimeMs < since) { this.unsaved = true; continue }
      const tally: Tally = { ...t, days: t.days.filter(isDay).map(([day, d]) => [day, { ...d }]), messages: [], fileKey: file }
      for (const message of t.messages.filter(isMessage)) {
        const [id, day, reread, written, io] = message
        if (this.owners.has(id)) {
          const total = tally.days.find(entry => entry[0] === day)?.[1]
          if (total) { total.reread -= reread; total.written -= written; total.io -= io; total.calls-- }
          tally.reread -= reread
          tally.calls--
          continue
        }
        this.owners.set(id, file)
        tally.messages.push(message)
      }
      if (tally.messages.length !== t.messages.length) {
        tally.startedAt = undefined
        tally.lastAt = undefined
        for (const message of tally.messages) {
          tally.startedAt = Math.min(tally.startedAt ?? message[5], message[5])
          tally.lastAt = Math.max(tally.lastAt ?? message[5], message[5])
        }
        this.unsaved = true
      }
      this.tallies.set(file, tally)
    }
    this.savedAt = num(saved.savedAt) ? saved.savedAt : 0
  }

  /** Any window's save is whole on its own, so the last one wins; the next reload reads what it lacks. */
  private async save(now: number, since: number, force = false): Promise<boolean> {
    if (!this.savePath || !this.unsaved) return true
    if (!force && now - this.savedAt < SAVE_EVERY_MS) return false
    const files: Saved['files'] = {}
    for (const [file, { fileKey: _, ...t }] of this.tallies) {
      if (t.mtimeMs < since) continue
      files[file] = { ...t, days: t.days.filter(isDay), messages: t.messages.filter(isMessage) }
    }
    // Turned to text before any wait: a scan may change the totals meanwhile.
    const text = JSON.stringify({ version: SAVE_VERSION, savedAt: now, files } satisfies Saved)
    const tmp = `${this.savePath}.${process.pid}.tmp`
    this.savedAt = now
    this.unsaved = false
    try {
      await fs.promises.mkdir(path.dirname(this.savePath), { recursive: true })
      await fs.promises.writeFile(tmp, text, { mode: 0o600 })
      await fs.promises.rename(tmp, this.savePath)
      return true
    } catch { this.unsaved = true; return false }
  }

  async drop(now = Date.now()): Promise<void> {
    if (this.running) return
    clearTimeout(this.idle)
    if (!await this.save(now, now - this.days * DAY_MS, true)) return
    if (this.running || (this.savePath && this.unsaved)) return
    this.tallies.clear()
    this.owners?.clear()
    this.owners = undefined
    this.messageIndexes.clear()
    this.loaded = false
  }

  private async files(): Promise<Array<{ path: string; sessionKey: string; isMain: boolean }>> {
    const out: Array<{ path: string; sessionKey: string; isMain: boolean }> = []
    let projects: fs.Dirent[] = []
    try { projects = await fs.promises.readdir(this.root, { withFileTypes: true }) } catch { return out }
    for (const p of projects) {
      if (!p.isDirectory()) continue
      const dir = path.join(this.root, p.name)
      let entries: fs.Dirent[] = []
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { continue }
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.jsonl')) {
          out.push({ path: path.join(dir, e.name), sessionKey: e.name.slice(0, -6), isMain: true })
        } else if (e.isDirectory()) {
          const session = e.name
          const walk = async (sub: string) => {
            let subs: fs.Dirent[] = []
            try { subs = await fs.promises.readdir(sub, { withFileTypes: true }) } catch { return }
            for (const item of subs) {
              const p = path.join(sub, item.name)
              if (item.isDirectory()) await walk(p)
              else if (item.isFile() && item.name.endsWith('.jsonl') && p.includes(`${path.sep}subagents${path.sep}`)) out.push({ path: p, sessionKey: session, isMain: false })
            }
          }
          await walk(path.join(dir, session, 'subagents'))
        }
      }
    }
    return out.sort((a, b) => a.path.localeCompare(b.path))
  }

  private async read(file: string, tally: Tally, size: number): Promise<void> {
    if (!this.owners) {
      this.owners = new Map()
      for (const [key, item] of this.tallies) for (const message of item.messages) if (Array.isArray(message) && typeof message[0] === 'string' && !this.owners.has(message[0])) this.owners.set(message[0], key)
    }
    if (!this.messageIndexes.has(file)) {
      tally.days = tally.days.filter(isDay)
      tally.messages = tally.messages.filter(isMessage)
      this.messageIndexes.set(file, new Map(tally.messages.map(([id], i) => [id, i])))
    }
    const handle = await fs.promises.open(file, 'r')
    try {
      let carry = ''
      let position = tally.offset
      const buffer = Buffer.alloc(CHUNK)
      while (position < size) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(CHUNK, size - position), position)
        if (bytesRead === 0) break
        position += bytesRead
        const text = carry + buffer.toString('utf8', 0, bytesRead)
        const lastNewline = text.lastIndexOf('\n')
        if (lastNewline < 0) { carry = text; continue }
        for (const line of text.slice(0, lastNewline).split('\n')) this.line(line, tally)
        carry = text.slice(lastNewline + 1)
        // Count only up to the last complete line; a partial one is read again next time.
        tally.offset = position - Buffer.byteLength(carry, 'utf8')
        await yieldToHost()
      }
    } finally {
      await handle.close()
    }
  }

  private line(line: string, tally: Tally): void {
    const hasUsage = line.includes('"usage"')
    const wantsLabel = tally.isMain && !tally.label && line.includes('"type":"user"')
    const isTitle = tally.isMain && line.includes('"custom-title"')
    if (!hasUsage && !wantsLabel && !isTitle && tally.project) return
    let entry: Record<string, unknown>
    try { entry = JSON.parse(line) } catch { return }
    if (isTitle && entry.type === 'custom-title' && typeof entry.customTitle === 'string') {
      tally.title = entry.customTitle.slice(0, LABEL_MAX)
      return
    }
    const cwd = typeof entry.cwd === 'string' ? entry.cwd : undefined
    if (cwd && !tally.project) tally.project = projectName(cwd)
    const ts = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN
    const message = entry.message as { id?: string; role?: string; content?: unknown; usage?: Record<string, number> } | undefined
    if (wantsLabel && entry.type === 'user' && message?.role === 'user') {
      const text = textOf(message.content).trim()
      // A chat opened with a slash command is named by what was typed after it.
      const args = /^<command-(?:message|name)>/.test(text) ? /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim() : undefined
      // A chat that opened with a paste is named by the paste's first line.
      const pasted = /^<pasted_content[^>]*>\s*([^\n<]*)/.exec(text)?.[1]?.trim()
      if (args) {
        tally.label = args.split('\n')[0].slice(0, LABEL_MAX)
      } else if (text.startsWith('<pasted_content')) {
        tally.label = `Pasted: ${pasted || 'text'}`.slice(0, LABEL_MAX)
      } else if (text && !text.startsWith('<command-message>') && !SYSTEM_CONTENT_PREFIXES.some(prefix => text.startsWith(prefix))) {
        tally.label = text.split('\n')[0].slice(0, LABEL_MAX)
      }
    }
    const u = message?.usage
    if (!hasUsage || entry.type !== 'assistant' || !u || Number.isNaN(ts)) return
    const id = typeof message?.id === 'string' ? message.id : `${ts}:${tally.calls}`
    const owner = this.owners?.get(id)
    if (owner && owner !== tally.fileKey) return
    if (this.owners && !owner) this.owners.set(id, tally.fileKey)
    const messageAt = this.messageIndexes.get(tally.fileKey)?.get(id)
    const previous = messageAt === undefined ? undefined : tally.messages[messageAt]
    if (previous) {
      const old = tally.days.find(entry => isDay(entry) && entry[0] === previous[1])?.[1]
      if (old) { old.reread -= previous[2]; old.written -= previous[3]; old.io -= previous[4]; old.calls--; tally.reread -= previous[2]; tally.calls-- }
    }
    const reread = u.cache_read_input_tokens ?? 0
    const day = dayKey(ts)
    let d = tally.days.find(entry => isDay(entry) && entry[0] === day)?.[1]
    if (!d) { d = { reread: 0, written: 0, io: 0, calls: 0 }; tally.days.push([day, d]) }
    d.reread += reread
    d.written += u.cache_creation_input_tokens ?? 0
    d.io += (u.input_tokens ?? 0) + (u.output_tokens ?? 0)
    d.calls += 1
    tally.reread += reread
    tally.calls += 1
    tally.startedAt = Math.min(tally.startedAt ?? ts, ts)
    tally.lastAt = Math.max(tally.lastAt ?? ts, ts)
    const tuple: SavedMessage = [id, day, reread, u.cache_creation_input_tokens ?? 0, (u.input_tokens ?? 0) + (u.output_tokens ?? 0), ts]
    const index = this.messageIndexes.get(tally.fileKey)!
    const tupleIndex = index.get(id)
    if (tupleIndex === undefined) { index.set(id, tally.messages.length); tally.messages.push(tuple) }
    else tally.messages[tupleIndex] = tuple
  }

  private history(now: number): DayUsage[] {
    const out: DayUsage[] = []
    for (let i = this.days - 1; i >= 0; i--) {
      const day = dayKey(now - i * DAY_MS)
      const sum = { day, reread: 0, written: 0, io: 0, calls: 0, sessions: 0 }
      const sessions = new Set<string>()
      for (const t of this.tallies.values()) {
        const d = t.days.find(entry => isDay(entry) && entry[0] === day)?.[1]
        if (!d) continue
        sum.reread += d.reread; sum.written += d.written; sum.io += d.io; sum.calls += d.calls
        if (d.calls > 0) sessions.add(t.sessionKey)
      }
      sum.sessions = sessions.size
      out.push(sum)
    }
    return out
  }

  private sessions(since: number): SessionRow[] {
    const rows = new Map<string, SessionRow>()
    for (const t of this.tallies.values()) {
      if (t.lastAt === undefined) continue
      const row = rows.get(t.sessionKey) ?? { sessionId: t.sessionKey, label: '', project: '', reread: 0, calls: 0, startedAt: t.startedAt ?? t.lastAt, lastAt: t.lastAt }
      row.reread += t.reread
      row.calls += t.calls
      row.startedAt = Math.min(row.startedAt, t.startedAt ?? row.startedAt)
      row.lastAt = Math.max(row.lastAt, t.lastAt)
      if (t.isMain) { row.label = t.title ?? t.label ?? row.label; row.project = t.project ?? row.project }
      rows.set(t.sessionKey, row)
    }
    return [...rows.values()]
      .filter(r => r.lastAt >= since)
      .map(r => ({ ...r, label: r.label || r.sessionId.slice(0, 8) }))
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, SESSIONS_MAX)
  }
}

export const usageHistory = new HistoryScanner(undefined, undefined, undefined, undefined, path.join(os.homedir(), '.claude', 'switchboard', 'usage', 'history.json'))
