/** The header's 5h and weekly meters, merged across live chats. */
import type { KeptLimits, Limit, LimitPause, SessionLive } from './hub-types'

/** level: 'none' with no data, 'high' from 80%, 'out' from 100%, by the raw value. */
export type Meter = { kind: string; label: string; percent?: number; level?: 'none' | 'high' | 'out'; reset?: string }

const KINDS = [['five_hour', '5h'], ['seven_day', 'Week']] as const
const CODEX = [['codex_five_hour', 'Codex 5h'], ['codex_seven_day', 'Codex week']] as const
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** resets_at as ISO, epoch seconds or epoch ms (number or digits) to ms. */
export function resetAt(v: string | number | undefined): number | undefined {
  if (typeof v === 'string' && !/^\d+(\.\d+)?$/.test(v.trim())) { const t = Date.parse(v); return Number.isFinite(t) ? t : undefined }
  const n = Number(v)
  if (v === undefined || !Number.isFinite(n)) return undefined
  return n < 1e12 ? n * 1000 : n
}

/** "3:40 PM" today, "Tue 9 AM" on a later day. */
export function resetText(at: number, now = Date.now()): string {
  const d = new Date(at), h = d.getHours() % 12 || 12, m = d.getMinutes()
  const time = `${h}${m ? `:${String(m).padStart(2, '0')}` : ''} ${d.getHours() < 12 ? 'AM' : 'PM'}`
  return `${d.toDateString() === new Date(now).toDateString() ? '' : `${DAYS[d.getDay()]} `}${time}`
}

/** "2h 5m", "12m", "under 1m" until at. */
export function countdown(at: number, now = Date.now()): string {
  const m = Math.ceil((at - now) / 60_000), h = Math.floor(m / 60)
  return at - now < 60_000 ? 'under 1m' : h ? `${h}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`
}

/** "3 chats queued, resume at 11:51 PM (in 2h 5m)". */
export function pauseLine(p: LimitPause, now = Date.now()): string {
  const n = p.chats.length
  return `Paused at ${p.percent}%: ${n} chat${n === 1 ? '' : 's'} queued${p.resumeAt ? `, resume at ${resetText(p.resumeAt, now)} (in ${countdown(p.resumeAt, now)})` : ''}`
}

/**
 * Both windows, always. Per window: the latest reset window wins, then the highest % in it; a window whose reset has passed reads 0.
 * kept (limits.json) fills a window no live chat reports, and a limit hit reads out until its reset.
 */
export function limitMeters(live: SessionLive[], now = Date.now(), kept?: KeptLimits, codexKept: Limit[] = []): Meter[] {
  const out = kept?.out && (kept.out.resetsAt ?? Infinity) > now ? kept.out : undefined
  // The window the hit was on: one at 100%, else the 5h one.
  const outKind = out && ([...live.flatMap(c => c.limits), ...kept!.windows].find(l => !l.kind.startsWith('codex_') && l.percentUsed >= 100)?.kind ?? 'five_hour')
  // Codex meters show while a Codex chat feeds them, or from the kept window until its reset.
  const keptCodex = codexKept.filter(l => (resetAt(l.resetsAt) ?? 0) > now)
  const codex = CODEX.filter(([kind]) => live.some(c => c.limits.some(l => l.kind === kind)) || keptCodex.some(l => l.kind === kind))
  return [...KINDS, ...codex].map(([kind, label]) => {
    if (kind === outKind) return { kind, label, percent: 100, level: 'out' as const, reset: `Limit reached${out!.resetsAt ? `, resets ${resetText(out!.resetsAt, now)} (in ${countdown(out!.resetsAt, now)})` : ''}` }
    const fed = live.flatMap(c => c.limits).filter(l => l.kind === kind)
    const all = (fed.length ? fed : [...(kept?.windows ?? []), ...keptCodex].filter(l => l.kind === kind)).map(l => ({ pct: l.percentUsed, at: resetAt(l.resetsAt) }))
    // Chats can disagree by seconds on one reset: anything within 5 min of the latest is the same window.
    const latest = Math.max(...all.map(l => l.at ?? -Infinity))
    const same = Number.isFinite(latest) ? all.filter(l => l.at !== undefined && l.at >= latest - 5 * 60_000) : all
    const best = same.reduce<(typeof all)[number] | undefined>((b, l) => (!b || l.pct > b.pct ? l : b), undefined)
    if (!best) return { kind, label, level: 'none' }
    if (best.at !== undefined && best.at <= now) return { kind, label, percent: 0 }
    const level = best.pct >= 100 ? 'out' : best.pct >= 80 ? 'high' : undefined
    // Floored, so 99.6 reads 99% and not a used-up 100%.
    return { kind, label, percent: Math.floor(best.pct), ...(level && { level }), ...(best.at !== undefined && { reset: `resets ${resetText(best.at, now)}` }) }
  })
}
