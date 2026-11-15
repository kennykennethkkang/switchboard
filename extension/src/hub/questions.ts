/**
 * Questions from the switchboard ask tool (extension/ask), waiting on an answer here. The tool also shows them
 * in the terminal; whichever answers first wins and the tool closes the other.
 */
import * as fs from 'fs'
import * as path from 'path'
import { writeJsonAtomic } from '../fs-utils'
import { otherText } from './progress'
import type { Ask, Choice } from './types'

const EXPIRE_MS = 60 * 60 * 1000
// The tool polls every 25 s; a question nobody polled for this long belongs to a chat that is gone.
const POLLED_MS = 2 * 60_000
// seen: last post or poll, memory only.
type Open = { sessionId: string; ask: Ask; at: number; seen: number; choice?: Choice; wake?: (c: Choice | undefined) => void }
const open = new Map<string, Open>()

// Kept on disk so a window reload does not drop the cards; one file per window.
let file: string | undefined
const save = () => {
  if (!file) return
  try { writeJsonAtomic(file, Object.fromEntries([...open].map(([id, q]) => [id, { sessionId: q.sessionId, ask: q.ask, at: q.at, ...(q.choice ? { choice: q.choice } : {}) }]))) } catch { /* best effort */ }
}

/** Loads the questions a reload left in file, then keeps it current. */
export function keepQuestions(f: string, now = Date.now()): void {
  file = f
  try {
    for (const [id, v] of Object.entries(JSON.parse(fs.readFileSync(f, 'utf8')) as Record<string, unknown>)) {
      const q = v as Partial<Open> | null
      if (open.has(id) || typeof q?.sessionId !== 'string' || !q.ask || typeof q.at !== 'number' || now - q.at > EXPIRE_MS) continue
      open.set(id, { sessionId: q.sessionId, ask: q.ask, at: q.at, seen: now, ...(q.choice ? { choice: q.choice } : {}) })
    }
  } catch { /* none yet, or broken */ }
  save()
}

/** A re-post (the tool found the window again after a reload) keeps an answer already given. */
export function openQuestion(id: string, sessionId: string, ask: Ask, now = Date.now()): void {
  for (const [k, q] of open) if (now - q.at > EXPIRE_MS) closeQuestion(k)
  open.set(id, { ...open.get(id), sessionId, ask, at: now, seen: now })
  save()
}

/** Unanswered questions the tool still polls for; any holds off a reload. */
export const openCount = (now = Date.now()) => [...open.values()].filter(q => !q.choice && now - q.seen < POLLED_MS).length

export const questionOf = (id: string) => open.get(id)

/** The answer once given, else empty after ms; undefined when the question is gone. A choice handed over closes it. */
export function waitQuestion(id: string, ms: number): Promise<Choice | undefined> | undefined {
  const q = open.get(id)
  if (!q) return undefined
  q.seen = Date.now()
  if (q.choice) { open.delete(id); save(); return Promise.resolve(q.choice) }
  q.wake?.(undefined)
  return new Promise(resolve => {
    const t = setTimeout(() => { if (q.wake === wake) q.wake = undefined; resolve(undefined) }, ms)
    const wake = (c: Choice | undefined) => {
      clearTimeout(t)
      if (q.wake === wake) q.wake = undefined
      if (c) { open.delete(id); save() }
      resolve(c)
    }
    q.wake = wake
  })
}

export function answerQuestion(id: string, choice: Choice): boolean {
  const q = open.get(id)
  if (!q || q.choice) return false
  q.choice = choice
  save()
  q.wake?.(choice)
  return true
}

/** The chat it was for, when it was still open. */
export function closeQuestion(id: string): string | undefined {
  const q = open.get(id)
  if (open.delete(id)) save()
  q?.wake?.(undefined)
  return q?.sessionId
}

/** Why a choice does not fit the ask's questions; several picks only where multiSelect, Other text instead of a single pick. */
export function choiceProblem(ask: Ask, choice: Choice): string | undefined {
  const qs = ask.questions ?? []
  if (choice.length !== qs.length) return 'answer every question'
  const ok = choice.every((c, n) => {
    const typed = typeof c === 'object' && !Array.isArray(c)
    if (typed && !otherText(String(c.other))) return false
    const picks = typed ? c.picks ?? [] : [c].flat()
    const several = Array.isArray(c) || (typed && picks.length > 0)
    return (!several || qs[n].multiSelect) && (typed || picks.length > 0) && new Set(picks).size === picks.length && picks.every(i => i >= 0 && i < qs[n].options.length)
  })
  return ok ? undefined : 'that is not one of the options'
}

export const askRegistered = (claudeJson: unknown) => !!(claudeJson as { mcpServers?: Record<string, unknown> } | undefined)?.mcpServers?.switchboard

const FILES = ['ask-core.mjs', 'ask-server.mjs', 'chats.mjs']

/** Copies files from one folder to another, skipping any already the same. */
export function copyChanged(from: string, dir: string, files: string[]): void {
  fs.mkdirSync(dir, { recursive: true })
  for (const f of files) {
    const src = fs.readFileSync(path.join(from, f))
    const dest = path.join(dir, f)
    let same = false
    try { same = fs.readFileSync(dest).equals(src) } catch { /* not there yet */ }
    if (!same) fs.writeFileSync(dest, src)
  }
}

/** Copies the bundled ask server to ~/.claude/switchboard/ask when changed; register runs once while ~/.claude.json lacks it. */
export function installAsk(from: string, home: string, register: (server: string) => void): string {
  const dir = path.join(home, '.claude', 'switchboard', 'ask')
  copyChanged(from, dir, FILES)
  const server = path.join(dir, 'ask-server.mjs')
  let json: unknown
  try { json = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')) } catch { /* no file yet */ }
  if (!askRegistered(json)) register(server)
  return server
}
