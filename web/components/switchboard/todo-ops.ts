'use client'
// What the to-do panel does with an item, across every project: undo, wait, snooze and edit.
import { useEffect, useReducer, useRef, useState } from 'react'
import { useFlash } from '@/hooks/use-flash'
import type { ArchivedChat, ChatRow, TodoItem, TodoList, WindowInfo } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import type { runFields } from '@/lib/model-effort'
import { runLanded } from '@/lib/todo'
import { liveSnoozes, snoozeTo, snoozed } from '@/lib/todo-layout'

const UNDO_MS = 5000
const SNOOZE_KEY = 'switchboard.todo.snoozed'
export const MAX = 2000
// After a row goes away, focus lands somewhere useful instead of the page.
export const refocus = (sel: string) => requestAnimationFrame(() => document.querySelector<HTMLElement>(sel)?.focus())
export const same = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase()

// sent: when it went out; the row stays hidden until the list drops it, so it never flickers back.
type Pend = { key: string; ids: string[]; verb: 'done' | 'dismissed'; msg: string; cmd: HubCommand; sent?: number }
type Wait = { path: string; msg: string; ids: string[]; ok: (l: TodoList) => boolean }
/** Which model and effort a run takes: the fields hub-todo-run carries. */
export type RunPicks = ReturnType<typeof runFields>

function readSnoozes(): Record<string, number> {
  try { return liveSnoozes(JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? '{}'), Date.now()) } catch { return {} }
}

export function useTodoOps({ todos, chats, archive = [], windows, send }: { todos: Record<string, TodoList>; chats: ChatRow[]; archive?: ArchivedChat[]; windows?: WindowInfo[]; send: (c: HubCommand) => void }) {
  const [said, say] = useFlash('', 3000)
  const [open, setOpen] = useState<string[]>([])
  const [editing, setEditing] = useState<{ folder: string; id: string; text: string } | null>(null)
  const [wait, setWait] = useState<Wait | null>(null)
  const [snoozes, setSnoozes] = useState<Record<string, number>>({})
  useEffect(() => setSnoozes(readSnoozes()), [])
  // Rows the page waits on show as busy until the list reflects the change; never longer than 15 s.
  useEffect(() => { const l = wait && todos[wait.path]; if (l && wait.ok(l)) { say(wait.msg); setWait(null) } }, [todos, wait])
  useEffect(() => { if (!wait) return; const t = setTimeout(() => setWait(null), 15_000); return () => clearTimeout(t) }, [wait])

  // Done and Decline wait UNDO_MS before they go out; leaving or hiding the page sends them at once.
  const pend = useRef<Pend[]>([]), timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const sendRef = useRef(send); sendRef.current = send
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const go = (key: string) => {
    const p = pend.current.find(x => x.key === key)
    if (!p || p.sent) return
    clearTimeout(timers.current.get(key)); timers.current.delete(key)
    p.sent = Date.now(); sendRef.current(p.cmd); bump()
  }
  const undoAll = () => {
    for (const p of pend.current) if (!p.sent) { clearTimeout(timers.current.get(p.key)); timers.current.delete(p.key) }
    pend.current = pend.current.filter(p => p.sent); bump()
  }
  const later = (ids: string[], verb: Pend['verb'], msg: string, cmd: HubCommand) => {
    const key = `${ids.join()}:${Date.now()}`
    pend.current = [...pend.current, { key, ids, verb, msg, cmd }]
    timers.current.set(key, setTimeout(() => go(key), UNDO_MS)); bump()
  }
  // A sent one lets its row go once no list has it, or after 15 s if the change never lands.
  useEffect(() => {
    if (!pend.current.length) return
    const has = (id: string) => Object.values(todos).some(l => [...l.todo, ...l.suggested ?? []].some(t => t.id === id))
    const keep = pend.current.filter(p => !p.sent || (Date.now() - p.sent < 15_000 && p.ids.some(has)))
    if (keep.length !== pend.current.length) { pend.current = keep; bump() }
    if (!pend.current.some(p => p.sent)) return
    const t = setTimeout(bump, 15_000); return () => clearTimeout(t)
  })
  useEffect(() => {
    // A VS Code webview that is closed or hidden may never fire pagehide; visibilitychange comes first.
    const flush = () => { for (const p of pend.current) go(p.key) }
    const hide = () => { if (document.visibilityState === 'hidden') flush() }
    addEventListener('pagehide', flush); document.addEventListener('visibilitychange', hide)
    return () => { removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', hide); flush() }
  }, [])
  const hidden = new Set(pend.current.flatMap(p => p.ids))
  const undoable = pend.current.filter(p => !p.sent)
  // One toast for everything still undoable; Undo takes them all back.
  const toast = undoable.length === 1 ? undoable[0].msg : undoable.length
    ? (['done', 'dismissed'] as const).map(v => [undoable.filter(p => p.verb === v).length, v] as const).filter(([n]) => n).map(([n, v]) => `${n} ${v}`).join(', ')
    : ''

  const live = (id?: string) => !!id && chats.some(c => c.sessionId === id && c.live)
  const busy = new Set(wait?.ids ?? [])
  const toggle = (id: string) => setOpen(o => (o.includes(id) ? o.filter(x => x !== id) : [...o, id]))

  const run = (folder: string, ids: string[], opts: { to?: string; picks?: RunPicks } = {}) => {
    const list = todos[folder], was = new Map((list?.todo ?? []).map(t => [t.id, t.chat]))
    send({ type: 'hub-todo-run', path: folder, ids, ...(opts.to ? { to: opts.to } : {}), ...opts.picks })
    setWait({ path: folder, ids, msg: opts.to ? 'Sent to the chat.' : 'Started a chat on it.', ok: l => runLanded(l.todo, ids, was, opts.to) })
  }
  // Approving is Start for an item that needs OK; the store clears the gate when the run claims it (claimItems).
  const approve = (folder: string, t: TodoItem, picks?: RunPicks) => run(folder, [t.id], { picks })
  const accept = (folder: string, t: TodoItem) => {
    send({ type: 'hub-todo-accept', path: folder, id: t.id })
    setWait({ path: folder, ids: [t.id], msg: 'Added to the list.', ok: l => !l.suggested?.some(x => x.id === t.id) })
  }
  const decline = (folder: string, t: TodoItem) => later([t.id], 'dismissed', `Declined: ${t.short ?? t.text}`, { type: 'hub-todo-dismiss', path: folder, id: t.id })
  const finish = (folder: string, t: TodoItem) => later([t.id], 'done', `Done: ${t.short ?? t.text}`, { type: 'hub-todo-remove', path: folder, id: t.id })
  const snooze = (t: TodoItem, kind: 'tomorrow' | 'week') => {
    const next = { ...readSnoozes(), [t.id]: snoozeTo(Date.now(), kind) }
    try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(next)) } catch { /* private window: it holds until reload */ }
    setSnoozes(next); say(kind === 'week' ? 'Snoozed for a week.' : 'Snoozed until tomorrow.')
  }
  const wake = () => { try { localStorage.removeItem(SNOOZE_KEY) } catch { /* nothing stored */ } setSnoozes({}) }
  const isSnoozed = (id: string) => snoozed(snoozes, id, Date.now())
  const edit = (folder: string, t: TodoItem) => setEditing({ folder, id: t.id, text: t.text })
  const save = () => {
    if (!editing) return
    const t = todos[editing.folder]?.todo.find(x => x.id === editing.id), text = editing.text.trim()
    if (text && text !== t?.text) send({ type: 'hub-todo-edit', path: editing.folder, id: editing.id, text })
    setEditing(null)
  }
  const restore = (folder: string, id: string) => { send({ type: 'hub-todo-restore', path: folder, id }); say('Put back on the list.') }
  const add = (folder: string, text: string): 'dup' | 'ok' | 'empty' => {
    const t = text.trim()
    if (!t) return 'empty'
    if ((todos[folder]?.todo ?? []).some(x => !hidden.has(x.id) && same(x.text, t))) { say('Already on the list.'); return 'dup' }
    send({ type: 'hub-todo-add', path: folder, text: t })
    return 'ok'
  }
  const jump = (id: string) => {
    const c = chats.find(x => x.sessionId === id)
    send(c?.live ? { type: 'hub-focus-chat', sessionId: id } : { type: 'hub-resume', sessionId: id, ai: c?.ai ?? 'claude' })
  }
  const setPilot = (folder: string, c: { on?: boolean; paused?: boolean }) => send({ type: 'hub-todo-pilot', path: folder, ...c })
  const move = (folder: string, ids: string[]) => send({ type: 'hub-todo-move', path: folder, ids })

  return { todos, chats, archive, windows, said, say, open, toggle, editing, setEditing, edit, save, busy, hidden, toast, undoable, undoAll, live, run, approve, accept, decline, finish, snooze, wake, isSnoozed, snoozedCount: Object.keys(snoozes).length, restore, add, jump, setPilot, move, send }
}
export type Ops = ReturnType<typeof useTodoOps>
