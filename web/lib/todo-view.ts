// Pure parts of the to-do panel.
import type { TickedItem, TodoItem, TodoList } from './hub-types'
import { holdOf, type Held } from './todo'

export type Shipped = { sha: string; subject: string }

/** The commit that auto-ticked a row, when one did. Reads loosely until hub-types carries the field. */
export const shippedOf = (t: object): Shipped | undefined => {
  const s = (t as { shipped?: Shipped }).shipped
  return s && s.sha ? s : undefined
}

/** Open work the list shows: hand steps sit apart, under Only you. */
export const openOf = (l?: TodoList): TodoItem[] => l?.todo.filter(t => t.why !== 'you') ?? []
export const youOf = (l?: TodoList): TodoItem[] => [...l?.suggested ?? [], ...l?.todo ?? []].filter(t => t.why === 'you')
export const suggestedOf = (l?: TodoList): TodoItem[] => l?.suggested?.filter(t => t.why !== 'you') ?? []

/** Ticked in the last `days`, newest first. Older ones stay out of sight. */
export const recentDone = (l: TodoList | undefined, now: number, days = 7): TickedItem[] =>
  (l?.ticked ?? []).filter(t => now - t.at < days * 864e5).sort((a, b) => b.at - a.at)

/** Projects with something to act on (open, suggested or your step), busiest first. Empty ones drop out. */
export function projectsWithWork(todos: Record<string, TodoList>) {
  return Object.entries(todos)
    .map(([folder, l]) => ({ folder, open: openOf(l).length, suggested: suggestedOf(l).length, you: youOf(l).length }))
    .filter(p => p.open + p.suggested + p.you > 0)
    .sort((a, b) => (b.open + b.suggested + b.you) - (a.open + a.suggested + a.you))
}

/** Projects to draw blocks for: those with work, then those with only recent done rows (so Undo stays reachable); the picked one when neither exists, so Add still has a home. */
export const shownProjects = (todos: Record<string, TodoList>, fallback?: string, now = Date.now()): string[] => {
  const ps = projectsWithWork(todos).map(p => p.folder)
  const done = Object.keys(todos).filter(f => !ps.includes(f) && recentDone(todos[f], now).length)
  const all = [...ps, ...done]
  return all.length || !fallback ? all : [fallback]
}

/** Block title parts: counts in the order you act on them. */
export const counts = (l?: TodoList) => ({ open: openOf(l).length, suggested: suggestedOf(l).length, you: youOf(l).length })


/** Past this many characters a row folds to three lines with Show all. */
export const LONG = 180
export const isLong = (text: string) => text.length > LONG || text.split('\n').length > 3

/** A commit's short sha; a CHANGELOG match keeps its word. */
export const shortSha = (s: Shipped) => (/^[0-9a-f]{7,40}$/i.test(s.sha) ? s.sha.slice(0, 7) : s.sha)

/** inbox: a suggestion; ready: auto-start would run it; running: in a live chat; waiting: see waitOf; done: finished. */
export type Status = 'inbox' | 'ready' | 'running' | 'waiting' | 'done'
/** Why an item waits: its own hold, or after the first open prerequisite that is itself held. until: the date, for 'date'. */
export type Wait = { why: Held | 'after'; on?: TodoItem; until?: number }

/**
 * The open item's wait, none when it is ready or running. list gives the prerequisites (items with before = this id);
 * one in a live chat is on its way out and holds nothing, a link to a done or missing item is not a prerequisite.
 */
export function waitOf(t: TodoItem, live: (chat?: string) => boolean, now: number, list?: TodoList): Wait | undefined {
  if (live(t.chat)) return undefined
  const own = holdOf(t, now)
  if (own) return { why: own, ...(own === 'date' ? { until: t.notBefore } : {}) }
  const seen = new Set([t.id])
  const behind = (x: TodoItem): TodoItem | undefined => {
    for (const p of list?.todo.filter(y => y.before === x.id && !seen.has(y.id)) ?? []) {
      seen.add(p.id)
      if (!live(p.chat) && (holdOf(p, now) || behind(p))) return p
    }
    return undefined
  }
  const p = behind(t)
  return p && { why: 'after', on: p }
}

/** One status per item, so every page agrees. Give list for inbox, done and prerequisites; without it the item is open. */
export function statusOf(t: TodoItem | TickedItem, live: (chat?: string) => boolean, now: number, list?: TodoList): Status {
  if (list && !list.todo.some(x => x.id === t.id)) {
    if (list.suggested?.some(x => x.id === t.id)) return 'inbox'
    if (list.ticked?.some(x => x.id === t.id)) return 'done'
  }
  const open = t as TodoItem
  return live(open.chat) ? 'running' : waitOf(open, live, now, list) ? 'waiting' : 'ready'
}

/** The row's title: its short title, else the text cut to 60 characters the way todo.ts shortOf does. A trailing colon, semicolon or comma goes. */
export function titleOf(t: Pick<TodoItem, 'text' | 'short'>): string {
  const tidy = (s: string) => s.replace(/\s*[:;,]$/, '')
  if (t.short) return tidy(t.short)
  if (t.text.length <= 60) return t.text
  const clause = t.text.split(/(?<=[.:;?!])\s/)[0]
  if (clause.length >= 12 && clause.length <= 60) return tidy(clause)
  const cut = t.text.slice(0, 57), at = cut.lastIndexOf(' ')
  return `${cut.slice(0, at > 20 ? at : cut.length)}...`
}
