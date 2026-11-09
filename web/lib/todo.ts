// The to-do panel's pure parts.
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

/** Items the to-do list shows: hand steps (why 'you') show under Finish up instead. */
export const openCount = (l?: TodoList) => l?.todo.filter(t => t.why !== 'you').length ?? 0

/** Open items in every project but this one. */
export const openElsewhere = (todos: Record<string, TodoList> | undefined, folder: string) =>
  Object.entries(todos ?? {}).reduce((n, [f, l]) => n + (f === folder ? 0 : openCount(l)), 0)

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
export const runCount = (todo: TodoItem[], ids: string[]) => runIds(todo, ids).size

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
