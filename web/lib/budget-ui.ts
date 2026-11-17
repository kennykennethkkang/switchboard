import type { ChatRow, CheckBack, IndefiniteBudget, TrendValue } from './hub-types'
import { formatDuration } from './duration'

const H = 3_600_000
export const CHECK_BACK_MAX = 12

/** "1h 20m", "35m", "just now". */
export function elapsedText(ms: number): string {
  return formatDuration(ms, 'elapsed')
}

/** Goal line under the chat name: elapsed and cost, with the caps when set. */
export function budgetLine(c: Pick<ChatRow, 'elapsedMs' | 'costUsd' | 'budget'>): string {
  const b = c.budget
  const t = c.elapsedMs !== undefined ? `${elapsedText(c.elapsedMs)}${b?.maxHours ? ` of ${b.maxHours}h` : ''}` : ''
  const m = c.costUsd !== undefined ? `$${c.costUsd.toFixed(2)}${b?.maxCostUsd ? ` of $${b.maxCostUsd}` : ''}` : ''
  return [t, m].filter(Boolean).join(' · ')
}

/** Quiet map badge: "limit 4h / $5, gate", "check back 30m 3/12"; empty with neither. */
export function limitText(c: Pick<ChatRow, 'budget' | 'checkBack'>): string {
  const b = c.budget
  const caps = [b?.maxHours ? `${b.maxHours}h` : '', b?.maxCostUsd ? `$${b.maxCostUsd}` : ''].filter(Boolean).join(' / ')
  const limit = [caps, b?.gate ? 'gate' : ''].filter(Boolean).join(', ')
  return [limit && `limit ${limit}`, c.checkBack && `check back ${c.checkBack.everyMin}m ${checkBackCount(c.checkBack)}`].filter(Boolean).join(' \u00b7 ')
}

/** Short form for the map's yard tag, which is narrow: "4h $5 gate · back 3/12". */
export function limitTag(c: Pick<ChatRow, 'budget' | 'checkBack'>): string {
  const b = c.budget
  const limit = [b?.maxHours ? `${b.maxHours}h` : '', b?.maxCostUsd ? `$${b.maxCostUsd}` : '', b?.gate ? 'gate' : ''].filter(Boolean).join(' ')
  return [limit, c.checkBack && `back ${checkBackCount(c.checkBack)}`].filter(Boolean).join(' · ')
}

/** 0..1 toward the nearer cap, or undefined with none set. */
export function budgetFill(c: Pick<ChatRow, 'elapsedMs' | 'costUsd' | 'budget'>): number | undefined {
  const b = c.budget
  const parts = [b?.maxHours && c.elapsedMs !== undefined ? c.elapsedMs / (b.maxHours * H) : undefined, b?.maxCostUsd && c.costUsd !== undefined ? c.costUsd / b.maxCostUsd : undefined].filter((v): v is number => v !== undefined)
  return parts.length ? Math.min(1, Math.max(...parts)) : undefined
}

/** Form text to a budget message: empty or non-positive clears (null). */
export function budgetMsg(hours: string, usd: string, gate: string): { maxHours: number | null; maxCostUsd: number | null; gate: string | null } {
  const n = (s: string) => { const v = Number(s); return s.trim() && Number.isFinite(v) && v > 0 ? v : null }
  return { maxHours: n(hours), maxCostUsd: n(usd), gate: gate.trim() || null }
}

export const budgetForm = (b?: IndefiniteBudget) => ({ hours: b?.maxHours ? String(b.maxHours) : '', usd: b?.maxCostUsd ? String(b.maxCostUsd) : '', gate: b?.gate ?? '' })

export const CHECK_BACK_OPTIONS: Array<[string, string]> = [['0', 'Check back: off'], ['10', 'Check back: 10 min'], ['30', 'Check back: 30 min'], ['60', 'Check back: 60 min']]
export const checkBackValue = (c?: CheckBack) => String(c?.everyMin ?? 0)
export const checkBackCount = (c?: CheckBack) => c ? `${c.count}/${CHECK_BACK_MAX}` : ''

/** Arrow and size of a delta; undefined with nothing to compare. */
export function trendArrow(v: TrendValue): { vsDay?: string; vsWeek?: string } {
  const one = (d?: number) => d === undefined ? undefined : d > 0 ? `↑${d}` : d < 0 ? `↓${-d}` : 'same'
  return { vsDay: one(v.vsDay), vsWeek: one(v.vsWeek) }
}

/** Cost trends are dollars, the rest whole counts. */
export const trendNum = (v: number, usd?: boolean) => usd ? `$${v.toFixed(2)}` : String(v)
export function trendText(v: TrendValue, usd?: boolean): string {
  const a = trendArrow(v), fmt = (s?: string) => s && usd && /\d/.test(s) ? `${s[0]}$${Number(s.slice(1)).toFixed(2)}` : s
  return [trendNum(v.value, usd), fmt(a.vsDay) && `${fmt(a.vsDay)} vs day`, fmt(a.vsWeek) && `${fmt(a.vsWeek)} vs week`].filter(Boolean).join(' ')
}

/** A new run folder name for a pipeline chat: date, pipeline, then a time suffix so two starts never collide. */
export const freshRun = (slug: string, now = Date.now()): string => `${new Date(now).toISOString().slice(0, 10)}-${slug}-${now.toString(36)}`
