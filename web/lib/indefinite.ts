import type { ChatProfile } from './hub-types'

export const INDEFINITE_LABEL = 'Run indefinitely'

/** Whether Run indefinitely is on for a chat, from its saved profile. */
export const indefiniteOn = (p?: ChatProfile): boolean => !!p?.indefinite

/** The line under the switch: what it does when off, how long it has run when on. */
export function indefiniteHint(p: ChatProfile | undefined, now: number): string {
  if (!p?.indefinite) return 'The chat asks its questions once, then keeps auditing and fixing until nothing is left'
  const min = Math.max(0, Math.floor((now - p.indefinite) / 60_000))
  const ran = min < 1 ? 'just now' : min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ago`
  return `On since ${ran}. Turns itself off when the chat ends with "Run indefinitely: done"`
}
