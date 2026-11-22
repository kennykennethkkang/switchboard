/** The drawer's plain-language story for one role: a headline sentence and a few short facts. Local only, no model call. */
import { clockDur, statusTone, type RunDetail } from './runs'

export type Story = { headline: string; facts: string[] }
type Opts = { active: boolean; left?: string }

const name = (r: string) => (r === 'qa' ? 'QA' : r === 'lead' ? 'The lead' : r[0].toUpperCase() + r.slice(1))
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
// First sentence of a note, short enough for a headline.
const gist = (t: string) => {
  const s = t.trim().split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, '')
  return s.length > 80 ? `${s.slice(0, 77).trimEnd()}...` : s
}

export function storyOf(role: string, runs: RunDetail[], { active, left }: Opts): Story {
  const N = name(role)
  const ordered = [...runs].sort((a, b) => a.startedAt - b.startedAt)
  if (!ordered.length) return { headline: active ? `${N} is queued and has not started yet.` : `${N} has not run in this chat.`, facts: [] }

  const now = Date.now()
  const total = ordered.reduce((s, r) => s + ((active && r === ordered[ordered.length - 1] && !r.finished ? now : r.endedAt) - r.startedAt), 0)
  const calls = ordered.reduce((s, r) => s + r.callCount, 0)
  const files = new Set(ordered.flatMap(r => r.files.map(f => f.path))).size
  const facts = [total >= 1000 && `${clockDur(total)} total`, files > 0 && plural(files, 'file') + ' changed', calls > 0 && plural(calls, 'tool call')].filter(Boolean) as string[]

  if (role === 'lead') {
    const ds = ordered[0].dispatches ?? [], roles = new Set(ds.map(d => d.role)).size
    // A role can get several briefs; then name both counts.
    const to = ds.length === roles ? `handed work to ${plural(roles, 'role')}` : `sent ${plural(ds.length, 'brief')} to ${plural(roles, 'role')}`
    if (!ds.length) return { headline: active ? 'The lead is working and has not handed out any work yet.' : `The lead worked alone in ${plural(calls, 'tool call')}.`, facts }
    return { headline: active ? `The lead is working and has ${to} so far.` : `The lead ${to} in ${plural(calls, 'tool call')}.`, facts }
  }

  const last = ordered[ordered.length - 1]
  if (active) {
    const back = ordered.slice(0, -1).flatMap(r => r.loops)[0]
    const eta = !left || left === 'estimating' ? '' : left === 'longer than usual' ? ', taking longer than usual' : /^(about|at least)/.test(left) ? `, ${left} left` : `, about ${left} left`
    return { headline: `Still on run ${ordered.length}${back ? ` after ${back.by === 'qa' ? 'QA' : 'the lead'} sent the last one back` : ''}${eta}.`, facts }
  }

  const loops = ordered.flatMap(r => r.loops)
  const tone = statusTone(last.report?.status)
  const tail = tone === 'blocked' ? 'is blocked' : tone === 'concerns' ? 'finished with concerns' : 'finished'
  const most = (re: RegExp) => Math.max(0, ...(last.report?.checked ?? []).map(c => Number(re.exec(c)?.[1] ?? 0)))
  const failed = most(/(\d+)\s+fail/i), passed = most(/(\d+)\s+pass/i)
  const open = last.report?.open.length ?? 0
  const bits: string[] = []
  // Blocked beats failures, failures beat passes, and a 0 count says nothing.
  const many = loops.length > 0 || ordered.length > 1
  const tests = tone === 'blocked' ? undefined
    : failed ? `${many ? 'In the last run ' : ''}${plural(failed, 'test')} failed.`
    : passed ? `${many ? 'The last run' : 'It'} passed ${passed} tests.` : undefined
  if (loops.length) {
    const by = loops[0].by === 'qa' ? 'QA' : 'The lead'
    bits.push(`${N} ran ${times(ordered.length)}.`, `${by} sent it back ${times(loops.length)}: ${gist(loops[0].text)}.`)
    if (tone === 'blocked' || (!tests && tone && tone !== 'done')) bits.push(`The last run ${tail}.`)
  } else bits.push(`${N} ran ${times(ordered.length)} and ${tail}.`)
  if (tests) bits.push(tests)
  if (tone === 'concerns' && open) bits.push(`${open === 1 ? '1 thing is' : `${open} things are`} still open.`)
  return { headline: bits.join(' '), facts }
}
