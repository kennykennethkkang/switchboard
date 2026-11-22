/**
 * Opens the Research panel in its own floating window when a chat starts web research:
 * the deep-research skill, or a researcher subagent's first web search or fetch.
 * A plain researcher lookup in files never opens it.
 */
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
      this.asked.set(id, slash ? slash[1].trim() || prompt : prompt)
      starts = !!slash
    } else if (event === 'PreToolUse') {
      const input = (p.tool_input ?? {}) as Payload
      const skill = p.tool_name === 'Skill' && String(input.skill ?? '').split(':').pop() === 'deep-research'
      if (skill && typeof input.args === 'string' && input.args.trim()) this.asked.set(id, input.args.trim())
      starts = skill || (WEB.has(String(p.tool_name)) && (isResearcher(p.agent_type) || (!p.agent_type && !!this.live.get(id)?.size)))
    }
    if (!starts) return undefined
    const last = this.opened.get(id)
    if (last !== undefined && now - last < REOPEN_MS) return undefined
    this.opened.set(id, now)
    return id
  }

  /** The panel closed: the chat may open it again after REOPEN_MS. Still open: never twice. */
  closed(id: string, now = Date.now()): void { this.opened.set(id, now) }
}

let open: ((sessionId: string) => void) | undefined
const trigger = new ResearchTrigger()
const showing = new Set<string>()

/** extension.ts hands over how to open and wire a research webview. */
export function setResearchOpener(fn: (sessionId: string, question?: string) => Promise<{ onDidDispose(cb: () => void): void }>): void {
  open = id => {
    if (showing.has(id)) return
    showing.add(id)
    const done = () => { showing.delete(id); trigger.closed(id) }
    fn(id, trigger.question(id)).then(v => v.onDidDispose(done), done)
  }
}

/** Every raw hook payload this window owns. */
export function researchHook(p: Payload): void {
  const id = trigger.hook(p)
  if (id && open) open(id)
}
