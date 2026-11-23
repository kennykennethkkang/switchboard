// Every chat's research run, folded from the moment the webview loads, so a panel mounted later
// (the inline one on the Chats page, or the Research tab after its replay) starts with what already happened.
import { vscodeBridge, type AgentEvent } from './vscode-bridge'
import { emptyRun, reduceResearch, type ResearchRun } from './research'

const EMPTY = emptyRun()
const runs = new Map<string, ResearchRun>()
const subs = new Set<() => void>()
const tell = () => subs.forEach(f => f())

/** One event in, filed under its own chat. */
export function feedResearch(e: AgentEvent, now = Date.now()): void {
  if (!e.sessionId) return
  const prev = runs.get(e.sessionId) ?? EMPTY
  const next = reduceResearch(prev, e, e.sessionId, now)
  if (next === prev) return
  runs.set(e.sessionId, next)
  tell()
}

// The replay after a reset re-folds old runs.
export const clearResearch = () => { runs.clear(); tell() }
export const researchRun = (sessionId: string): ResearchRun => runs.get(sessionId) ?? EMPTY
export const subscribeResearch = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }

let started = false
/** Start listening; call before posting 'ready' so the replay lands here. */
export function startResearchStore(): void {
  if (started || !vscodeBridge) return
  started = true
  vscodeBridge.onEvent(e => feedResearch(e))
  vscodeBridge.onSession(type => { if (type === 'reset') clearResearch() })
}
