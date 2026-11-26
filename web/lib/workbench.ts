import type { Change, ReportAction, SuggestedChanges } from './hub-types'

export type { Change, ReportAction, SuggestedChanges }
export type Area = ReportAction['area']
export type ChangeStatus = Change['status']
export type ActionState = SuggestedChanges['actions'][number]['state']

export const AREA_WORD: Record<Area, string> = { mac: 'Mac', dev: 'Dev', kit: 'Kit', other: 'Other', project: 'Project' }
export const STATUS_WORD: Record<ActionState | ChangeStatus, string> = {
  new: 'New', open: 'Working', applied: 'Applied', failed: 'Failed', undone: 'Undone', 'undo-failed': 'Undo failed',
}

/** What Undo will run, in order, for the inline confirm. */
export const undoPlan = (c: Change): string[] => [
  ...(c.undo ? [c.undo] : []),
  ...c.files.map(f => f.before === null ? `remove ${f.path}` : `restore ${f.path}`),
]

// A change left open this long belongs to a chat that stopped before finishing it.
const STALE_MS = 2 * 3_600_000
export const isStale = (c: Change, now = Date.now()) => c.status === 'open' && now - c.at > STALE_MS

export const whenWord = (at: number, now = Date.now()) => {
  const m = Math.round((now - at) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 24 * 60) return `${Math.round(m / 60)} h ago`
  const d = Math.round(m / 1440)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

/** A report's text without its Actions sections, which the cards show instead. */
export function withoutActions(text: string): string {
  let level = 0, fenced = false
  return text.split('\n').filter(l => {
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced
    const h = fenced ? null : l.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (h && (!level || h[1].length <= level)) level = /^actions$/i.test(h[2]) ? h[1].length : 0
    return !level
  }).join('\n')
}
