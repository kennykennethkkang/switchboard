// Pure parts of the to-do panel.
import type { TickedItem, TodoItem, TodoList } from './hub-types'

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
