// Phone mode: Switchboard rings Kenneth through the phone skill's call.py instead of waiting at the terminal.
import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { withLock } from '../fs-utils'
import { APPROVE_QUESTION } from './approve'
import { doneText, otherText } from './progress'
import type { Ask, AskQuestion, ChatProgress, Choice } from './types'

/** say: a notice with no question (call.py --say). */
export type Call = { key: string; text: string; context?: string; say?: boolean }
export type Placed = { code: number; answer?: string }
type Dial = (c: Call) => Promise<Placed>

const SCRIPT = path.join(os.homedir(), '.claude', 'skills', 'phone', 'call.py')
// call.py waits up to 8 min for the hangup and 1 more for the summary.
const CALL_MS = 10 * 60_000

const dialPy: Dial = c => new Promise(resolve => {
  execFile('python3', [SCRIPT, c.text, c.context ?? '', ...(c.say ? ['--say'] : [])], { timeout: CALL_MS, windowsHide: true }, (err, out) => {
    const code = !err ? 0 : typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1
    resolve({ code, answer: /^ANSWER: (.*)$/m.exec(String(out))?.[1]?.trim() })
  })
})

let dial: Dial = dialPy
/** Tests swap in a fake; nothing here may place a real call under test. */
export const setDial = (d: Dial) => { dial = d }

// ponytail: seen keys live for the window's life, a few bytes per call.
const seen = new Set<string>()
let line: Promise<unknown> = Promise.resolve()
// Tests act as a second window, which starts with nothing rung.
export const forgetRung = () => seen.clear()

/** One call at a time, in order; a key already rung is skipped (undefined). */
export function ring(c: Call): Promise<Placed | undefined> {
  if (seen.has(c.key)) return Promise.resolve(undefined)
  seen.add(c.key)
  const next = line.then(() => dial(c)).catch((): Placed => ({ code: 1 }))
  line = next
  return next
}

// phone-mode (claude-mods) denies every AskUserQuestion but the closing one and has the chat call instead.
const chatCalls = (a: Ask | undefined) => a?.tool === 'AskUserQuestion' && !a.questions?.some(q => q.question.includes(APPROVE_QUESTION))

/** A chat turned done or needs-you (notify.ts dedupes repeats). A hub ask rings on its own through phoneAsk; a chat's own call covers its AskUserQuestion. */
export function phoneChange(p: ChatProgress, title: string): void {
  if (p.state === 'done') void ring({ key: `done\n${p.sessionId}\n${doneText(p)}`, text: `${title} is done. ${doneText(p)}`, say: true })
  else if (p.state === 'needs-you' && p.ask?.via !== 'hub' && !chatCalls(p.ask)) void ring({ key: `need\n${p.sessionId}\n${p.question ?? ''}`, text: `${title} needs you: ${p.question ?? 'it is waiting on you'}`, say: true })
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The option(s) named in the spoken answer; anything else goes back as Other text. */
export function pickOf(q: AskQuestion, answer: string): Choice[number] {
  const hits = q.options.flatMap((o, i) => new RegExp(`(^|\\W)${esc(o)}(\\W|$)`, 'i').test(answer) ? [i] : [])
  if (q.multiSelect && hits.length) return hits
  if (!q.multiSelect && hits.length === 1) return hits[0]
  return { other: otherText(answer) }
}

/** One call per question; undefined when any went unanswered, so the question stays on screen. */
export async function phoneAsk(ask: Ask, title: string): Promise<Choice | undefined> {
  const choice: Choice = []
  for (const q of ask.questions ?? []) {
    const r = await ring({ key: `ask\n${ask.id}\n${q.question}`, text: `${q.question}${q.options.length ? ` Options: ${q.options.join(', ')}.` : ''}`, context: `Asked by the chat ${title}.` })
    if (!r || r.code !== 0 || !r.answer) return undefined
    choice.push(pickOf(q, r.answer))
  }
  return choice.length ? choice : undefined
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

/** First window on the machine to claim key in dir gets true; every window runs the pause, one rings. */
export function claim(dir: string, key: string): boolean {
  const file = path.join(dir, 'phone-claims.json')
  return withLock(`${file}.lock`, () => {
    let keys: string[] = []
    try { keys = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* none yet */ }
    if (!Array.isArray(keys)) keys = []
    if (keys.includes(key)) return false
    try { fs.writeFileSync(file, JSON.stringify([...keys, key].slice(-50))) } catch { /* ring anyway */ }
    return true
  })
}

/** Usage pause started (resumed false) or lifted; dir (the switchboard folder) makes it once per machine. */
export function phonePause(pause: { percent: number; resumeAt?: number; chats: unknown[] }, resumed: boolean, dir?: string): void {
  const at = pause.resumeAt ?? 0
  if (dir && !claim(dir, `${resumed ? 'resume' : 'pause'}\n${at}`)) return
  void ring(resumed
    ? { key: `resume\n${at}`, text: `Usage reset. Switchboard is resuming ${pause.chats.length} paused chats.`, say: true }
    : { key: `pause\n${at}`, text: `Usage is at ${pause.percent} percent. Switchboard paused ${pause.chats.length} chats${pause.resumeAt ? ` until ${clock(pause.resumeAt)}` : ''}.`, say: true })
}
