/**
 * The pick log and the effort guard. Every auto pick (picker.ts) is one row in ~/.claude/switchboard/picks.jsonl, so the
 * thresholds can be tuned on real rows later and a handoff can start the fresh chat on the old chat's pick.
 * No vscode here.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { writeJsonAtomic } from '../fs-utils'

export const PICKS_FILE = path.join(os.homedir(), '.claude', 'switchboard', 'picks.jsonl')
const TAIL = 1 << 20

/** explicit: the fields Kenneth set himself (the pick did not touch them). kept: a handoff's fresh chat carrying the old pick. features: scoreTask's signals. */
export type PickRow = {
  at: number
  session?: string
  project: string
  ai: 'claude' | 'codex'
  role: string
  model?: string
  effort?: string
  ultracode: boolean
  ultrathink: boolean
  reason: string
  auto: boolean
  explicit?: { model?: string; effort?: string; ultracode?: boolean }
  features?: Record<string, number | boolean>
  kept?: boolean
}

/** One row appended; a log that cannot be written never stops a chat. */
export function logPick(row: PickRow, file = PICKS_FILE): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`, { mode: 0o600 })
  } catch { /* no log, no problem */ }
}

/** The latest row for a chat, from the last MB of the log; undefined when it has none. */
export function readPick(session: string, file = PICKS_FILE): PickRow | undefined {
  let text = ''
  try {
    const size = fs.statSync(file).size, fd = fs.openSync(file, 'r')
    try { const n = Math.min(size, TAIL), b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, size - n); text = b.toString('utf8') } finally { fs.closeSync(fd) }
  } catch { return undefined }
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const r = JSON.parse(lines[i]) as PickRow
      if (r.session === session) return r
    } catch { /* torn line */ }
  }
  return undefined
}

// Claude Code saves a chat's /effort as the default for new sessions. A per-chat pick must not move that default,
// so the first /effort in a burst snapshots effortLevel and it goes back after ms.
let guard: { timer: NodeJS.Timeout; was: unknown } | undefined

const read = (file: string): Record<string, unknown> | undefined => {
  try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); return s && typeof s === 'object' && !Array.isArray(s) ? s : undefined } catch { return undefined }
}

/** Call before an /effort goes to a chat: effortLevel in the settings file is put back ms later (5 s). */
export function keepEffortDefault(file: string, ms = 5000): void {
  let was = guard?.was
  if (guard) clearTimeout(guard.timer)
  else {
    const s = read(file)
    if (!s) return
    was = s.effortLevel
  }
  const timer = setTimeout(() => {
    guard = undefined
    const s = read(file)
    if (!s || s.effortLevel === was) return
    const next = { ...s }
    if (was === undefined) delete next.effortLevel
    else next.effortLevel = was
    try { writeJsonAtomic(file, next) } catch { /* left as Claude Code wrote it */ }
  }, ms)
  timer.unref?.()
  guard = { timer, was }
}

/** The gear set a new default on purpose: the snapshot is dropped, so it is not undone. */
export function dropEffortGuard(): void {
  if (guard) clearTimeout(guard.timer)
  guard = undefined
}
