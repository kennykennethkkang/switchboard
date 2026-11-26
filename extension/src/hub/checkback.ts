import type { ChatProgress, CheckBack } from './types'

export const CHECK_BACK_MAX = 12
export const CHECK_BACK_TEXT = 'Check back: look at progress on open work and continue or report.'

/** What dueCheckBacks needs of a chat. takes: this window owns its terminal. open: tasks or background work pending. stopped: approved or ended. */
export type CheckBackChat = { sessionId: string; status?: string; updatedAt?: number; takes?: boolean; open: boolean; stopped?: boolean }

/** Open tasks, subagents or background jobs in a chat's progress. */
export const hasOpenWork = (p: Pick<ChatProgress, 'tasks' | 'running' | 'jobs' | 'subJobs'> | undefined): boolean =>
  !!p && (p.tasks.some(t => t.status !== 'completed') || !!p.running?.length || !!p.jobs?.length || !!p.subJobs?.length)

/** The text a check-back sends: the Timer's own prompt, else the default. */
export const checkBackText = (s: CheckBack) => s.text || CHECK_BACK_TEXT

/** Session ids owed a check-back: idle for everyMin since the later of its last turn and last check-back, under the cap; the default text also needs open work. */
export function dueCheckBacks(now: number, chats: CheckBackChat[], settings: Record<string, CheckBack | undefined>): string[] {
  return chats.flatMap(c => {
    const s = settings[c.sessionId]
    if (!s || c.stopped || !c.takes || (!c.open && !s.text) || c.status !== 'idle' || c.updatedAt === undefined || s.count >= CHECK_BACK_MAX) return []
    return now - Math.max(c.updatedAt, s.lastAt ?? 0) >= s.everyMin * 60_000 ? [c.sessionId] : []
  })
}
