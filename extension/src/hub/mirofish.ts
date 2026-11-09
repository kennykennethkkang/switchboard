import type { MirofishState } from './types'

const API = 'http://localhost:5001/api'
const RUNNING_POLL_MS = 10_000
const IDLE_POLL_MS = 60_000

type Reply = { ok: boolean; json(): Promise<unknown> }
type Fetch = (url: string, init?: RequestInit) => Promise<Reply>
type Timer = ReturnType<typeof setTimeout>
type Options = { fetch?: Fetch; now?: () => number; setTimeout?: typeof setTimeout; clearTimeout?: typeof clearTimeout }
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

export class MirofishPoller {
  private readonly fetcher: Fetch
  private readonly now: () => number
  private readonly schedule: typeof setTimeout
  private readonly cancel: typeof clearTimeout
  private timer?: Timer
  private state?: MirofishState
  private stopped = true
  nextPollMs = IDLE_POLL_MS

  constructor(options: Options = {}) {
    this.fetcher = options.fetch ?? fetch
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
      const sim = ids.find(s => s.status === 'running') ?? ids
        .filter(s => (s.status === 'stopped' || s.status === 'completed') && this.now() - timeOf(s.updated_at) < FRESH_MS)
        .sort((a, b) => timeOf(b.updated_at) - timeOf(a.updated_at))[0]
      if (!sim) {
        this.state = undefined
        this.nextPollMs = IDLE_POLL_MS
        return undefined
      }
      running = true
      const simId = sim.simulation_id as string
      const run = await this.get(`${API}/simulation/${encodeURIComponent(simId)}/run-status`) as Record<string, unknown>
      const round = Number(run.current_round) || 0, rounds = Number(run.total_rounds) || 0
      const roundsDone = (run.twitter_completed === true && run.reddit_completed === true) || (sim.status !== 'running' && rounds > 0 && round >= rounds)
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
      if (roundsDone) {
        // by-simulation answers with the report and its status at any stage; 404 means none has started.
        const reply = await this.fetcher(`${API}/report/by-simulation/${encodeURIComponent(simId)}`)
        const report = reply.ok ? dataOf(await reply.json()) as Record<string, unknown> : {}
        const reportExcerpt = report.status === 'completed' ? excerptOf(report.markdown_content) : undefined
        if (reportExcerpt) Object.assign(state, { step: 'done', reportReady: true, reportExcerpt })
      }
      this.state = state
      this.nextPollMs = state.step === 'done' ? IDLE_POLL_MS : RUNNING_POLL_MS
      return state
    } catch {
      this.nextPollMs = running ? RUNNING_POLL_MS : IDLE_POLL_MS
      return this.state
    }
  }

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
