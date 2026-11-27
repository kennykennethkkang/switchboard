import * as fs from 'node:fs'
import * as path from 'node:path'
import { redact } from './brain'
import type { ChatProgress, ChatRow, IndefiniteBudget } from './types'

/** The line that ends Run indefinitely; the usage-meter mod's IND_DONE for Claude chats. */
export const INDEFINITE_DONE = /^Run indefinitely: done\s*$/m
/** UI rounds: a Safe and an Explore version, crowd-ab picks; the mod's IND_DESIGN. */
export const DESIGN_ROUND = 'If the round changes UI or UX, build two versions on localhost behind a toggle: Safe (proven patterns from the project and the design library) and Explore (a bolder take from ~/.claude/switchboard/design-md/SOURCES.md); have a qa agent that built neither run crowd-ab on both, keep the winner, log its result in .switchboard/design-rounds.md, and start the next UI round from the winner with a fresh Safe and Explore pair.'
/** The next-round prompt, as the usage-meter mod's IND_ROUND sends it to a Claude chat. */
export const INDEFINITE_ROUND = `Run indefinitely is on. Do another round: audit the project for bugs, errors, user problems and hard-to-use parts; fix them; add components that would help this project; run the checks; dispatch role subagents as needed. ${DESIGN_ROUND} Decide everything yourself and note decisions. Never commit. When nothing is left you can improve, end with the line \`Run indefinitely: done\`.`

type Turn = { on: number | undefined; answer?: string; aborted?: boolean; held?: boolean }

/**
 * What a Codex chat's ended turn needs under Run indefinitely (the mod's Stop rules): 'done' when its last answer carries the
 * closing line, 'send' for another round, nothing otherwise. Never while it works, asks (needs-you, the closing question
 * included), was interrupted, or is held (approved, handed off, archived, usage pause). once: a turn is nudged once, by its mtime.
 */
export function codexRound(chat: ChatRow, progress: ChatProgress | undefined, t: Turn, once: Map<string, number>): 'send' | 'done' | undefined {
  if (t.on === undefined || chat.ai !== 'codex' || chat.status !== 'idle' || chat.updatedAt === undefined || chat.updatedAt <= t.on) return undefined
  if (once.get(chat.sessionId) === chat.updatedAt) return undefined
  if (progress?.state === 'working' || progress?.state === 'needs-you' || t.aborted) return undefined
  if (t.answer && INDEFINITE_DONE.test(t.answer)) return 'done'
  if (t.held) return undefined
  return 'send'
}

/** The gate cap, as the usage-meter mod's IND_GATE_MS. */
export const GATE_MS = 10 * 60_000
export type GateExec = (cmd: string, cwd: string, timeoutMs: number) => Promise<{ code: number; out: string }>

/** Runs the gate through exec (sh -c in the chat's folder); a failure keeps the last 20 output lines, redacted. */
export async function runGate(gate: string, cwd: string, exec: GateExec): Promise<{ ok: true } | { ok: false; out: string }> {
  try {
    const r = await exec(gate, cwd, GATE_MS)
    return r.code === 0 ? { ok: true } : { ok: false, out: redact(r.out.trim().split('\n').slice(-20).join('\n')) }
  } catch (err) {
    return { ok: false, out: redact(`gate did not finish: ${err instanceof Error ? err.message : String(err)}`) }
  }
}

/** The end reason when a cap is spent; an unknown cost never trips the cost cap. */
export function budgetEnd(b: IndefiniteBudget | undefined, onAt: number, now: number, costUsd: number | undefined): string | undefined {
  if (!b) return undefined
  const hours = (now - onAt) / 3_600_000
  if ((b.maxHours !== undefined && hours >= b.maxHours) || (b.maxCostUsd !== undefined && costUsd !== undefined && costUsd >= b.maxCostUsd)) return 'budget reached (not a success)'
  return undefined
}

export const usageLine = (onAt: number, now: number, usd: number | undefined) =>
  `used ${typeof usd === 'number' ? `$${usd.toFixed(2)} ` : ''}over ${Math.round((Math.max(0, now - onAt) / 3_600_000) * 10) / 10}h`

/** The round for a chat with a /goal file, as the usage-meter mod's goalRound. */
export const goalRound = (file: string) => `Run indefinitely is on with a goal in ${file}. Do another round toward it: build or fix what is still missing, test every function it names against how it should work, run its check and the project checks, dispatch role subagents as needed. ${DESIGN_ROUND} Decide everything yourself and note decisions in the goal file. Never commit. When every point in the goal works with no issues and its check passes, end with the line \`Run indefinitely: done\`.`

/** The round prompt (the goal's when it has one), with a failed gate's output after it. */
export const roundText = (gate: string | undefined, failedOut: string, goalFile?: string) => {
  const round = goalFile ? goalRound(goalFile) : INDEFINITE_ROUND
  return gate && failedOut ? `${round}\n\nThe gate \`${gate}\` failed. Its last output:\n${failedOut}` : round
}

/** A chat's /goal file: .switchboard/goals/<id>.md in its folder or the nearest parent that has one. */
export function goalFor(cwd: string, id: string, read = (p: string) => fs.readFileSync(p, 'utf8')): { file: string; dir: string; text: string } | undefined {
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    const file = path.join(dir, '.switchboard', 'goals', `${id}.md`)
    try { return { file, dir, text: read(file) } } catch { /* try the parent */ }
    if (path.dirname(dir) === dir) return undefined
  }
}

/** The command on the goal's Check line. */
export const goalCheck = (text: string) => text.match(/^Check: `([^`\n]+)`/m)?.[1].trim()

/** The handoff note line that hands a Codex chat's goal to its fresh chat; the new id is only known inside it. */
export const goalHandoffLine = (g: { file: string; dir: string }) =>
  `Goal: ${g.file}. Before anything else copy it to ${g.dir}/.switchboard/goals/$CODEX_THREAD_ID.md (run echo "$CODEX_THREAD_ID" for the id), then keep working toward it as /goal says.`
