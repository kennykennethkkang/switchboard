/**
 * Approve: a done chat waits for Kenneth's OK, then closes and moves to History.
 * The done-check mod (claude-mods) writes ~/.claude/switchboard/done-check/<session>.json.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { closeChatTerminal } from './ais'
import { isResearch } from './research'
import { CHAT_PREFIX } from './terminal-tags'
import type { ChatProgress, ChatRow, DoneCheck } from './types'

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
export const APPROVE_OPTIONS = ['Approve', 'Send back'] as const

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

// Claude's ask tool and Codex's (hook payload tool_name, as claude-mods codex-hooks.mjs reads it).
const ASK_TOOLS = new Set(['AskUserQuestion', 'request_user_input'])

// Switchboard's own ask tool, as Claude (mcp__switchboard__ask) or Codex may name it.
const SB_ASK = /^(mcp__)?switchboard(__|\.|\/)ask$/

/** The ask tool's reply is text: one `"question": picked` line per question. */
function replyText(r: unknown): string {
  if (typeof r === 'string') return r
  if (Array.isArray(r)) return r.map(replyText).join('\n')
  if (r && typeof r === 'object') { const o = r as { text?: unknown; content?: unknown }; return typeof o.text === 'string' ? o.text : o.content ? replyText(o.content) : '' }
  return ''
}

type Pick = (typeof APPROVE_OPTIONS)[number]

function sbAskPick(payload: Record<string, unknown>): Pick | undefined {
  const qs = (payload.tool_input as { questions?: unknown } | undefined)?.questions
  if (!Array.isArray(qs)) return undefined
  const lines = replyText(payload.tool_response).split('\n')
  for (const q of qs) {
    const { question, options } = (q ?? {}) as { question?: unknown; options?: unknown }
    if (!Array.isArray(options) || !isClosing(question, options.map(o => (o as { label?: unknown })?.label))) continue
    const hit = APPROVE_OPTIONS.find(o => lines.includes(`"${question}": ${o}`))
    if (hit) return hit
  }
  return undefined
}

/** The answer to the kit's closing AskUserQuestion, Approve or Send back; undefined for any other question or answer. */
export function closingPick(payload: Record<string, unknown>): Pick | undefined {
  if (payload.hook_event_name !== 'PostToolUse') return undefined
  if (SB_ASK.test(String(payload.tool_name))) return sbAskPick(payload)
  if (!ASK_TOOLS.has(String(payload.tool_name))) return undefined
  const answers = (payload.tool_response as { answers?: Record<string, unknown> } | undefined)?.answers
  const qs = (payload.tool_input as { questions?: unknown } | undefined)?.questions
  if (!answers || typeof answers !== 'object' || !Array.isArray(qs)) return undefined
  for (const q of qs) {
    const { question, options } = (q ?? {}) as { question?: unknown; options?: unknown }
    if (!Array.isArray(options) || !isClosing(question, options.map(o => (o as { label?: unknown })?.label))) continue
    const a = answers[question as string] ?? answers[(q as { id?: string }).id ?? '']
    // Codex wraps an answer as { answers: [label] }.
    const picked = String((typeof a === 'object' && a ? (a as { answers?: unknown[] }).answers?.[0] : a) ?? '').trim()
    const hit = APPROVE_OPTIONS.find(o => o === picked)
    if (hit) return hit
  }
  return undefined
}

/** The kit's closing AskUserQuestion answered Approve, whatever state the chat is in. */
export const closingApprove = (payload: Record<string, unknown>) => closingPick(payload) === 'Approve'

const isClosing = (question: unknown, labels: unknown[]) => typeof question === 'string' && question.includes(APPROVE_QUESTION)
  && labels.length === APPROVE_OPTIONS.length && APPROVE_OPTIONS.every((l, i) => labels[i] === l)

/** Chats that show the done-check stamp: done ones, and ones whose open prompt is the closing question. */
export const stampedChats = (progress: ChatProgress[]) => progress.filter(p => p.state === 'done'
  || (p.state === 'needs-you' && p.ask?.kind === 'question' && !p.ask.sub && !!p.ask.questions?.some(q => isClosing(q.question, q.options)))).map(p => p.sessionId)


/** By name, for callers without the owner map (terminals.ts): actions.ts names chat terminals `Claude Code: ...` or `Codex: ...`. */
export const ourTerminal = (t: { name: string }) => CHAT_PREFIX.test(t.name)

type Term = { name: string; processId: Thenable<number | undefined>; dispose(): void }
/** Disposes the Switchboard terminal of each approved chat process once it exits; how many closed. isOurs: hub-panel passes the owner map. */
export async function closeApproved<T extends Term>(pids: number[], terminals: readonly T[], o?: Parameters<typeof closeChatTerminal>[2], isOurs: (t: T) => boolean = ourTerminal): Promise<number> {
  const ours = terminals.filter(isOurs)
  const done = await Promise.all(pids.map(pid => closeChatTerminal(pid, ours, o)))
  return done.filter(Boolean).length
}

/** Approve leaves the chat running: it works mid-turn, or a question or permission prompt still waits, which a stale click must not kill. */
export const staysOpenOnApprove = (p: ChatProgress | undefined) =>
  !!p && ((p.state === 'working' && !p.waiting) || (p.state === 'needs-you' && (!!p.ask || !!p.asks?.length)))

// A research chat sits this long idle for a follow-up, then closes as approved; a new prompt restarts the clock.
export const RESEARCH_IDLE_MS = 10 * 60 * 1000

/** Live research chats idle past RESEARCH_IDLE_MS with no prompt waiting and nothing still running, background jobs included. Pure. */
export function idleResearch(chats: ChatRow[], progress: ChatProgress[], now = Date.now()): string[] {
  return chats.filter(c => c.live && isResearch(c.cwd) && c.status === 'idle' && c.updatedAt !== undefined && now - c.updatedAt >= RESEARCH_IDLE_MS)
    .filter(c => { const p = progress.find(x => x.sessionId === c.sessionId); return !staysOpenOnApprove(p) && !approvalBlock(p, now) && !p?.ask && !p?.asks?.length && !p?.jobs?.length && !p?.subJobs?.length })
    .map(c => c.sessionId)
}

/** closeApproved again while a chat is still running, up to tries; true once every chat's terminal closed. */
export async function closeApprovedRetry<T extends Term>(pids: number[], terminals: readonly T[], o?: Parameters<typeof closeChatTerminal>[2], isOurs: (t: T) => boolean = ourTerminal, tries = 3): Promise<boolean> {
  for (let i = 0; i < tries; i++) if (await closeApproved(pids, terminals, o, isOurs) >= pids.length) return true
  return false
}

export const CLOSING_DENY = 'Run the aar skill and print the standup (done, for you, left, risks) before the Approve question.'
// Enough for a long closing turn; older entries only matter for the no-edits skip.
const GATE_TAIL = 4 * 1024 * 1024
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

type Entry = { type?: string; isMeta?: boolean; isCompactSummary?: boolean; origin?: { kind?: string }; message?: { content?: unknown } }
type Block = { type?: string; text?: string; name?: string; input?: unknown }

const blocks = (e: Entry): Block[] => Array.isArray(e.message?.content) ? e.message!.content as Block[] : []
// Typed by Kenneth: not a tool result, skill body, compact summary, subagent notice or mod nudge (origin plugin).
const realPrompt = (e: Entry) => e.type === 'user' && !e.isMeta && !e.isCompactSummary && (!e.origin?.kind || e.origin.kind === 'human') && (typeof e.message?.content === 'string'
  ? !e.message.content.startsWith('<task-notification>')
  : blocks(e).some(b => b.type === 'text') && !blocks(e).some(b => b.type === 'tool_result'))

function readTail(file: string): Entry[] {
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size, n = Math.min(size, GATE_TAIL), b = Buffer.alloc(n)
    fs.readSync(fd, b, 0, n, size - n)
    return b.toString('utf8').split('\n').flatMap(l => { try { return [JSON.parse(l) as Entry] } catch { return [] } })
  } catch { return [] } finally { if (fd !== undefined) fs.closeSync(fd) }
}

const aarRan = (b: Block) => b.type === 'tool_use' && ((b.name === 'Skill' && /(^|:)aar$/.test(String((b.input as { skill?: unknown })?.skill ?? '')))
  || /aar\/SKILL\.md|wiki\/aar-[\w.-]+\.md/.test(JSON.stringify(b.input ?? '')))

/** PreToolUse deny reason for the closing question asked before the aar and standup; undefined lets it through. */
export function closingGate(payload: { hook_event_name?: string; tool_name?: string; tool_input?: unknown; transcript_path?: string; cwd?: string }): string | undefined {
  if (payload.hook_event_name !== 'PreToolUse' || payload.tool_name !== 'AskUserQuestion' || !payload.transcript_path) return undefined
  // Research chats end on a finding, not a change: no aar to run first.
  if (isResearch(payload.cwd)) return undefined
  const qs = (payload.tool_input as { questions?: unknown })?.questions
  if (!Array.isArray(qs) || !qs.some(q => isClosing((q as { question?: unknown })?.question, Array.isArray((q as { options?: unknown })?.options) ? (q as { options: { label?: unknown }[] }).options.map(o => o?.label) : []))) return undefined
  const entries = readTail(payload.transcript_path)
  if (!entries.length) return undefined
  // ponytail: Edit/Write tool calls only; a chat that changed files only through Bash skips the gate (close-means-approved).
  if (!entries.some(e => blocks(e).some(b => b.type === 'tool_use' && EDITS.has(String(b.name))))) return undefined
  let start = 0
  entries.forEach((e, i) => { if (realPrompt(e)) start = i + 1 })
  // The turn began before the tail: the aar may sit outside it, so do not guess.
  if (!start) return undefined
  const turn = entries.slice(start).filter(e => e.type === 'assistant').flatMap(blocks)
  // No standup text check: the transcript drops some assistant text blocks (the standup right before the question among them), so it would deny forever.
  return turn.some(aarRan) ? undefined : CLOSING_DENY
}
