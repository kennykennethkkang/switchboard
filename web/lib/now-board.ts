/** The Now page's layout (the pass board, or the old lanes at ?layout=classic), the to-do rows and a chat's cost and time. */
import type { ChatRow, ChatProgress, SessionLive, TodoItem, TodoList } from './hub-types'
import { finishUp, ordered } from './todo'
import { formatDuration } from './duration'

export type NowLayout = 'line' | 'classic'
export const layoutOf = (search: string): NowLayout => new URLSearchParams(search).get('layout') === 'classic' ? 'classic' : 'line'

/** you: a hand step; running: its chat is live. Open items plus hand steps, less the ones already cooking (they show in Cooking). */
export type NextRow = { t: TodoItem; you: boolean; running: boolean }
export function nextRows(list: TodoList | undefined, live: (chat?: string) => boolean): NextRow[] {
  if (!list) return []
  const you = finishUp(list).map(t => ({ t, you: true, running: false }))
  const open = ordered(list.todo.filter(t => t.why !== 'you')).map(r => ({ t: r.t, you: false, running: live(r.t.chat) })).filter(r => !r.running)
  return [...you, ...open]
}

type Held = NonNullable<TodoList['plan']>['held'][number]['why']
const HELD: Record<Held, string> = { blocked: 'Blocked', you: 'Your step', stopped: 'Stopped', ok: 'Needs your OK', date: 'Scheduled' }
/** The tag over an Up next row: why it waits when the plan holds it, else its To-do number. */
export function nextTag({ t, you }: NextRow, n?: number, held?: Held): { tag: string; kind?: 'you' | 'stopped' | 'held' } {
  if (you) return { tag: 'Your step', kind: 'you' }
  if (t.stopped || held === 'stopped') return { tag: 'Stopped', kind: 'stopped' }
  if (t.why === 'blocked') return { tag: 'Blocked', kind: 'held' }
  if (held) return { tag: HELD[held], kind: held === 'you' ? 'you' : 'held' }
  return { tag: n ? `To-do ${n}` : 'To-do' }
}

/** A chat started from a to-do takes the item's full text as its title while its own name is only the start of it. */
export function cookTitle(name: string, sessionId: string, list: TodoList | undefined): string {
  const t = list?.todo.find(x => x.chat === sessionId)?.text
  return t && t.length > name.length && t.toLowerCase().startsWith(name.toLowerCase()) ? t : name
}

/** "$3.40" and "1h 35m": the usage feed's cost, else the live row's; time since the chat started. */
export function chatMeta(chat: ChatRow, p: ChatProgress | undefined, live: SessionLive[] = [], now = Date.now()): { cost?: string; time?: string } {
  const usd = chat.costUsd ?? live.find(l => l.sessionId === chat.sessionId)?.costUsd
  const ms = chat.elapsedMs ?? (p ? now - p.startedAt : undefined)
  return { ...(usd !== undefined && { cost: `$${usd.toFixed(2)}` }), ...(ms !== undefined && { time: formatDuration(ms, 'elapsed') }) }
}

/** The phone chip over Your call: shown for two or more cards. */
export const needChip = (n: number) => n > 1 ? `${n} need you` : undefined

/** Which card the chip scrolls to: the first whose top is below edge (a gap counts as below), else back to the first. -1: no cards. */
export const nextCardIndex = (tops: number[], edge: number) => {
  const i = tops.findIndex(t => t > edge + 1)
  return tops.length ? Math.max(i, 0) : -1
}
