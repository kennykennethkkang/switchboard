/** Usage limit pause: reset times from limit messages, the pause threshold and the resume order. */
import type { Limit } from './types'
import { LIMITS } from './progress'

const zoned = (at: number, tz: string) => {
  // The wall clock in tz for instant at, read back as if UTC: the difference is tz's offset.
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    .formatToParts(at).map(x => [x.type, Number(x.value)]))
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000
}

/** "resets 11:50pm (America/Los_Angeles)" (or "resets 3am", "resets Nov 9, 5pm") to epoch ms: the next such time after now. */
export function limitReset(text: string, now = Date.now()): number | undefined {
  const m = /resets\s+(?:([A-Z][a-z]{2})\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)\b(?:\s*\(([^)]+)\))?/i.exec(text)
  if (!m) return undefined
  const [, mon, day, hh, mm = '0', ap, tz] = m
  const hour = (Number(hh) % 12) + (ap.toLowerCase() === 'pm' ? 12 : 0)
  const local = (at: number) => -new Date(at).getTimezoneOffset() * 60_000
  const offAt = (at: number) => { try { return tz ? zoned(at, tz) : local(at) } catch { return local(at) } }
  // A wall time to its instants, with the offset at each instant, not now's: two in the fall-back hour, earliest first.
  // None in the spring-forward gap; then the offset from before it.
  const instants = (w: number) => {
    const t = [...new Set([offAt(w - 86_400_000), offAt(w + 86_400_000)])].map(o => w - o).filter(x => offAt(x) === w - x).sort((a, b) => a - b)
    return t.length ? t : [w - offAt(w - offAt(w))]
  }
  // Work in tz's wall clock as UTC fields.
  const wall = new Date(now + offAt(now))
  const month = mon ? new Date(`${mon} 1, 2000`).getMonth() : wall.getUTCMonth()
  let wallAt = Date.UTC(wall.getUTCFullYear(), month, mon ? Number(day) : wall.getUTCDate(), hour, Number(mm))
  if (Number.isNaN(wallAt)) return undefined
  // Already past: tomorrow, or next year for a dated one.
  let at = instants(wallAt).find(x => x > now)
  while (at === undefined) { wallAt = mon ? Date.UTC(new Date(wallAt).getUTCFullYear() + 1, month, Number(day), hour, Number(mm)) : wallAt + 86_400_000; at = instants(wallAt).find(x => x > now) }
  return at
}

/** The window at or past pct, with its reset; undefined below it or with the pause off (pct null). */
export function pauseDue(windows: Limit[], pct: number | null | undefined, resetMs: (v?: string) => number, now = Date.now()): { kind: string; percent: number; resetsAt?: number } | undefined {
  if (pct === null || pct === undefined) return undefined
  const hot = windows.filter(w => w.percentUsed >= pct).map(w => ({ kind: w.kind, percent: w.percentUsed, resetsAt: resetMs(w.resetsAt) }))
    .filter(w => !Number.isFinite(w.resetsAt) || w.resetsAt > now)
  if (!hot.length) return undefined
  // The latest reset is the one that frees everything.
  const w = hot.reduce((a, b) => ((b.resetsAt || 0) > (a.resetsAt || 0) ? b : a))
  return { kind: w.kind, percent: w.percent, ...(Number.isFinite(w.resetsAt) ? { resetsAt: w.resetsAt } : {}) }
}

/** Resume order: chats holding subagents first (their agents wait on them), then the order they were queued. */
export const resumeOrder = <T extends { at: number; agents?: unknown[] }>(q: T[]): T[] =>
  [...q].sort((a, b) => Number(!!b.agents?.length) - Number(!!a.agents?.length) || a.at - b.at)

/** Whether a transcript's last assistant entry is Claude Code's usage limit error: the chat stopped on the limit, not by hand. */
export function endedOnLimit(tail: string): boolean {
  const lines = tail.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    let e: { type?: string; isApiErrorMessage?: boolean; error?: string }
    try { e = JSON.parse(lines[i]) } catch { continue }
    if (e.type === 'assistant') return e.isApiErrorMessage === true && LIMITS.has(String(e.error))
  }
  return false
}
