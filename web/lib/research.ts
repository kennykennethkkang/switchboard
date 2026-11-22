// The Research panel's state: one chat's agent events folded into searches, sources, lanes and the answer.
// Pure: the panel and its test feed it the same events the hub gets.
import type { AgentEvent } from './bridge-types'

const LEAD = 'orchestrator'

export type Depth = 'quick' | 'standard' | 'deep'
export type Search = { kind: 'search'; id: number; query: string; agent: string; tool: string; state: 'running' | 'done' }
export type Source = {
  kind: 'source'; id: number; url: string; agent: string; tool: string
  state: 'reading' | 'read' | 'failed'
  /** Agents with a fetch of it still out. */
  pending: string[]
  /** Times it was opened; deep-research re-opens what it cites. */
  reads: number
}
export type FeedItem = Search | Source
export type Lane = {
  name: string; task: string; brief?: string; state: 'running' | 'done'
  sources: number; searches: number; last?: string
  /** Did web work, or its task reads like research. */
  research: boolean
  order: number
}
export type ResearchRun = {
  status: 'waiting' | 'running' | 'done'
  question?: string
  depth?: Depth
  feed: FeedItem[]
  lanes: Lane[]
  answer?: string
  /** Event times (s) of the start and the newest event, and when (ms) the newest arrived. */
  t0?: number; tLast?: number; seenAt?: number
  lastUser?: string
  /** A new question came in after the run ended: the next start resets. */
  fresh?: boolean
  /** The lead spoke since the last research lane returned. */
  leadSince?: boolean
  seq: number
}

export const emptyRun = (): ResearchRun => ({ status: 'waiting', feed: [], lanes: [], seq: 0 })

const str = (v: unknown) => (typeof v === 'string' ? v : '')
// A task that opens with a research verb; "Fix ... findings" or "Security review of Research routes" do not.
const RESEARCHY = /^(research|investigate|look ?up|find out|survey|compare|search|fact.?check|deep.?research)\b/i
const FETCHY = /fetch|scrap|brows|reach|firecrawl|read_url|request/i
const SEARCHY = /search|query-docs|perplexity|last30/i

/** The URL a tool call reads, if it is a source read. */
function sourceUrl(tool: string, args: string, input: Record<string, unknown> | undefined): string | undefined {
  if (tool === 'WebFetch') return str(input?.url) || (args ? (/^https?:/.test(args) ? args : `https://${args}`) : undefined)
  if (tool.startsWith('mcp__') && FETCHY.test(tool)) return args.match(/https?:\/\/[^\s"'<>\\]+/)?.[0]
  return undefined
}
/** The query a tool call searches, if it is a search. */
function searchQuery(tool: string, args: string, input: Record<string, unknown> | undefined): string | undefined {
  if (tool === 'WebSearch') return str(input?.query) || args
  if (tool.startsWith('mcp__') && SEARCHY.test(tool)) return args.match(/"(?:query|q|search_query|topic)"\s*:\s*"([^"]*)/)?.[1] || undefined
  return undefined
}

export const normUrl = (u: string) => u.replace(/#.*$/, '').replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '').toLowerCase()

function depthIn(text: string): Depth | undefined {
  const m = text.match(/\b(?:depth|level)\b\W{0,3}(?:is\s+|=\s*)?\**(quick|standard|deep)\b/i) ?? text.match(/\b(quick|standard|deep)\b\W{0,3}(?:depth|level)\b/i)
  return m ? (m[1].toLowerCase() as Depth) : undefined
}

const ANSWER_DONE = /\*\*Answer:?\*\*|^#+\s*Sources\b/im
/** The lead's text is the report itself, not a progress note. */
export const looksLikeAnswer = (text: string) => ANSWER_DONE.test(text) || /^#+\s*(Findings|Answer)\b/im.test(text)

function begin(run: ResearchRun): ResearchRun {
  if (run.status === 'running') return run
  // More web work on the same question: live again.
  if (run.status === 'done' && !run.fresh) return { ...run, status: 'running' }
  const base = run.status === 'done' ? { ...emptyRun(), lastUser: run.lastUser } : run
  return { ...base, status: 'running', question: run.lastUser ?? base.question, fresh: undefined }
}

const patchLane = (run: ResearchRun, name: string, f: (l: Lane) => Lane): ResearchRun => {
  const i = run.lanes.findIndex(l => l.name === name)
  if (i < 0) return run
  const lanes = run.lanes.slice()
  lanes[i] = f(lanes[i])
  return { ...run, lanes }
}

// Done when nothing runs and either the report is in, or every research lane is back and the lead spoke after.
function settle(run: ResearchRun): ResearchRun {
  if (run.status !== 'running') return run
  const lanes = run.lanes.filter(l => l.research)
  if (lanes.some(l => l.state === 'running') || run.feed.some(f => f.state === 'running' || f.state === 'reading')) return run
  const report = !!run.answer && ANSWER_DONE.test(run.answer)
  return report || (lanes.length > 0 && run.leadSince) ? { ...run, status: 'done' } : run
}

/** One event in; events for other sessions come back unchanged. now: ms, for the elapsed clock. */
export function reduceResearch(run: ResearchRun, e: AgentEvent, sessionId: string, now: number): ResearchRun {
  if (e.sessionId !== sessionId) return run
  const p = e.payload ?? {}
  let next = step(run, e.type, p)
  if (next === run) return run
  if (next.status !== 'waiting' && typeof e.time === 'number' && e.time > 0) {
    const t0 = next.t0 ?? e.time
    if (next.tLast === undefined || e.time >= next.tLast) next = { ...next, t0, tLast: e.time, seenAt: now }
    else if (next.t0 === undefined) next = { ...next, t0 }
  }
  return settle(next)
}

function step(run: ResearchRun, type: string, p: Record<string, unknown>): ResearchRun {
  const agent = str(p.agent) || LEAD
  switch (type) {
    case 'message': {
      const role = str(p.role), text = str(p.content).trim()
      if (!text) return run
      if (agent === LEAD && role === 'user') {
        // The extension posts the question after its replay, so it can land on a started run.
        if (run.status !== 'waiting' && !run.question) return { ...run, lastUser: text, question: text }
        return { ...run, lastUser: text, fresh: run.status === 'done' ? true : run.fresh }
      }
      if (role === 'user') return patchLane(run, agent, l => (l.brief ? l : { ...l, brief: text.split('\n')[0].slice(0, 240) }))
      if (role !== 'assistant') return run
      const depth = agent === LEAD ? depthIn(text) ?? run.depth : run.depth
      if (run.status === 'waiting') return depth === run.depth ? run : { ...run, depth }
      // The report wins from the lead or a research lane (deep-research often runs inside a researcher); a qa or engineer report never does. Lead notes only fill an empty box.
      const report = looksLikeAnswer(text) && (agent === LEAD || !!run.lanes.find(l => l.name === agent)?.research)
      const answer = report || (agent === LEAD && !(run.answer && looksLikeAnswer(run.answer))) ? text : run.answer
      return { ...run, answer, depth, leadSince: agent === LEAD ? true : run.leadSince }
    }
    case 'subagent_dispatch':
    case 'agent_spawn': {
      const name = str(type === 'agent_spawn' ? p.name : p.child)
      if (!name || p.isMain || name === LEAD) {
        // The lead came back after it ended: same run, live again.
        return type === 'agent_spawn' && p.isMain && run.status === 'done' && !run.fresh ? { ...run, status: 'running' } : run
      }
      const task = str(p.task) || name
      const kind = str(p.subagent_type) || str(p.agentType)
      const researchy = (s: string) => RESEARCHY.test(s) || /^researcher\b/i.test(name) || /researcher/i.test(kind)
      const i = run.lanes.findIndex(l => l.name === name)
      if (i >= 0) {
        const l = run.lanes[i]
        const better = task.length > l.task.length ? task : l.task
        return better === l.task && l.state === 'running' ? run : patchLane(run, name, x => ({ ...x, task: better, state: 'running', research: x.research || researchy(better) }))
      }
      const lane: Lane = { name, task, state: 'running', sources: 0, searches: 0, research: researchy(task) || researchy(name), order: run.lanes.length }
      const withLane = { ...run, lanes: [...run.lanes, lane] }
      return lane.research ? begin(withLane) : withLane
    }
    case 'subagent_return':
      return backFrom(run, str(p.child))
    case 'agent_complete': {
      const name = str(p.name)
      if (name === LEAD) return run.status === 'running' ? { ...run, status: 'done' } : run
      return run.lanes.some(l => l.name === name && l.state !== 'done') ? backFrom(run, name) : run
    }
    case 'tool_call_start': {
      const tool = str(p.tool), args = str(p.args)
      const input = p.inputData && typeof p.inputData === 'object' ? (p.inputData as Record<string, unknown>) : undefined
      if (tool === 'Skill') return /deep-research/.test(args) ? begin(run) : run
      const query = searchQuery(tool, args, input)
      const url = query === undefined ? sourceUrl(tool, args, input) : undefined
      if (query === undefined && !url) return run
      let r = begin(run)
      if (query !== undefined) {
        r = { ...r, seq: r.seq + 1, feed: [...r.feed, { kind: 'search', id: r.seq + 1, query, agent, tool, state: 'running' }] }
        return patchLane(r, agent, l => ({ ...l, searches: l.searches + 1, research: true, last: `Searching “${query}”` }))
      }
      const key = normUrl(url!)
      const at = r.feed.findIndex(f => f.kind === 'source' && normUrl(f.url) === key)
      const site = siteOf(url!)
      if (at >= 0) {
        const s = r.feed[at] as Source
        const feed = r.feed.slice()
        feed[at] = { ...s, state: 'reading', pending: [...s.pending, agent], reads: s.reads + 1 }
        r = { ...r, feed }
        return patchLane(r, agent, l => ({ ...l, research: true, last: `Re-reading ${site.host}` }))
      }
      r = { ...r, seq: r.seq + 1, feed: [...r.feed, { kind: 'source', id: r.seq + 1, url: url!, agent, tool, state: 'reading', pending: [agent], reads: 1 }] }
      return patchLane(r, agent, l => ({ ...l, sources: l.sources + 1, research: true, last: `Reading ${site.host}${site.path}` }))
    }
    case 'tool_call_end': {
      const tool = str(p.tool), result = str(p.result)
      const failed = p.isError === true && /^\[FAILED\]|^(error|request failed|failed to fetch|unable)/i.test(result) || /^\[FAILED\]/.test(result)
      // No call id comes back with a result; a URL, when one does, picks the right parallel fetch.
      const url = str(p.url) || str((p.inputData as Record<string, unknown> | undefined)?.url)
      const mine = (f: FeedItem) => f.tool === tool && (f.kind === 'search' ? f.state === 'running' && f.agent === agent : f.pending.includes(agent))
      const byUrl = url ? run.feed.findIndex(f => mine(f) && f.kind === 'source' && normUrl(f.url) === normUrl(url)) : -1
      const i = byUrl >= 0 ? byUrl : run.feed.findIndex(mine)
      if (i < 0) return run
      const feed = run.feed.slice()
      const f = feed[i]
      if (f.kind === 'search') feed[i] = { ...f, state: 'done' }
      else {
        const pending = f.pending.slice()
        pending.splice(pending.indexOf(agent), 1)
        // A failed re-read keeps the first good read.
        const state = pending.length ? 'reading' : failed ? (f.reads > 1 ? 'read' : 'failed') : 'read'
        feed[i] = { ...f, pending, state }
      }
      return { ...run, feed }
    }
  }
  return run
}

function backFrom(run: ResearchRun, name: string): ResearchRun {
  const next = patchLane(run, name, l => ({ ...l, state: 'done' }))
  return next.lanes.some(l => l.name === name && l.research) ? { ...next, leadSince: false } : next
}

export const foldResearch = (events: AgentEvent[], sessionId: string, now: number) => events.reduce((r, e) => reduceResearch(r, e, sessionId, now), emptyRun())

/** Lanes worth showing, in dispatch order. */
export const visibleLanes = (run: ResearchRun) => run.lanes.filter(l => l.research)

/** Seconds since the start; a running run ticks on from its newest event. */
export function elapsedOf(run: ResearchRun, now: number): number {
  if (run.t0 === undefined || run.tLast === undefined) return 0
  const live = run.status === 'running' && run.seenAt !== undefined ? Math.max(0, (now - run.seenAt) / 1000) : 0
  return Math.max(0, run.tLast - run.t0 + live)
}

export function fmtElapsed(sec: number): string {
  const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`
}

const TWO_PART = /^(co|com|org|net|ac|gov|edu)$/
/** Host without www, a short path, and a monogram letter with a hue index (0..5) from the site's name. */
export function siteOf(url: string): { host: string; path: string; letter: string; hue: number } {
  let host = url, path = ''
  try {
    const u = new URL(url)
    host = u.hostname.replace(/^www\./, '')
    path = u.pathname === '/' ? '' : decodeURI(u.pathname).replace(/\/$/, '')
  } catch { /* keep the raw text */ }
  const labels = host.split('.')
  const name = labels.length > 2 && TWO_PART.test(labels[labels.length - 2]) ? labels[labels.length - 3] : labels.length > 1 ? labels[labels.length - 2] : labels[0]
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return { host, path, letter: (name.match(/[a-z0-9]/i)?.[0] ?? '?').toUpperCase(), hue: h % 6 }
}

const URL_RE = /https?:\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"]/g

/** [n] -> URL, from the answer's source list lines. */
export function citations(text: string): Record<number, string> {
  const out: Record<number, string> = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:[-*]\s*)?\[(\d+)\]/)
    const u = m && line.match(URL_RE)?.[0]
    if (m && u) out[Number(m[1])] = u
  }
  return out
}

export function isCited(answer: string | undefined, url: string): boolean {
  if (!answer) return false
  const key = normUrl(url)
  return (answer.match(URL_RE) ?? []).some(u => normUrl(u) === key)
}

export type Block = { type: 'h'; text: string } | { type: 'p'; text: string } | { type: 'li'; text: string; n?: number }
/** A small markdown subset: headings, list items, paragraphs. */
export function answerBlocks(text: string): Block[] {
  const out: Block[] = []
  let para: string[] = []
  const flush = () => { if (para.length) out.push({ type: 'p', text: para.join(' ') }); para = [] }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || /^\|?\s*:?-{3,}/.test(line)) { flush(); continue }
    const h = line.match(/^#{1,6}\s+(.*)$/)
    const ul = line.match(/^[-*•]\s+(.*)$/)
    const ol = line.match(/^(\d+)[.)]\s+(.*)$/)
    if (h) { flush(); out.push({ type: 'h', text: h[1] }) }
    else if (ul) { flush(); out.push({ type: 'li', text: ul[1] }) }
    else if (ol) { flush(); out.push({ type: 'li', text: ol[2], n: Number(ol[1]) }) }
    else para.push(line)
  }
  flush()
  return out
}

export type Inline = { t: 'text' | 'b' | 'code'; s: string } | { t: 'link'; s: string; href: string } | { t: 'cite'; s: string; n: number }
const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\[(\d+)\]|(https?:\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"])/g
export function inline(text: string): Inline[] {
  const out: Inline[] = []
  let at = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > at) out.push({ t: 'text', s: text.slice(at, m.index) })
    if (m[1] !== undefined) out.push({ t: 'b', s: m[1] })
    else if (m[2] !== undefined) out.push({ t: 'code', s: m[2] })
    else if (m[3] !== undefined) out.push({ t: 'link', s: m[3], href: m[4] })
    else if (m[5] !== undefined) out.push({ t: 'cite', s: m[5], n: Number(m[5]) })
    else out.push({ t: 'link', s: m[6].replace(/^https?:\/\/(www\.)?/, ''), href: m[6] })
    at = m.index! + m[0].length
  }
  if (at < text.length) out.push({ t: 'text', s: text.slice(at) })
  return out
}
