/** How far a chat is through its task list, and roughly how long the rest takes at its own pace so far. */
import type { ChatProgress, TaskRow } from './hub-types'
import { formatDuration } from './duration'

export type Eta = { done: number; total: number; current?: TaskRow; elapsedMs: number; perTaskMs?: number; leftMs?: number }

export function eta(p: ChatProgress, now: number): Eta {
  const tasks = p.tasks, finished = tasks.filter(t => t.status === 'completed')
  const current = tasks.find(t => t.status === 'in_progress')
  const timed = finished.filter(t => t.startedAt !== undefined && t.doneAt !== undefined).map(t => t.doneAt! - t.startedAt!)
  // Per task: the tasks' own times when known, else the chat's time so far spread over what finished.
  const last = Math.max(0, ...finished.map(t => t.doneAt ?? 0))
  const perTaskMs = timed.length ? timed.reduce((a, b) => a + b, 0) / timed.length
    : finished.length && last ? (last - p.startedAt) / finished.length : undefined
  const open = tasks.length - finished.length
  // The task under way counts as partly done, but never below a fifth of a task.
  const into = current?.startedAt !== undefined ? now - current.startedAt : 0
  const leftMs = perTaskMs !== undefined && open ? Math.max(perTaskMs * open - into, perTaskMs * 0.2) : undefined
  return { done: finished.length, total: tasks.length, current, elapsedMs: now - p.startedAt, perTaskMs, leftMs }
}

/** "under a minute", "about 4 min", "about 1 h 20 min". */
export function say(ms: number): string {
  return formatDuration(ms, 'eta')
}

const MIN = 60e3
/** Time left as a range; open: a part with no history runs too, so it may take longer. 'estimating': too little to go on yet. 'over': past its usual length. */
export type Left = { lo: number; hi: number; open?: true } | 'estimating' | 'over'

/** Parts that run side by side: the longest sets the range, an unknown one leaves it open ended. */
export function projectLeft(parts: Array<Left | undefined>): Left | undefined {
  const known = parts.filter((l): l is Exclude<Left, string> => typeof l === 'object')
  if (!known.length) return parts.includes('over') ? 'over' : parts.includes('estimating') ? 'estimating' : undefined
  const open = parts.some(l => typeof l === 'string') || known.some(l => l.open)
  return { lo: Math.max(...known.map(l => l.lo)), hi: Math.max(...known.map(l => l.hi)), ...(open ? { open: true as const } : {}) }
}

const quart = (s: number[], q: number) => { const i = (s.length - 1) * q, f = Math.floor(i); return s[f] + (s[Math.min(f + 1, s.length - 1)] - s[f]) * (i - f) }

/**
 * A working chat's time left: its open tasks at its own pace, each running subagent against past runs of its role in any chat,
 * background shells as unknown. Undefined when nothing runs.
 */
export function timeLeft(p: ChatProgress, all: ChatProgress[], now: number): Left | undefined {
  if (p.state !== 'working') return undefined
  const parts: Left[] = []
  const e = eta(p, now)
  // A fixed spread around the average task, not a fitted one; widen it if real chats keep landing outside.
  if (e.total > e.done) parts.push(e.leftMs === undefined ? 'estimating' : { lo: e.leftMs * 0.75, hi: e.leftMs * 1.5 })
  for (const id of p.running ?? []) {
    const r = p.roles.find(x => x.id === id)
    const runs = all.flatMap(c => c.roles.filter(x => x.role === r?.role && x.state === 'done' && x.at !== undefined && x.at > x.startedAt).map(x => x.at! - x.startedAt)).sort((a, b) => a - b)
    if (!r || runs.length < 3) { parts.push('estimating'); continue }
    const into = now - r.startedAt, hi = quart(runs, 0.75) - into
    if (hi <= 0) { parts.push('over'); continue }
    parts.push({ lo: Math.max(quart(runs, 0.25) - into, MIN / 2), hi: Math.max(hi, MIN) })
  }
  if (p.jobs?.length) parts.push('estimating')
  return projectLeft(parts)
}

const short = (ms: number) => say(ms).replace(/^about /, '')
/** "about 4 to 7 min left", "at least 8 min left", "estimating time left". */
export function sayLeft(l: Left): string {
  if (l === 'estimating') return 'estimating time left'
  if (l === 'over') return 'running longer than usual'
  if (l.open) return `at least ${short(Math.max(l.lo, MIN))} left`
  const a = Math.round(l.lo / MIN), b = Math.round(l.hi / MIN)
  if (b < 1) return 'under a minute left'
  if (a === b) return `${say(l.hi)} left`
  return b < 60 ? `about ${Math.max(a, 1)} to ${b} min left` : `about ${short(l.lo)} to ${short(l.hi)} left`
}

/** "3 agents, 1 shell running"; undefined when nothing runs in the background. */
export function busyLine(p?: ChatProgress): string | undefined {
  const n = (k: number, w: string) => k ? `${k} ${w}${k === 1 ? '' : 's'}` : ''
  const parts = [n(p?.running?.length ?? 0, 'agent'), n(p?.jobs?.length ?? 0, 'shell')].filter(Boolean)
  return parts.length ? `${parts.join(', ')} running` : undefined
}
