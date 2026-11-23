import type { AiId, ArchivedChat, ChatRow, TodoItem, TodoList } from './hub-types'

// Windows paths (a drive letter first): either slash, either case.
const fold = (p: string) => (/^[a-z]:[\\/]/i.test(p) ? p.replace(/\\/g, '/').toLowerCase() : p)

/** Whether cwd is the folder or under it. */
export const inside = (folder: string, cwd: string) => { const c = fold(cwd), f = fold(folder); return c === f || c.startsWith(`${f}/`) }

/** The lists, plus an empty one for cwd when no listed project holds it, so its first item can be added. */
export function withHome(todos: Record<string, TodoList> = {}, cwd?: string): Record<string, TodoList> {
  return !cwd || Object.keys(todos).some(f => inside(f, cwd)) ? todos : { ...todos, [cwd]: { todo: [] } }
}

/** The listed project holding the folder (the longest), else the window's, else the first. */
export function todoFolder(folders: string[], cwd?: string, here?: string): string | undefined {
  const holding = (f?: string) => (f ? folders.filter(p => inside(p, f)).sort((a, b) => b.length - a.length)[0] : undefined)
  return holding(cwd) ?? holding(here) ?? folders[0]
}

/** The Plan page's project: the window's (this one, or the one used last in the browser app), else the picked chat's. A manual pick holds while that stays the same. */
export function planFolder(folders: string[], cwd?: string, here?: string, manual?: { at: string; folder: string }) {
  const at = todoFolder(folders, here, cwd)
  return { at, folder: manual && manual.at === at && folders.includes(manual.folder) ? manual.folder : at }
}

/** Rows to show: each prerequisite directly above the item it precedes, one step further in. */
export function ordered(todo: TodoItem[]): Array<{ t: TodoItem; depth: number }> {
  const out: Array<{ t: TodoItem; depth: number }> = [], seen = new Set<string>()
  const visit = (t: TodoItem, depth: number) => {
    if (seen.has(t.id)) return
    seen.add(t.id)
    // Deepest first, so the first thing to do sits on top.
    const pre = todo.filter(x => x.before === t.id)
    for (const p of pre) visit(p, depth + 1)
    out.push({ t, depth })
  }
  const ids = new Set(todo.map(t => t.id))
  for (const t of todo) if (!t.before || !ids.has(t.before)) visit(t, 0)
  // A loop of prerequisites has no top; it still shows.
  for (const t of todo) visit(t, 0)
  return out
}

/**
 * The one rule for Start by hand, on every page: an open item that is not a hand step and not running in a live chat.
 * A stopped item (its chat ended) qualifies, so does one that needs OK or waits for a date: those only hold auto-start (holdOf).
 */
export const startable = (t: TodoItem, live: (chat?: string) => boolean) => t.why !== 'you' && !live(t.chat)

/** The first item that can start, in list order. */
export const upNext = (list: TodoList, live: (chat?: string) => boolean) => ordered(list.todo).map(r => r.t).find(t => startable(t, live))

/** Items the to-do list shows: hand steps (why 'you') show under Finish up instead. */
export const openCount = (l?: TodoList) => l?.todo.filter(t => t.why !== 'you').length ?? 0

/** Running chats in the project that the panel can send a message to. */
export const runTargets = (chats: ChatRow[], folder: string) => chats.filter(c => c.live && c.takes && inside(folder, c.cwd))

/** What a run starts on: the picked ones still listed and their open prerequisites (todo.ts runOrder). */
export function runIds(todo: TodoItem[], ids: string[]): Set<string> {
  const s = new Set(ids.filter(id => todo.some(t => t.id === id)))
  for (let grew = true; grew;) {
    grew = false
    for (const t of todo) if (t.before && s.has(t.before) && !s.has(t.id)) { s.add(t.id); grew = true }
  }
  return s
}

/** Whether a run shows in the list: each picked item gone or in the chat it went to (to), else in a chat other than the one it had (was). */
export const runLanded = (todo: TodoItem[], ids: string[], was: Map<string, string | undefined>, to?: string) =>
  ids.every(id => { const t = todo.find(x => x.id === id); return !t || (to ? t.chat === to : !!t.chat && t.chat !== was.get(id)) })

/** Finish up: Kenneth's own hand steps (why 'you'), from the tray, then accepted before. */
export const finishUp = (list: TodoList) => [...list.suggested ?? [], ...list.todo].filter(t => t.why === 'you')

const AI: Record<AiId, string> = { claude: 'Claude', codex: 'Codex', hermes: 'Hermes' }
/** Which AI ran a chat: "Codex", or "Claude to Codex" when its handoff chain changed AI. Unknown chat: undefined. */
export function aiPath(id: string | undefined, chats: ChatRow[], archive: ArchivedChat[] = []): string | undefined {
  const live = chats.find(c => c.sessionId === id), gone = archive.find(a => a.sessionId === id)
  if (!live && !gone) return undefined
  const chain = live?.chain ?? gone?.origin
  const steps = chain ? archive.filter(a => a.origin === chain).sort((a, b) => a.version - b.version).map(a => a.ai) : gone ? [gone.ai] : []
  if (live) steps.push(live.ai ?? 'claude')
  return steps.filter((ai, i) => ai !== steps[i - 1]).map(ai => AI[ai] ?? ai).join(' to ')
}

/** Top-level ids after moving id by step (-1 up, 1 down) or to a place (index). */
export function moved(ids: string[], id: string, to: number): string[] {
  const out = ids.filter(x => x !== id), at = Math.max(0, Math.min(out.length, to))
  return ids.includes(id) ? [...out.slice(0, at), id, ...out.slice(at)] : ids
}

/** The project with the most open items and your steps, or undefined when every list is empty. */
export const busiestTodo = (todos: Record<string, TodoList>) => {
  const [best] = Object.entries(todos).map(([f, l]) => [f, openCount(l) + finishUp(l).length] as const).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
  return best?.[0]
}

/** A chip in the autopilot chain: n is the To-do number (queued ones get the number they will take); a run's chip is its last item, pre: its prerequisites. */
export type Step = { id: string; n?: number; text: string; state: 'done' | 'running' | 'next' | 'queued' | 'held'; why?: Held; pre?: number; auto?: true; chat?: string }
export type Held = 'blocked' | 'you' | 'stopped' | 'ok' | 'date'
/** Why auto-start leaves an item alone (the extension's todo.ts hold, same order); none when it would start. Items in a live chat are filtered out before this. */
export const holdOf = (t: TodoItem, now: number): Held | undefined =>
  t.why === 'blocked' ? 'blocked' : t.why === 'you' ? 'you' : t.needsOk ? 'ok' : t.notBefore && t.notBefore > now ? 'date' : t.chat || t.stopped ? 'stopped' : undefined
/** num: each queued row's run number; held: rows auto-start never starts; starts: each run's first row, in order. */
export type Pilot = { on: boolean; paused: boolean; mode: 'running' | 'idle' | 'off' | 'paused' | 'empty'; steps: Step[]; running: Step[]; queued: number; head: string; note: string; num: Map<string, number>; held: Map<string, Held>; starts: string[]; /** Why the next item waits (the extension plan's hold). */ hold?: NonNullable<TodoList['plan']>['hold'] }
const STATE: Record<Step['state'], string> = { done: 'Done', running: 'Running', next: 'Next', queued: 'Queued', held: 'Held' }
/** The word a held row or chip shows. */
export const HELD: Record<Held, string> = { blocked: 'Blocked', you: 'Waits on you', stopped: 'Stopped', ok: 'Needs your OK', date: 'Waits for its date' }
const tag = (n?: number) => (n ? `To-do ${n}` : 'a to-do')
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
/** What a screen reader says for a chip. */
export const stepLabel = (s: Step) => `${tag(s.n)}, ${s.text}${s.pre ? `, +${plural(s.pre, 'prerequisite')}` : ''}: ${s.why ? HELD[s.why] : STATE[s.state]}${s.auto && (s.state === 'done' || s.state === 'running') ? ', started by autopilot' : ''}`

/**
 * The project's autopilot: on falls back to the global Auto-start; done steps are ticked ones from the current chain (run >= streak).
 * What runs next comes from the extension's plan (todo.ts upcoming); without one (an older extension) the queue has no numbers.
 */
export function autopilot(list: TodoList, autoStart: boolean, live: (chat?: string) => boolean, now = Date.now()): Pilot {
  const on = list.pilot?.on ?? autoStart, paused = on && !!list.pilot?.paused
  const rows = ordered(list.todo.filter(t => t.why !== 'you')).map(r => r.t)
  const s = list.streak
  const done: Step[] = s === undefined ? [] : (list.ticked ?? []).filter(t => t.run !== undefined && t.run >= s).sort((a, b) => a.run! - b.run!)
    .map(t => ({ id: t.id, n: t.run, text: t.text, state: 'done', ...(t.auto ? { auto: true } : {}) }))
  const running: Step[] = rows.filter(t => live(t.chat)).map(t => ({ id: t.id, n: t.run, text: t.text, state: 'running', chat: t.chat, ...(t.auto ? { auto: true } : {}) }))
  const wait = rows.filter(t => !live(t.chat)), byId = new Map(list.todo.map(t => [t.id, t]))
  const runs = list.plan ? list.plan.runs.filter(r => r.ids.every(id => byId.has(id) && !live(byId.get(id)!.chat))) : wait.filter(t => !holdOf(t, now)).map(t => ({ n: undefined, ids: [t.id] }))
  const num = new Map(runs.flatMap(r => (r.n ? r.ids.map(id => [id, r.n] as const) : [])))
  const queue: Step[] = runs.map((r, i) => { const t = byId.get(r.ids.at(-1)!)!; return { id: t.id, ...(r.n ? { n: r.n } : {}), text: t.text, state: i ? 'queued' : 'next', ...(r.ids.length > 1 ? { pre: r.ids.length - 1 } : {}) } })
  const inRun = new Set(runs.flatMap(r => r.ids)), why = new Map(list.plan?.held.map(h => [h.id, h.why]))
  // A row in no run waits on something; a chat that died since the plan was sent reads as stopped.
  const held = new Map(wait.filter(t => !inRun.has(t.id)).map(t => [t.id, why.get(t.id) ?? holdOf(t, now) ?? 'stopped'] as const))
  const heldSteps: Step[] = [...held].map(([id, w]) => ({ id, text: byId.get(id)!.text, state: 'held', why: w }))
  const steps = [...done, ...running, ...queue, ...heldSteps], next = queue[0], last = queue.at(-1)?.n ?? running.at(-1)?.n
  const r = running.find(x => x.auto) ?? running[0]
  const hold = list.plan?.hold
  const base = { on, paused, steps, running, queued: queue.length, num, held, starts: runs.map(r => r.ids[0]), hold }
  if (!on) return { ...base, mode: 'off', head: 'Auto-run is off: press Start on an item', note: 'Turn on Auto-run next and each item starts by itself when the one before it is done.' }
  if (paused) return { ...base, mode: 'paused', head: 'Paused: nothing new starts. Running chats keep going.', note: queue.length ? `${queue.length} queued. Resume to pick up where it stopped.` : 'Resume to pick up where it stopped.' }
  if (r) return { ...base, mode: 'running', head: r.auto ? `Autopilot is running ${tag(r.n)}${last && last !== r.n ? ` of ${last}` : ''}` : `${tag(r.n)} is running, started by hand`,
    note: `Runs beside your other chats. ${next ? (hold ? `${hold.text}.` : `Next: ${tag(next.n)} starts by itself when this one is done.`) : 'Nothing queued after it.'}` }
  if (next) return { ...base, mode: 'idle', head: hold ? hold.text : `Next: ${tag(next.n)} starts by itself when no to-do chat is running`, note: 'Runs beside your other chats. Start now goes at once.' }
  return { ...base, mode: 'empty', head: 'Auto-run is on. Nothing queued.', note: heldNote(held) }
}

/** The line under an empty queue: a stopped item says Start again, the rest what to clear. */
function heldNote(held: Map<string, Held>): string {
  const n = held.size, stopped = [...held.values()].filter(w => w === 'stopped').length
  if (!n) return 'Add something and it starts by itself.'
  if (stopped === n) return `${plural(n, 'item')} stopped: ${n === 1 ? 'its chat ended' : 'their chats ended'} before finishing. Press Start again.`
  return `${plural(n, 'item')} held. Clear what holds one and it starts by itself.${stopped ? ' A stopped one needs Start again.' : ''}`
}

/** One Plan page lane per project with to-do items or a chain in it. */
export const pilotLanes = (todos: Record<string, TodoList>, autoStart: boolean, live: (chat?: string) => boolean) =>
  Object.entries(todos).map(([folder, l]) => ({ folder, pilot: autopilot(l, autoStart, live) })).filter(x => x.pilot.steps.length > 0)

/** The small cues on an item row. to: the item it waits on, or the chat it runs in or came from. */
export type Cue = { k: 'waits' | 'running' | 'from'; text: string; to?: string }
export function rowCues(t: TodoItem, list: TodoList, chats: ChatRow[]): Cue[] {
  const named = (id: string) => chats.find(c => c.sessionId === id)?.name
  const pre = list.todo.filter(x => x.before === t.id)
  const out: Cue[] = []
  if (pre.length) out.push({ k: 'waits', text: `Waits on ${pre.map(x => x.short ?? x.text).join(', ')}`, to: pre[0].id })
  // A gone chat shows as the row's STOPPED badge, not as running.
  const run = t.chat ? chats.find(c => c.sessionId === t.chat && c.live) : undefined
  if (run) out.push({ k: 'running', text: `Running in ${run.name ?? 'a chat'}`, to: run.sessionId })
  const from = t.name ?? (t.from ? named(t.from) : undefined)
  if (t.from && from) out.push({ k: 'from', text: `From ${from}`, to: t.from })
  return out
}

/** The To-do links on a chat card: the run it is (To-do N) and the lines it left (→ N to To-do). */
export type TodoChip = { k: 'run' | 'left'; text: string; folder: string; item: string }
export function todoChips(todos: Record<string, TodoList>, chatId: string): TodoChip[] {
  return Object.entries(todos).flatMap(([folder, l]) => {
    const run = l.todo.filter(t => t.chat === chatId)
    const left = [...l.suggested ?? [], ...l.todo].filter(t => t.from === chatId && t.chat !== chatId)
    return [
      ...run.map(t => ({ k: 'run' as const, text: t.run ? `To-do ${t.run}` : 'To-do', folder, item: t.id })),
      ...(left.length ? [{ k: 'left' as const, text: `→ ${left.length} to To-do`, folder, item: left[0].id }] : []),
    ]
  })
}
