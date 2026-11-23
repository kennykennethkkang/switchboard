/** Numbers the Code view shows beside the graph: which parts chats changed lately, and which are imported most. */
import type { Part } from '@/lib/flow-map'

const WEEK = 7 * 86_400_000

export type Heat = { n: number; last?: number; who?: string; hot: boolean }

/** n: changes by chats; hot: last change within a week of the newest change anywhere (not of today, so an old repo still shows its live corner). */
export function heats(parts: Part[]): { by: Map<string, Heat>; max: number; hot: number } {
  const by = new Map<string, Heat>()
  let ref = 0
  for (const p of parts) {
    const n = p.chats.reduce((s, c) => s + c.n, 0)
    const top = p.chats.filter(c => c.at).sort((a, b) => b.at! - a.at!)[0]
    by.set(p.id, { n, last: top?.at, who: top?.label ?? p.chats[0]?.label, hot: false })
    if (top?.at && top.at > ref) ref = top.at
  }
  let hot = 0, max = 1
  for (const h of by.values()) {
    h.hot = !!h.last && ref - h.last <= WEEK
    if (h.hot) hot++
    if (h.n > max) max = h.n
  }
  return { by, max, hot }
}

/** "2d ago": the text twin of the hot dot, so recency never rests on colour alone. */
export function ago(at: number, now = Date.now()): string {
  const m = Math.max(0, now - at) / 60_000
  return m < 60 ? `${Math.max(1, Math.round(m))}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`
}

/** Activity order: newest change first, then more changes, then bigger. */
export const byActivity = (by: Map<string, Heat>) => (a: Part, b: Part) =>
  (by.get(b.id)?.last ?? 0) - (by.get(a.id)?.last ?? 0) || (by.get(b.id)?.n ?? 0) - (by.get(a.id)?.n ?? 0) || b.files.length - a.files.length
