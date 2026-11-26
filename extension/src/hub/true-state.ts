/**
 * Hooks are posted with a short timeout, so a busy window misses some and a chat reads working, or needs you, long
 * after it moved on. Claude Code's own session file says busy, waiting or idle: the missed hook is made up from that
 * and the transcript, so every window lands on what the terminal shows. Called from hub-service.ts trueUp.
 */
import * as fs from 'fs'
import type { ChatProgress, ChatRow } from './types'

type Payload = Record<string, unknown>
/** text: the last answer of the last turn. cut: that turn never answered (interrupted, or only a prompt). error: it died on an API error. */
export type LastTurn = { text: string; cut?: true; error?: string }

// How long a status has to stand, with no hook since, before the hooks count as lost and not just on their way.
const SETTLE_MS = 10_000
// A cache ping keeps an idle chat busy for some seconds.
const BUSY_MS = 30_000
// A hook that came after the status changed says more than the status; only a long quiet outweighs it.
const QUIET_MS = 60_000
const STOP_HOOKS_MS = 120_000
// "dialog open" is a menu the user opened.
const PROMPTS = /permission prompt|input needed|request/

/** The hook a chat's progress is missing, judged by its session file; undefined when they agree. answering: an answer
 * from Switchboard is being typed into its terminal. */
export function missedHook(p: ChatProgress | undefined, c: ChatRow, now: number, last: () => LastTurn | undefined, answering = false): Payload | undefined {
  if (!c.live || c.statusAt === undefined || p?.limited) return undefined
  const at = { session_id: c.sessionId, cwd: p?.cwd ?? c.cwd }
  const quiet = p ? now - p.at : Infinity, stood = now - c.statusAt, after = !p || c.statusAt > p.at
  const asks = p?.asks ?? (p?.ask ? [p.ask] : [])
  const inHub = asks.some(a => a.via === 'hub')
  if (c.status === 'busy') {
    if (!p) return { ...at, hook_event_name: 'SwitchboardBusy' }
    const settled = p.state === 'idle' || p.state === 'done'
    const lost = settled ? (after && stood >= BUSY_MS) || quiet >= STOP_HOOKS_MS : p.state === 'needs-you' && !inHub && after && stood >= BUSY_MS
    return lost ? { ...at, hook_event_name: 'SwitchboardBusy' } : undefined
  }
  if (c.status === 'waiting') {
    if (!PROMPTS.test(c.waitingFor ?? '') || stood < SETTLE_MS || answering || p?.state === 'needs-you') return undefined
    return { ...at, hook_event_name: 'SwitchboardWaiting', message: 'Waiting for you in its terminal' }
  }
  if (c.status !== 'idle' && c.status !== 'shell') return undefined
  if (p) {
    if (p.waiting || inHub || !(p.state === 'working' || asks.length)) return undefined
    if (stood < SETTLE_MS || quiet < (after ? SETTLE_MS : QUIET_MS)) return undefined
  }
  const turn = last()
  if (!turn || turn.cut) return { ...at, hook_event_name: 'SwitchboardIdle' }
  return turn.error ? { ...at, hook_event_name: 'StopFailure', error: turn.error, last_assistant_message: turn.text } : { ...at, hook_event_name: 'Stop', last_assistant_message: turn.text }
}

/** The chat's turn ended a while ago and both its status and its hooks say so; background jobs may still run. */
export const turnOver = (p: ChatProgress, c: ChatRow, now: number): boolean =>
  c.live && c.ai !== 'codex' && (c.status === 'idle' || c.status === 'shell') && c.statusAt !== undefined && now - c.statusAt >= SETTLE_MS
  && (p.state === 'done' || p.state === 'idle' || !!p.waiting)

const TAIL = 1 << 20
/** How a chat's last turn ended, from the last MB of its transcript; undefined when it has none to read. */
export function lastTurn(file: string): LastTurn | undefined {
  let lines: string[], fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size, n = Math.min(size, TAIL), b = Buffer.alloc(n)
    fs.readSync(fd, b, 0, n, size - n)
    lines = b.toString('utf8').split('\n')
  } catch { return undefined } finally { if (fd !== undefined) fs.closeSync(fd) }
  for (let i = lines.length - 1; i >= 0; i--) {
    let e: { type?: string; isSidechain?: boolean; isMeta?: boolean; isApiErrorMessage?: boolean; error?: string; message?: { content?: unknown } }
    try { e = JSON.parse(lines[i]) } catch { continue }
    if (e.isSidechain || e.isMeta || (e.type !== 'assistant' && e.type !== 'user')) continue
    const content = e.message?.content
    const parts = (Array.isArray(content) ? content : [{ type: 'text', text: content }]) as { type?: string; text?: unknown }[]
    const text = parts.filter(x => x.type === 'text' && typeof x.text === 'string').map(x => x.text).join('\n').trim()
    if (!text) continue
    if (e.type === 'user') return { text: '', cut: true }
    return e.isApiErrorMessage ? { text, error: e.error ?? 'unknown' } : { text }
  }
  return undefined
}
