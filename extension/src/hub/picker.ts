/**
 * Auto for New chat: Jev labels the task with a role, a rule table picks the AI.
 * The table comes from the Codex model bench (no Claude vs Codex head-to-head yet): code roles go to Codex, the rest to Claude.
 */
import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { keyEnv, keyStore } from './keys'
import type { AiStatus, AutoPick } from './types'

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

/** Codex is on PATH and not signed out. ponytail: no Codex usage-limit signal exists in the hub yet; add it here when one does. */
export const codexUsable = (ais: AiStatus[]) => { const c = ais.find(a => a.id === 'codex'); return !!c?.installed && c.signedIn !== false }

type Run = (preset: string, input: string) => Promise<string | undefined>
const viaJev: Run = (preset, input) => new Promise(done => execFile('python3', [JEV, 'ask', '--preset', preset, '--input', input],
  { timeout: 5000, maxBuffer: 1 << 20, env: { ...process.env, ...keyEnv(keyStore(), process.env) } }, (err, out) => done(err ? undefined : String(out))))

/** Jev's role for the task from the project's route preset, or undefined when unsure, missing or slower than ms. */
export async function jevRole(task: string, preset: string, run: Run = viaJev, ms = 2000): Promise<string | undefined> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pick-'))
  try {
    const input = path.join(dir, 'items.json')
    fs.writeFileSync(input, JSON.stringify([{ _id: '0', task: task.slice(0, 2000) }]))
    const out = await Promise.race([run(preset, input), new Promise<undefined>(r => setTimeout(() => r(undefined), ms))])
    for (const line of out?.split('\n') ?? []) {
      try {
        const r = JSON.parse(line) as { role?: unknown; role_conf?: unknown }
        if (typeof r.role === 'string' && typeof r.role_conf === 'number' && r.role_conf >= SURE) return r.role
      } catch { /* summary line or noise */ }
    }
    return undefined
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** The full pick: Jev when the project has a route preset and the skill is installed, else the keywords. */
export async function autoPick(text: string, ais: AiStatus[], preset?: string): Promise<AutoPick> {
  const label = preset && fs.existsSync(JEV) && text.trim() ? await jevRole(text, preset) : undefined
  return pickAi({ text, codexReady: codexUsable(ais), label })
}
