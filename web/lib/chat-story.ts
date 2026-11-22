// A plain-language read of a chat's outputs, worked out locally: no model call.
import type { ChatMessage, ChatOutputs } from './chat-view'

export type Tone = 'ok' | 'warn' | 'bad' | 'none'
export type ReportSection = { label: string; items: string[] }
export type ParsedReport = { status?: string; tone: Tone; sections: ReportSection[] }

const KEYS = ['changed', 'checked', 'found', 'open', 'status', 'risks', 'skipped']
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

// By the leading word only: "done, no failures" is still done.
const tone = (s?: string): Tone => {
  const t = (s ?? '').trim().toLowerCase()
  if (/^(block|fail|error)/.test(t)) return 'bad'
  if (/^(done,? with concerns|concern|partial|warn)/.test(t)) return 'warn'
  return /^(done|pass|ok|complete|finished)/.test(t) ? 'ok' : 'none'
}
/** A final message that only says it is still going, not worth showing. */
export const trivial = (s?: string) => !s || /^still (working|on)/i.test(s.trim())

/** "Status: done" plus "Changed:" style headings with "- " items; anything else lands in Notes. */
export function parseReport(text: string): ParsedReport {
  let status: string | undefined
  const sections: ReportSection[] = []
  let cur: ReportSection | undefined
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const m = /^([A-Za-z]+):\s*(.*)$/.exec(line)
    if (m && KEYS.includes(m[1].toLowerCase())) {
      const key = m[1].toLowerCase()
      if (key === 'status') { status = m[2]; cur = undefined; continue }
      cur = { label: cap(key), items: m[2] ? [m[2]] : [] }
      sections.push(cur)
      continue
    }
    if (!cur) { cur = { label: 'Notes', items: [] }; sections.push(cur) }
    cur.items.push(line.replace(/^[-*]\s+/, ''))
  }
  return { status, tone: tone(status), sections }
}

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`

export type Story = {
  headline: string
  needs: string[]
  tests: { runs: number; failing: number; tone: Tone; first?: string }
  errors: number
  files: number
  questions: { total: number; open: number }
  agents: number
}

export function chatStory(o: ChatOutputs): Story {
  const runs = o.tests.length, failing = o.tests.filter(t => !t.ok)
  const lastBad = runs > 0 && !o.tests[runs - 1].ok
  const first = [...failing].reverse().find(t => t.first)?.first
  const asked = o.questions.length, open = o.questions.filter(q => !q.answer).length
  const parts: string[] = []
  if (o.reports.length) parts.push(`${n(o.reports.length, 'agent')} reported.`)
  if (runs) parts.push(failing.length ? `Tests: ${failing.length} of ${n(runs, 'run')} failing${first ? ` (${first})` : ''}.` : `Tests: all ${n(runs, 'run')} passing.`)
  if (o.files.length) parts.push(`${n(o.files.length, 'file')} changed.`)
  if (asked) parts.push(!open ? `${n(asked, 'question')} answered.` : open === asked ? `${n(open, 'question')} still open.` : `${n(asked, 'question')}, ${open} still open.`)
  const needs: string[] = []
  if (lastBad) needs.push(`Tests are failing${first ? `: ${first}` : ''}`)
  if (o.errors.length) needs.push(`${n(o.errors.length, 'error')} recorded`)
  if (open) needs.push(`${n(open, 'question')} still open`)
  return {
    headline: parts.join(' ') || (trivial(o.final) ? 'Nothing recorded yet.' : 'Final message below.'),
    needs,
    tests: { runs, failing: failing.length, tone: !runs ? 'none' : lastBad ? 'bad' : failing.length ? 'warn' : 'ok', first },
    errors: o.errors.length, files: o.files.length, questions: { total: o.questions.length, open }, agents: o.reports.length,
  }
}

export type MsgGroup = ChatMessage | { tools: ChatMessage[] }

/** Runs of tool lines become one entry so the transcript reads as messages. */
export function groupMessages(ms: ChatMessage[]): MsgGroup[] {
  const out: MsgGroup[] = []
  for (const m of ms) {
    const last = out[out.length - 1]
    if (m.role !== 'tool') out.push(m)
    else if (last && 'tools' in last) last.tools.push(m)
    else out.push({ tools: [m] })
  }
  return out
}
