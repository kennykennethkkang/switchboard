import type { ChatProfile, IndefiniteBudget } from './hub-types'
import { formatDuration } from './duration'

/** Whether Run indefinitely is on for a chat, from its saved profile. */
export const indefiniteOn = (p?: ChatProfile): boolean => !!p?.indefinite

/** The line under the switch: what it does when off, how long it has run when on. */
export function indefiniteHint(p: ChatProfile | undefined, now: number, budget: IndefiniteBudget | undefined = p?.budget): string {
  if (!p?.indefinite) return 'The chat asks its questions once, then keeps auditing and fixing until nothing is left'
  const ran = formatDuration(now - p.indefinite, 'indefinite')
  const open = !budget?.maxHours && !budget?.maxCostUsd && !budget?.gate
  return `On since ${ran}. Turns itself off when the chat ends with "Run indefinitely: done"${open ? '. No limit set' : ''}`
}
