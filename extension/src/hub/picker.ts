/**
 * Auto for New chat: Jev labels the task with a role, a rule table picks the AI.
 * The table comes from the Codex model bench (no Claude vs Codex head-to-head yet): code roles go to Codex, the rest to Claude.
 * pickRun then picks the model and effort for that AI from the task (see the rule above it).
 */
import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { keyEnv, keyStore } from './keys'
import type { AiStatus, AutoPick } from './types'

/** Whether a run gets the auto pick: its own auto (New chat, the Start popover) wins, else the gear's Auto pick per task, on unless false. */
export const autoOn = (auto: boolean | undefined, gear: boolean | undefined) => auto ?? gear !== false

const JEV = path.join(os.homedir(), '.claude', 'skills', 'claude-x-jev', 'scripts', 'jev.py')
const SURE = 0.7
const CODE = new Set(['engineer', 'qa'])
const WHY: Record<string, string> = {
  engineer: 'it is a code change', qa: 'it is a code review or test run',
  designer: 'it is UI or design work', growth: 'it is writing', researcher: 'it is research', ops: 'it is ops work',
}

// First match wins, so UI words beat code words ("fix the button styling" is design).
const WORDS: Array<[string, RegExp]> = [
  ['designer', /\b(ui|ux|design|redesign|layout|styl\w*|css|colou?r|look|screen|button|mockup|animation|theme|font)\b/i],
  ['growth', /\b(copy|launch post|blog|email|landing page|marketing|tweet|pricing text)\b/i],
  ['researcher', /\b(research|find out|investigate|compare|how does|how do|why does|explain)\b/i],
  ['ops', /\b(deploy|server|ci|release|install|key|account|cron|schedule|cleanup|changelog)\b/i],
  ['qa', /\b(review|qa|verify|reproduce)\b/i],
  ['engineer', /\b(fix|implement|add|build|refactor|test|tests|bug|function|endpoint|typecheck|parser|api|rename|migrate|wire)\b/i],
]
const NEEDS_CLAUDE = /\b(plugin|mods?|skills?|hooks?|mcp|claude code)\b/i

/** A role guess from the words alone; 'unknown' when none match, 'claude-only' for plugin and mod work. */
export function keywordRole(text: string): string {
  if (NEEDS_CLAUDE.test(text)) return 'claude-only'
  return WORDS.find(([, re]) => re.test(text))?.[0] ?? 'unknown'
}

/** label: Jev's role when it was sure; the keywords stand in otherwise. */
export function pickAi(o: { text: string; codexReady: boolean; label?: string }): AutoPick {
  const text = o.text.trim()
  if (!text) return { ai: 'claude', reason: 'there is no task yet' }
  const role = o.label ?? keywordRole(text)
  if (!CODE.has(role)) return { ai: 'claude', reason: role === 'claude-only' ? 'it needs Claude plugins or mods' : WHY[role] ? `${WHY[role]}, which Claude handles` : 'nothing marks it as code work' }
  if (!o.codexReady) return { ai: 'claude', reason: 'Codex is signed out or out of usage' }
  return { ai: 'codex', reason: `${WHY[role]}, and Codex benched best on those` }
}

/** Codex is on PATH and not signed out. Its 5h usage never blocks it: pickCodexRun only holds xhigh back. */
export const codexUsable = (ais: AiStatus[]) => { const c = ais.find(a => a.id === 'codex'); return !!c?.installed && c.signedIn !== false }

type Run = (preset: string, input: string) => Promise<string | undefined>
const viaJev: Run = (preset, input) => new Promise(done => execFile('python3', [JEV, 'ask', '--preset', preset, '--input', input],
  { timeout: 5000, maxBuffer: 1 << 20, env: { ...process.env, ...keyEnv(keyStore(), process.env) } }, (err, out) => done(err ? undefined : String(out))))

import type { Difficulty } from './pick-run'
export * from './pick-run'
const DIFFICULTIES: readonly string[] = ['trivial', 'routine', 'hard', 'frontier']
export type JevLabels = { role?: string; difficulty?: Difficulty }

/** Jev's role and difficulty for the task from the project's route preset; each only when sure, nothing when missing or slower than ms. One call answers both. */
export async function jevLabels(task: string, preset: string, run: Run = viaJev, ms = 2000): Promise<JevLabels> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pick-'))
  try {
    const input = path.join(dir, 'items.json')
    fs.writeFileSync(input, JSON.stringify([{ _id: '0', task: task.slice(0, 2000) }]))
    const out = await Promise.race([run(preset, input), new Promise<undefined>(r => setTimeout(() => r(undefined), ms))])
    for (const line of out?.split('\n') ?? []) {
      try {
        const r = JSON.parse(line) as { role?: unknown; role_conf?: unknown; difficulty?: unknown; difficulty_conf?: unknown }
        const labels: JevLabels = {}
        if (typeof r.role === 'string' && typeof r.role_conf === 'number' && r.role_conf >= SURE) labels.role = r.role
        if (typeof r.difficulty === 'string' && DIFFICULTIES.includes(r.difficulty) && typeof r.difficulty_conf === 'number' && r.difficulty_conf >= SURE) labels.difficulty = r.difficulty as Difficulty
        if (labels.role || labels.difficulty) return labels
      } catch { /* summary line or noise */ }
    }
    return {}
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** Jev's role for the task, or undefined when unsure, missing or slower than ms. */
export const jevRole = async (task: string, preset: string, run: Run = viaJev, ms = 2000) => (await jevLabels(task, preset, run, ms)).role

/** Jev's labels when the project has a route preset and the skill is installed, else none. */
export const labelTask = (text: string, preset?: string): Promise<JevLabels> => (preset && fs.existsSync(JEV) && text.trim() ? jevLabels(text, preset) : Promise.resolve({}))

/** The full pick: Jev when the project has a route preset and the skill is installed, else the keywords. labels: already fetched, so the call is not made twice. */
export async function autoPick(text: string, ais: AiStatus[], preset?: string, labels?: JevLabels): Promise<AutoPick> {
  const label = (labels ?? await labelTask(text, preset)).role
  return pickAi({ text, codexReady: codexUsable(ais), label })
}

/** The first message with Claude Code's ultrathink keyword once at the end; a slash command keeps its line as typed. */
export const withUltrathink = (text: string): string => (!text || /\bultrathink\b/i.test(text) || /^\/[a-z][\w:-]*(\s|$)/i.test(text) ? text : `${text} ultrathink`)

/** The highest unreset window of this kind (five_hour, or codex_five_hour) in percent; 0 with none. reset reads a window's resetsAt as epoch ms. */
export function fiveHour(windows: Array<{ kind?: string; percentUsed: number; resetsAt?: string }>, kind: string, reset: (v?: string) => number, now = Date.now()): number {
  return Math.max(0, ...windows.filter(w => w.kind === kind && !(reset(w.resetsAt) <= now)).map(w => w.percentUsed))
}
