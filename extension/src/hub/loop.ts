import type { ChatProfile, CheckBack } from './types'
import { smartPick, type Stats } from './smart-pick'
export { codeTask, statsOf, taskLabel } from './smart-pick'

// The four loop kinds from Anthropic's loop engineering post, as Switchboard runs them.
// turn: plain chat. goal: Run indefinitely toward a goal. timer: a prompt on an interval (check-back). proactive: a cloud routine made with /schedule.
export type LoopMode = 'turn' | 'goal' | 'timer' | 'proactive'
export const LOOP_MODES: LoopMode[] = ['turn', 'goal', 'timer', 'proactive']
/** New chat's picker: auto reads the message and picks one of the four. */
export type LoopChoice = LoopMode | 'auto'
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

// First match wins: a schedule beats a check-back, which beats a keep-going word.
const RULES: Array<[LoopMode, RegExp, string]> = [
  ['proactive', /\b(every\s+(weekday|morning|evening|night|day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?|each\s+(morning|day|week|weekday)|daily|nightly|weekly|monthly|at\s+\d{1,2}(:\d\d)?\s*(am|pm)|(a|cloud)\s+routine|on\s+a\s+schedule|cron|when(ever)?\s+(a|an)\s+(new\s+)?(pr|pull request|issue)\s+(opens|comes in|is opened)|on\s+(each|every)\s+(push|pr|pull request|issue|release)|(my|the)\s+mac\s+(is\s+)?off)\b/i, 'it runs on a schedule or an event'],
  ['timer', /\b(check\s+back|keep\s+(an\s+eye|checking|watching)|monitor|poll(ing)?|watch\s+(the|for|it)|every\s+\d+\s*(m|min|mins|minutes?|h|hrs?|hours?)|every\s+(few|couple\s+of)\s+(minutes|hours)|hourly|remind\s+me)\b/i, 'it asks to check back'],
  ['goal', /\b(until|till|keep\s+going|don'?t\s+stop|do\s+not\s+stop|run\s+indefinitely|no\s+matter\s+how\s+long|(crash|bug|error)[-\s]?free|zero\s+(issues|errors|bugs|warnings|lag)|all\s+(the\s+)?tests\s+pass|end\s+to\s+end)\b/i, 'it asks to keep going'],
]

/** "every 2 hours" as the nearest Timer interval; 30 min when the text names none. */
export function everyOf(text: string): Every {
  const m = /\bevery\s+(\d+)\s*(m|min|mins|minutes?|h|hrs?|hours?)\b/i.exec(text)
  const min = m ? Number(m[1]) * (/^h/i.test(m[2]) ? 60 : 1) : /\bhourly\b/i.test(text) ? 60 : 30
  return EVERY.reduce((a, b) => (Math.abs(b - min) < Math.abs(a - min) ? b : a))
}

export type AutoLoop = { mode: LoopMode; rule: LoopMode; why: string; everyMin?: Every }

/** Auto: the rule pick from the words, unless the learned table (kind loop, per task label) clearly knows better. */
export function autoLoop(text: string, task: string, stats: Stats = {}): AutoLoop {
  let rule: LoopMode = 'turn', why = 'nothing asks to repeat, keep going or run on a schedule'
  for (const [mode, re, what] of RULES) {
    const hit = re.exec(text)
    if (hit) { rule = mode; why = `${what} ("${hit[0].toLowerCase()}")`; break }
  }
  const s = smartPick('loop', task, rule, LOOP_MODES, stats)
  const mode = s.pick as LoopMode
  return { mode, rule, why: s.why ? `learned override, ${s.why.slice(8).trim()}` : why, ...(mode === 'timer' ? { everyMin: everyOf(text) } : {}) }
}

/** What New chat sends so Smart select can learn: Auto's pick, and the mode Kenneth chose by hand when it differs. */
export type SmartLoop = { task: string; pick: LoopMode; why: string; final?: LoopMode }
export const isSmartLoop = (v: unknown): v is SmartLoop => {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.task === 'string' && o.task.length <= 40 && LOOP_MODES.includes(o.pick as LoopMode) && typeof o.why === 'string' && o.why.length <= 300
    && (o.final === undefined || LOOP_MODES.includes(o.final as LoopMode))
}
