/**
 * Approve: a done chat waits for Kenneth's OK, then closes and moves to History.
 * The done-check mod (claude-mods) writes ~/.claude/switchboard/done-check/<session>.json.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { closeChatTerminal } from './ais'
import { CHAT_PREFIX } from './terminal-tags'
import type { ChatProgress, DoneCheck } from './types'

const DONE_CHECK = path.join(os.homedir(), '.claude', 'switchboard', 'done-check')

/** The done-check verdict for a chat; undefined when the mod wrote none or it does not parse. */
export function readDoneCheck(sessionId: string, dir = DONE_CHECK): DoneCheck | undefined {
  if (!/^[\w-]{1,80}$/.test(sessionId)) return undefined
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, `${sessionId}.json`), 'utf8')) as Record<string, unknown>
    if (typeof raw?.verified !== 'boolean') return undefined
    const missing = Array.isArray(raw.missing) ? raw.missing.filter((m): m is string => typeof m === 'string').map(m => m.slice(0, 200)).slice(0, 20) : []
    return { verified: raw.verified, ...(missing.length ? { missing } : {}) }
  } catch { return undefined }
}

/** History's approve fields. Read from the file: a chat approved through the closing question is needs-you, then working, never done. */
export function approvedFields(sessionId: string, commit?: string, now = Date.now(), dir = DONE_CHECK): { approvedAt: number; commit?: string; doneCheck?: DoneCheck } {
  const doneCheck = readDoneCheck(sessionId, dir)
  return { approvedAt: now, ...(commit ? { commit } : {}), ...(doneCheck ? { doneCheck } : {}) }
}

/** The kit rule's closing question (claude-mods kit/rules.md); any other Approve answer is not this. */
export const APPROVE_QUESTION = 'Approve this chat as finished'
const APPROVE_OPTIONS = ['Approve', 'Send back']

// A subagent killed without SubagentStop (a 429) stays in running up to RUNNING_CAP_MS; past this it no longer holds approval.
export const LIVE_SUB_MS = 10 * 60 * 1000

/** Why a finished-looking chat still cannot be approved; undefined: it can. */
export function approvalBlock(chat: ChatProgress | undefined, now = Date.now()): string | undefined {
  if (!chat) return undefined
  if (chat.state === 'working') return 'the chat is still working'
  const live = (chat.running ?? []).filter(id => { const r = chat.roles.find(r => r.id === id); return !!r && now - (r.at ?? r.startedAt) <= LIVE_SUB_MS })
  if (live.length) return `subagents still running: ${live.join(', ')}`
  const open = chat.tasks.filter(t => t.status !== 'completed').length
  return open ? `${open} open task${open === 1 ? '' : 's'}` : undefined
}

/** The kit's closing AskUserQuestion answered Approve, whatever state the chat is in. */
export function closingApprove(payload: Record<string, unknown>): boolean {
  if (payload.hook_event_name !== 'PostToolUse' || payload.tool_name !== 'AskUserQuestion') return false
  const answers = (payload.tool_response as { answers?: Record<string, unknown> } | undefined)?.answers
  const qs = (payload.tool_input as { questions?: unknown } | undefined)?.questions
  if (!answers || typeof answers !== 'object' || !Array.isArray(qs)) return false
  return qs.some(q => {
    const { question, options } = (q ?? {}) as { question?: unknown; options?: unknown }
    if (!Array.isArray(options)) return false
    return isClosing(question, options.map(o => (o as { label?: unknown })?.label)) && String(answers[question as string] ?? '').trim() === 'Approve'
  })
}

const isClosing = (question: unknown, labels: unknown[]) => typeof question === 'string' && question.includes(APPROVE_QUESTION)
  && labels.length === APPROVE_OPTIONS.length && APPROVE_OPTIONS.every((l, i) => labels[i] === l)

/** Chats that show the done-check stamp: done ones, and ones whose open prompt is the closing question. */
export const stampedChats = (progress: ChatProgress[]) => progress.filter(p => p.state === 'done'
  || (p.state === 'needs-you' && p.ask?.kind === 'question' && !p.ask.sub && !!p.ask.questions?.some(q => isClosing(q.question, q.options)))).map(p => p.sessionId)

/** The closing question came back Approve and nothing live is left. The question itself puts the chat in needs-you. */
export const approvedAnswer = (payload: Record<string, unknown>, chat?: ChatProgress, now = Date.now()) => closingApprove(payload) && !approvalBlock(chat, now)

export { isTempDir } from './temp'

/** By name, for callers without the owner map (terminals.ts): actions.ts names chat terminals `Claude Code: ...` or `Codex: ...`. */
export const ourTerminal = (t: { name: string }) => CHAT_PREFIX.test(t.name)

type Term = { name: string; processId: Thenable<number | undefined>; dispose(): void }
/** Disposes the Switchboard terminal of each approved chat process once it exits; how many closed. isOurs: hub-panel passes the owner map. */
export async function closeApproved<T extends Term>(pids: number[], terminals: readonly T[], o?: Parameters<typeof closeChatTerminal>[2], isOurs: (t: T) => boolean = ourTerminal): Promise<number> {
  const ours = terminals.filter(isOurs)
  const done = await Promise.all(pids.map(pid => closeChatTerminal(pid, ours, o)))
  return done.filter(Boolean).length
}
