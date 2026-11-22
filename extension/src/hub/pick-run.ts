/** The model, effort, ultracode and ultrathink pick for one run. Pure, so the web UI imports it too (web/lib/auto-reason.ts). */
export type Difficulty = 'trivial' | 'routine' | 'hard' | 'frontier'

// Model, effort, ultrathink and ultracode from the task. Two scores: C (does it need a stronger model) and T (does it need more effort).
//   C = min(6, 3*hardGroups) + 3*learned + min(2, sentBack) - min(4, 2*easyWords)    (a Jev difficulty replaces the keyword part)
//   T = max(scope, size) + 2*verify + 2*risk + 2*(parts >= 3) + unattended + min(2, sentBack) - (easy ? 1 : 0)
// The thresholds are judgment, not measured; ~/.claude/switchboard/picks.jsonl collects rows to tune them on.
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type PickInput = {
  text: string
  /** lead (a chat), a role file name, or engineer-codex and qa-codex; anything else counts as lead. */
  role?: string
  ai: 'claude' | 'codex'
  /** Files the task touches (a qa diff's count); read from paths in the text when absent. */
  files?: number
  /** Separate asks in the task; counted from bullets and "also" when absent. */
  parts?: number
  /** A To-do run or Run indefinitely. */
  unattended?: boolean
  /** The 5h window of the account that will run it (Claude's, or Codex's for ai codex), in percent. */
  usage5h: number
  jevDifficulty?: Difficulty
  /** Kenneth's own picks: used as given, never gated. */
  explicit?: { model?: string; effort?: Effort; ultracode?: boolean }
  /** Escalation steps learned on these files (usage-meter model-learn), and times Kenneth sent the chat back. */
  learned?: number
  sentBack?: number
}
export type RunPick = { model: string; effort: Effort; ultracode: boolean; ultrathink: boolean; reason: string }

const LADDER = ['haiku', 'sonnet', 'opus', 'fable']
export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
type RoleRule = { base: string; floor: string; ceil: string; eMin: Effort; eMax: Effort }
const ROLES: Record<string, RoleRule> = {
  lead: { base: 'opus', floor: 'sonnet', ceil: 'fable', eMin: 'medium', eMax: 'max' },
  engineer: { base: 'sonnet', floor: 'haiku', ceil: 'fable', eMin: 'low', eMax: 'max' },
  qa: { base: 'sonnet', floor: 'haiku', ceil: 'opus', eMin: 'medium', eMax: 'xhigh' },
  researcher: { base: 'haiku', floor: 'haiku', ceil: 'opus', eMin: 'medium', eMax: 'high' },
  Explore: { base: 'haiku', floor: 'haiku', ceil: 'sonnet', eMin: 'medium', eMax: 'medium' },
  designer: { base: 'opus', floor: 'sonnet', ceil: 'fable', eMin: 'medium', eMax: 'xhigh' },
  ops: { base: 'haiku', floor: 'haiku', ceil: 'sonnet', eMin: 'low', eMax: 'high' },
  growth: { base: 'opus', floor: 'sonnet', ceil: 'opus', eMin: 'medium', eMax: 'high' },
}
const HARD = [
  /\b(architect\w*|algorith\w*|state machine|protocol|design (a|an|the) (system|schema|api))\b/i,
  /\b(race|races|concurren\w*|deadlock\w*|atomic\w*)\b/i,
  /\b(root cause|intermittent\w*|flak\w*|why does|why do|why is|non-?determinis\w*|leak\w*)\b/i,
  /\b(migrat\w*|rewrite|port (it |this )?to)\b/i,
  /\b(security|vulnerab\w*|exploit\w*|threat model)\b/i,
]
const EASY = /\b(rename|typo|wording|bump|comment|readme|format|lint|one[- ]line|tiny|trivial|tweak)\b/gi
const VERIFY = /\b(bug|fix|fixes|regression|edge cases?|broken|failing|fails)\b/i
const RISK = /\b(auth\w*|secrets?|api keys?|passwords?|payments?|billing|data loss|database|deploy\w*|permissions?|shell|network|keychain|security|vulnerab\w*)\b/i
const BROAD = /\b(every|all (the )?(files|callers|routes|screens|pages|tests)|whole|entire|(deep|full) sweep|across|codebase-wide|repo-wide|audit)\b/i
// A lookup or a dismissal is not work: "pull up the page", "never mind".
const LOOKUP = /^\s*(can you )?(pull( me)?( up| to)|show me|where|which|what|is |are |does |did |have |has |when |how )/i
const NOOP = /\b(ignore it|never ?mind|forget it)\b/i
// A build ask this long that names no file is a feature, not a tweak: it counts as scope 2 (3 from 1000 chars).
const BUILD = /\b(implement|build|create|creating|add|revamp|redesign|integrate|make (me )?an? )/i
const SHARED = /\b(shared state|state|store|cache|database|data)\b/i
const FILE = /(?:[\w.-]+\/)+[\w.*-]+\.\w+|\b[\w-]+\.(?:tsx?|m?js|json|md|py|css|swift|go|rs)\b/g
const JEV_C: Record<Difficulty, number> = { trivial: -2, routine: 0, hard: 3, frontier: 6 }
/** From this 5h usage on, the costly picks (ultracode, xhigh, max, fable) step down. */
export const GATE = 60

/** The signals the pick reads, for the log too. */
export function scoreTask(i: PickInput) {
  const t = i.text
  const lookup = LOOKUP.test(t), short = lookup && t.length < 100
  const files = i.files ?? new Set(t.match(FILE) ?? []).size
  const bullets = t.split('\n').filter(l => /^\s*([-*]|\d+[.)])\s/.test(l)).length
  const parts = i.parts ?? Math.max(bullets, 1 + (t.match(/\b(also|and then|plus)\b/gi) ?? []).length)
  const broad = BROAD.test(t) && !lookup, hard = HARD.filter(r => r.test(t)).length
  const easy = new Set((t.match(EASY) ?? []).map(s => s.toLowerCase())).size
  const verify = VERIFY.test(t) && !short && !NOOP.test(t), risk = RISK.test(t) && !short, shared = SHARED.test(t)
  const size = BUILD.test(t) && !files && !easy ? (t.length >= 1000 ? 3 : t.length >= 300 ? 2 : 0) : 0
  const learned = i.learned ?? 0, sentBack = i.sentBack ?? 0
  const kw = Math.min(6, 3 * hard) - Math.min(4, 2 * easy)
  const C = (i.jevDifficulty ? JEV_C[i.jevDifficulty] : kw) + 3 * learned + Math.min(2, sentBack)
  const scope = broad || files >= 10 ? 3 : files >= 4 ? 2 : files >= 2 ? 1 : 0
  const T = Math.max(scope, size) + (verify && !easy ? 2 : 0) + (risk ? 2 : 0) + (parts >= 3 ? 2 : 0) + (i.unattended ? 1 : 0) + Math.min(2, sentBack) - (easy ? 1 : 0)
  return { C, T, scope, files, parts, broad, hard, easy, verify, risk, shared, learned, sentBack }
}

const at = (l: readonly string[], v: string) => l.indexOf(v)
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/** The "because" part of the reason line. */
function because(i: PickInput, f: ReturnType<typeof scoreTask>): string[] {
  const why: string[] = []
  if (i.jevDifficulty) why.push(`Jev says ${i.jevDifficulty}`)
  else if (f.hard) why.push(`${f.hard} hard signal${f.hard > 1 ? 's' : ''}`)
  if (f.easy) why.push('small change')
  if (f.scope) why.push(f.broad ? 'repo-wide' : `${f.files} files`)
  if (f.verify && !f.easy) why.push('bug fix')
  if (f.risk) why.push('risky area')
  if (f.learned) why.push('escalated before on these files')
  if (f.sentBack) why.push(`sent back ${f.sentBack}x`)
  if (i.unattended) why.push('runs unattended')
  return why
}

/** The model and effort range a role may run at (pickRun clamps to it); an unknown role counts as lead. */
export const roleBounds = (role?: string) => { const r = ROLES[role && ROLES[role] ? role : 'lead']; return { model: [r.floor, r.ceil], effort: [r.eMin, r.eMax] } as const }

/**
 * Model, effort, ultrathink and ultracode for one run. Kenneth's explicit picks stand as given; the rest comes from the rule.
 * Ultracode, xhigh, max and fable only while the 5h usage is under GATE: above it they step down (xhigh and max to high, fable to
 * opus) and the reason says what was held. ai codex is pickCodexRun.
 */
export function pickRun(i: PickInput): RunPick {
  if (i.ai === 'codex') return pickCodexRun(i)
  const name = i.role && ROLES[i.role] ? i.role : 'lead'
  const role = ROLES[name], lead = name === 'lead', x = i.explicit ?? {}
  const f = scoreTask(i), { C, T } = f
  // Model: the role's base moved by C; fable only for the hardest (C >= 6).
  let m = clamp(at(LADDER, role.base) + (C <= -2 ? -1 : C <= 2 ? 0 : C <= 5 ? 1 : 2), at(LADDER, role.floor), at(LADDER, role.ceil))
  // qa follows Kenneth's rule: opus for risk or shared state or a big diff, haiku for a small one, else sonnet.
  if (name === 'qa') m = f.risk || f.shared || f.files >= 10 ? 2 : T <= 1 ? 0 : 1
  if (m === 3 && C < 6) m = 2
  // Effort from T, lifted by C, held to the role's range; max only for unattended work that is hard and wide.
  let e = T <= 0 ? 0 : T === 1 ? 1 : T <= 4 ? 2 : 3
  if (C >= 3) e = Math.max(e, 1)
  if (C >= 6) e = Math.max(e, 2)
  if (T >= 6 && i.unattended && C >= 6) e = 4
  e = clamp(e, at(EFFORTS, role.eMin), at(EFFORTS, role.eMax))
  // A stronger model at high beats haiku at xhigh.
  if (m === 0 && e >= 3) { m = 1; e = 2 }
  let ultracode = x.ultracode ?? (lead && f.parts >= 3 && f.scope >= 2 && T >= 5)
  let ultrathink = lead && !ultracode && f.parts < 3 && C >= 3 && T <= 2
  const why = because(i, f)
  if (i.usage5h >= GATE) {
    const held: string[] = []
    if (ultracode && x.ultracode === undefined) { ultracode = false; held.push('ultracode') }
    if (ultrathink) { ultrathink = false; held.push('ultrathink') }
    if (e >= 3 && x.effort === undefined) { held.push(EFFORTS[e]); e = 2 }
    if (m === 3 && x.model === undefined) { held.push('fable'); m = 2 }
    if (held.length) why.push(`5h at ${i.usage5h}%: held ${held.join(', ')}`)
  }
  return { model: x.model ?? LADDER[m], effort: x.effort ?? EFFORTS[e], ultracode, ultrathink, reason: why.join(', ') || 'routine task' }
}

/**
 * The Codex pick, from its bench: qa is always gpt-5.6-luna at high; code goes gpt-5.6-terra at medium, at high from T 2,
 * and gpt-6-luna at xhigh from T 5 while Codex's own 5h usage is under GATE.
 */
export function pickCodexRun(i: PickInput): RunPick {
  const f = scoreTask(i), x = i.explicit ?? {}
  const T = f.scope + (f.verify ? 2 : 0) + (f.risk ? 2 : 0) + 3 * Math.min(2, f.hard)
  const why = because(i, f)
  let model = 'gpt-5.6-terra', effort: Effort = T >= 2 ? 'high' : 'medium'
  if (i.role?.startsWith('qa')) { model = 'gpt-5.6-luna'; effort = 'high' } else if (T >= 5) {
    if (i.usage5h < GATE) { model = 'gpt-6-luna'; effort = 'xhigh' } else why.push(`codex 5h at ${i.usage5h}%: held xhigh`)
  }
  return { model: x.model ?? model, effort: x.effort ?? effort, ultracode: false, ultrathink: false, reason: why.join(', ') || 'routine task' }
}

