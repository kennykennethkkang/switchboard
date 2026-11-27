/** Approve: a done chat waits for Kenneth's OK before it closes and moves to History. */
import type { ChatProgress, DoneCheck } from './hub-types'

/** The done-check verdict beside the button; undefined when the mod wrote none. */
export const checkLine = (c?: DoneCheck) => !c ? undefined : c.verified ? 'Verified' : `Unverified${c.missing?.length ? `: ${c.missing.join(', ')}` : ''}`

const SAYS: [RegExp, string][] = [[/standup/, 'a short summary of what it did'], [/tests? after last edit/, 'tests run after the last change'], [/review after last edit/, 'a review after the last change']]
/** Simple view: the same verdict as what to do, in plain words. */
export const plainCheck = (c?: DoneCheck) => !c ? undefined : c.verified ? 'Checked and ready'
  : c.missing?.length ? `Not checked yet. Still needed: ${c.missing.map(m => SAYS.find(([re]) => re.test(m))?.[1] ?? m).join(', ')}` : 'Not checked yet'

/** Simple view: approveBlock's reason as a plain sentence part. */
export const plainBlock = (b: string) => b === 'the chat is still working' ? 'it is still working'
  : b.startsWith('subagents still running') ? 'its helpers are still running'
  : b.replace(/^(\d+) open tasks?$/, (_, n) => `${n} ${n === '1' ? 'task is' : 'tasks are'} not finished`)

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

const CLOSING = 'Approve this chat as finished'
/** Chats waiting on Kenneth's review, oldest wait first: done ones and ones asking the closing question (stampedChats in extension/src/hub/approve.ts). */
export const reviewQueue = (progress: ChatProgress[]) => progress
  .filter(p => p.state === 'done' || (p.state === 'needs-you' && p.ask?.kind === 'question' && !p.ask.sub
    && !!p.ask.questions?.some(q => q.question.includes(CLOSING) && q.options.join('|') === 'Approve|Send back')))
  // shortcut: an ask has no start time, so a closing-question chat sorts by its last hook (at); add Ask.at if late hooks reorder it.
  .map(p => ({ id: p.sessionId, since: (p.state === 'done' && p.finishedAt) || p.at }))
  .sort((a, b) => a.since - b.since).map(r => r.id)
