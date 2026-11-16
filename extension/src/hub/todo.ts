/**
 * Per-project to-do list of future work: Kenneth's items and what chats add with todo_add. What finished chats left waits in suggested for Accept or Dismiss. Hand steps (why 'you') never stay: the chat opens the page for them, and prune drops any an older device wrote. A repo keeps it as todo.json in a commit on refs/switchboard/todo,
 * synced through origin by fetch, merge and a plain push; branches, the index, the working tree and HEAD
 * are never touched. A folder with no git keeps them in ~/.claude/switchboard/todo/<sha>.json, unsynced.
 */
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { ghPath, git, repoRoot } from './git'
import { cloneTarget, repoTop } from './projects'
import { MISSED, missed, plainText, workText } from './progress'
import { writeJsonAtomic } from '../hook-entries'
import { foldPathCase } from '../fs-utils'
import { createLogger } from '../logger'
import { hub } from './hub-service'
import { quickAsk } from './brain'
import type { ChatProgress, TickedItem, TodoDoc, TodoItem, TodoPilot, TodoSync, TodoWhy } from './types'

export const TODO_REF = 'refs/switchboard/todo'
const REMOTE_REF = 'refs/switchboard/todo-remote'
const FILE = 'todo.json'
const log = createLogger('Todo')
const NO_REF = '0'.repeat(40)
const UNREADABLE = 'remote list unreadable'
// Matches the route's raw cap; the panel says so under its input.
const TEXT_MAX = 2000
const ID = () => crypto.randomBytes(4).toString('hex')
const ID_OK = /^[A-Za-z0-9_-]{1,64}$/
const okId = (id: unknown): id is string => typeof id === 'string' && ID_OK.test(id) && id !== '__proto__'
// A ticked item put back: its own tombstone, so a merge never shows it as ticked again.
const BACK = (id: string) => `${id}.back`
const okKey = (k: string) => okId(k.endsWith('.back') ? k.slice(0, -5) : k)
const TICKED_MAX = 10
// Past these a change that grows the list is refused; git's output buffer is 8 MB.
const MAX_ITEMS = 500, MAX_BYTES = 1 << 20
let host: string | undefined
/**
 * This machine, on the items it starts, so another device's chats are never judged gone here. A random id
 * made once in ~/.claude/switchboard/host-id: the hostname changes between networks on macOS.
 */
export function hostId(): string {
  if (host) return host
  const file = path.join(os.homedir(), '.claude', 'switchboard', 'host-id')
  const read = () => { try { const t = fs.readFileSync(file, 'utf8').trim(); return /^[0-9a-f]{16}$/.test(t) ? t : undefined } catch { return undefined } }
  host = read()
  if (!host) {
    const made = crypto.randomBytes(8).toString('hex')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // wx: another window that wrote first wins, and both use its id.
    try { fs.writeFileSync(file, `${made}\n`, { flag: 'wx', mode: 0o600 }); host = made } catch { host = read() ?? made }
  }
  return host
}
// Commits on the ref are Switchboard's, never signed (no 1Password prompt on a list change).
const AS = ['-c', 'user.name=Switchboard', '-c', 'user.email=switchboard@localhost']

export const emptyDoc = (): TodoDoc => ({ version: 1, todo: [], removed: {} })
const clean = (text: string) => plainText(text).replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX)

/** Only well formed rows with plain ids survive; the remote's copy is anyone's. Bad JSON throws, so nothing writes over it. */
export function parseDoc(raw: string): TodoDoc {
  const j = JSON.parse(raw) as Record<string, unknown>
  const rows = <T>(v: unknown, extras: string[]) => (Array.isArray(v) ? v : []).flatMap(x => {
    const o = (x ?? {}) as Record<string, unknown>
    if (!okId(o.id) || typeof o.text !== 'string' || typeof o.at !== 'number') return []
    const more = Object.fromEntries(extras.flatMap(k => (typeof o[k] === 'string' ? [[k, (o[k] as string).slice(0, 64)]] : [])))
    if (more.why && !WHYS.has(more.why)) delete more.why
    return [{ id: o.id, text: clean(o.text), at: o.at, ...more, ...(count(o.run) ? { run: o.run } : {}), ...(o.auto === true ? { auto: true } : {}), ...(o.stopped === true ? { stopped: true } : {}) } as T]
  })
  const removed = Object.fromEntries(Object.entries((j?.removed ?? {}) as object).filter(([id, at]) => okKey(id) && typeof at === 'number'))
  // Older docs keep finished chats' items in left; they are to-do items now, and an older device may still write them.
  const todo = rows<TodoItem>(j?.todo, ['chat', 'host', 'from', 'before', 'name', 'why'])
  const ids = new Set(todo.map(t => t.id))
  const left = rows<TodoItem>(j?.left, ['from']).filter(l => !ids.has(l.id) && !Object.hasOwn(removed, l.id))
  const o = (j?.order ?? {}) as { ids?: unknown; at?: unknown }
  const order = Array.isArray(o.ids) && typeof o.at === 'number' ? { ids: o.ids.filter(okId).slice(0, 500) as string[], at: o.at } : undefined
  const p = (j?.pilot ?? {}) as Record<string, unknown>
  const pilot = typeof p.at === 'number' ? { ...(typeof p.on === 'boolean' ? { on: p.on } : {}), ...(p.paused === true ? { paused: true } : {}), at: p.at } : undefined
  const runs = { ...(pilot ? { pilot } : {}), ...(count(j?.seq) ? { seq: j.seq } : {}), ...(count(j?.streak) ? { streak: j.streak } : {}) }
  const out = withTicked({ version: 1, todo: [...todo, ...left], removed, ...(order ? { order } : {}), ...runs }, rows<TickedItem>(j?.ticked, ['by', 'from', 'before', 'name', 'why']))
  return withSuggested(out, rows<TodoItem>(j?.suggested, ['from', 'name', 'why']))
}

const count = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0

/** d with ticked set to xs, newest first and capped; no field when empty. */
function withTicked(d: TodoDoc, xs: TickedItem[]): TodoDoc {
  const { ticked: _t, ...rest } = d
  const keep = [...xs].sort((a, b) => b.at - a.at).slice(0, TICKED_MAX)
  return keep.length ? { ...rest, ticked: keep } : rest
}

/** d with suggested set to xs; no field when empty, so an older doc reads the same. */
function withSuggested(d: TodoDoc, xs: TodoItem[]): TodoDoc {
  const { suggested: _s, ...rest } = d
  return xs.length ? { ...rest, suggested: xs } : rest
}

// Both devices have synced long before a tombstone is this old.
const TOMBSTONE_MS = 90 * 24 * 60 * 60 * 1000

/** Union by id; an id removed on either side is gone; the same id on both sides keeps the newer at. */
export function mergeDocs(a: TodoDoc, b: TodoDoc, now = Date.now()): TodoDoc {
  const removed = new Map<string, number>()
  for (const [id, at] of [...Object.entries(a.removed), ...Object.entries(b.removed)]) if (now - at < TOMBSTONE_MS) removed.set(id, Math.max(at, removed.get(id) ?? 0))
  const pick = <T extends { id: string; at: number }>(xs: T[], ys: T[]) => {
    const m = new Map<string, T>()
    // An older device's newer copy has no name, why or run; keep the ones this side knows.
    for (const x of [...xs, ...ys]) { const o = m.get(x.id) as TodoItem | undefined; if (!o || x.at > o.at) m.set(x.id, o ? { ...(o.name ? { name: o.name } : {}), ...(o.why ? { why: o.why } : {}), ...(o.run ? { run: o.run } : {}), ...(o.auto ? { auto: o.auto } : {}), ...(o.stopped && !(x as { chat?: string }).chat ? { stopped: o.stopped } : {}), ...x } : x) }
    return [...m.values()].filter(x => !removed.has(x.id))
  }
  // Ticked ids are tombstoned as items, so only the put-back tombstone drops one.
  const ticked = new Map<string, TickedItem>()
  for (const x of [...a.ticked ?? [], ...b.ticked ?? []]) {
    const o = ticked.get(x.id)
    if (!removed.has(BACK(x.id)) && now - x.at < TOMBSTONE_MS && (!o || x.at > o.at)) ticked.set(x.id, x)
  }
  const order = [a.order, b.order].reduce<TodoDoc['order']>((m, o) => (o && (!m || o.at > m.at) ? o : m), undefined)
  const todo = order ? byOrder(pick(a.todo, b.todo), order.ids) : pick(a.todo, b.todo)
  const pilot = [a.pilot, b.pilot].reduce<TodoDoc['pilot']>((m, p) => (p && (!m || p.at > m.at) ? p : m), undefined)
  // The higher seq knows the latest claim; on a tie an ended chain (no streak) wins.
  const [hi, lo] = (a.seq ?? 0) >= (b.seq ?? 0) ? [a, b] : [b, a]
  const streak = hi.seq === lo.seq && lo.streak === undefined ? undefined : hi.streak
  const runs = { ...(pilot ? { pilot } : {}), ...(hi.seq ? { seq: hi.seq } : {}), ...(streak ? { streak } : {}) }
  const out = withTicked({ version: 1, todo, removed: Object.fromEntries(removed), ...(order ? { order } : {}), ...runs }, [...ticked.values()])
  return withSuggested(out, pick(a.suggested ?? [], b.suggested ?? []))
}

// Listed ids first in that order; the rest keep their place after them.
const byOrder = (todo: TodoItem[], ids: string[]) => {
  const at = new Map(ids.map((id, i) => [id, i]))
  return todo.map((t, i) => ({ t, k: at.get(t.id) ?? ids.length + i })).sort((x, y) => x.k - y.k).map(x => x.t)
}
/** hub-todo-move: the panel's new order for the items it shows. */
export function moveTodo(d: TodoDoc, ids: string[], now = Date.now()): TodoDoc {
  return { ...d, todo: byOrder(d.todo, ids), order: { ids: ids.slice(0, 500), at: now } }
}

/** The Put back link: the item is open again under a new id (its old one stays tombstoned on every device). */
export function restoreTicked(d: TodoDoc, id: string, now = Date.now(), newId = ID()): TodoDoc {
  const t = d.ticked?.find(x => x.id === id)
  if (!t) return d
  const { id: _i, at: _a, by: _b, shipped: _s, text, ...more } = t
  const out = withTicked({ ...d, removed: { ...d.removed, [BACK(id)]: now } }, d.ticked!.filter(x => x !== t))
  return addTodo(out, text, now, newId, { ...more, ...(_s ? { kept: true as const } : {}) })
}

/** Same text as an open item, ignoring case and spacing. */
export const sameText = (a: string, b: string) => clean(a).toLowerCase() === clean(b).toLowerCase()
/** Every add path (panel, accept, put back, todo_add) comes here, so an open item is never on the list twice. */
export function addTodo(d: TodoDoc, text: string, now = Date.now(), id = ID(), more: Partial<TodoItem> = {}): TodoDoc {
  const t = clean(text)
  return t && !d.todo.some(x => sameText(x.text, t)) ? { ...d, todo: [...d.todo, { id, text: t, at: now, ...more }] } : d
}
export function editTodo(d: TodoDoc, id: string, text: string, now = Date.now()): TodoDoc {
  const t = clean(text)
  return t ? { ...d, todo: d.todo.map(x => x.id === id ? { ...x, text: t, at: now } : x) } : d
}
export function removeItem(d: TodoDoc, id: string, now = Date.now()): TodoDoc {
  if (!okId(id)) return d
  const out = { ...d, todo: d.todo.filter(x => x.id !== id), removed: { ...d.removed, [id]: now } }
  // The queue went empty: the next claim starts a new chain.
  if (!out.todo.some(x => x.why !== 'you')) delete out.streak
  return out
}

/** hub-todo-pilot: the fields given change, the rest stay; at stamps it for the merge. */
export function setPilot(d: TodoDoc, set: { on?: boolean; paused?: boolean }, now = Date.now()): TodoDoc {
  const { at: _a, ...was } = d.pilot ?? { at: 0 }
  const p = { ...was, ...(set.on !== undefined ? { on: set.on } : {}), ...(set.paused !== undefined ? { paused: set.paused } : {}) }
  if (!p.paused) delete p.paused
  return { ...d, pilot: { ...p, at: now } }
}

/** SWITCHBOARD_TODO for a chat started on items: run number, autopilot or Start, the item the run is for, who left it, project, item count. */
export type RunLabel = { n: number; auto: boolean; text: string; from: string; project: string; total: number }
export function runLabel(items: TodoItem[], folder: string): RunLabel | undefined {
  const r = items.find(t => t.run), t = items.find(x => !items.some(y => y.id === x.before)) ?? items[0]
  return r?.run ? { n: r.run, auto: !!r.auto, text: t.text, from: t.name ?? 'you', project: path.basename(folder), total: items.length } : undefined
}
/** The run label of the items any of chats holds (a resume, or a handoff by old or new id), in run order. */
export function heldLabel(todo: TodoItem[] | undefined, folder: string, chats: string[]): RunLabel | undefined {
  const all = todo ?? []
  return runLabel(runOrder(all, all.filter(t => !!t.chat && chats.includes(t.chat)).map(t => t.id)), folder)
}
/** A chat terminal's SWITCHBOARD_TODO, none when it is not a to-do chat. */
export const todoEnv = (label?: RunLabel): Record<string, string> => (label ? { SWITCHBOARD_TODO: JSON.stringify(label) } : {})
/** Done: off the list (or the tray) and into the finished archive; by is the chat that did it, none for the user. */
export function finishItem(d: TodoDoc, id: string, by?: string, now = Date.now()): TodoDoc {
  const t = d.todo.find(x => x.id === id)
  if (!t) { const s = d.suggested?.find(x => x.id === id); return s ? tickSuggestion(d, s, by, now) : d }
  return removeItem(withTicked(d, [tickRow(t, by, now), ...d.ticked ?? []]), id, now)
}
/** The finished row keeps name and why, so Put back brings a hand step back as one. */
const tickRow = ({ chat: _c, host: _h, at: _a, ...t }: TodoItem, by: string | undefined, now: number): TickedItem => ({ ...t, at: now, ...(by ? { by } : {}) })
export function startTodo(d: TodoDoc, id: string, chat: string | undefined, now = Date.now()): TodoDoc {
  return { ...d, todo: d.todo.map(x => { if (x.id !== id) return x; const { chat: _c, host: _h, stopped: _s, ...rest } = x; return { ...rest, at: now, ...(chat ? { chat, host: hostId() } : {}) } }) }
}

/** A handoff: the item follows its chat to the fresh one. */
export function moveChat(d: TodoDoc, from: string, to: string, now = Date.now()): TodoDoc {
  const hit = d.todo.filter(x => x.chat === from)
  return hit.reduce((out, x) => startTodo(out, x.id, to, now), d)
}

// A chat started from an item takes a while to show in the chat list.
export const START_GRACE_MS = 2 * 60_000
/** Items this machine started whose chat is no longer live here go back to not started, marked stopped: only Start again runs them. */
export function clearGone(d: TodoDoc, live: Set<string>, now = Date.now()): TodoDoc {
  const gone = new Set(d.todo.filter(x => x.chat && x.host === hostId() && !live.has(x.chat) && now - x.at > START_GRACE_MS).map(x => x.id))
  const out = [...gone].reduce((o, id) => startTodo(o, id, undefined, now), d)
  return gone.size ? { ...out, todo: out.todo.map(x => (gone.has(x.id) ? { ...x, stopped: true as const } : x)) } : d
}

/** The ids of known items an answer names, each as a whole word. */
export function parseDoneIds(answer: string, ids: string[]): string[] {
  const words = new Set(answer.toLowerCase().split(/[^a-z0-9_-]+/))
  return ids.filter(id => words.has(id.toLowerCase()))
}

export function finishPrompt(left: TodoItem[], p: ChatProgress): string {
  const said = [...(p.report?.done ?? []), ...(p.asked ?? [])].map(s => `- ${s}`).join('\n')
  return `Open to-do items for a project, one per line as "id: text":\n${left.map(l => `${l.id}: ${l.text}`).join('\n')}\n\n`
    + `A coding chat in the project just finished. What it did and what it was asked:\n${said}\n\n`
    + 'Which open items are now done? Answer with their ids only, comma separated, or "none".'
}

/** A chat's standup Left items, cleaned, once each. Its open tasks stay on its card, and For you stays there too: the to-do is for later work. */
const leftTexts = (p: ChatProgress) => [...new Set((p.report?.left ?? []).map(clean).filter(Boolean))]

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
/** Whether a Left line and an item say the same thing: one holds the other, or most of the shorter one's longer words are in both. */
export function mentions(a: string, b: string): boolean {
  const x = words(a), y = words(b)
  if (!x || !y) return false
  return x.includes(y) || y.includes(x) || overlap(x, y, 2)
}
/** Most of the shorter one's longer words (at least min) are in both. */
function overlap(x: string, y: string, min: number): boolean {
  const [short, long] = x.length < y.length ? [x, y] : [y, x]
  const key = short.split(' ').filter(w => w.length > 3), has = new Set(long.split(' '))
  // Word overlap, not meaning; the quick model call in todoFinished covers the rest.
  return key.length >= min && key.filter(w => has.has(w)).length / key.length >= 0.7
}
/** todo_add's repeat check: no substring match, so "CI" never swallows "Add CircleCI config". */
const repeats = (a: string, b: string) => { const x = words(a), y = words(b); return !!x && !!y && (x === y || overlap(x, y, 3)) }

const WHYS = new Set<string>(['blocked', 'you', 'scope', 'later', 'missed'])
/** Why a Left line was left, from its words. */
export function whyLeft(text: string): TodoWhy {
  const t = text.toLowerCase()
  // Keyword guess; swap in a quick model call if these read wrong too often.
  if (/out of scope|not in scope|unrelated|separate (task|chat|pr)|beyond (this|the) (task|brief)/.test(t)) return 'scope'
  if (/\bblocked\b|\bblocker|waiting (on|for)|waits (on|for)|no access|missing (key|token|access|credentials)/.test(t)) return 'blocked'
  // No 'you' guess: For you lines are the hand steps, and a word guess dropped real work ("add retries to your handler").
  return 'later'
}

/** The chat's name now, so a suggestion still says it after the chat leaves the list. */
const chatName = (id: string) => hub.get().chats.find(c => c.sessionId === id)?.name?.slice(0, 64)

const VERBS = new Set(('add set re-run rerun run fix build make write create update remove delete drop replace rename move merge split check test verify review audit confirm ' +
  'wire hook connect ship release publish deploy push pull install uninstall configure enable disable turn show hide display list print log record save load open close ' +
  'start stop restart reload retry rebuild refactor simplify clean tidy port migrate upgrade bump revert undo restore handle support allow block prevent guard ' +
  'document explain describe research investigate find look trace debug profile measure benchmark compare decide choose pick design draft sketch redesign polish ' +
  'tune adjust change edit extend expand reduce cut trim cap limit sync import export copy paste send post call fetch read parse render sort filter group ' +
  'track watch monitor notify alert warn ask tell ping sign log rotate revoke grant approve reject accept dismiss tick mark flag tag name label ' +
  'map rework wrap implement introduce expose surface include exclude skip combine blocked waiting needs need wait try use apply keep make ensure give take get put prefer move teach train index scan seed backfill dedupe cover finish complete continue resume').split(' '))
// Steps addressed to Kenneth: For you work, never a to-do.
const HAND = /^(commit|quit|type|say go|reconnect|let the other|leave (out|unstaged)|delete the old|reload (vs ?code|each|the)|give me|approve or drop|open a new chat|log (out|in) of|sign (in|out)|close (vs ?code|the chats?)|keep waiting|reload (the )?window|call me|phone me)\b/i
/** The line without a leading "Before/After/Once/When/Next ..." clause, a short "Label (note):" and a list number. */
const lead = (text: string) => {
  let t = text.trim().replace(/^(?:before|after|once|when|next)\b[^,:]*[,:]\s*/i, '')
  const m = /^([^:]{1,60}?)(?:\s*\([^)]*\))?:\s+(.+)$/.exec(t)
  if (m) t = m[2]
  return { t: t.replace(/^\d+[.)]\s+/, ''), label: m?.[1] }
}
// Openers that make a line a statement: determiners, pronouns, numbers, adverb clauses.
const STATEMENT = new Set('the a an this that these those it its there i we you they he she one once some all no also still currently now just only already yet maybe probably sometimes often because if so'.split(' '))
const AUX = new Set(['is', 'are', 'was', 'were', 'has', 'have', 'had', "hasn't", "haven't", "doesn't", "didn't", "isn't", "won't", "can't", 'would', 'could', 'will', 'should', 'need', 'needs'])
/** A real to-do: an imperative. Kept when it opens on a known verb; otherwise kept unless it reads as a statement (determiner, pronoun, number or gerund opener, "JustTCG answers", or a finite auxiliary early). Hand steps fail. */
export function actionLine(text: string): boolean {
  const { t, label } = lead(text)
  if (HAND.test(t)) return false
  // "Verify X once on a board: clicking ..." opens on a verb before its label is stripped.
  if (VERBS.has(text.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z-]/g, ''))) return true
  const raw = t.split(/\s+/), w = raw.map(x => x.toLowerCase().replace(/[^a-z0-9'-]/g, ''))
  if (!w[0]) return false
  if (VERBS.has(w[0]) || (w[0] === 'also' && VERBS.has(w[1] ?? ''))) return true
  if (label && /\b(fix|plan|proposed|to-do|todo|task)\b/i.test(label)) return true
  // A quoted title, a question, or a place or time opener with no verb up front is not a task.
  if (/^["`]/.test(t) || questionLike(t) || (/^(on|in|at|for|with|from|your|my)$/.test(w[0]) && !w.slice(1, 4).some(x => VERBS.has(x)))) return false
  if (STATEMENT.has(w[0]) || /^\d/.test(w[0]) || (w[0].endsWith('ing') && w[0].length > 5)) return false
  // A CamelCase name opener ("JustTCG answers ...") is a subject, not a verb.
  if (/^[A-Z][a-z0-9]*[A-Z]/.test(raw[0])) return false
  for (const x of w.slice(0, 5)) { if (VERBS.has(x)) break; if (AUX.has(x)) return false }
  // "... still say", "... no longer", "Your x is": a state report, unless a verb comes first.
  const head = w.slice(0, 10)
  for (const [i, x] of head.entries()) {
    // Nouns like list, approve or name sit on the verb list, so only an opener verb ends the scan.
    if (w[0] === 'your' && AUX.has(x)) return false
    if (VERBS.has(x) && i < 3 && w[0] !== 'your') break
    if (x === 'still' || x === 'already' || x === 'currently' || (x === 'no' && head[i + 1] === 'longer')) return false
  }
  return true
}
// Questions and complaints typed at a chat are not work to do.
const QUESTION = /^(sorry\b|how come\b|why\b|is it because\b|are we\b|are they\b|is (this|that|there)\b|did you\b|do you\b|does\b|what (is|s|are)\b|where (is|s|are)\b|when (is|will|did)\b|who\b)|\bhow come\b|\bis it because\b/
const questionLike = (t: string) => QUESTION.test(t.toLowerCase().replace(/[^a-z0-9?' ]+/g, ' ').replace(/\s+/g, ' ').trim())

/** Paths that are never a to-do project: test and cache dirs. */
export const junkPath = (p: string) => [path.join(os.homedir(), '.cache'), os.tmpdir(), '/tmp', '/private/tmp', '/var/folders'].some(j => { const f = foldPathCase(p), q = foldPathCase(j); return f === q || f.startsWith(q + path.sep) })

/** This chat's lines as suggestions, skipping junk, a tombstone, a known id and text an open item or suggestion already says; then prune. */
function suggest(d: TodoDoc, p: ChatProgress, texts: string[], now: number, why: (t: string) => TodoWhy, idOf = leftId, strict = true): TodoDoc {
  const add: TodoItem[] = [], had = d.suggested ?? [], name = chatName(p.sessionId)
  for (const raw of texts) {
    const text = workText(raw)
    if (!text || (strict && !actionLine(text))) continue
    const id = idOf(p.sessionId, text)
    if (Object.hasOwn(d.removed, id) || [...d.todo, ...had, ...add].some(l => l.id === id || sameWork(l.text, text))) continue
    add.push({ id, text, at: now, from: p.sessionId, ...(name ? { name } : {}), why: why(text) })
  }
  return prune(add.length ? withSuggested(d, [...had, ...add]) : d, now)
}

/** Whole-word match on normalized text, so an open "CI" never matches "Decide pricing". */
const sameWork = (a: string, b: string) => { const x = words(a), y = words(b); return !!x && !!y && (` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `) || overlap(x, y, 2)) }
// Oldest first, then smallest id: every machine keeps the same one of two duplicates.
const byAge = <T extends { id: string; at: number }>(xs: T[]) => [...xs].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

export type ShippedSources = { commits: Array<{ sha: string; subject: string; at: number }>; changelog: string[] }
const STOP = new Set('the and for with that this from into when then than have has not are was were its their about after before under over each only also more most some such what which while will would should could there here your you our out all any can but via per use used using'.split(' '))
const keys = (t: string) => [...new Set(words(t).split(' ').filter(w => w.length > 3 && !STOP.has(w)).map(w => w.slice(0, 5)))]
/** Strong overlap on distinctive words: 3 or more shared and 75% of the longer side. */
const shippedBy = (text: string, subject: string) => {
  const a = keys(text), b = new Set(keys(subject)), n = a.filter(w => b.has(w)).length
  return n >= 3 && n / Math.max(a.length, b.size) >= 0.75
}
/** Open items and suggestions that a later commit subject or a CHANGELOG line already says, ticked with the match. */
export function tickShipped(d: TodoDoc, src: ShippedSources, now = Date.now()): TodoDoc {
  let out = d
  for (const t of [...d.todo.filter(x => !x.chat), ...d.suggested ?? []]) {
    if (handStep(t) || (t as TodoItem).kept) continue
    const c = src.commits.find(x => x.at >= t.at && shippedBy(t.text, x.subject))
    const line = c ? undefined : src.changelog.find(l => shippedBy(t.text, l))
    const shipped = c ? { sha: c.sha, subject: c.subject } : line ? { sha: 'CHANGELOG', subject: line } : undefined
    if (!shipped) continue
    out = finishItem(out, t.id, undefined, now)
    out = { ...out, ticked: out.ticked?.map(x => x.id === t.id ? { ...x, shipped } : x) }
  }
  return out
}
const shippedCache = new Map<string, { key: string; src: ShippedSources }>()
const clMtime = (root: string) => { try { return fs.statSync(path.join(root, 'CHANGELOG.md')).mtimeMs } catch { return 0 } }
/** The repo's last 300 commit subjects and CHANGELOG lines; cached per HEAD and CHANGELOG mtime, and a failed git log is not cached. */
async function shippedSources(root: string): Promise<ShippedSources | undefined> {
  const head = (await git(root, ['rev-parse', '-q', '--verify', 'HEAD'])).out.trim()
  const key = `${head}:${clMtime(root)}`
  const hit = shippedCache.get(root)
  if (hit && hit.key === key) return hit.src
  const r = head ? await git(root, ['log', '-n', '300', '--format=%h%x09%ct%x09%s']) : undefined
  if (!r?.ok) return hit?.src
  const commits = r.out.split('\n').flatMap(l => { const [sha, ct, ...x] = l.split('\t'); return sha && x.length ? [{ sha, subject: x.join('\t'), at: Number(ct) * 1000 }] : [] })
  const changelog = (() => { try { return fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').split('\n').map(l => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim()).filter(l => l.length > 20 && !l.startsWith('#')) } catch { return [] } })()
  const src = { commits, changelog }
  shippedCache.set(root, { key, src })
  return src
}
/** After the list shows: refresh the sources and tick what shipped, written back like a prune. */
function tickLater(folder: string, s: TodoStore): void {
  if (!s.root) return
  shippedSources(s.root).then(async src => {
    if (!src) return
    const d = await readDoc(s)
    if (tickShipped(d, src) !== d) await changeTodo(folder, x => tickShipped(x, src))
  }).catch(err => log.warn('Shipped check failed:', err))
}

/**
 * The list without junk. A For you hand step, open (accepted) or suggested. Suggestions: wrapped blocks or nudges (workText),
 * a pointer at an open item's id, a repeat of an open item or an older suggestion. Open items: an exact repeat that a chat
 * added and nobody accepted (no -ok id); accepted and typed items stay. Order free: the same set prunes the same on every
 * machine. Drops are tombstoned, so sync keeps them gone. d itself when nothing goes.
 */
export function prune(d: TodoDoc, now = Date.now()): TodoDoc {
  const open = new Set(d.todo.map(t => t.id))
  const pointsAt = (x: TodoItem) => [...x.text.matchAll(/\b[0-9a-f]{8}(?:-ok)?\b/g)].some(m => m[0] !== x.id && open.has(m[0]))
  let out = d
  const seen = new Set<string>()
  for (const t of byAge(d.todo)) {
    const w = words(t.text)
    if (handStep(t) || (seen.has(w) && t.from && !t.chat && !t.id.endsWith('-ok'))) out = removeItem(out, t.id, now)
    else seen.add(w)
  }
  const kept: TodoItem[] = []
  for (const s of byAge(d.suggested ?? [])) {
    if (handStep(s) || !workText(s.text, s.why === 'missed') || (s.why === 'missed' ? questionLike(s.text) : !actionLine(s.text)) || pointsAt(s) || [...out.todo, ...kept].some(l => sameWork(l.text, s.text))) out = dismissSuggestion(out, s.id, now)
    else kept.push(s)
  }
  const n = d.todo.length + (d.suggested?.length ?? 0) - out.todo.length - (out.suggested?.length ?? 0)
  return n ? { ...out, cleared: n } : out
}
const addLeft = (d: TodoDoc, p: ChatProgress, texts: string[], now: number) => suggest(d, p, texts, now, whyLeft)

// For you lines used to land as suggestions under this id; only those go, not a Left line once guessed as 'you'.
const youId = (chat: string, text: string) => leftId(chat, `you\n${text}`)
const handStep = (t: TodoItem) => t.why === 'you' && !!t.from && t.id.replace(/-ok$/, '') === youId(t.from, t.text)

const missedId = (chat: string, text: string) => leftId(chat, `missed\n${text}`)
// Talk to the chat, not work: call me, carry on from a handoff, how is it going, a system notice pasted into a turn.
const CHATTY = /^(cross session idle notice|switchboard stopped|subagent .* (has been quiet|no new output)|agent message from|developer reload window|(please )?(complete|do|finish) (what s|what is|everything) (left|remaining))\b|^(please )?(give me a (phone )?call|call me|phone me|ring me|text me)\b|^(please )?(continue|carry on|pick up|resume) (from|with) |^(so )?(what s|what is|how s|how is|how are|where are|where s|are you|is it) (the )?(status|progress|it going|things going|going|we at|you at|done|finished|up to)\b/
const chatty = (t: string) => CHATTY.test(t.toLowerCase().replace(/[^a-z0-9/]+/g, ' ').trim())
/** Kenneth's requests Jev found the Done list does not cover, as suggestions; one Jev now scores covered goes. */
export function addMissed(d: TodoDoc, p: ChatProgress, now = Date.now()): TodoDoc {
  const scored = p.covered?.length === p.asked?.length ? p.asked ?? [] : []
  const covered = new Set(scored.filter((_, i) => (p.covered?.[i] ?? 0) > MISSED).map(t => clean(workText(t, true) ?? t)))
  const gone = (d.suggested ?? []).filter(x => x.from === p.sessionId && x.why === 'missed' && covered.has(x.text) && x.id === missedId(p.sessionId, x.text))
  const out = gone.reduce((o, x) => dismissSuggestion(o, x.id, now), d)
  return suggest(out, p, [...new Set(missed(p).map(clean).filter(t => t && !chatty(t) && !questionLike(t)))], now, () => 'missed', missedId, false)
}

/** Kenneth approved the chat as finished, so the requests Jev scored as missed were covered after all. */
export function approvedMissed(d: TodoDoc, sessionId: string, now = Date.now()): TodoDoc {
  return (d.suggested ?? []).filter(x => x.from === sessionId && x.why === 'missed').reduce((o, x) => dismissSuggestion(o, x.id, now), d)
}

/** hub-panel.ts calls this on Approve; no write when the chat left no missed rows. */
export async function chatApproved(sessionId: string, cwd: string): Promise<void> {
  const folder = projectOf(cwd)
  if (hub.get().todos?.[folder]?.suggested?.some(x => x.from === sessionId && x.why === 'missed')) await changeTodo(folder, d => approvedMissed(d, sessionId))
}

/** Accept: into the to-do keeping where it came from and why; the suggestion stays tombstoned. The new id comes from the old one, so two devices accepting it make one item. */
export function acceptSuggestion(d: TodoDoc, id: string, now = Date.now(), newId = `${id}-ok`): TodoDoc {
  const s = d.suggested?.find(x => x.id === id)
  if (!s) return d
  const { id: _i, at: _a, text, ...more } = s
  return addTodo(dismissSuggestion(d, id, now), text, now, newId, more)
}
function tickSuggestion(d: TodoDoc, s: TodoItem, by: string | undefined, now: number): TodoDoc {
  return withTicked(dismissSuggestion(d, s.id, now), [tickRow(s, by, now), ...d.ticked ?? []])
}
export function dismissSuggestion(d: TodoDoc, id: string, now = Date.now()): TodoDoc {
  if (!okId(id) || !d.suggested?.some(x => x.id === id)) return d
  return withSuggested({ ...d, removed: { ...d.removed, [id]: now } }, d.suggested.filter(x => x.id !== id))
}

/**
 * A chat ended (SessionEnd) without reaching Done: its standup Left lines become suggestions;
 * its items go back to not started. A handoff never comes here.
 */
export function afterEnd(d: TodoDoc, p: ChatProgress, now = Date.now(), add = leftTexts(p)): TodoDoc {
  if (p.state === 'done') return d
  let out = d
  for (const t of d.todo.filter(x => x.chat === p.sessionId)) out = startTodo(out, t.id, undefined, now)
  return addLeft(out, p, add, now)
}

const leftId = (chat: string, text: string) => crypto.createHash('sha1').update(`${chat}\n${text}`).digest('hex').slice(0, 8)

/**
 * A chat reached Done: the ids the model named are done; items it worked on are done unless its Left
 * mentions them (then open again, not started); its Left and For you lines replace the suggestions it made before.
 * add: the Left lines laterOnly kept. Only adding goes by it, so a wrong filter answer never tombstones a line the chat still lists.
 */
export function afterFinish(d: TodoDoc, p: ChatProgress, doneIds: string[], now = Date.now(), add?: string[]): TodoDoc {
  const texts = leftTexts(p)
  const fresh = new Set(texts.map(t => leftId(p.sessionId, t)))
  // Only the model's guesses can be put back; the user's Done and the chat's own items cannot.
  let out = doneIds.reduce((o, id) => finishItem(o, id, p.sessionId, now), d)
  // Older docs hold auto added Left items in todo; those and the suggestions both follow the chat's latest Left.
  for (const l of out.todo) if (l.from === p.sessionId && !l.chat && l.id === leftId(p.sessionId, l.text) && !fresh.has(l.id)) out = removeItem(out, l.id, now)
  for (const l of out.suggested ?? []) if (l.from === p.sessionId && l.id === leftId(p.sessionId, l.text) && !fresh.has(l.id)) out = dismissSuggestion(out, l.id, now)
  for (const t of out.todo.filter(x => x.chat === p.sessionId)) out = texts.some(l => mentions(l, t.text)) ? startTodo(out, t.id, undefined, now) : removeItem(out, t.id, now)
  return addLeft(out, p, add ?? texts, now)
}

/** The picked items with their open prerequisites first, each once, in list order. */
export function runOrder(todo: TodoItem[], ids: string[]): TodoItem[] {
  const out: TodoItem[] = [], seen = new Set<string>()
  const visit = (t: TodoItem) => {
    if (seen.has(t.id)) return
    seen.add(t.id)
    for (const pre of todo.filter(x => x.before === t.id)) visit(pre)
    out.push(t)
  }
  for (const t of todo) if (ids.includes(t.id)) visit(t)
  return out
}

/**
 * Auto-start: the items one fresh chat should run in this window's project, or none. folder: the project this window
 * owns (none: a mirror). busy: held for another reason. live: live chat ids; one holding an item here keeps it busy,
 * other chats in the project do not. pilot: the project's switch over the global on; paused starts nothing, running
 * chats go on. limited: a usage limit is used up or a retry waits. tried: items
 * auto-started before, never again (a chat that keeps failing to start would loop). resumed: when a chat in it was last
 * resumed after a usage limit. A claim or a resume still in its grace counts as busy: that chat is not live yet.
 * failedAt: the last auto claim origin did not confirm (offline, rejected); nothing for SYNC_MS after it.
 */
export function autoStartPlan(s: { on: boolean; pilot?: TodoPilot; folder?: string; todo: TodoItem[]; busy: boolean; live?: Set<string>; limited: boolean; tried: Set<string>; now: number; resumed?: number; failedAt?: number }): { folder: string; items: TodoItem[] } | undefined {
  if (!(s.pilot?.on ?? s.on) || s.pilot?.paused || !s.folder || s.busy || s.limited) return undefined
  if (s.live && s.todo.some(x => x.chat && s.live!.has(x.chat))) return undefined
  if (s.resumed !== undefined && s.now - s.resumed <= START_GRACE_MS) return undefined
  if (s.failedAt !== undefined && s.now - s.failedAt < SYNC_MS) return undefined
  if (s.todo.some(x => x.chat && s.now - x.at <= START_GRACE_MS)) return undefined
  const items = nextRun(s.todo, t => startable(t) && !s.tried.has(t.id))
  return items && { folder: s.folder, items }
}

// A hand step, a blocked item, one in a chat or one whose chat died is not for auto-start, nor anything waiting on one.
const startable = (t: TodoItem) => !t.chat && !t.stopped && t.why !== 'you' && t.why !== 'blocked'
/** The first item, in list order, that starts with its prerequisites all ready; those items in run order. */
function nextRun(todo: TodoItem[], ready: (t: TodoItem) => boolean): TodoItem[] | undefined {
  for (const t of todo.filter(ready)) {
    const items = runOrder(todo, [t.id])
    if (items.every(ready)) return items
  }
  return undefined
}

export type TodoPlan = { runs: Array<{ n: number; ids: string[] }>; held: Array<{ id: string; why: 'blocked' | 'you' | 'stopped' }> }
/**
 * What auto-start will run, in order, each run one chat with one number after seq; held: what it never starts and why
 * (its own or a prerequisite's). Items in a live chat are running and in neither.
 */
export function upcoming(all: TodoItem[], seq = 0, live = new Set<string>()): TodoPlan {
  // A live chat's items leave the list when it is done, so nothing waits on them.
  const todo = all.filter(t => !(t.chat && live.has(t.chat)))
  const runs: TodoPlan['runs'] = [], taken = new Set<string>()
  for (let items; (items = nextRun(todo, t => startable(t) && !taken.has(t.id)));) {
    for (const t of items) taken.add(t.id)
    runs.push({ n: seq + runs.length + 1, ids: items.map(t => t.id) })
  }
  const why = (t: TodoItem) => (t.why === 'blocked' ? 'blocked' : t.why === 'you' ? 'you' : t.chat || t.stopped ? 'stopped' : undefined)
  const held = todo.filter(t => !taken.has(t.id)).map(t => {
    const chain = runOrder(todo, [t.id]).map(why)
    return { id: t.id, why: chain.find(w => w === 'blocked') ?? chain.find(w => w === 'you') ?? 'stopped' as const }
  })
  return { runs, held }
}

/**
 * The items claimed for chat, or d unchanged when any is gone or taken: running here, claimed within the grace (its
 * chat may not be live yet), or on another machine. manual (Run): another machine's claim past the grace is taken over,
 * since only that machine's clearGone frees it and it may be off. Runs inside updateDoc, on the list as it is on disk.
 */
export function claimItems(d: TodoDoc, ids: string[], chat: string, live: Set<string>, now = Date.now(), manual = false): TodoDoc {
  const taken = (t: TodoItem | undefined) => !t || (!!t.chat && ((t.host !== hostId() && !manual) || live.has(t.chat) || now - t.at <= START_GRACE_MS))
  if (ids.some(id => taken(d.todo.find(t => t.id === id)))) return d
  const n = (d.seq ?? 0) + 1, out = ids.reduce((o, id) => startTodo(o, id, chat, now), d)
  const todo = out.todo.map(t => { if (!ids.includes(t.id)) return t; const { auto: _a, ...rest } = t; return { ...rest, run: n, ...(manual ? {} : { auto: true as const }) } })
  return { ...out, todo, seq: n, streak: d.streak ?? n }
}

/**
 * claimItems on the stored list; false when another window or tap got there first. Auto-start on a synced list waits
 * for origin to take the claim (claimRemote), so two devices cannot both start an item; offline it starts nothing.
 * Run (manual) claims locally and pushes on the next sync: a person pressed it.
 */
/** tried: gets the ids once claimed, so auto-start never picks them again; an unconfirmed claim leaves them for later. */
export async function claimTodo(folder: string, ids: string[], chat: string, live: Set<string>, manual = false, optIn = readOptIn(), tried?: Set<string>): Promise<boolean> {
  const ok = await claimOnce(folder, ids, chat, live, manual, optIn)
  if (ok) for (const id of ids) tried?.add(id)
  return ok
}

async function claimOnce(folder: string, ids: string[], chat: string, live: Set<string>, manual: boolean, optIn: Record<string, true>): Promise<boolean> {
  const s = await storeOf(folder)
  if (!manual && s.root && (await syncMode(folder, (await git(s.root, ['config', '--get', 'remote.origin.url'])).out.trim(), optIn)).state === 'synced') {
    const d = await claimRemote(s.root, d => claimItems(d, ids, chat, live, Date.now()))
    if (d) show(folder, d)
    return !!d
  }
  let ok = false
  // updateDoc may run fn again on a ref race, so ok follows the last run.
  await changeTodo(folder, d => { const next = claimItems(d, ids, chat, live, Date.now(), manual); ok = next !== d; return next })
  return ok
}

/** The prompt a run sends: the items numbered, then how to handle prerequisites and closing. */
export function runMessage(items: TodoItem[]): string {
  const lines = items.map((t, i) => {
    const n = t.before ? items.findIndex(x => x.id === t.before) : -1
    return `${i + 1}. ${t.text} (id ${t.id}${n >= 0 ? `, needed first for ${n + 1}` : ''})`
  })
  return ['Switchboard to-do, in this order:', ...lines, '',
    "Do prerequisites first. When you find something that must be done before an item, add it to the to-do with the switchboard todo_add tool (before_id: that item's id) as a prerequisite, do it, then continue. Mark each item done with todo_done (its id) when it is finished."].join('\n')
}

/** An open item by id, else by its text (exact, else the one item holding it); throws when none or several. */
export function findItem(d: TodoDoc, key: string, miss?: (msg: string) => Error): TodoItem {
  const k = key.trim().toLowerCase()
  const hit = d.todo.find(t => t.id === key.trim()) ?? d.todo.find(t => t.text.toLowerCase() === k)
  if (hit) return hit
  const some = k ? d.todo.filter(t => t.text.toLowerCase().includes(k)) : []
  if (some.length === 1) return some[0]
  const msg = some.length ? `"${key}" matches ${some.length} items; use the id` : `no open to-do item matches "${key}"`
  throw miss?.(msg) ?? new Error(msg)
}

/** A todo_add or todo_done call from a chat (the ask server's MCP tools). session: the calling chat. */
export type TodoCall = { op: 'add' | 'done'; text?: string; id?: string; before?: string; session?: string }

/** What the call makes of the doc, and the line the tool answers with. A prerequisite is in progress where its item is. */
export function toolStep(d: TodoDoc, c: TodoCall, now = Date.now(), id = ID()): { doc: TodoDoc; said: string } {
  if (c.op === 'done') {
    const key = c.id ?? c.text ?? ''
    let t: TodoItem
    try { t = findItem(d, key) } catch (err) {
      // Only a key that matches nothing falls through to the tray; several matches stay an error.
      if (!(err as Error).message.startsWith('no open to-do item')) throw err
      // A chat closing its own leftover: the suggestion goes to the finished list.
      const s = findItem({ ...d, todo: d.suggested ?? [] }, key, () => err as Error)
      return { doc: tickSuggestion(d, s, c.session, now), said: `Done: ${s.text}` }
    }
    return { doc: finishItem(d, t.id, c.session, now), said: `Done: ${t.text}` }
  }
  const text = clean(c.text ?? '')
  if (!text) throw new Error('text is empty')
  // Open items only: a tray line may still be dismissed.
  const dup = d.todo.find(t => repeats(t.text, text))
  if (dup) return { doc: d, said: `Already on the list as ${dup.id}: ${dup.text}` }
  const to = c.before ? findItem(d, c.before) : undefined
  const more: Partial<TodoItem> = { ...(to ? { before: to.id } : {}), ...(to?.chat ? { chat: to.chat, host: to.host } : {}), ...(to?.run && to.chat && to.chat === c.session ? { run: to.run, ...(to.auto ? { auto: true as const } : {}) } : {}), ...(c.session ? { from: c.session.slice(0, 64) } : {}), ...(c.session && chatName(c.session) ? { name: chatName(c.session) } : {}) }
  return { doc: addTodo(d, text, now, id, more), said: `Added ${id}: ${text}${to ? ` (needed first for ${to.id})` : ''}` }
}

/** Where a folder's lists live: its repo's ref, else a file. */
export type TodoStore = { root?: string; file?: string }

export async function storeFor(folder: string, dir = path.join(os.homedir(), '.claude', 'switchboard', 'todo')): Promise<TodoStore> {
  const root = fs.existsSync(folder) ? await repoRoot(folder) : undefined
  return root ? { root } : { file: path.join(dir, `${crypto.createHash('sha1').update(folder).digest('hex')}.json`) }
}

const revParse = async (root: string, ref: string) => { const r = await git(root, ['rev-parse', '--verify', '-q', `${ref}^{commit}`]); return r.ok ? r.out.trim() : undefined }
/** No ref yet is an empty list; a ref that cannot be read throws, so no write replaces it with an empty one. */
const docAt = async (root: string, commit: string | undefined) => {
  if (!commit) return emptyDoc()
  const r = await git(root, ['cat-file', 'blob', `${commit}:${FILE}`])
  if (!r.ok) throw new Error(`could not read the to-do list (${r.err.trim().split('\n')[0]})`)
  return parseDoc(r.out)
}

const size = (d: TodoDoc) => JSON.stringify(d).length
const tooBig = (d: TodoDoc) => d.todo.length > MAX_ITEMS || size(d) > MAX_BYTES
/** What fn makes of was; a change that grows a list past the cap is refused. */
function grown(was: TodoDoc, fn: (d: TodoDoc) => TodoDoc): TodoDoc {
  const next = fn(was)
  if (tooBig(next) && size(next) > size(was)) throw new Error(`the to-do list is full (${MAX_ITEMS} items)`)
  return next
}

/** A commit holding only todo.json, on the given parents; undefined when git refused. */
async function commitDoc(root: string, d: TodoDoc, parents: string[]): Promise<string | undefined> {
  const blob = await git(root, ['hash-object', '-w', '--stdin'], undefined, `${JSON.stringify(d, null, 1)}\n`)
  if (!blob.ok) return undefined
  const tree = await git(root, ['mktree'], undefined, `100644 blob ${blob.out.trim()}\t${FILE}\n`)
  if (!tree.ok) return undefined
  const c = await git(root, [...AS, 'commit-tree', '--no-gpg-sign', tree.out.trim(), ...parents.flatMap(p => ['-p', p]), '-m', 'Switchboard to-do'])
  return c.ok ? c.out.trim() : undefined
}

/** Moves the ref only if it still points at old, so two windows never lose each other's change. */
const setRef = async (root: string, next: string, old: string | undefined) => (await git(root, ['update-ref', TODO_REF, next, old ?? NO_REF])).ok

export async function readDoc(s: TodoStore): Promise<TodoDoc> {
  if (s.root) return docAt(s.root, await revParse(s.root, TODO_REF))
  let raw: string
  try { raw = await fs.promises.readFile(s.file!, 'utf8') } catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyDoc(); throw err }
  return parseDoc(raw)
}

// Per-file queue in this process; withLock keeps other windows out.
const fileQueue = new Map<string, Promise<unknown>>()
const LOCK_STALE_MS = 5_000
/** <file>.lock made with wx around fn; a lock older than staleMs is a crashed window's and is taken over.
 * fn gets owned(): false once another window took the lock over, so it must not write. Release only removes our own lock. */
export async function withLock<T>(file: string, fn: (owned: () => boolean) => Promise<T>, staleMs = LOCK_STALE_MS): Promise<T> {
  const lock = `${file}.lock`, me = `${process.pid}-${crypto.randomUUID()}`
  const read = () => { try { return fs.readFileSync(lock, 'utf8') } catch { return '' } }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  for (let i = 0; ; i++) {
    try { fs.writeFileSync(lock, me, { flag: 'wx' }); break } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      // Rename first so only one waiter removes a stale lock, never a fresh one.
      try { if (Date.now() - fs.statSync(lock).mtimeMs > staleMs) { const gone = `${lock}.${me}`; fs.renameSync(lock, gone); fs.rmSync(gone, { force: true }) } } catch { /* another waiter got it */ }
      if (i > 400) throw new Error('the to-do list stayed locked')
      await new Promise(r => setTimeout(r, 10 + Math.random() * 20))
    }
  }
  try { return await fn(() => read() === me) } finally { if (read() === me) fs.rmSync(lock, { force: true }) }
}

/** Applies fn to the latest doc and writes it; with git, again on a lost race (another window wrote first). */
export async function updateDoc(s: TodoStore, fn: (d: TodoDoc) => TodoDoc): Promise<TodoDoc> {
  if (!s.root) {
    const file = s.file!
    const once = () => withLock(file, async owned => {
      const was = await readDoc(s), next = grown(was, fn)
      // Lost the lock to a stall takeover: read again under a new lock.
      if (!owned()) return undefined
      if (JSON.stringify(next) !== JSON.stringify(was)) writeJsonAtomic(file, next)
      return next
    })
    const run = (fileQueue.get(file) ?? Promise.resolve()).catch(() => {}).then(async () => {
      for (let i = 0; i < 3; i++) { const r = await once(); if (r) return r }
      throw new Error('the to-do list kept changing hands')
    })
    fileQueue.set(file, run)
    void run.finally(() => { if (fileQueue.get(file) === run) fileQueue.delete(file) }).catch(() => {})
    return run
  }
  for (let i = 0; i < 3; i++) {
    const old = await revParse(s.root, TODO_REF)
    const was = await docAt(s.root, old), next = grown(was, fn)
    if (JSON.stringify(next) === JSON.stringify(was)) return was
    const c = await commitDoc(s.root, next, old ? [old] : [])
    if (!c) throw new Error('git could not write the to-do list')
    if (await setRef(s.root, c, old)) return next
  }
  throw new Error('the to-do list kept changing under us')
}

const hasOrigin = async (root: string) => !!(await git(root, ['config', '--get', 'remote.origin.url'])).out.trim()
const isAncestor = async (root: string, a: string, b: string) => (await git(root, ['merge-base', '--is-ancestor', a, b])).ok

/** Pushes the ref to origin; never forced, no pre-push hooks. A string says why it did not go. */
export async function pushTodo(root: string): Promise<string | undefined> {
  if (!(await hasOrigin(root))) return undefined
  const r = await git(root, ['push', '--no-verify', '-q', 'origin', `${TODO_REF}:${TODO_REF}`], 60_000)
  return r.ok ? undefined : r.err.trim().split('\n')[0] || 'push failed'
}

// At call time, so a test's HOME applies (imports run before it is set).
export const optInFile = () => path.join(os.homedir(), '.claude', 'switchboard', 'todo-sync.json')
// A test repo in a temp folder once landed in the real file; such paths are never projects.
const inTemp = (k: string) => { const t = os.tmpdir(); return [t, fs.realpathSync(t)].some(d => k.startsWith(d + path.sep)) }

/** Folders the user chose to sync even though their repo is not known to be private. */
export function readOptIn(file = optInFile()): Record<string, true> {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    return Object.fromEntries(Object.entries(j).filter(([k, v]) => v === true && k !== '__proto__' && !inTemp(k))) as Record<string, true>
  } catch { return {} }
}

export function setOptIn(folder: string, on: boolean, file = optInFile()): void {
  const o = new Map(Object.entries(readOptIn(file)))
  if (on) o.set(folder, true); else o.delete(folder)
  writeJsonAtomic(file, Object.fromEntries(o))
}

/** owner/repo of a GitHub remote, by cloneTarget's rules. */
export const ownerRepo = (url: string) => { const t = cloneTarget(url); return t ? /github\.com[:/](.+)\.git$/.exec(t.url)?.[1] : undefined }

const ghApi = async (args: string[]): Promise<string | undefined> => {
  const gh = await ghPath()
  if (!gh) return undefined
  return new Promise(resolve => execFile(gh, args, { timeout: 15_000, windowsHide: true, env: { ...process.env, GH_PROMPT_DISABLED: '1' } }, (err, out) => resolve(err ? undefined : String(out))))
}
// gh's yes or no per repo, for the session; a failure is asked again next time.
const privates = new Map<string, boolean>()

/** Only a private GitHub repo syncs by itself; public, other hosts or no answer from gh stay local until opted in. */
export async function syncMode(folder: string, url: string, optIn = readOptIn(), gh = ghApi): Promise<TodoSync> {
  if (!url) return { state: 'local', why: 'no origin remote' }
  if (Object.hasOwn(optIn, folder)) return { state: 'synced', canSync: true, optIn: true }
  const repo = ownerRepo(url)
  if (!repo) return { state: 'local', why: 'origin is not on GitHub', canSync: true }
  if (!privates.has(repo)) {
    const a = await gh(['api', `repos/${repo}`, '--jq', '.private']).then(x => x?.trim(), () => undefined)
    if (a === 'true' || a === 'false') privates.set(repo, a === 'true')
  }
  const priv = privates.get(repo)
  return priv ? { state: 'synced', canSync: true } : { state: 'local', why: priv === false ? 'public repo' : 'could not check the repo with gh', canSync: true }
}

/** Whether theirs lost what an older device cannot write: an untombstoned suggestion, or an item's or finished row's name or why. */
export function dropped(mine: TodoDoc, theirs: TodoDoc): boolean {
  const has = new Set((theirs.suggested ?? []).map(x => x.id))
  if ((mine.suggested ?? []).some(x => !has.has(x.id) && !Object.hasOwn(theirs.removed, x.id))) return true
  const lost = (xs: Array<TodoItem | TickedItem>, ys: Array<TodoItem | TickedItem>) => {
    const by = new Map(ys.map(x => [x.id, x]))
    return xs.some(x => { const o = by.get(x.id); return !!o && !o.name && !o.why && !!(x.name || x.why) })
  }
  return lost(mine.todo, theirs.todo) || lost(mine.ticked ?? [], theirs.ticked ?? [])
}

/** Fetch origin's ref, merge it in (both parents when both moved), push what origin lacks. Offline or no origin: local only. */
export async function syncDoc(s: TodoStore): Promise<string | undefined> {
  const root = s.root
  if (!root || !(await hasOrigin(root))) return undefined
  const f = await git(root, ['fetch', '-q', '--no-tags', '--no-write-fetch-head', 'origin', `+${TODO_REF}:${REMOTE_REF}`], 60_000)
  const local = await revParse(root, TODO_REF), remote = f.ok ? await revParse(root, REMOTE_REF) : undefined
  if (remote && remote !== local) {
    // Read before adopting or merging: a list that cannot be read would lock this one, and is never pushed over.
    const theirs = await docAt(root, remote).catch(() => undefined)
    if (!theirs) return UNREADABLE
    const ff = !local || await isAncestor(root, local, remote)
    // An unreadable local list is simply replaced by origin's, as before.
    const mine = local ? await docAt(root, local).catch(() => undefined) : undefined
    if (ff && !(mine && dropped(mine, theirs))) await setRef(root, remote, local)
    else if (ff) {
      // An older device wrote over fields it does not know: merge them back on top of its commit.
      const c = await commitDoc(root, mergeDocs(mine!, theirs), [remote])
      if (c) await setRef(root, c, local)
    } else if (!(await isAncestor(root, remote, local!))) {
      const c = await commitDoc(root, mergeDocs(mine ?? await docAt(root, local!), theirs), [local!, remote])
      if (c) await setRef(root, c, local)
    }
  }
  const tip = await revParse(root, TODO_REF)
  return tip && tip !== remote ? pushTodo(root) : undefined
}

/**
 * A claim origin has taken: fetch, fn on the local list merged with origin's, commit on both, move the local ref, push.
 * The local move goes first, under update-ref's compare: a Run claim that landed meanwhile fails it, and one after
 * it sees this claim. A rejected push (another device pushed first) puts the local ref back and tries again, tries
 * times in all. Undefined when offline, origin's list is unreadable, fn leaves the list as it was (taken), or every
 * try lost. beforeClaim, beforePush: tests only, to race a Run press or another device. No lock is held over the network.
 */
export async function claimRemote(root: string, fn: (d: TodoDoc) => TodoDoc, opts: { tries?: number; beforeClaim?: () => Promise<void>; beforePush?: () => Promise<void> } = {}): Promise<TodoDoc | undefined> {
  if (!(await hasOrigin(root))) return undefined
  for (let i = 0; i < (opts.tries ?? 3); i++) {
    const f = await git(root, ['fetch', '-q', '--no-tags', '--no-write-fetch-head', 'origin', `+${TODO_REF}:${REMOTE_REF}`], 60_000)
    // Origin with no list yet is an empty one; any other fetch failure is offline.
    if (!f.ok && !/couldn't find remote ref/i.test(f.err)) return undefined
    const local = await revParse(root, TODO_REF), remote = f.ok ? await revParse(root, REMOTE_REF) : undefined
    let base: TodoDoc
    try { base = remote ? mergeDocs(await docAt(root, local), await docAt(root, remote)) : await docAt(root, local) } catch { return undefined }
    const next = fn(base)
    if (next === base) return undefined
    const parents = [...new Set([remote, local].filter((c): c is string => !!c))]
    const keep = parents.length === 2 && await isAncestor(root, parents[1], parents[0]) ? [parents[0]] : parents.length === 2 && await isAncestor(root, parents[0], parents[1]) ? [parents[1]] : parents
    const c = await commitDoc(root, next, keep)
    if (!c) return undefined
    await opts.beforeClaim?.()
    // The list changed here since the read (a Run press): read it again.
    if (!(await setRef(root, c, local))) continue
    await opts.beforePush?.()
    const p = await git(root, ['push', '--no-verify', '-q', 'origin', `${c}:${TODO_REF}`], 60_000)
    if (p.ok) return next
    // Not confirmed: the claim comes off here. Something written on top of it keeps it, so take the items back by chat.
    const back = local ? ['update-ref', TODO_REF, local, c] : ['update-ref', '-d', TODO_REF, c]
    if (!(await git(root, back)).ok) await updateDoc({ root }, d => unclaim(d, base, next))
  }
  return undefined
}

/** The items next claimed over base, freed again where they still hold that claim. */
function unclaim(d: TodoDoc, base: TodoDoc, next: TodoDoc): TodoDoc {
  const ours = next.todo.filter(t => t.chat && base.todo.find(b => b.id === t.id)?.chat !== t.chat)
  return ours.reduce((out, t) => (out.todo.find(x => x.id === t.id)?.chat === t.chat ? startTodo(out, t.id, undefined) : out), d)
}

/** The remote list's commit the last fetch saw. */
export const remoteSeen = (root: string) => revParse(root, REMOTE_REF)

/**
 * The user chose to replace an unreadable remote list with this one: only refs/switchboard/todo goes, and only
 * while origin still has the commit they saw. A string says why it did not go.
 */
export async function replaceRemote(root: string, seen: string): Promise<string | undefined> {
  if (!/^[0-9a-f]{40}$/.test(seen)) return 'not a commit id'
  if (!(await revParse(root, TODO_REF))) {
    const c = await commitDoc(root, emptyDoc(), [])
    if (!c || !(await setRef(root, c, undefined))) return 'git could not write the to-do list'
  }
  const r = await git(root, ['push', '--no-verify', '-q', `--force-with-lease=${TODO_REF}:${seen}`, 'origin', `${TODO_REF}:${TODO_REF}`], 60_000)
  return r.ok ? undefined : r.err.trim().split('\n')[0] || 'push failed'
}

export function laterPrompt(lines: string[]): string {
  return `A coding chat's standup listed these as left, numbered:\n${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n\n`
    + 'Keep only work for later: something still to build, fix, check, deploy or decide, by a later chat or by the user. '
    + 'Drop lines that say nothing is open, report status, describe what was already done, or ask to retry or re-send a request. '
    + 'Answer with the numbers to keep, comma separated, or "none".'
}

/** The numbers an answer names; undefined when it is neither numbers nor "none". */
export function parseKept(answer: string, count: number): number[] | undefined {
  if (/^\W*none\W*$/i.test(answer.trim())) return []
  const ns = answer.match(/\d+/g)?.map(Number).filter(n => n >= 1 && n <= count)
  return ns?.length ? [...new Set(ns)].map(n => n - 1) : undefined
}

/** The chat's Left lines that are later work. A failed or unreadable answer keeps them all. */
export async function laterOnly(p: ChatProgress, ask: (prompt: string, ms: number) => Promise<string>): Promise<string[]> {
  const left = leftTexts(p)
  if (!left.length) return left
  const kept = parseKept(await ask(laterPrompt(left), 60_000).catch(() => ''), left.length)
  return kept ? kept.map(i => left[i]) : left
}

// The latest Done or resume per chat: a slower, older todoFinished must not write over a newer one.
const turns = new Map<string, number>()
const nextTurn = (id: string) => { const n = (turns.get(id) ?? 0) + 1; turns.set(id, n); return n }

type Ask = (prompt: string, ms: number) => Promise<string>
/**
 * The ids of open items and tray lines, from any chat, that this chat's work covers: a chat often finishes one while
 * on another. Not asked about: items in progress on a chat, or what its own Left still lists. withAsked: what it was
 * asked counts as evidence too (a chat at Done).
 */
async function coveredIds(d: TodoDoc, p: ChatProgress, ask: Ask, withAsked: boolean): Promise<string[]> {
  const left = leftTexts(p)
  // Its own missed lines are its asks, which the evidence repeats; Jev's score in addMissed judges those.
  const open = [...d.todo.filter(l => !l.chat), ...(d.suggested ?? []).filter(l => !(l.why === 'missed' && l.from === p.sessionId))].filter(l => !left.some(t => mentions(t, l.text)))
  const q = withAsked ? p : { ...p, asked: [] }
  if (!open.length || !(q.report?.done.length || q.asked?.length)) return []
  return parseDoneIds(await ask(finishPrompt(open, q), 60_000).catch(() => ''), open.map(l => l.id))
}

/** A chat reached Done: one quick model call ticks the open items and tray lines its work covers, another keeps only later work from its Left, then afterFinish. */
export async function todoFinished(s: TodoStore, p: ChatProgress, ask: Ask): Promise<TodoDoc> {
  const turn = nextTurn(p.sessionId)
  const was = await readDoc(s)
  const [done, later] = await Promise.all([coveredIds(was, p, ask, true), laterOnly(p, ask)])
  if (turns.get(p.sessionId) !== turn) return readDoc(s)
  return updateDoc(s, d => afterFinish(d, p, done, Date.now(), later))
}

/** A chat ended without Done: what its Done list covers is ticked all the same, then afterEnd. */
export async function todoEnded(s: TodoStore, p: ChatProgress, ask: Ask): Promise<TodoDoc> {
  if (p.state === 'done') return readDoc(s)
  // ponytail: a report seen at an earlier Done was judged then; a newer standup after it is skipped too, add a report time if that matters.
  const [done, later] = await Promise.all([p.finishedAt ? [] : coveredIds(await readDoc(s), p, ask, false), laterOnly(p, ask)])
  return updateDoc(s, d => afterEnd(done.reduce((o, id) => finishItem(o, id, p.sessionId), d), p, Date.now(), later))
}

/** Kenneth wrote to a chat past Done: what its Left put on the list is that chat's work again, until its next Done says what is still left. */
export function backInChat(d: TodoDoc, sessionId: string, now = Date.now()): TodoDoc {
  const mine = d.todo.filter(l => l.from === sessionId && !l.chat && l.id === leftId(sessionId, l.text))
  return mine.reduce((out, l) => startTodo(out, l.id, sessionId, now), d)
}

// The hub side: lists by project folder in hub.todos, synced at most every SYNC_MS and a few seconds after a change.
const SYNC_MS = 5 * 60_000
const PUSH_WAIT_MS = 3000
const stores = new Map<string, Promise<TodoStore>>()
const syncedAt = new Map<string, number>()
const syncState = new Map<string, TodoSync>()
const pushes = new Map<string, NodeJS.Timeout>()
const storeOf = (folder: string) => { let s = stores.get(folder); if (!s) stores.set(folder, s = storeFor(folder)); return s }
const show = (folder: string, d?: TodoDoc) => {
  const was = hub.get().todos?.[folder]
  const src = d ?? was
  hub.set({ todos: { ...hub.get().todos, [folder]: { todo: src?.todo ?? [], ticked: src?.ticked, suggested: src?.suggested, cleared: src?.cleared, pilot: src?.pilot, seq: src?.seq, streak: src?.streak, sync: syncState.get(folder),
    plan: upcoming(src?.todo ?? [], src?.seq, new Set(hub.get().chats.filter(c => c.live).map(c => c.sessionId))) } } })
}

/** Syncs when the repo may (syncMode) and keeps how it went for the panel. */
async function syncNow(folder: string, s: TodoStore): Promise<void> {
  if (!s.root) { syncState.set(folder, { state: 'local', why: 'not a git repo' }); return }
  const mode = await syncMode(folder, (await git(s.root, ['config', '--get', 'remote.origin.url'])).out.trim())
  const why = mode.state === 'synced' ? await syncDoc(s).catch(err => (err as Error).message) : undefined
  if (why) log.warn(`To-do sync for ${folder}: ${why}`)
  // Unreadable: the panel offers to replace it, under a lease on this commit.
  const remote = why === UNREADABLE ? await remoteSeen(s.root) : undefined
  syncState.set(folder, why ? { ...mode, state: 'failing', why: why.slice(0, 120), ...(remote ? { remote } : {}) } : mode)
}

/** The git repo holding a folder, else the listed project holding it (the longest), else the folder itself. */
export function projectOf(cwd: string): string {
  const top = repoTop(cwd)
  if (top) return top
  // Drive letters differ in case on Windows (c:\ from VS Code, C:\ from Claude Code).
  const c = foldPathCase(cwd)
  const inside = (p: string) => { const q = foldPathCase(p); return c === q || c.startsWith(q.endsWith(path.sep) ? q : q + path.sep) }
  return hub.get().projects.filter(p => inside(p.path)).sort((a, b) => b.path.length - a.path.length)[0]?.path ?? cwd
}

/** This window's project and every chat's, shown in the panel. */
export const todoFolders = (workspace: string | undefined) => [...new Set([...(workspace ? [workspace] : []), ...hub.get().chats.map(c => c.cwd)].filter(Boolean).map(projectOf)
  .filter(f => !junkPath(f) && (repoTop(f) === f || hub.get().projects.some(p => foldPathCase(p.path) === foldPathCase(f)))))]

function laterSync(folder: string, s: TodoStore): void {
  if (!s.root) return
  clearTimeout(pushes.get(folder))
  pushes.set(folder, setTimeout(() => {
    pushes.delete(folder)
    // A failed push is retried by the next change or refresh sync.
    syncNow(folder, s).then(() => readDoc(s)).then(d => show(folder, d), err => { log.warn('To-do sync failed:', err); show(folder) })
  }, PUSH_WAIT_MS))
}

/** Every repo project the window and chats do not cover: shown on the one page, read-only here (loadLocalTodos). */
export const extraTodoFolders = (workspace: string | undefined) => {
  const own = new Set(todoFolders(workspace))
  return [...new Set(hub.get().projects.filter(p => p.kind === 'repo').map(p => projectOf(p.path)))].filter(f => !own.has(f) && !junkPath(f))
}

/** Reads those folders' local lists only: no fetch or push, no shipped check, prune written locally, never claimed or auto-started. */
export async function loadLocalTodos(folders: string[]): Promise<void> {
  await Promise.all(folders.map(async folder => {
    let d: TodoDoc | undefined
    try {
      const st = await storeOf(folder)
      d = await readDoc(st)
      // Junk goes from the file too (local write, no push); the next normal sync carries the tombstones.
      show(folder, prune(d) === d ? d : await updateDoc(st, prune))
    } catch { show(folder, d && prune(d)) }
  }))
}

/** Reads each folder's lists; fetches and merges when due (or forced by Refresh). */
export async function loadTodos(folders: string[], force = false): Promise<void> {
  await Promise.all(folders.map(async folder => {
    const s = await storeOf(folder)
    if (force || Date.now() - (syncedAt.get(folder) ?? 0) >= SYNC_MS) {
      syncedAt.set(folder, Date.now())
      await syncNow(folder, s)
    }
    try {
      const d = await readDoc(s)
      // Old junk and shipped work go on read too, written back so sync carries the tombstones.
      const src = s.root ? shippedCache.get(s.root)?.src : undefined
      const tidy = (x: TodoDoc) => { const p = prune(x); return src ? tickShipped(p, src) : p }
      if (tidy(d) === d) show(folder, d)
      else await changeTodo(folder, tidy).catch(() => show(folder, d))
      tickLater(folder, s)
    } catch (err) {
      syncState.set(folder, { ...syncState.get(folder), state: 'failing', why: (err as Error).message.slice(0, 120) })
      show(folder)
    }
  }))
}

export async function changeTodo(folder: string, fn: (d: TodoDoc) => TodoDoc): Promise<void> {
  const s = await storeOf(folder)
  show(folder, await updateDoc(s, fn))
  laterSync(folder, s)
}

/** The ask server's todo_add and todo_done, on the project holding cwd. */
export async function todoTool(c: TodoCall & { cwd: string }): Promise<string> {
  let said = ''
  await changeTodo(projectOf(c.cwd), d => { const r = toolStep(d, c); said = r.said; return r.doc })
  return said
}

/** claude-runtime.ts calls this when a chat this window owns reaches Done. */
export async function chatFinished(p: ChatProgress): Promise<void> {
  const folder = projectOf(p.cwd), s = await storeOf(folder)
  show(folder, await todoFinished(s, p, quickAsk))
  laterSync(folder, s)
}

/** claude-runtime.ts calls this when a chat this window owns ends without Done (hub.onEnded). */
export async function chatEnded(p: ChatProgress): Promise<void> {
  if (p.state === 'done') return
  const folder = projectOf(p.cwd), s = await storeOf(folder)
  show(folder, await todoEnded(s, p, quickAsk))
  laterSync(folder, s)
}

/** claude-runtime.ts calls this once Jev scored a Done chat's requests. */
export async function chatMissed(p: ChatProgress): Promise<void> {
  const folder = projectOf(p.cwd)
  // Nothing missed and nothing of this chat's to clear: no write.
  if (missed(p).length || hub.get().todos?.[folder]?.suggested?.some(x => x.from === p.sessionId && x.why === 'missed')) await changeTodo(folder, d => addMissed(d, p))
}

/** claude-runtime.ts calls this when a chat this window owns leaves Done. */
export async function chatResumed(p: ChatProgress): Promise<void> {
  nextTurn(p.sessionId)
  const folder = projectOf(p.cwd)
  // Most chats left nothing on the list: no write and no sync for those.
  if (!hub.get().todos?.[folder]?.todo.some(l => l.from === p.sessionId && !l.chat)) return
  await changeTodo(folder, d => backInChat(d, p.sessionId))
}

/** hub-todo-sync: the user's choice for a folder, then a sync at once. */
export async function setTodoSync(folder: string, on: boolean): Promise<void> {
  setOptIn(folder, on)
  await loadTodos([folder], true)
}

/** hub-todo-replace: the panel's Replace button, then a sync at once. A string says why it did not go. */
export async function replaceRemoteTodo(folder: string, seen: string): Promise<string | undefined> {
  const s = await storeOf(folder)
  const why = s.root ? await replaceRemote(s.root, seen) : 'not a git repo'
  await loadTodos([folder], true)
  return why
}

/** A handoff to a fresh Claude chat: an item in progress on the old one follows it. */
export async function moveTodoChat(cwd: string, from: string, to: string): Promise<void> {
  const folder = projectOf(cwd)
  if (hub.get().todos?.[folder]?.todo.some(t => t.chat === from)) await changeTodo(folder, d => moveChat(d, from, to))
}

/** After the chat list loads: items whose chat is gone from this machine stop showing in progress. */
/** keep: chats to treat as live, such as one waiting on its usage limit or just resumed from it. */
export async function clearGoneChats(keep: Iterable<string> = [], now = Date.now()): Promise<void> {
  const live = new Set([...hub.get().chats.filter(c => c.live).map(c => c.sessionId), ...keep])
  for (const [folder, l] of Object.entries(hub.get().todos ?? {})) {
    const doc: TodoDoc = { version: 1, todo: l.todo, removed: {} }
    if (clearGone(doc, live, now) !== doc) await changeTodo(folder, d => clearGone(d, live, now))
  }
}
