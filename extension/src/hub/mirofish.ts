import { execFileSync, spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { MirofishPost, MirofishReport, MirofishState } from './types'

const API = 'http://localhost:5001/api'
const RUNNING_POLL_MS = 10_000
const IDLE_POLL_MS = 60_000

type Reply = { ok: boolean; status?: number; json(): Promise<unknown> }
type Fetch = (url: string, init?: RequestInit) => Promise<Reply>
type Timer = ReturnType<typeof setTimeout>
type Options = { dir?: string; translate?: (text: string) => Promise<string>; fetch?: Fetch; now?: () => number; setTimeout?: typeof setTimeout; clearTimeout?: typeof clearTimeout }
const dataOf = (v: unknown): unknown => v && typeof v === 'object' && 'data' in v ? (v as { data: unknown }).data : {}
// A sim that stopped this long ago is history, not a run to watch.
const FRESH_MS = 6 * 3600_000
const EXCERPT = 400
// Markdown to plain sentences: a heading ends with a period, emphasis markers go, words like simulation_id keep their underscores.
const excerptOf = (text: unknown) => {
  if (typeof text !== 'string') return undefined
  const lines = text.replace(/```[\s\S]*?```/g, ' ').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const head = /^#{1,6}\s/.test(l)
    const t = l.replace(/^#{1,6}\s+|^>\s*|^[-*+]\s+/, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/(\*\*|__|~~|`)(.+?)\1/g, '$2').replace(/(^|\s)[*_](\S(?:.*?\S)?)[*_](?=[\s.,;:!?]|$)/g, '$1$2').trim()
    return head && !/[.!?:\u3002\uff1a]$/.test(t) ? `${t}.` : t
  })
  const all = lines.join(' ').replace(/\s+/g, ' ').trim()
  if (all.length <= EXCERPT) return all || undefined
  const cut = all.slice(0, EXCERPT)
  const space = cut.lastIndexOf(' ')
  return `${(space > EXCERPT * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, '')}\u2026`
}
const timeOf = (v: unknown) => typeof v === 'string' ? Date.parse(v) : NaN
const doneRounds = (sim: Record<string, unknown>, run: Record<string, unknown>) => {
  const round = Number(run.current_round) || 0, rounds = Number(run.total_rounds) || 0
  return (run.twitter_completed === true && run.reddit_completed === true) || (sim.status !== 'running' && rounds > 0 && round >= rounds)
}
const FEED = 12
// Chinese, Japanese or Korean script: MiroFish's default output language is Chinese.
export const notEnglish = (t: string) => /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(t)
const firstHeading = (md: string) => md.match(/^#\s+(.+)$/m)?.[1]?.trim()
// A chat that ran the sim may start its own report; Switchboard steps in only after this.
const GRACE_MS = 2 * 60_000
// MiroFish writes progress every few seconds while it works.
const STALL_MS = 15 * 60_000
// A running sim whose round has not moved this long is shown as Stalled.
const SIM_STALL_MS = 30 * 60_000
const LOCK_STALE_MS = 30_000
const DISMISS_MS = 24 * 3600_000
const MAX_TRIES = 3
const RETRY_MS = 5 * 60_000
const REPORTS = path.join(os.homedir(), '.claude', 'switchboard', 'mirofish')

/** Writes <simId>.md and <simId>.json once; true when the report is on disk. */
export function saveReport(dir: string, simId: string, report: Record<string, unknown>): boolean {
  const md = path.join(dir, `${simId}.md`), meta = path.join(dir, `${simId}.json`)
  if (fs.existsSync(md) && fs.existsSync(meta)) return true
  const markdown = typeof report.markdown_content === 'string' ? report.markdown_content : ''
  if (!markdown.trim()) return false
  const outline = (report.outline && typeof report.outline === 'object' ? report.outline : {}) as Record<string, unknown>
  const title = String(outline.title ?? markdown.match(/^#\s+(.+)$/m)?.[1] ?? simId)
  const info: Omit<MirofishReport, 'file' | 'markdown'> = {
    simId, title, at: String(report.completed_at ?? new Date().toISOString()),
    ...(typeof report.report_id === 'string' ? { reportId: report.report_id } : {}),
    ...(typeof outline.summary === 'string' ? { summary: outline.summary } : {}),
    ...(typeof report.simulation_requirement === 'string' ? { requirement: report.simulation_requirement } : {}),
  }
  try {
    fs.mkdirSync(dir, { recursive: true })
    // Unique temp names: two windows saving the same report must not trip over one .tmp file.
    const tag = `${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
    for (const [file, text] of [[md, markdown], [meta, JSON.stringify(info, null, 1)]]) {
      try { fs.writeFileSync(`${file}.${tag}`, text); fs.renameSync(`${file}.${tag}`, file) } catch (err) { fs.rmSync(`${file}.${tag}`, { force: true }); throw err }
    }
    return true
  } catch { return false }
}

/** Saved reports, newest first, each with its text; an English copy (<simId>.en.md) wins over the original. */
export function savedReports(dir = REPORTS, keep = 5): MirofishReport[] {
  let files: string[] = []
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')) } catch { return [] }
  const list = files.flatMap(f => { try { return [{ ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), file: path.join(dir, f.replace(/\.json$/, '.md')) } as MirofishReport] } catch { return [] } })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, keep)
  for (const r of list) {
    const en = r.file.replace(/\.md$/, '.en.md')
    try {
      if (fs.existsSync(en)) {
        r.markdown = fs.readFileSync(en, 'utf8')
        Object.assign(r, { file: en, translated: true, title: firstHeading(r.markdown) ?? r.title })
        delete r.summary
      } else r.markdown = fs.readFileSync(r.file, 'utf8')
    } catch { /* listed without its text */ }
  }
  return list
}
const clip = (t: string, n = 160) => t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}\u2026`
// CREATE_COMMENT -> commented, LIKE_POST -> liked; anything new reads as its own words.
const VERBS: Record<string, string> = { CREATE_POST: 'posted', CREATE_COMMENT: 'commented', LIKE_POST: 'liked', LIKE_COMMENT: 'liked a comment', REPOST: 'reposted', QUOTE_POST: 'quoted', FOLLOW: 'followed', DISLIKE_POST: 'disliked' }
export function postOf(a: Record<string, unknown>): MirofishPost | undefined {
  const args = a.action_args && typeof a.action_args === 'object' ? a.action_args as Record<string, unknown> : {}
  const type = String(a.action_type ?? '')
  if (!type || type === 'DO_NOTHING') return undefined
  const text = [args.content, args.quote_content, args.post_content].find(t => typeof t === 'string' && t.trim()) as string | undefined
  return {
    at: String(a.timestamp ?? ''), who: String(a.agent_name ?? `Agent ${a.agent_id ?? '?'}`), platform: String(a.platform ?? ''),
    action: VERBS[type] ?? type.toLowerCase().replace(/_/g, ' '), ...(text ? { text: clip(text.replace(/\s+/g, ' ').trim()) } : {}),
  }
}

export class MirofishPoller {
  private readonly fetcher: Fetch
  private readonly dir: string
  private readonly noReportSince = new Map<string, number>()
  private readonly roundSeen = new Map<string, { round: number; at: number }>()
  private readonly translate?: (text: string) => Promise<string>
  private readonly english = new Map<string, string>()
  private translating = false
  private readonly now: () => number
  private readonly schedule: typeof setTimeout
  private readonly cancel: typeof clearTimeout
  private timer?: Timer
  private state?: MirofishState
  private stopped = true
  nextPollMs = IDLE_POLL_MS

  constructor(options: Options = {}) {
    this.fetcher = options.fetch ?? fetch
    this.dir = options.dir ?? REPORTS
    this.translate = options.translate
    this.now = options.now ?? Date.now
    this.schedule = options.setTimeout ?? setTimeout
    this.cancel = options.clearTimeout ?? clearTimeout
  }

  async poll(): Promise<MirofishState | undefined> {
    let running = false
    try {
      const list = await this.get(`${API}/simulation/list`)
      const simulations = Array.isArray(list) ? list as Record<string, unknown>[] : []
      // A running sim first; else the newest one that stopped or finished lately, so the report stage stays on the card.
      const ids = simulations.filter(s => typeof s.simulation_id === 'string')
      // Dismissed sims leave the card but still get their report.
      const hidden = this.dismissed()
      const sim = ids.find(s => s.status === 'running' && !hidden.has(String(s.simulation_id))) ?? ids
        .filter(s => !hidden.has(String(s.simulation_id)) && (s.status === 'stopped' || s.status === 'completed') && this.now() - timeOf(s.updated_at) < FRESH_MS)
        .sort((a, b) => timeOf(b.updated_at) - timeOf(a.updated_at))[0]
      if (!sim) {
        await this.saveOthers(ids, sim, hidden)
        this.englishReports()
        this.state = undefined
        this.nextPollMs = IDLE_POLL_MS
        return undefined
      }
      running = true
      const simId = sim.simulation_id as string
      const run = await this.get(`${API}/simulation/${encodeURIComponent(simId)}/run-status`) as Record<string, unknown>
      const round = Number(run.current_round) || 0, rounds = Number(run.total_rounds) || 0
      const roundsDone = doneRounds(sim, run)
      const startedAt = typeof run.started_at === 'string' ? run.started_at : undefined
      const startedMs = startedAt ? Date.parse(startedAt) : NaN
      const elapsedMs = Number.isFinite(startedMs) ? Math.max(0, this.now() - startedMs) : undefined
      const etaMs = elapsedMs !== undefined && round > 0 && rounds > round ? Math.round(elapsedMs / round * (rounds - round)) : undefined
      const percent = Math.min(100, Math.max(0, Number(run.progress_percent) || (rounds ? round / rounds * 100 : 0)))
      const state: MirofishState = {
        simId, step: roundsDone ? 'report' : 'rounds', round, rounds, percent,
        ...(startedAt ? { startedAt } : {}), ...(elapsedMs !== undefined ? { elapsedMs } : {}), ...(etaMs !== undefined ? { etaMs } : {}),
        reportReady: false,
      }
      if (!roundsDone) {
        const seen = this.roundSeen.get(simId)
        if (!seen || seen.round !== round) this.roundSeen.set(simId, { round, at: this.now() })
        // The backend's own update time counts too, so a reload does not restart the clock.
        const movedAt = Math.max(this.roundSeen.get(simId)!.at, (timeOf(run.updated_at) || timeOf(sim.updated_at) || 0))
        if (this.now() - movedAt > SIM_STALL_MS) state.stalled = true
        // The feed is a nice-to-have: a failed read keeps the progress.
        const feed = await this.get(`${API}/simulation/${encodeURIComponent(simId)}/actions?limit=${FEED * 2}`).catch(() => undefined) as { actions?: unknown } | undefined
        const posts = Array.isArray(feed?.actions) ? (feed.actions as Record<string, unknown>[]).flatMap(a => postOf(a) ?? []).slice(0, FEED) : []
        if (posts.length) state.feed = this.englishFeed(posts)
      }
      if (roundsDone) await this.report(state, String(run.runner_status ?? ''))
      const others = await this.saveOthers(ids, sim, hidden)
      this.englishReports()
      this.state = state
      this.nextPollMs = state.step === 'done' && !others.length ? IDLE_POLL_MS : RUNNING_POLL_MS
      return state
    } catch {
      this.nextPollMs = running ? RUNNING_POLL_MS : IDLE_POLL_MS
      return this.state
    }
  }

  // Ids with a .dismissed marker; markers older than a day are removed.
  private dismissed(): Set<string> {
    const out = new Set<string>()
    let files: string[] = []
    try { files = fs.readdirSync(this.dir).filter(f => f.endsWith('.dismissed')) } catch { return out }
    for (const f of files) {
      const file = path.join(this.dir, f)
      try { if (Date.now() - fs.statSync(file).mtimeMs > DISMISS_MS) fs.rmSync(file); else out.add(f.replace(/\.dismissed$/, '')) } catch { /* gone already */ }
    }
    return out
  }

  /** Hides a sim from the card in every window; a marker file next to the reports keeps it hidden. */
  dismiss(simId: string): void {
    try { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(path.join(this.dir, `${path.basename(simId)}.dismissed`), '') } catch { /* stays on the card */ }
    this.state = undefined
  }

  // Other sims that finished lately get their report too, not just the one on the card.
  private async saveOthers(ids: Record<string, unknown>[], sim: Record<string, unknown> | undefined, hidden: Set<string>): Promise<Record<string, unknown>[]> {
    const others = ids.filter(s => s !== sim && (((s.status === 'stopped' || s.status === 'completed') && this.now() - timeOf(s.updated_at) < FRESH_MS) || (hidden.has(String(s.simulation_id)) && s.status === 'running'))
      && !fs.existsSync(path.join(this.dir, `${s.simulation_id}.md`)) && !this.gaveUp(String(s.simulation_id))).slice(0, 3)
    for (const other of others) {
      const id = other.simulation_id as string
      const otherRun = await this.get(`${API}/simulation/${encodeURIComponent(id)}/run-status`).catch(() => undefined) as Record<string, unknown> | undefined
      if (otherRun && doneRounds(other, otherRun)) await this.report({ simId: id, step: 'report', round: 0, rounds: 0, percent: 100, reportReady: false }, String(otherRun.runner_status ?? '')).catch(() => undefined)
    }
    return others
  }

  // by-simulation answers with the report at any stage; 404 means none has started, so Switchboard starts one.
  private async report(state: MirofishState, runner: string): Promise<void> {
    const reply = await this.fetcher(`${API}/report/by-simulation/${encodeURIComponent(state.simId)}`)
    const report = reply.ok ? dataOf(await reply.json()) as Record<string, unknown> : {}
    if (typeof report.report_id === 'string') state.reportId = report.report_id
    if (report.status === 'completed') {
      const reportExcerpt = excerptOf(report.markdown_content), saved = saveReport(this.dir, state.simId, report)
      Object.assign(state, { step: 'done', reportReady: true, saved, ...(reportExcerpt ? { reportExcerpt } : {}) })
      if (!saved) Object.assign(state, { reportError: 'MiroFish finished the report but it came back empty.', reportGaveUp: true })
      return
    }
    let why: string | undefined
    if (report.status === 'failed') why = `MiroFish could not write the report: ${String(report.error ?? 'no reason given')}`
    else if (state.reportId) {
      const p = await this.get(`${API}/report/${encodeURIComponent(state.reportId)}/progress`).catch(() => undefined) as Record<string, unknown> | undefined
      state.reportPercent = Math.min(100, Math.max(0, Number(p?.progress) || 0))
      if (Array.isArray(p?.completed_sections)) state.reportSections = p.completed_sections.length
      // A backend that died mid-write leaves the report in planning or generating for good.
      // No progress file at all: judge by when the report was created.
      const moved = timeOf(p?.updated_at)
      if (!(this.now() - (Number.isNaN(moved) ? timeOf(report.created_at) : moved) > STALL_MS)) return
      why = `Report stalled at ${state.reportPercent}%`
    } else {
      if (reply.ok || reply.status !== 404) return
      const since = this.noReportSince.get(state.simId) ?? this.now()
      this.noReportSince.set(state.simId, since)
      if (this.now() - since < GRACE_MS) { state.reportPercent = 0; return }
    }
    await this.kick(state, runner, why)
  }

  // Non-English posts go out in one numbered batch at a time; their English shows from the next poll on.
  private englishFeed(posts: MirofishPost[]): MirofishPost[] {
    const need = posts.filter(p => p.text && notEnglish(p.text) && !this.english.has(p.text))
    if (this.translate && need.length && !this.translating) {
      this.translating = true
      if (this.english.size > 500) this.english.clear()
      void this.translate(need.map((p, i) => `${i + 1}. ${p.text}`).join('\n')).then(out => {
        for (const m of out.matchAll(/^(\d+)\.\s+(.+)$/gm)) { const text = need[Number(m[1]) - 1]?.text; if (text) this.english.set(text, m[2].trim()) }
      }).catch(() => undefined).finally(() => { this.translating = false })
    }
    return posts.map(p => p.text && this.english.has(p.text) ? { ...p, text: this.english.get(p.text), translated: true } : p)
  }

  // One saved report at a time gets an English copy; <simId>.en.pending keeps windows from doing the same one twice.
  private englishReports(): void {
    if (!this.translate || this.translating) return
    let files: string[] = []
    try { files = fs.readdirSync(this.dir).filter(f => f.endsWith('.json')) } catch { return }
    for (const f of files) {
      const md = path.join(this.dir, f.replace(/\.json$/, '.md')), en = md.replace(/\.md$/, '.en.md'), pending = md.replace(/\.md$/, '.en.pending')
      let text = ''
      try { if (fs.existsSync(en)) continue; text = fs.readFileSync(md, 'utf8') } catch { continue }
      if (!notEnglish(text)) continue
      try { if (Date.now() - fs.statSync(pending).mtimeMs > 10 * 60_000) fs.rmSync(pending) } catch { /* none */ }
      try { fs.closeSync(fs.openSync(pending, 'wx')) } catch { continue }
      this.translating = true
      // A failed try keeps the lock, so the next one waits for it to go stale instead of firing every poll.
      void this.translate(text).then(out => { if (out.trim()) { fs.writeFileSync(`${en}.tmp`, out); fs.renameSync(`${en}.tmp`, en); fs.rmSync(pending, { force: true }) } })
        .catch(() => undefined).finally(() => { this.translating = false })
      return
    }
  }

  private gaveUp(simId: string): boolean {
    try { return Number(JSON.parse(fs.readFileSync(path.join(this.dir, `${simId}.requested`), 'utf8')).n) >= MAX_TRIES } catch { return false }
  }

  // Asks MiroFish for the report: at most MAX_TRIES per sim, RETRY_MS apart, counted in <simId>.requested so every window agrees.
  private async kick(state: MirofishState, runner: string, why?: string): Promise<void> {
    const mark = path.join(this.dir, `${state.simId}.requested`)
    let tries = { n: 0, at: 0, error: '' }
    try { tries = { ...tries, ...JSON.parse(fs.readFileSync(mark, 'utf8')) } } catch { /* first try */ }
    const problem = why ?? (tries.error || undefined)
    if (tries.n >= MAX_TRIES) { Object.assign(state, { reportError: `${problem ?? 'Report did not start'}. Tried ${tries.n} times; open MiroFish to look.`, reportGaveUp: true }); return }
    if (tries.n && this.now() - tries.at < RETRY_MS) { if (problem) state.reportError = `${problem}. Trying again shortly.`; return }
    // Last look before asking: the chat that ran the sim may have just started its own report.
    if (!why) {
      const again = await this.fetcher(`${API}/report/by-simulation/${encodeURIComponent(state.simId)}`).catch(() => undefined)
      if (again?.ok) return
    }
    // Claim the try under an exclusive lock file and reread the count, so two windows never both post.
    const lock = `${mark}.lock`
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      try { if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmSync(lock) } catch { /* none */ }
      fs.closeSync(fs.openSync(lock, 'wx'))
    } catch { return }
    try {
      let fresh = { n: 0 }
      try { fresh = JSON.parse(fs.readFileSync(mark, 'utf8')) } catch { /* first try */ }
      if (Number(fresh.n) !== tries.n) return
      fs.writeFileSync(mark, JSON.stringify({ n: tries.n + 1, at: this.now(), error: '' }))
    } catch { return } finally { fs.rmSync(lock, { force: true }) }
    let error = ''
    try {
      // MiroFish writes the report in the request's language and defaults to Chinese.
      const post = (url: string, body: object) => this.fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en' }, body: JSON.stringify({ simulation_id: state.simId, ...body }) })
      // The runner idles at "running" after the last round, and generate answers 409 until it ends.
      if (runner === 'running' || runner === 'paused') await post(`${API}/simulation/stop`, {})
      const r = await post(`${API}/report/generate`, why ? { force_regenerate: true } : {})
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: unknown }
        error = `Report did not start: ${String(body.error ?? r.status ?? 'unknown error')}`
      }
    } catch (err) { error = `Report did not start: ${(err as Error).message}` }
    try { fs.writeFileSync(mark, JSON.stringify({ n: tries.n + 1, at: this.now(), error })) } catch { /* the count stays at the claim */ }
    if (error) state.reportError = `${error}. Trying again shortly.`
    else { state.reportPercent = 0; delete state.reportError }
  }

  /** Saved reports, newest first; the newest carries its markdown for the Live page. */
  reports(keep = 8): MirofishReport[] { return savedReports(this.dir, keep) }

  start(onState: (state: MirofishState | undefined) => void): void {
    if (!this.stopped) return
    this.stopped = false
    const tick = async () => {
      const state = await this.poll()
      if (this.stopped) return
      onState(state)
      this.timer = this.schedule(() => { void tick() }, this.nextPollMs)
    }
    void tick()
  }

  dispose(): void {
    this.stopped = true
    if (this.timer) this.cancel(this.timer)
    this.timer = undefined
  }

  private async get(url: string): Promise<unknown> {
    const response = await this.fetcher(url)
    if (!response.ok) throw new Error('MiroFish request failed')
    return dataOf(await response.json())
  }
}

const WEB = 'http://localhost:3100'
type OpenDeps = { fetch?: Fetch; folder?: () => string | undefined; start?: (dir: string) => string | void; waitMs?: number; sleep?: (ms: number) => Promise<void> }

// The backend on :5001 runs from <MiroFish>/backend, so its cwd names the checkout.
function mirofishFolder(): string | undefined {
  try {
    const pid = execFileSync('lsof', ['-tiTCP:5001', '-sTCP:LISTEN'], { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0]
    const cwd = execFileSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], { encoding: 'utf8', timeout: 5000 }).split('\n').find(l => l.startsWith('n'))?.slice(1)
    if (cwd && fs.existsSync(path.join(cwd, '..', 'frontend'))) return path.resolve(cwd, '..')
  } catch { /* backend down or lsof missing */ }
  const guess = path.join(os.homedir(), 'Documents', 'GitHub', 'MiroFish')
  return fs.existsSync(path.join(guess, 'frontend')) ? guess : undefined
}

// VS Code started from the Dock has a bare PATH, so look where Homebrew and nvm-less installs put npm.
const npmPath = () => [...(process.env.PATH ?? '').split(':'), '/opt/homebrew/bin', '/usr/local/bin'].map(dir => path.join(dir, 'npm')).find(runnable)
const runnable = (f: string) => { try { fs.accessSync(f, fs.constants.X_OK); return true } catch { return false } }

/** Starts vite in <MiroFish>/frontend; returns a problem when it cannot. */
function startWeb(dir: string): string | undefined {
  const npm = npmPath()
  if (!npm) return 'npm not found; start MiroFish with npm run dev in its checkout.'
  try {
    const logDir = path.join(os.homedir(), '.claude', 'switchboard')
    fs.mkdirSync(logDir, { recursive: true })
    const log = fs.openSync(path.join(logDir, 'mirofish-web.log'), 'a')
    const child = spawn(npm, ['run', 'dev'], { cwd: path.join(dir, 'frontend'), detached: true, stdio: ['ignore', log, log], env: { ...process.env, PATH: `${path.dirname(npm)}:${process.env.PATH ?? ''}` } })
    child.on('error', () => { /* shows as the 30s wait problem */ })
    child.unref()
    fs.closeSync(log)
  } catch (err) { return `Could not start MiroFish: ${(err as Error).message}` }
  return undefined
}

/** MiroFish's page for the sim, starting its web app (vite on :3100) first when it is down. Returns the url, or a problem. */
export async function mirofishPage(simId: string | undefined, deps: OpenDeps = {}): Promise<{ url: string } | { problem: string }> {
  const get = deps.fetch ?? fetch, sleep = deps.sleep ?? (ms => new Promise(r => setTimeout(r, ms)))
  // Vite answers in milliseconds; a hung port reads as down.
  const up = async () => { try { await get(WEB, { signal: AbortSignal.timeout(2000) }); return true } catch { return false } }
  const url = simId ? `${WEB}/simulation/${encodeURIComponent(simId)}/start` : WEB
  if (await up()) return { url }
  const dir = (deps.folder ?? mirofishFolder)()
  if (!dir) return { problem: 'MiroFish folder not found; start it with npm run dev in the MiroFish checkout.' }
  const problem = (deps.start ?? startWeb)(dir)
  if (problem) return { problem }
  for (let waited = 0; waited < (deps.waitMs ?? 30_000); waited += 500) {
    await sleep(500)
    if (await up()) return { url }
  }
  return { problem: 'MiroFish web app did not start in 30s; see ~/.claude/switchboard/mirofish-web.log.' }
}
