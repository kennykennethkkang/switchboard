/**
 * Spend limits for the paid-guard mod: spend-policy.json (written here) and spend.json (the mod counts each paid call).
 * Keep DEFAULTS in step with claude-mods paid-guard/hooks/register.ts.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { writeJsonAtomic } from '../hook-entries'
import type { SpendMode, SpendRow } from './types'

const SB = path.join(os.homedir(), '.claude', 'switchboard')

const DEFAULTS: Array<[key: string, label: string, mode: SpendMode, monthlyUsd?: number]> = [
  ['openrouter', 'OpenRouter (Jev)', 'provider'], ['bland', 'Bland', 'provider'], ['perplexity', 'Perplexity', 'provider'],
  ['newblack', 'NewBlack renders', 'provider'], ['fit', 'Fit of the day', 'provider'], ['shop', 'Shop search', 'provider'],
  ['gemini', 'Gemini', 'cap', 5], ['aws', 'AWS changes', 'ask'], ['stitch', 'Stitch uploads', 'ask'],
]
export const SPEND_KEYS = DEFAULTS.map(d => d[0])
export const SPEND_MODES: SpendMode[] = ['provider', 'cap', 'ask']

const read = (file: string): Record<string, any> => {
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return v && typeof v === 'object' ? v : {} } catch { return {} }
}

export function readSpend(dir = SB): SpendRow[] {
  const policy = read(path.join(dir, 'spend-policy.json'))
  const spend = read(path.join(dir, 'spend.json'))
  const used = spend.month === new Date().toISOString().slice(0, 7) && spend.keys ? spend.keys : {}
  return DEFAULTS.map(([key, label, mode, cap]) => {
    const p = policy[key]
    const m: SpendMode = SPEND_MODES.includes(p?.mode) ? p.mode : mode
    const monthlyUsd = typeof p?.monthlyUsd === 'number' ? p.monthlyUsd : cap ?? 5
    return { key, label, mode: m, monthlyUsd, calls: Number(used[key]?.calls) || 0, usd: Number(used[key]?.usd) || 0 }
  })
}

export function setSpend(key: string, mode: SpendMode, monthlyUsd: number | undefined, dir = SB): void {
  if (!SPEND_KEYS.includes(key) || !SPEND_MODES.includes(mode)) throw new Error(`Unknown spend setting ${key}`)
  if (monthlyUsd !== undefined && !(Number.isFinite(monthlyUsd) && monthlyUsd >= 0 && monthlyUsd <= 10_000)) throw new Error('The cap must be 0 to 10000 dollars')
  const file = path.join(dir, 'spend-policy.json')
  const policy = read(file)
  policy[key] = { mode, ...(monthlyUsd !== undefined ? { monthlyUsd } : policy[key]?.monthlyUsd !== undefined ? { monthlyUsd: policy[key].monthlyUsd } : {}) }
  fs.mkdirSync(dir, { recursive: true })
  writeJsonAtomic(file, policy)
}
