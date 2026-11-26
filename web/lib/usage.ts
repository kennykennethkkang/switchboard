import { vscodeBridge } from './vscode-bridge'
import { downReason } from './hub-remote'

export type UsageTokens = { input: number; output: number; cacheRead: number; cacheWrite: number; thinking: number }
export type UsageRow = UsageTokens & { day: string; ai: 'claude' | 'codex'; model: string; project: string; role: string; calls: number; searches: number; costUsd: number; split: { input: number; output: number; cacheRead: number; cacheWrite: number; search: number }; savedUsd: number; unpriced?: true }
export type UsageChat = { sessionId: string; ai: 'claude' | 'codex'; label: string; project: string; startedAt: number; lastAt: number; agents: number; models: string[]; days: Record<string, { costUsd: number; tokens: number; calls: number }> }
export type UsageReport = { at: number; from: string; rows: UsageRow[]; chats: UsageChat[]; since?: number }
export type Range = 'today' | '7d' | '30d'
export type Ai = 'all' | 'claude' | 'codex'

export async function loadUsage(f: typeof fetch = fetch): Promise<UsageReport | string> {
  if (vscodeBridge?.isVSCode) return vscodeBridge.usage()
  try {
    const r = await f('/hub/usage', { headers: { 'X-Switchboard': '1' }, cache: 'no-store' })
    return r.ok ? await r.json() as UsageReport : downReason(r.status)
  } catch { return downReason(undefined) }
}

const localDay = (n: number) => { const d = new Date(n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const daysBack = (day: string, n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() - n); return localDay(d.getTime()) }
export function inRange(report: UsageReport, range: Range, ai: Ai = 'all', now = report.at): UsageRow[] {
  const end = localDay(now), count = range === 'today' ? 1 : range === '7d' ? 7 : 30, from = daysBack(end, count - 1)
  return report.rows.filter(r => r.day >= from && r.day <= end && (ai === 'all' || r.ai === ai))
}
export type UsageTotals = UsageTokens & { calls: number; searches: number; costUsd: number; savedUsd: number; tokens: number; split: UsageRow['split'] }
export function totals(rows: UsageRow[]): UsageTotals {
  const sum = rows.reduce((a, r) => { a.input += r.input; a.output += r.output; a.cacheRead += r.cacheRead; a.cacheWrite += r.cacheWrite; a.thinking += r.thinking; a.calls += r.calls; a.searches += r.searches; a.costUsd += r.costUsd; a.savedUsd += r.savedUsd; a.split.input += r.split.input; a.split.output += r.split.output; a.split.cacheRead += r.split.cacheRead; a.split.cacheWrite += r.split.cacheWrite; a.split.search += r.split.search; return a }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0, calls: 0, searches: 0, costUsd: 0, savedUsd: 0, split: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, search: 0 } })
  return { ...sum, tokens: sum.input + sum.output + sum.cacheRead + sum.cacheWrite }
}
export function priorTotals(report: UsageReport, range: Range, ai: Ai = 'all', now = report.at): UsageTotals | undefined {
  const count = range === 'today' ? 1 : range === '7d' ? 7 : 30, currentStart = daysBack(localDay(now), count - 1), start = daysBack(currentStart, count)
  if (start < report.from) return undefined
  return totals(report.rows.filter(r => r.day >= start && r.day < currentStart && (ai === 'all' || r.ai === ai)))
}
export function byDay(report: UsageReport, range: Range, ai: Ai = 'all', now = report.at) {
  const count = range === 'today' ? 1 : range === '7d' ? 7 : 30, end = localDay(now), start = daysBack(end, count - 1), rows = inRange(report, range, ai, now)
  return Array.from({ length: count }, (_, i) => {
    const day = daysBack(start, -i), onDay = rows.filter(r => r.day === day), claude = totals(onDay.filter(r => r.ai === 'claude')), codex = totals(onDay.filter(r => r.ai === 'codex'))
    return { day, total: totals(onDay), ai: { claude, codex } }
  })
}
export function groupBy(rows: UsageRow[], key: 'model' | 'project' | 'role' | 'ai') {
  const all = totals(rows)
  const map = new Map<string, UsageRow[]>()
  for (const row of rows) map.set(row[key], [...(map.get(row[key]) ?? []), row])
  return [...map].map(([name, group]) => ({ key: name, name, ...totals(group), share: all.costUsd ? totals(group).costUsd / all.costUsd : 0, ...(group.some(r => r.unpriced) ? { unpriced: true as const } : {}) })).sort((a, b) => b.costUsd - a.costUsd)
}
export function topChats(report: UsageReport, range: Range, ai: Ai = 'all', now = report.at) {
  const rangeRows = inRange(report, range, ai, now), days = new Set(rangeRows.map(r => r.day))
  return report.chats.map(chat => ({ ...chat, costUsd: Object.entries(chat.days).filter(([d]) => days.has(d)).reduce((s, [, x]) => s + x.costUsd, 0), tokens: Object.entries(chat.days).filter(([d]) => days.has(d)).reduce((s, [, x]) => s + x.tokens, 0) })).filter(c => c.costUsd > 0 && (ai === 'all' || c.ai === ai)).sort((a, b) => b.costUsd - a.costUsd)
}
export const cacheHitRate = (t: UsageTokens) => t.input + t.cacheRead + t.cacheWrite ? t.cacheRead / (t.input + t.cacheRead + t.cacheWrite) : 0
export const usd = (n: number) => n > 0 && n < 0.01 ? '<$0.01' : `$${n.toLocaleString('en-US', { maximumFractionDigits: n < 100 ? 2 : 0, minimumFractionDigits: n < 100 ? 2 : 0 })}`
export function tokens(n: number): string {
  if (n < 1000) return `${n}`
  const units = [[1e3, 'K'], [1e6, 'M'], [1e9, 'B']] as const
  let i = units.findLastIndex(([size]) => n >= size)
  let value = n / units[i][0]
  let rounded = Number(value.toFixed(value < 10 ? 2 : 1))
  if (rounded >= 1000 && i < units.length - 1) {
    i++
    value = n / units[i][0]
    rounded = Number(value.toFixed(value < 10 ? 2 : 1))
  }
  return `${rounded}${units[i][1]}`
}
