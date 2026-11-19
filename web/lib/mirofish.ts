import type { MirofishState } from './hub-types'

export const duration = (ms?: number) => {
  if (ms === undefined) return 'unknown'
  const minutes = Math.max(0, Math.round(ms / 60_000))
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export type Stage = 'rounds' | 'report' | 'saved'

/** Where the sim is, in words: what is happening now and what comes next. */
export function mirofishStatus(m: MirofishState): { stage: Stage; head: string; sub: string; tone: 'run' | 'done' | 'bad'; bar?: number } {
  if (m.step === 'rounds' && m.stalled) return { stage: 'rounds', head: `Stalled at round ${m.round} of ${m.rounds}`, sub: 'No progress for 30 minutes. MiroFish may have stopped. Dismiss it to clear the card.', tone: 'bad' }
  if (m.step === 'rounds') return { stage: 'rounds', head: `Running round ${m.round} of ${m.rounds}`, sub: `About ${duration(m.etaMs)} left. Then the report is written and saved here.`, tone: 'run', bar: m.percent }
  if (m.reportGaveUp) return { stage: 'report', head: 'Report needs a look', sub: m.reportError ?? 'MiroFish did not finish the report.', tone: 'bad' }
  if (m.step === 'done') return m.saved
    ? { stage: 'saved', head: 'Finished. Report saved', sub: 'Read it under MiroFish reports.', tone: 'done' }
    : { stage: 'report', head: 'Report written, saving it', sub: 'Switchboard saves it on the next check.', tone: 'run' }
  if (m.reportError) return { stage: 'report', head: 'Report hit a problem', sub: m.reportError, tone: 'bad' }
  const sections = m.reportSections ? ` ${m.reportSections} section${m.reportSections === 1 ? '' : 's'} written.` : ''
  return { stage: 'report', head: 'Rounds finished. Writing the report', sub: `This takes a few minutes.${sections}`, tone: 'run', bar: m.reportPercent ?? 0 }
}
