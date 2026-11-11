/** The Now page's lanes, its row of day numbers and each lane row. */
import type { ArchivedChat, ChatProgress, ChatRow } from './hub-types'
import type { Today } from './today'
import type { TaskTotals } from './progress'
import { inProjects, projectName } from './archive'
import { busyLine } from './eta'

type Card = { chat: ChatRow; progress?: ChatProgress }
export type Day = { done: number; total: number; working: number; approved: number; jev?: { runs: number; costUsd: number } }
export type LaneRow = { id: string; name: string; project: string; role?: string; done: number; total: number; step?: string }

const newest = (key: (p: ChatProgress) => number) => (a: Card, b: Card) => key(b.progress!) - key(a.progress!)

/** Working chats by latest activity, and chats approved today, newest first. */
export function nowLanes<C extends Card>(cards: C[], archive: ArchivedChat[] = [], now = Date.now()): { working: C[]; done: ArchivedChat[] } {
  const day = new Date(now).toDateString()
  return {
    working: cards.filter(c => c.progress?.state === 'working').sort(newest(p => p.at)),
    done: archive.filter(a => a.approvedAt && new Date(a.approvedAt).toDateString() === day).sort((a, b) => b.approvedAt! - a.approvedAt!),
  }
}

/** Items in the picked projects, by their chat's folder; one whose chat is gone stays, so the filter never hides it. */
export function picked<T extends { sessionId: string }>(items: T[], cards: Card[], projects: string[]): T[] {
  if (!projects.length) return items
  return items.filter(i => { const c = cards.find(x => x.chat.sessionId === i.sessionId); return !c || inProjects(c.chat, projects) })
}

/** jev falls back to today's own runs. */
export function dayNumbers(today: Today, tasks: TaskTotals, jev = today.jev): Day {
  return { done: tasks.done, total: tasks.total, working: today.working.length, approved: today.done.length, ...(jev && { jev }) }
}

/** Step: the task in progress, else what still runs. */
export function laneRow({ chat, progress: p }: Card): LaneRow {
  const project = projectName(chat)
  const tasks = p?.tasks ?? []
  const roles = p?.roles ?? []
  return {
    id: chat.sessionId, name: chat.name || project, project,
    role: (roles.findLast(r => r.state === 'active') ?? roles.at(-1))?.role,
    done: tasks.filter(t => t.status === 'completed').length, total: tasks.length,
    step: tasks.find(t => t.status === 'in_progress')?.subject ?? busyLine(p),
  }
}
