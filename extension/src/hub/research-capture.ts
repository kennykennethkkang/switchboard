/**
 * Finished research read from hook payloads, so a run is kept whichever window or view is open.
 * A run is real when its turn runs the deep-research skill or a researcher subagent. Its report is the
 * lead's reply at Stop (last_assistant_message, else the transcript's last assistant text).
 */
import * as fs from 'fs'
import * as path from 'path'
import { isResearch, researchProject, RESEARCH_ROOT } from './research'
import { saveResearch, type ResearchItem } from './research-library'

type Payload = Record<string, unknown>
export type Captured = { sessionId: string; question: string; answer: string; cwd?: string }
// The turn's state: real once its own research starts, titled by its own prompt.
type Run = { real: boolean; prompt?: string; args?: string }

// Same rule as web/lib/research.ts (ANSWER_DONE and looksLikeAnswer): keep them in step.
const ANSWER_DONE = /\*\*Answer:?\*\*|^#+\s*Sources\b/im
export const looksLikeAnswer = (text: string) => ANSWER_DONE.test(text) || /^#+\s*(Findings|Answer)\b/im.test(text)

const TAIL = 1 << 20
const WEB = new Set(['WebSearch', 'WebFetch'])
const RESEARCHER = (t: unknown) => typeof t === 'string' && t.split(':').pop() === 'researcher'

/** The last assistant text in a transcript (JSONL), read from its tail. Empty when none or not a regular file. */
export function transcriptReply(file: unknown): string {
  if (typeof file !== 'string' || !file) return ''
  let text = ''
  try {
    if (!fs.lstatSync(file).isFile()) return ''
    const fd = fs.openSync(file, 'r')
    try {
      if (!fs.fstatSync(fd).isFile()) return ''
      const size = fs.fstatSync(fd).size, n = Math.min(size, TAIL), buf = Buffer.alloc(n)
      fs.readSync(fd, buf, 0, n, size - n)
      for (const line of buf.toString('utf8').split('\n').reverse()) {
        let e: { type?: string; message?: { content?: unknown } }
        try { e = JSON.parse(line) } catch { continue }
        if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue
        text = (e.message.content as Array<{ type?: string; text?: unknown }>).filter(p => p.type === 'text' && typeof p.text === 'string').map(p => p.text as string).join('\n').trim()
        if (text) break
      }
    } finally { fs.closeSync(fd) }
  } catch { return '' }
  return text
}

/** Per-session research state, folded from every hook payload Switchboard sees. */
export class ResearchCapture {
  private runs = new Map<string, Run>()

  /** The finished report this payload ends, or undefined. */
  hook(p: Payload, reply: (file: unknown) => string = transcriptReply): Captured | undefined {
    const id = typeof p.session_id === 'string' ? p.session_id : undefined
    if (!id) return undefined
    const event = p.hook_event_name
    if (event === 'SessionEnd') { this.runs.delete(id); return undefined }
    if (event === 'UserPromptSubmit') {
      // A new turn starts clean: only its own research makes it real.
      const turn: Run = { real: false }
      const prompt = String(p.prompt ?? '').trim()
      if (prompt) {
        turn.prompt = prompt
        const slash = prompt.match(/^\/(?:[\w-]+:)?deep-research\b\s*([\s\S]*)$/)
        if (slash) { turn.real = true; turn.args = slash[1].trim() || undefined }
      }
      this.runs.set(id, turn)
      return undefined
    }
    const run = this.runs.get(id) ?? { real: false }
    if (event === 'PreToolUse') {
      const input = (p.tool_input ?? {}) as Record<string, unknown>
      if (p.tool_name === 'Skill' && String(input.skill ?? '').split(':').pop() === 'deep-research') {
        run.real = true
        if (typeof input.args === 'string' && input.args.trim()) run.args = input.args.trim()
      }
      // A web call in a Research-space chat is research too (same rule as ResearchTrigger in research-window.ts).
      if (WEB.has(String(p.tool_name)) && isResearch(p.cwd)) run.real = true
    } else if (event === 'SubagentStart' && RESEARCHER(p.agent_type)) {
      run.real = true
    } else if (event === 'Stop') {
      if (!run.real) return undefined
      const last = typeof p.last_assistant_message === 'string' ? p.last_assistant_message : reply(p.transcript_path)
      if (!looksLikeAnswer(last)) { this.runs.set(id, run); return undefined }
      this.runs.delete(id)
      return { sessionId: id, question: run.args ?? run.prompt ?? 'Research run', answer: last, cwd: typeof p.cwd === 'string' ? p.cwd : undefined }
    }
    this.runs.set(id, run)
    return undefined
  }
}

export type CaptureDeps = { root: string; projects: string[]; chat: string; now?: number; scrub?: (s: string) => string }

/** Saves a captured run to the library file (once per session and question, see saveResearch). Project memory is the event fold's job. */
export function captureSaved(c: Captured, d: CaptureDeps): { item?: ResearchItem; created: boolean } {
  const scrub = d.scrub ?? (s => s)
  // en-CA prints the local day as YYYY-MM-DD
  const date = new Date(d.now ?? Date.now()).toLocaleDateString('en-CA')
  const project = c.cwd ? researchProject(c.cwd, d.projects, RESEARCH_ROOT) : undefined
  return saveResearch(d.root, { question: c.question, answer: c.answer, chat: d.chat, sessionId: c.sessionId, project, date, at: d.now ?? Date.now() }, scrub)
}
