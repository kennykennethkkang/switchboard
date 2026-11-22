// Pure parts of the to-do panel; statusOf in todo-view.ts says where an item stands.
import type { TickedItem, TodoItem, TodoList } from './hub-types'
import { inside, ordered } from './todo'
import { recentDone, statusOf, titleOf, waitOf, type Status, type Wait } from './todo-view'

export const DAY = 86_400_000

/** depth: how many items it is a prerequisite for; suggestions and top-level items are 0. */
export type Row = { t: TodoItem; status: Status; wait?: Wait; depth: number }

/** One project's rows: open items in list order (prerequisites above), suggestions that are not snoozed, done from the last week. */
export function rowsOf(list: TodoList, live: (chat?: string) => boolean, now: number, snoozedId: (id: string) => boolean, days = 7) {
  const open: Row[] = ordered(list.todo).map(({ t, depth }) => ({ t, depth, status: statusOf(t, live, now, list), wait: waitOf(t, live, now, list) }))
  const inbox: Row[] = (list.suggested ?? []).filter(t => !snoozedId(t.id)).map(t => ({ t, depth: 0, status: 'inbox' as const }))
  const done: TickedItem[] = recentDone(list, now, days)
  return { open, inbox, done }
}
type Rows = ReturnType<typeof rowsOf>

/** A: Decide (approvals, then suggestions), Running, Queue (a stopped item stays startable here), Waiting. */
export function splitA({ open, inbox }: Rows) {
  const w = (r: Row, why: Wait['why']) => r.status === 'waiting' && r.wait?.why === why
  return {
    decide: [...open.filter(r => w(r, 'ok')), ...inbox],
    running: open.filter(r => r.status === 'running'),
    queue: open.filter(r => r.status === 'ready' || w(r, 'stopped')),
    waiting: open.filter(r => r.status === 'waiting' && !w(r, 'ok') && !w(r, 'stopped')),
  }
}

export type Section = keyof ReturnType<typeof splitA>
/** Each section's size across projects, for the chips up top. */
export const countA = (all: Rows[]) => {
  const n: Record<Section, number> = { decide: 0, running: 0, queue: 0, waiting: 0 }
  for (const r of all) for (const [k, v] of Object.entries(splitA(r))) n[k as Section] += v.length
  return n
}

/** Move up or down one queue row: the spot in the whole list next to the neighbour on screen, or undefined at an end. */
export const stepTo = (all: string[], shown: string[], id: string, dir: -1 | 1) => {
  const i = shown.indexOf(id), to = i < 0 ? undefined : shown[i + dir]
  return to === undefined ? undefined : all.indexOf(to)
}

/** Collapsed sections, as stored; anything unreadable opens them all. */
export const closedOf = (raw: string | null): string[] => {
  try { const v = JSON.parse(raw ?? '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [] } catch { return [] }
}
export const toggled = (list: string[], k: string) => (list.includes(k) ? list.filter(x => x !== k) : [...list, k])

/** What a waiting row says: the label, and a sentence for the detail. day formats a date. */
export function waitText(w: Wait, day: (at: number) => string): { label: string; detail?: string } {
  switch (w.why) {
    case 'ok': return { label: 'Needs your OK', detail: 'A chat asked for your go-ahead before this runs.' }
    case 'date': return { label: `Starts ${day(w.until ?? 0)}`, detail: 'Auto-run leaves it until then. Start anyway runs it now.' }
    case 'stopped': return { label: 'Stopped', detail: 'Its chat ended before it finished.' }
    case 'you': return { label: 'Your step', detail: 'Only you can do this one.' }
    case 'blocked': return { label: 'Blocked', detail: 'A chat marked this as blocked.' }
    case 'after': return { label: 'Waiting', detail: w.on ? `Runs after "${titleOf(w.on)}" is done.` : 'Runs after another item is done.' }
  }
}

/** Snooze lengths. Kept on this device until the store has a field for it. */
export const snoozeTo = (now: number, kind: 'tomorrow' | 'week') => now + (kind === 'week' ? 7 : 1) * DAY
export const snoozed = (m: Record<string, number>, id: string, now: number) => (m[id] ?? 0) > now
export const liveSnoozes = (m: Record<string, number>, now: number) => Object.fromEntries(Object.entries(m).filter(([, at]) => at > now))

/** Folders that are not (under) a known project go to Other folders. No known list: none do. */
export const splitKnown = (folders: string[], known?: string[]) => {
  const main = known ? folders.filter(f => known.some(k => inside(k, f))) : folders
  return { main, other: folders.filter(f => !main.includes(f)) }
}
