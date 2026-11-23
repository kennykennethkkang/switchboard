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

// A quick call takes 5 to 10 s while many chats run; past this the message starts whole.
export const SPLIT_MS = 20000
const MAX_ASKS = 8
const MAX_PIECES = 60
const GROUPS = path.join(os.homedir(), '.claude', 'switchboard', 'groups.json')
const GROUPS_MAX = 500

// Cut points: after a sentence end (not e.g., vs. or a list marker), after a line break, before an inline "2." after a colon, before "2)".
const CUT = /(?<=(?<!\b(?:e\.g|i\.e|vs)|(?:^|[.!?:;]\s+)\(?\d+)[.!?]+\s+|\n)(?=\S)|(?<=[:;]\s+)(?=\(?\d+\.\s)|(?<=\s)(?=\(?\d+\)\s)/
const MARKER = /^\s*(?:\(?\d+[.)]|[-*\u2022])\s+/

/** text cut into sentences, lines and list items; joined back they are text. */
export const pieces = (text: string) => text.split(CUT).filter(Boolean)

/** The asks in text, or [text] when it should stay one. */
export async function splitAsks(text: string, ask: (prompt: string, ms: number) => Promise<string>, ms = SPLIT_MS): Promise<string[]> {
  const whole = [text]
  const body = text.trim()
  // A secret in the text stays off the model; the message just starts as one.
  if (!body || redact(body) !== body) return whole
  const parts = pieces(body)
  if (parts.length < 2 || parts.length > MAX_PIECES) return whole
  // The model answers with piece numbers only: a short reply comes back in time, and each ask is the message's own words.
  const q = `Below is a message to a coding assistant, cut into numbered pieces. Group the pieces into the message's separate, unrelated asks. Keep related sub-steps of one task in one group. If it is one task, put every piece in one group.\nAnswer with a JSON array of arrays of piece numbers only, like [[1,2],[3]].\n\n${parts.map((x, i) => `[${i + 1}] ${x.trim()}`).join('\n')}`
  const answer = await withDeadline(() => ask(q, ms), ms)
  const json = answer?.slice(answer.indexOf('['), answer.lastIndexOf(']') + 1)
  let groups: unknown
  try { groups = JSON.parse(json || 'null') } catch { return whole }
  if (!Array.isArray(groups) || groups.length < 2 || groups.length > MAX_ASKS) return whole
  const owner: number[] = parts.map(() => -1)
  for (const [g, nums] of groups.entries()) {
    if (!Array.isArray(nums) || !nums.length) return whole
    for (const n of nums) {
      if (!Number.isInteger(n) || n < 1 || n > parts.length || owner[n - 1] >= 0) return whole
      owner[n - 1] = g
    }
  }
  // A piece the model left out (a lead-in, a trailing note) joins the ask before it, or the first one.
  const first = owner.find(g => g >= 0) ?? 0
  owner.forEach((g, i) => { if (g < 0) owner[i] = i ? owner[i - 1] : first })
  // Asks keep the message's order, whatever order the model listed them in.
  const order = groups.map((_, g) => g).sort((a, b) => owner.indexOf(a) - owner.indexOf(b))
  const asks = order.map(g => parts.filter((_, i) => owner[i] === g).join('').trim().replace(MARKER, ''))
  return asks.filter(Boolean).length < 2 ? whole : asks.filter(Boolean)
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
