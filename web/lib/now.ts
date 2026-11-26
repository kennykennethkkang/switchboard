/** The Now page's lanes, its row of day numbers and each lane row. */
import { isShipId } from './ship-list'
import type { ArchivedChat, ChatProgress, ChatRow, HubState } from './hub-types'
import type { Today } from './today'
import type { TaskTotals } from './progress'
import { inProjects, liveChats, projectName } from './archive'
import { busyLine } from './eta'
import { chatShown, isBusy } from './chat-state'

type Card = { chat: ChatRow; progress?: ChatProgress }
export type Day = { done: number; total: number; working: number; approved: number; tokens?: number }
export type LaneRow = { id: string; name: string; project: string; role?: string; done: number; total: number; step?: string }

const newest = (key: (p: ChatProgress) => number) => (a: Card, b: Card) => key(b.progress!) - key(a.progress!)

/** Working chats by latest activity, and chats approved today, newest first. */
export function nowLanes<C extends Card>(cards: C[], archive: ArchivedChat[] = [], now = Date.now()): { working: C[]; done: ArchivedChat[] } {
  const day = new Date(now).toDateString()
  return {
    working: cards.filter(c => isBusy(chatShown(c.progress))).sort(newest(p => p.at)),
    done: archive.filter(a => a.approvedAt && new Date(a.approvedAt).toDateString() === day).sort((a, b) => b.approvedAt! - a.approvedAt!),
  }
}

/** Items in the picked projects, by their chat's folder; one whose chat is gone stays, so the filter never hides it. */
export function picked<T extends { sessionId: string }>(items: T[], cards: Card[], projects: string[]): T[] {
  if (!projects.length) return items
  return items.filter(i => { const c = cards.find(x => x.chat.sessionId === i.sessionId); return !c || inProjects(c.chat, projects) })
}

export function dayNumbers(today: Today, tasks: TaskTotals): Day {
  return { done: tasks.done, total: tasks.total, working: today.working.length, approved: today.done.length, ...(today.tokens !== undefined && { tokens: today.tokens }) }
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

/**
 * The one count of needs you, working and done today: Now, the nav, the Agents header, the council panel and Plan all read it.
 * Needs you is a question, a finished chat waiting on Approve, a failed CI run, a stuck item, a learn proposal or a research offer; done is approved today.
 */
export function hubCounts(hub: HubState, projects: string[] = [], now = Date.now()): { needs: number; working: number; done: number } {
  const cards = liveChats(hub.chats, hub.archive ?? []).map(chat => ({ chat, progress: hub.progress.find(p => p.sessionId === chat.sessionId) })).filter(c => inProjects(c.chat, projects))
  const ci = hub.repo?.ci
  // A repo picked on Ship belongs to no chat, so it asks nothing here.
  const fails = ci?.conclusion === 'failure' && hub.repo && !isShipId(hub.repo.sessionId) ? picked([{ sessionId: hub.repo.sessionId }], cards, projects).length : 0
  const { working, done } = nowLanes(cards, (hub.archive ?? []).filter(a => inProjects(a, projects)), now)
  const needs = cards.filter(c => c.progress?.state === 'needs-you' || c.progress?.state === 'done').length
  return { needs: needs + fails + picked(hub.stuck ?? [], cards, projects).length + (hub.learnReady?.length ?? 0) + (hub.researchOffers?.length ?? 0), working: working.length, done: done.length }
}
