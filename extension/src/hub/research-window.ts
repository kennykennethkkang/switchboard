/**
 * Opens the Research panel as an editor tab beside the chat when a Research-space chat starts web research:
 * the deep-research skill, a researcher subagent's first web search or fetch, or any web call from a chat in the research folder.
 * A plain researcher lookup in files never opens it. A project chat's research shows on its Chats page instead.
 */
import { isResearch } from './research'
import { stripResearchInstructions } from './research-question'

type Payload = Record<string, unknown>

const WEB = new Set(['WebSearch', 'WebFetch'])
// Closed by hand: the same chat opens it again only after this long.
export const REOPEN_MS = 30 * 60_000

const isResearcher = (t: unknown) => typeof t === 'string' && t.split(':').pop() === 'researcher'

/** Which hook payloads start research, per session. Pure, so the rules are testable without VS Code. */
export class ResearchTrigger {
  // Live researcher subagents per session, for PreToolUse payloads that carry no agent_type.
  private live = new Map<string, Set<string>>()
  private opened = new Map<string, number>()
  private asked = new Map<string, string>()

  /** inScope: which payloads may open a tab, by cwd. */
  constructor(private inScope: (cwd: unknown) => boolean = () => true) {}

  /** The question for the panel's header: the skill's args, else the chat's last prompt. */
  question(id: string): string | undefined { return this.asked.get(id) }

  /** The session to open the panel for, or undefined. */
  hook(p: Payload, now = Date.now()): string | undefined {
    const id = typeof p.session_id === 'string' ? p.session_id : undefined
    if (!id) return undefined
    const event = p.hook_event_name
    const agent = typeof p.agent_id === 'string' ? p.agent_id : ''
    if (event === 'SubagentStart' && isResearcher(p.agent_type)) {
      this.live.set(id, (this.live.get(id) ?? new Set()).add(agent))
      return undefined
    }
    if (event === 'SubagentStop') { this.live.get(id)?.delete(agent); return undefined }
    if (event === 'SessionEnd') { this.live.delete(id); this.opened.delete(id); this.asked.delete(id); return undefined }
    let starts = false
    if (event === 'UserPromptSubmit') {
      const prompt = String(p.prompt ?? '').trim()
      if (!prompt) return undefined
      const slash = prompt.match(/^\/(?:[\w-]+:)?deep-research\b\s*([\s\S]*)$/)
      this.asked.set(id, slash ? stripResearchInstructions(slash[1]) || stripResearchInstructions(prompt) : stripResearchInstructions(prompt))
      starts = !!slash
    } else if (event === 'PreToolUse') {
      const input = (p.tool_input ?? {}) as Payload
      const skill = p.tool_name === 'Skill' && String(input.skill ?? '').split(':').pop() === 'deep-research'
      if (skill && typeof input.args === 'string' && input.args.trim()) this.asked.set(id, stripResearchInstructions(input.args))
      starts = skill || (WEB.has(String(p.tool_name)) && (isResearch(p.cwd) || isResearcher(p.agent_type) || (!p.agent_type && !!this.live.get(id)?.size)))
    }
    if (!starts || !this.inScope(p.cwd)) return undefined
    const last = this.opened.get(id)
    if (last !== undefined && now - last < REOPEN_MS) return undefined
    this.opened.set(id, now)
    return id
  }

  /** The panel closed: the chat may open it again after REOPEN_MS. Still open: never twice. */
  closed(id: string, now = Date.now()): void { this.opened.set(id, now) }
}

type Tab = { onDidDispose(cb: () => void): void; dispose(): void }

let open: ((sessionId: string) => void) | undefined
const trigger = new ResearchTrigger(isResearch)
// at: when the tab opened or its chat was last seen live.
const showing = new Map<string, { at: number; tab?: Tab }>()

/** extension.ts hands over how to open and wire a research webview. */
export function setResearchOpener(fn: (sessionId: string, question?: string) => Promise<Tab>): void {
  open = id => {
    if (showing.has(id)) return
    const entry: { at: number; tab?: Tab } = { at: Date.now() }
    showing.set(id, entry)
    const done = () => { showing.delete(id); trigger.closed(id) }
    fn(id, trigger.question(id)).then(v => { entry.tab = v; v.onDidDispose(done) }, done)
  }
}

/** Closes a chat's research tab: its chat ended. */
export function closeResearch(sessionId: string): void { showing.get(sessionId)?.tab?.dispose() }

// A tab this young may belong to a chat the hub has not listed yet.
export const SWEEP_GRACE_MS = 2 * 60_000

/** Research tabs whose chat is gone, given when each was last seen live. Pure, for the periodic sweep. */
export function staleResearch(open: Iterable<[string, number]>, live: Set<string>, now = Date.now()): string[] {
  return [...open].filter(([id, at]) => !live.has(id) && now - at >= SWEEP_GRACE_MS).map(([id]) => id)
}

/** Closes every research tab whose chat has not been live for SWEEP_GRACE_MS. at: when the chat was last seen live. */
export function sweepResearch(live: Set<string>, now = Date.now()): void {
  for (const [id, e] of showing) if (live.has(id)) e.at = now
  for (const id of staleResearch([...showing].map(([id, e]) => [id, e.at] as [string, number]), live, now)) closeResearch(id)
}

/** Every raw hook payload this window owns. */
export function researchHook(p: Payload): void {
  if (p.hook_event_name === 'SessionEnd' && typeof p.session_id === 'string') closeResearch(p.session_id)
  const id = trigger.hook(p)
  if (id && open) open(id)
}

/** hub-research-open: the tracker's Open button, for a chat already doing research. */
export function openResearch(sessionId: string): void { open?.(sessionId) }
