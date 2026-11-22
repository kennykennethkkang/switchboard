/** The one rule for what a chat reads as on every page: Now, Chats, the court map, the counts. */
import type { ChatProgress, StuckItem } from './hub-types'

export type Shown = 'needs' | 'stuck' | 'waiting' | 'working' | 'done' | 'idle'

/**
 * needs: a question or a prompt waits for you. stuck: it works, but something in it went quiet or hot (hub.stuck).
 * waiting: its lead's turn ended while subagents or jobs still run, or it hit a usage limit. Else its progress state.
 * stuck only marks a working chat; a done or idle one keeps its state while the item stays in the Needs you strip.
 */
export function chatShown(p: Pick<ChatProgress, 'state' | 'ask' | 'asks' | 'limited' | 'waiting'> & { sessionId?: string } | undefined, stuck?: StuckItem[], id = p?.sessionId): Shown {
  if (!p) return 'idle'
  if (p.state === 'needs-you' || p.asks?.length || p.ask) return 'needs'
  if (p.state === 'working' && stuck?.some(i => i.sessionId === id)) return 'stuck'
  if (p.limited || p.waiting) return 'waiting'
  return p.state
}

/** Counts as working for the Working lane and its count. */
export const isBusy = (s: Shown) => s === 'working' || s === 'waiting' || s === 'stuck'
