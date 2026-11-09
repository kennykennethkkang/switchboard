/** Approve: a done chat waits for Kenneth's OK before it closes and moves to History. */
import type { ArchivedChat, ChatProgress, DoneCheck } from './hub-types'

/** Done chats not yet approved or archived. */
export const awaiting = (progress: ChatProgress[], archive: ArchivedChat[]) => {
  const gone = new Set(archive.map(a => a.sessionId))
  return progress.filter(p => p.state === 'done' && !gone.has(p.sessionId))
}

/** The done-check verdict beside the button; undefined when the mod wrote none. */
export const checkLine = (c?: DoneCheck) => !c ? undefined : c.verified ? 'Verified' : `Unverified${c.missing?.length ? `: ${c.missing.join(', ')}` : ''}`

/** The prompt Send back gives the chat. */
export const sendBackText = (c?: DoneCheck) => c?.missing?.length
  ? `Not approved yet. Still missing: ${c.missing.join('; ')}. Fix these, check them, then ask for approval again.`
  : 'Not approved yet. Check your work against what I asked, fix what is missing, then ask for approval again.'
