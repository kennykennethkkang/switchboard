import type { SmartPickRow, SmartState } from './hub-types'
export type { SmartPickRow, SmartState }
export type SmartRate = SmartState['rates'][number]
export type SmartVerdict = SmartPickRow['verdict']

export const SMART_KINDS: Array<[string, string]> = [['ponytail', 'Ponytail'], ['model', 'Model'], ['effort', 'Effort'], ['role', 'Role'], ['question', 'Questions']]

/** Laplace rate, same as the extension scorer, so the web ranks picks the way the pick rule does. */
export const laplace = (r: Pick<SmartRate, 'n' | 'useful'>) => (r.useful + 1) / (r.n + 2)
/** Whole percent of picks kept, from the raw counts. */
export const keptPct = (r: Pick<SmartRate, 'n' | 'useful'>) => r.n ? Math.round(100 * r.useful / r.n) : 0
export const keptText = (r: Pick<SmartRate, 'n' | 'useful'>) => `kept ${keptPct(r)}% of ${r.n}`

/** Per kind: the best pick per task (highest Laplace rate), tasks A to Z. Kinds with no rows are left out. */
export function bestByKind(rates: SmartRate[]): Array<{ kind: string; label: string; rows: SmartRate[] }> {
  return SMART_KINDS.flatMap(([kind, label]) => {
    const best = new Map<string, SmartRate>()
    for (const r of rates) if (r.kind === kind && r.n > 0) { const cur = best.get(r.task); if (!cur || laplace(r) > laplace(cur)) best.set(r.task, r) }
    const rows = [...best.values()].sort((a, b) => a.task.localeCompare(b.task))
    return rows.length ? [{ kind, label, rows }] : []
  })
}

export const kindLabel = (kind: string) => SMART_KINDS.find(k => k[0] === kind)?.[1] ?? kind
export const verdictLabel = (v: SmartVerdict) => v === 'useful' ? 'Useful' : v === 'not' ? 'Not useful' : 'Pending'
/** Newest first, at most n. */
export const recentPicks = (picks: SmartPickRow[], n = 12) => [...picks].sort((a, b) => b.at - a.at).slice(0, n)

/** The "Smart pick" mark on an ask option: AskQuestion.smart names the option and its learned rate. */
export const optionSmart = (q: { smart?: { option: number; rate?: number; n?: number } } | undefined, i: number) => q?.smart?.option === i ? q.smart : undefined
/** "Smart pick", with "kept 80% of 12" once the rate is known. rate is 0 to 1. */
export const smartMarkText = (s: { rate?: number; n?: number }) => s.rate !== undefined && s.n ? `Smart pick, kept ${Math.round(s.rate * 100)}% of ${s.n}` : 'Smart pick'

/** A chat's latest smart model and effort, as one line for the map's lead desk; undefined with no picks. */
export function chatSmart(picks: SmartPickRow[] | undefined, session: string): { model?: string; line: string } | undefined {
  const last = (kind: string) => [...(picks ?? [])].filter(p => p.session === session && p.kind === kind).sort((a, b) => b.at - a.at)[0]
  const m = last('model'), e = last('effort')
  if (!m && !e) return undefined
  const val = (p?: SmartPickRow) => p && (p.final ?? p.pick)
  const learned = [m, e].some(p => p?.why.startsWith('learned:'))
  return { model: val(m), line: `Smart: ${[val(m), val(e)].filter(Boolean).join(' · ')}${learned ? ', learned' : ''}` }
}
