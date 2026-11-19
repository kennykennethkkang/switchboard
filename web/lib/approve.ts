/** Approve: a done chat waits for Kenneth's OK before it closes and moves to History. */
import type { ArchivedChat, ChatProgress, DoneCheck } from './hub-types'

/** The done-check verdict beside the button; undefined when the mod wrote none. */
export const checkLine = (c?: DoneCheck) => !c ? undefined : c.verified ? 'Verified' : `Unverified${c.missing?.length ? `: ${c.missing.join(', ')}` : ''}`

/** The prompt Send back gives the chat. */
export const sendBackText = (c?: DoneCheck) => c?.missing?.length
  ? `Not approved yet. Still missing: ${c.missing.join('; ')}. Fix these, check them, then ask for approval again.`
  : 'Not approved yet. Check your work against what I asked, fix what is missing, then ask for approval again.'

const LIVE_SUB_MS = 10 * 60 * 1000

/** Why the extension would refuse this Approve; mirrors approvalBlock in extension/src/hub/approve.ts. undefined: it goes through. */
export function approveBlock(chat: ChatProgress | undefined, now = Date.now()): string | undefined {
  if (!chat) return undefined
  if (chat.state === 'working') return 'the chat is still working'
  const live = (chat.running ?? []).filter(id => { const r = chat.roles.find(r => r.id === id); return !!r && now - (r.at ?? r.startedAt) <= LIVE_SUB_MS })
  if (live.length) return `subagents still running: ${live.join(', ')}`
  const open = chat.tasks.filter(t => t.status !== 'completed').length
  return open ? `${open} open task${open === 1 ? '' : 's'}` : undefined
}
