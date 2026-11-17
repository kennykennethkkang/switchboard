/**
 * Split on New chat: one message cut into its separate asks by one quick model call, and the group
 * each split chat belongs to, kept in ~/.claude/switchboard/groups.json by session id.
 * Any doubt, error or slow answer keeps the message whole.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { writeJsonAtomic } from '../fs-utils'
import { redact } from './brain'
import { withDeadline } from './deadline'

export const SPLIT_MS = 8000
const MAX_ASKS = 8
const GROUPS = path.join(os.homedir(), '.claude', 'switchboard', 'groups.json')
const GROUPS_MAX = 500

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []

/** The asks in text, or [text] when it should stay one. */
export async function splitAsks(text: string, ask: (prompt: string, ms: number) => Promise<string>, ms = SPLIT_MS): Promise<string[]> {
  const whole = [text]
  const body = text.trim()
  // A secret in the text stays off the model; the message just starts as one.
  if (!body || redact(body) !== body) return whole
  const q = `Split this message to a coding assistant into its separate, unrelated asks. Keep related sub-steps of one task together in one ask. Copy each ask's wording from the message as closely as you can; never invent asks or add detail. If it is one task, return one ask.\nAnswer with a JSON array of strings only.\n\nMessage: ${body.slice(0, 4000)}`
  const answer = await withDeadline(() => ask(q, ms), ms)
  const json = answer?.slice(answer.indexOf('['), answer.lastIndexOf(']') + 1)
  let asks: unknown
  try { asks = JSON.parse(json || 'null') } catch { return whole }
  if (!Array.isArray(asks) || !asks.length || asks.length > MAX_ASKS || !asks.every(a => typeof a === 'string' && a.trim())) return whole
  // Each ask has to come from the message: most of its words are in it.
  const known = new Set(words(body))
  const made = (a: string) => { const w = words(a); return w.length > 0 && w.filter(x => known.has(x)).length / w.length < 0.6 }
  if (asks.some(made)) return whole
  return asks.map(a => a.trim())
}

export function readGroups(file = GROUPS): Record<string, string> {
  try {
    const g = JSON.parse(fs.readFileSync(file, 'utf8'))
    return g && typeof g === 'object' && !Array.isArray(g) ? Object.fromEntries(Object.entries(g).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {}
  } catch { return {} }
}

export function saveGroup(sessionId: string, group: string, file = GROUPS): void {
  // ponytail: oldest entries drop past GROUPS_MAX; a group outlives the map view long before that.
  const all = Object.entries({ ...readGroups(file), [sessionId]: group }).slice(-GROUPS_MAX)
  writeJsonAtomic(file, Object.fromEntries(all))
}
