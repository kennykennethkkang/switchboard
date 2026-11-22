import type { CrowdLive, MirofishState } from './hub-types'

export type Tone = 'run' | 'done' | 'bad'
/** head: the verdict in a few words; short: lowercase-safe clause for the page headline; line: the full plain sentence. */
export type Story = { tone: Tone; head: string; short: string; line: string }
export type CrowdStory = Story & { confidence: 'clear' | 'lean' | 'close' | 'early'; leader?: string; leadPct: number; trailPct: number; decided: number }
export type MirofishStory = Story & { topic?: string }

const pct = (n: number, of: number) => of ? Math.round(n / of * 100) : 0

/** Time left in words: 5 s steps under a minute, then minutes, then hours. */
export function eta(ms: number): string {
  const s = ms / 1000
  if (s < 45) return `${Math.max(5, Math.round(s / 5) * 5)} s`
  const m = s / 60
  return m < 90 ? `${Math.max(1, Math.round(m))} min` : `${Math.round(m / 60)} h`
}

/** Verdict rule: top two options as a coin-flip sample; the lead share must clear the 95% margin of error (0.98 / sqrt(n)) to count as clear, half of it to lean. */
export function crowdStory(c: CrowdLive): CrowdStory {
  const sorted = [...c.votes].sort((a, b) => b.n - a.n)
  const decided = c.votes.reduce((s, v) => s + v.n, 0)
  const [top, next] = sorted
  const pair = (top?.n ?? 0) + (next?.n ?? 0)
  const leadPct = pct(top?.n ?? 0, decided), trailPct = pct(next?.n ?? 0, decided)
  const diff = pair ? top.n / pair - 0.5 : 0
  const margin = pair ? 0.98 / Math.sqrt(pair) : 1
  let confidence: CrowdStory['confidence'], head: string, verdict: string
  if (decided < 30) { confidence = 'early'; head = 'Too early to say'; verdict = `Too early to say, only ${decided} picks so far` }
  else if (c.noPreference > decided) { confidence = 'close'; head = 'No clear winner'; verdict = 'No clear winner, many had no preference' }
  else if (diff > margin) { confidence = 'clear'; head = `${top.label} ahead`; verdict = `${top.label} is clearly ahead, ${leadPct}% to ${trailPct}% of ${decided} who picked` }
  else if (diff > margin / 2) { confidence = 'lean'; head = `${top.label} slightly ahead`; verdict = `${top.label} is slightly ahead, ${leadPct}% to ${trailPct}% of ${decided} who picked, not settled yet` }
  else { confidence = 'close'; head = 'Too close to call'; verdict = `Too close to call, ${leadPct}% to ${trailPct}% of ${decided} who picked` }
  const leader = confidence === 'clear' || confidence === 'lean' ? top.label : undefined
  const base = { confidence, leader, leadPct, trailPct, decided }
  if (c.ended) {
    const final = verdict.replace(/ is (clearly|slightly) ahead/, ' won').replace(/, not settled yet$/, '')
    return { ...base, tone: 'done', head: leader ? `${leader} won` : head, short: leader ? `${leader} won` : head.toLowerCase(), line: `Finished. ${final}.` }
  }
  if (c.stopped) return { ...base, tone: 'bad', head: 'Stopped', short: 'stopped', line: `Stopped at ${c.done} of ${c.items} ratings, no new ones for 5 minutes. So far: ${leader ? verdict : verdict[0].toLowerCase() + verdict.slice(1)}.` }
  const left = c.done > 0 ? (c.items - c.done) * (c.lastAt - c.startedAt) / c.done : undefined
  const time = left !== undefined && left > 0 ? `, about ${eta(left)} to go` : ''
  return { ...base, tone: 'run', head, short: leader ? `${leader} ahead` : head.toLowerCase(), line: `${verdict}. ${c.done} of ${c.items} ratings in${time}.` }
}

const STOP = new Set('the and for that this with have has had are was were but not you your they them their what when which who how can will just like from about into than then there here been being would could should its it\'s i\'m dont don\'t never always very really also more most some any all one out too get got new use used still even much many only over after before while where does did doing make made want people'.split(' '))
const words = (t: string) => new Set((t.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []).filter(w => !STOP.has(w)))

/** The word most posts share, if two or more posts use it. */
function topic(feed: MirofishState['feed']): string | undefined {
  const seen = new Map<string, number>()
  for (const p of feed ?? []) for (const w of words(p.text ?? '')) seen.set(w, (seen.get(w) ?? 0) + 1)
  const best = [...seen].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0]
  return best?.[0]
}

export function mirofishStory(m: MirofishState): MirofishStory {
  const t = topic(m.feed)
  const voices = new Set((m.feed ?? []).map(p => p.who)).size
  const said = t ? `; people so far mostly talk about "${t}"` : voices ? `; ${voices} simulated ${voices === 1 ? 'person has' : 'people have'} spoken so far` : ''
  if (m.step === 'rounds' && m.stalled) return { tone: 'bad', head: 'Stalled', short: 'stalled', topic: t, line: `Stalled at round ${m.round} of ${m.rounds}, no progress for 30 minutes. MiroFish may have stopped.` }
  if (m.step === 'rounds') {
    const left = m.etaMs !== undefined ? `, report in about ${eta(m.etaMs)}` : ''
    return { tone: 'run', head: `Round ${m.round} of ${m.rounds}`, short: m.etaMs !== undefined ? `report in about ${eta(m.etaMs)}` : `round ${m.round} of ${m.rounds}`, topic: t, line: `${m.round} of ${m.rounds} rounds done${left}${said}.` }
  }
  if (m.reportGaveUp || m.reportError) return { tone: 'bad', head: 'Report hit a problem', short: 'the report hit a problem', topic: t, line: `${m.reportError ?? 'MiroFish did not finish the report'}.`.replace(/\.\.$/, '.') }
  if (m.step === 'done') return m.saved
    ? { tone: 'done', head: 'Report saved', short: 'report saved', topic: t, line: 'All rounds done and the report is saved. Read it in the list below.' }
    : { tone: 'run', head: 'Saving the report', short: 'saving the report', topic: t, line: 'The report is written. Switchboard saves it on the next check.' }
  const sec = m.reportSections ? ` ${m.reportSections} section${m.reportSections === 1 ? '' : 's'} written.` : ''
  return { tone: 'run', head: 'Writing the report', short: 'writing the report', topic: t, line: `All ${m.rounds} rounds done. Writing the report, a few minutes.${sec}` }
}

/** Still moving: rounds or report under way, not stalled, report not given up. */
export const mfRunning = (m: MirofishState) => m.step !== 'done' && !m.stalled && !m.reportGaveUp

/** One sentence for the top of the page: how many runs are live and where each stands. */
export function liveHeadline(m?: MirofishState, c?: CrowdLive, reports = 0): string {
  const ms = m && mfRunning(m) ? mirofishStory(m) : undefined
  const cs = c && !c.ended && !c.stopped ? crowdStory(c) : undefined
  const n = (ms ? 1 : 0) + (cs ? 1 : 0)
  const parts = [n ? `${n} test${n === 1 ? '' : 's'} running.` : 'Nothing running.']
  const crowdPart = c && (cs ?? crowdStory(c))
  if (crowdPart) parts.push(`Crowd: ${crowdPart.short}.`)
  const mfPart = m && (ms ?? mirofishStory(m))
  if (mfPart) parts.push(`MiroFish: ${mfPart.short}.`)
  if (!n && !c && !m && reports) parts.push(`${reports} saved report${reports === 1 ? '' : 's'} to read.`)
  return parts.join(' ')
}
