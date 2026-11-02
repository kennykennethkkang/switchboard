/**
 * The Jarvis box on the Hub: a few keyword rules answer from the hub's own state, an instruction to start work
 * comes back as a proposal for the Confirm tap, and anything else goes to the brain. hub-panel.ts runs hub-jarvis.
 */
import * as path from 'path'
import { askBrain, askContext } from './brain'
import type { HubState, JarvisReply, JarvisStart, Project, Server } from './types'

const LIST_MAX = 8
const MIN = 60_000

const nameOf = (s: HubState, id: string) => s.chats.find(c => c.sessionId === id)?.name ?? s.live.find(l => l.sessionId === id)?.label ?? id.slice(0, 8)
const projectAt = (s: HubState, folder: string) => s.projects.find(p => p.path === folder)?.name ?? path.basename(folder)
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()

function running(s: HubState, now: number): string {
  const working = s.progress.filter(p => p.state === 'working').map(p => nameOf(s, p.sessionId))
  const needs = s.progress.filter(p => p.state === 'needs-you').map(p => nameOf(s, p.sessionId))
  const lines = [working.length ? `Working: ${working.join(', ')}.` : 'No chat is working right now.']
  if (needs.length) lines.push(`Waiting on you: ${needs.join(', ')}.`)
  for (const x of (s.stuck ?? []).slice(0, LIST_MAX)) lines.push(`Stuck: ${x.what} in ${nameOf(s, x.sessionId)} (${Math.round((now - x.since) / MIN)} min)`)
  return lines.join('\n')
}

function todos(s: HubState): string {
  const items = Object.entries(s.todos ?? {}).flatMap(([folder, l]) => l.todo.map(t => `${projectAt(s, folder)}: ${t.text}`))
  if (!items.length) return 'No open to-dos.'
  return [`${items.length} open to-do${items.length === 1 ? '' : 's'}.`, ...items.slice(0, LIST_MAX)].join('\n')
}

function standup(s: HubState, now: number): string {
  const done = s.progress.filter(p => p.state === 'done' && sameDay(p.at, now))
  if (!done.length) return 'No chat has finished today.'
  const lines = done.map(p => `${nameOf(s, p.sessionId)}${p.report?.done.length ? `: ${p.report.done.join('; ')}` : ''}`)
  const left = done.flatMap(p => p.report?.left ?? [])
  if (left.length) lines.push(`Left: ${left.slice(0, LIST_MAX).join('; ')}`)
  const you = done.flatMap(p => p.report?.you ?? [])
  if (you.length) lines.push(`For you: ${you.slice(0, LIST_MAX).join('; ')}`)
  return lines.join('\n')
}

// Whole-question phrasings only, first match wins; anything else costs one Haiku call.
const RULES: [RegExp, (s: HubState, now: number) => string][] = [
  [/^(?:(?:what(?:'s| is| are)(?: on)?|show(?: me)?|list)\s+)?(?:my\s+|the\s+)?(?:open\s+)?to-?dos?(?:\s+list)?\s*\??$/i, todos],
  [/^(?:what(?:'s| is) (?:running|going on|stuck)|(?:is )?anything (?:running|stuck)|(?:which|what|any|are any) chats? (?:are |is )?(?:running|working|stuck|busy)|who needs me)\s*\??$/i, running],
  [/^(?:(?:give me |show(?: me)? )?(?:today'?s |the |my )?standup|what(?:'s| is| got| was)? (?:done|finished|shipped)(?: today)?)\s*\??$/i, standup],
]

/** An answer from the hub's state alone, or undefined for the brain. */
export function jarvisLocal(s: HubState, q: string, now = Date.now()): string | undefined {
  // iPhone keyboards type a curly apostrophe
  const t = q.trim().replace(/[\u2018\u2019]/g, "'")
  return RULES.find(([re]) => re.test(t))?.[1](s, now)
}

const START = /^(?:please\s+)?(?:start|open|spin up|kick off|launch)\s+(?:a\s+)?(?:new\s+)?chat\b\s*(.*)$/i
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// whisper drops spaces and hyphens: "agent-flow" comes back as "AgentFlow"
const loose = (name: string) => name.split(/[\s_-]+/).map(esc).join('[\\s_-]*')
// "in/for/on X" leading the text, or a closing "in X"; a project word inside the goal ("work on a bug") is goal.
const lead = (p: Project) => new RegExp(`^(?:in|for|on)\\s+${loose(p.name)}(?=\\s|$|[.,:!?])`, 'i')
const tail = (p: Project) => new RegExp(`\\sin\\s+${loose(p.name)}[.!?]*$`, 'i')

/** The listed project the pattern finds, longest name first so "My App" beats "My". */
function named(s: HubState, text: string, at: (p: Project) => RegExp): { p: Project; m: RegExpExecArray } | undefined {
  for (const p of [...s.projects].sort((a, b) => b.name.length - a.name.length)) {
    const m = at(p).exec(text)
    if (m) return { p, m }
  }
  return undefined
}

/** Skills a chat can run: user skills, and plugin skills bare or as plugin:skill. */
function skillNames(s: HubState): Set<string> {
  const out = new Set<string>()
  for (const i of s.installed) {
    if (i.kind === 'skill') out.add(i.name.toLowerCase())
    if (i.kind === 'plugin') for (const k of i.skills ?? []) { out.add(k.toLowerCase()); out.add(`${i.name.split('@')[0]}:${k}`.toLowerCase()) }
  }
  return out
}

type Parsed = { start: JarvisStart } | { ask: string }

/** An instruction to start work, as a proposal or the question it needs answered; undefined when q is no such instruction. */
function startOf(s: HubState, q: string): Parsed | undefined {
  const t = q.trim()
  const m = START.exec(t)
  const run = /^(?:please\s+)?run\s+(\S+)/i.exec(t)
  if (!m && !(run && skillNames(s).has(run[1].toLowerCase()))) return undefined
  let hit: ReturnType<typeof named>
  let goal = t
  if (m) {
    let rest = m[1]
    hit = named(s, rest, lead)
    if (hit) rest = rest.slice(hit.m[0].length)
    // "in Nowhere to ...": a project was named but none is listed by that name. An unknown "for/on X" is just goal.
    else if (/^in\s+\S/i.test(rest)) return { ask: 'Which project? None is listed by that name.' }
    else if ((hit = named(s, rest, tail))) rest = rest.slice(0, hit.m.index)
    goal = rest.replace(/^[\s,]*(?:(?:to|that|and)\b|:)?\s*/i, '').trim()
  } else {
    const after = t.slice(run![0].length)
    hit = named(s, after.trimStart(), lead) ?? named(s, after, tail)
  }
  if (!/\w/.test(goal)) return { ask: 'What should the chat do? Say "start a chat to ...".' }
  const p = hit?.p ?? s.projects.find(x => x.isOpen)
  if (!p) return { ask: `Which project? Say "start a chat in <project> to ${goal}".` }
  return { start: { folder: p.path, project: p.name, goal } }
}

/** A start proposal for the Confirm tap; never starts anything itself. */
export function jarvisStart(s: HubState, q: string): JarvisStart | undefined {
  const r = startOf(s, q)
  return r && 'start' in r ? r.start : undefined
}

/** One box question: local, then a start proposal, then the brain on the open project's board. */
export async function jarvis(s: HubState, q: string, gone: Server[], ask = askBrain, now = Date.now()): Promise<JarvisReply> {
  const st = startOf(s, q)
  if (st) return 'start' in st ? { q, at: now, start: st.start } : { q, at: now, answer: st.ask }
  const local = jarvisLocal(s, q, now)
  if (local !== undefined) return { q, at: now, answer: local }
  if (!s.controls.switchboard.askBrain) return { q, at: now, answer: 'Ask the brain is off in Switchboard, Controls.' }
  const cwd = s.projects.find(p => p.isOpen)?.path ?? s.thisWindow ?? s.projects[0]?.path ?? ''
  return { q, at: now, answer: await ask(q, askContext(s, cwd, gone, now)) }
}
