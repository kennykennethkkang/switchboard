/** The Live page's Source check section: a run's one-line tally, a source's host and a band's color. */
import type { HubState } from './hub-types'

export type SourceRun = NonNullable<HubState['sourceChecks']>[number]
export type Source = SourceRun['sources'][number]
export type Band = Source['band']

const ORDER: Band[] = ['Reliable', 'Mixed', 'Unreliable', 'Satire', 'Retracted', 'Unverifiable']

/** color: a --hub-<color> token. look: the band says to check the source before relying on it. */
export const bandTone = (band: Band): { color: 'green' | 'yellow' | 'red' | 'violet' | 'ash'; look: boolean } =>
  band === 'Reliable' ? { color: 'green', look: false }
  : band === 'Mixed' ? { color: 'yellow', look: false }
  : band === 'Satire' ? { color: 'violet', look: true }
  : band === 'Unverifiable' ? { color: 'ash', look: true }
  : { color: 'red', look: true }

export function summaryLine(sources: Pick<Source, 'band'>[]): string {
  if (!sources.length) return 'No sources yet'
  const parts = ORDER.map(b => [b, sources.filter(s => s.band === b).length] as const).filter(([, n]) => n).map(([b, n]) => `${n} ${b.toLowerCase()}`)
  return `${sources.length} source${sources.length === 1 ? '' : 's'}: ${parts.join(', ')}`
}

export function siteOf(url: string): { host: string; path: string } {
  try {
    const u = new URL(url)
    return { host: u.hostname.replace(/^www\./, ''), path: u.pathname === '/' ? '' : u.pathname }
  } catch { return { host: url, path: '' } }
}

/** Runs the CLI is still writing; the Live tab's count. */
export const runningChecks = (runs: SourceRun[] | undefined) => runs?.filter(r => !r.done).length ?? 0
