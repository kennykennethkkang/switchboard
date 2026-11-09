/** Chat row helpers: the waiting test and the row's age. */
import type { ChatProgress } from './hub-types'
import type { LinkChip } from './wait-links'

// Asking and finished outrank everything else on the row.
const settled = (p?: ChatProgress) => p?.state === 'needs-you' || p?.state === 'done'

/** Waits on another chat (an out link), so it is held, not idle. */
export const waiting = (p: ChatProgress | undefined, chips: LinkChip[]) => !settled(p) && chips.some(c => c.dir === 'out')

/** "active now" or "last reply 21 min ago". */
export const replyAge = (at: number, now = Date.now()) => {
  const m = Math.round((now - at) / 60e3)
  return m < 1 ? 'active now' : `last reply ${m < 60 ? `${m} min` : m < 36 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`} ago`
}
