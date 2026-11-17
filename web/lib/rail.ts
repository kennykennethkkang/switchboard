/** Chat row helpers: the waiting test and the row's age. */
import type { ChatProgress } from './hub-types'
import type { LinkChip } from './wait-links'
import { formatDuration } from './duration'

// Asking and finished outrank everything else on the row.
const settled = (p?: ChatProgress) => p?.state === 'needs-you' || p?.state === 'done'

/** Waits on another chat (an out link), so it is held, not idle. */
export const waiting = (p: ChatProgress | undefined, chips: LinkChip[]) => !settled(p) && chips.some(c => c.dir === 'out')

/** "active now" or "last reply 21 min ago". */
export const replyAge = (at: number, now = Date.now()) => {
  const age = formatDuration(now - at, 'ago')
  return age === 'now' ? 'active now' : `last reply ${age} ago`
}
