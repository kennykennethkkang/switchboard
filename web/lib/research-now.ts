// Ship's Research tracker: which chats are doing web research right now, read from each chat's newest tool calls.
import type { ChatProgress, HubState } from './hub-types'

export type ResearchRow = {
  sessionId: string
  /** The chat the research serves: research runs inside it, by its lead or its researchers. */
  chat: string
  project?: string
  /** Kenneth's newest ask in that chat, cut short. */
  forAsk?: string
  who: 'lead' | 'researcher' | 'subagent'
  /** What it is doing now, in plain words. */
  doing: string
  searches: number
  sources: number
  live: boolean
  at: number
}

// Calls older than this drop off the tracker; a row stays live while its newest call or a researcher is this fresh.
export const SHOW_MS = 15 * 60_000
export const LIVE_MS = 3 * 60_000

const SEARCH = (t: string) => t === 'WebSearch' || (t.startsWith('mcp__') && /search|perplexity|query-docs|last30/i.test(t))
const FETCH = (t: string) => t === 'WebFetch' || (t.startsWith('mcp__') && /fetch|scrap|firecrawl|read_url|brows/i.test(t))
const DEEP = (tool: string, target?: string) => tool === 'Skill' && /deep-research/.test(target ?? '')
const base = (p?: string) => p?.replace(/\/+$/, '').split('/').pop() || undefined
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s)

function row(p: ChatProgress, hub: Pick<HubState, 'chats'>, now: number): ResearchRow | undefined {
  const calls = (p.tools ?? []).filter(c => now - c.at < SHOW_MS && (SEARCH(c.tool) || FETCH(c.tool) || DEEP(c.tool, c.target)))
  if (!calls.length) return undefined
  const last = calls[calls.length - 1]
  const chat = hub.chats.find(c => c.sessionId === p.sessionId)
  const researcherOn = p.roles.some(r => r.state === 'active' && /researcher/i.test(r.role))
  const who = last.role === 'lead' ? 'lead' : /researcher/i.test(last.role) ? 'researcher' : 'subagent'
  const verb = SEARCH(last.tool) ? (last.target ? `searching “${last.target}”` : 'searching the web')
    : FETCH(last.tool) ? (last.target ? `reading ${last.target}` : 'reading a page') : 'running deep research'
  const ask = p.asked?.at(-1)?.replace(/\s+/g, ' ').trim()
  return {
    sessionId: p.sessionId,
    chat: chat?.name || base(p.cwd) || p.sessionId.slice(0, 8),
    project: base(chat?.project ?? p.cwd),
    ...(ask ? { forAsk: cut(ask, 120) } : {}),
    who,
    doing: `${who === 'lead' ? 'The chat' : who === 'researcher' ? 'Its researcher' : 'A subagent'} is ${verb}`,
    searches: calls.filter(c => SEARCH(c.tool)).length,
    sources: new Set(calls.filter(c => FETCH(c.tool)).map(c => c.target ?? '')).size,
    live: p.state !== 'done' && (now - last.at < LIVE_MS || researcherOn),
    at: last.at,
  }
}

/** Live rows first, then newest. */
export function researchNow(hub: Pick<HubState, 'chats' | 'progress'>, now = Date.now()): ResearchRow[] {
  return hub.progress.map(p => row(p, hub, now)).filter((r): r is ResearchRow => !!r)
    .sort((a, b) => Number(b.live) - Number(a.live) || b.at - a.at)
}
