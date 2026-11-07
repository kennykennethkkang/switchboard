/**
 * The node drawer's data: a role's runs in one chat, as extension/src/hub/runs.ts reads them (same shapes),
 * how to get them (the panel's runs-get, else the app's /hub/runs proxy), and the small labels the drawer shows.
 */
import { vscodeBridge } from './vscode-bridge'
import { downReason } from './hub-remote'
import { timeLeft, type Left } from './eta'
import type { ChatProgress } from './hub-types'

export type RunReport = { status?: string; changed: string[]; checked: string[]; open: string[] }
export type RunFile = { path: string; added: number; removed: number }
export type RunCall = { at: number; tool: string; target?: string }
export type RunLoop = { at: number; by: 'qa' | 'lead'; text: string }
export type RunTokens = { input: number; output: number; cacheRead: number; cacheWrite: number }
export type RunDispatch = { at: number; role: string; title?: string; brief: string }
export type RunDetail = {
  id: string; role: string; title?: string; model?: string; startedAt: number; endedAt: number; finished: boolean
  brief: string; report?: RunReport; reportText?: string; files: RunFile[]; calls: RunCall[]; callCount: number
  loops: RunLoop[]; tokens: RunTokens; costUsd?: number; file: string; dispatches?: RunDispatch[]
}

/** role 'lead' gives one run: the chat's own transcript. */
export async function loadRuns(sessionId: string, role: string, f: typeof fetch = fetch): Promise<RunDetail[] | string> {
  if (vscodeBridge?.isVSCode) return vscodeBridge.runs(sessionId, role)
  try {
    const r = await f(`/hub/runs?${new URLSearchParams({ session: sessionId, role })}`, { headers: { 'X-Switchboard': '1' }, cache: 'no-store' })
    return r.ok ? ((await r.json()) as RunDetail[]) : downReason(r.status)
  } catch {
    return downReason(undefined)
  }
}

export type Kind = 'read' | 'search' | 'edit' | 'run' | 'other'
const KINDS: Record<string, Kind> = { Read: 'read', NotebookRead: 'read', WebFetch: 'read', Grep: 'search', Glob: 'search', WebSearch: 'search', ToolSearch: 'search', Edit: 'edit', Write: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', Bash: 'run', Monitor: 'run' }
export const kindOf = (tool: string): Kind => KINDS[tool] ?? (tool.startsWith('mcp__') ? 'run' : 'other')

/** A report's Status as a tone: blocked, concerns or done. */
export function statusTone(s?: string): 'blocked' | 'concerns' | 'done' | undefined {
  if (!s) return undefined
  return /block/i.test(s) ? 'blocked' : /concern|partial|fail/i.test(s) ? 'concerns' : /done|pass|complete/i.test(s) ? 'done' : undefined
}

/** "45s", "10m 05s", "1h 20m". */
export function clockDur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

/** "950", "412k", "12.6M". */
export const count = (n: number) => n < 1000 ? `${n}` : n < 1e6 ? `${Math.round(n / 1000)}k` : `${(n / 1e6).toFixed(1)}M`

/** A run is working while the chat's progress says so; without that, until its transcript says it finished. */
export function runState(r: RunDetail, p?: ChatProgress): 'active' | 'done' {
  return p?.roles.find(x => x.id === r.id)?.state ?? (r.finished ? 'done' : 'active')
}

/** The role's own time left: its running subagents against past runs, and its open tasks. */
export function roleLeft(p: ChatProgress | undefined, all: ChatProgress[], role: string, now: number): Left | undefined {
  if (!p) return undefined
  const running = p.roles.filter(r => r.role === role && r.state === 'active').map(r => r.id)
  if (!running.length) return undefined
  return timeLeft({ ...p, tasks: p.tasks.filter(t => t.role === role), running, jobs: undefined }, all, now)
}
