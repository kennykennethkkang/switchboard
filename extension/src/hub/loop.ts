import type { ChatProfile, CheckBack } from './types'

// The four loop kinds from Anthropic's loop engineering post, as Switchboard runs them.
// turn: plain chat. goal: Run indefinitely toward a goal. timer: a prompt on an interval (check-back). proactive: a cloud routine made with /schedule.
export type LoopMode = 'turn' | 'goal' | 'timer' | 'proactive'
export type Every = CheckBack['everyMin']
export const EVERY: Every[] = [10, 30, 60, 180, 1440]
export const ROUTINES_URL = 'https://claude.ai/code/routines'
/** What New chat or the chat page asks the extension to switch on; proactive starts a new chat instead. doneWhen: goal only; everyMin and text: timer only. */
export type LoopPick = { mode: 'turn' | 'goal' | 'timer'; doneWhen?: string; everyMin?: Every; text?: string }

const optText = (v: unknown, max: number) => v === undefined || (typeof v === 'string' && v.length <= max)
/** The hub-loop and hub-new-chat check; a timer needs its interval. */
export const isLoopPick = (v: unknown): v is LoopPick => {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (!['turn', 'goal', 'timer'].includes(o.mode as string)) return false
  if (o.everyMin !== undefined && !EVERY.includes(o.everyMin as Every)) return false
  if (o.mode === 'timer' && o.everyMin === undefined) return false
  return optText(o.doneWhen, 2000) && optText(o.text, 500)
}

/** A chat's loop from its saved profile: Goal while Run indefinitely is on, Timer while a check-back is set. */
export const loopOf = (p?: Pick<ChatProfile, 'indefinite' | 'checkBack'>): LoopMode => p?.indefinite ? 'goal' : p?.checkBack ? 'timer' : 'turn'

export const everyText = (m: number) => m >= 1440 ? 'daily' : m >= 60 ? `every ${m / 60} h` : `every ${m} min`

/** The goal skill writes the goal file and its Check line from this; the usage-meter rounds then work toward it. */
export const goalLine = (doneWhen: string) => `Use the goal skill to pin this chat to this goal: ${doneWhen.trim()}`

/** A Proactive chat's first prompt: Claude Code's /schedule turns it into a cloud routine that runs with this Mac off. */
export const scheduleText = (what: string) => `/schedule ${what.trim()}`
