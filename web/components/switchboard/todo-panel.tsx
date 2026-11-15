'use client'
import { useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useDraft } from '@/hooks/use-draft'
import type { ArchivedChat, ChatProgress, ChatRow, TickedItem, TodoItem, TodoList, TodoWhy, WindowInfo } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { aiPath, autopilot, finishUp, HELD, moved, openCount, openElsewhere, ordered, pilotLanes, runLanded, runTargets, stepLabel, type Pilot, type Step } from '@/lib/todo'
import { ago, caps, panel, placeOf, repoOf } from './look'
import { Check, chipOf } from './chat-cards'
import './todo-panel.css'
export { todoFolder } from '@/lib/todo'

// Same cap as todo.ts and the route.
const MAX = 2000
const UNDO_MS = 5000
// Past this a row clamps to two lines with More.
const LONG = 140
const SYNC = { synced: 'Synced across your devices', local: 'Only on this Mac', failing: 'Sync failing' } as const
// After a row goes away, focus lands somewhere useful instead of the page.
const refocus = (sel: string) => requestAnimationFrame(() => document.querySelector<HTMLElement>(sel)?.focus())
const WHY: Record<TodoWhy, { label: string; short: string; color: string }> = {
  blocked: { label: 'Blocked', short: 'Blocked', color: 'var(--hub-red)' },
  you: { label: 'Your step', short: 'Your step', color: 'var(--hub-yellow)' },
  scope: { label: 'Out of scope', short: 'Out of scope', color: 'var(--hub-mute)' },
  later: { label: 'For later', short: 'For later', color: 'var(--hub-mute)' },
  missed: { label: 'Asked, not covered', short: 'Not covered', color: 'var(--hub-teal)' },
}
const same = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase()
const day = (at: number) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const when = (at: number) => { const a = ago(at); return a === 'now' ? 'just now' : `${a} ago` }
const Dot = ({ color }: { color: string }) => <i aria-hidden className="hub-todo-dot" style={{ background: color }} />
// Dot plus words, so the reason never rests on color alone.
const Why = ({ why }: { why: TodoWhy }) => <span className="hub-todo-meta" title={WHY[why].label}><Dot color={WHY[why].color} />{WHY[why].short}</span>

// sent: when it went out; the row stays hidden until the list drops it, so it never flickers back.
type Pend = { key: string; ids: string[]; verb: 'done' | 'dismissed'; msg: string; cmd: HubCommand; sent?: number }

/** Future work for a project, kept across chats until done. The top item gets a Start button; the rest drag into order. */
/** windows: the chat a row runs in names its window on hover. archive: closed chats, for the AI a handoff chain ran in. */
/** autoStart: the global Auto-start, which a project's pilot.on overrides. onFolder: the project picker, held by the page so it outlives a remount. */
export function TodoPanel({ folder, onFolder, todos, chats, progress = [], windows, archive = [], autoStart = false, send }: { folder: string; todos: Record<string, TodoList>; chats: ChatRow[]; progress?: ChatProgress[]; windows?: WindowInfo[]; archive?: ArchivedChat[]; autoStart?: boolean; send: (c: HubCommand) => void; onFolder: (f: string) => void }) {
  const list = todos[folder] ?? { todo: [] }
  const [text, setText, clearText] = useDraft(`todo:new:${folder}`)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  // Escape cancels; the blur that follows must not save.
  const cancelled = useRef(false)
  const [replacing, setReplacing] = useState(false)
  // The order just dragged, shown until the list comes back in it.
  const [order, setOrder] = useState<string[] | null>(null)
  const [drag, setDrag] = useState<{ id: string; over?: number } | null>(null)
  const [open, setOpen] = useState<string[]>([])
  const [said, setSaid] = useState('')
  // Keyed by a count, so the same message twice still clears.
  const [saidN, setSaidN] = useState(0)
  const say = (m: string) => { setSaid(m); setSaidN(n => n + 1) }
  useEffect(() => { if (!said) return; const t = setTimeout(() => setSaid(''), 3000); return () => clearTimeout(t) }, [said, saidN])
  // A message waits for the list to show the change; a refused one never says it went. ids show as busy meanwhile.
  const [wait, setWait] = useState<{ path: string; msg: string; ids: string[]; ok: (l: TodoList) => boolean } | null>(null)
  useEffect(() => { const l = wait && todos[wait.path]; if (l && wait.ok(l)) { say(wait.msg); setWait(null) } }, [todos, wait])
  // Never shown: the change did not land in time, so a later one (a handoff) cannot set it off.
  useEffect(() => { if (!wait) return; const t = setTimeout(() => setWait(null), 15_000); return () => clearTimeout(t) }, [wait])

  // Done and Drop wait UNDO_MS before they go out; leaving or hiding the page sends them at once.
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
  // A sent one lets its row go once the list no longer has it, or after 15 s if the change never lands.
  useEffect(() => {
    if (!pend.current.length) return
    const has = (id: string) => [...list.todo, ...list.suggested ?? []].some(t => t.id === id)
    const keep = pend.current.filter(p => !p.sent || (Date.now() - p.sent < 15_000 && p.ids.some(has)))
    if (keep.length !== pend.current.length) { pend.current = keep; bump() }
    if (!pend.current.some(p => p.sent)) return
    const t = setTimeout(bump, 15_000); return () => clearTimeout(t)
  })
  useEffect(() => {
    // A VS Code webview that is closed or hidden may never fire pagehide; visibilitychange comes first.
    const flush = () => { for (const p of pend.current) go(p.key) }
    const hide = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', hide)
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', hide); flush() }
  }, [])
  const hidden = new Set(pend.current.flatMap(p => p.ids))
  // One toast for everything still undoable; Undo takes them all back.
  const undoable = pend.current.filter(p => !p.sent)
  const toast = undoable.length === 1 ? undoable[0].msg : undoable.length
    ? (['done', 'dismissed'] as const).map(v => [undoable.filter(p => p.verb === v).length, v] as const).filter(([n]) => n).map(([n, v]) => `${n} ${v}`).join(', ')
    : ''

  // Kenneth's hand steps show only under Needs you.
  const todo = list.todo.filter(t => t.why !== 'you' && !hidden.has(t.id)), mine = finishUp(list).filter(t => !hidden.has(t.id))
  const suggested = (list.suggested ?? []).filter(t => t.why !== 'you' && !hidden.has(t.id))
  const busy = new Set(wait?.ids ?? [])
  const add = () => {
    const t = text.trim()
    if (!t) return
    const dup = list.todo.find(x => !hidden.has(x.id) && same(x.text, t))
    if (dup) { say('Already on the list.'); return }
    send({ type: 'hub-todo-add', path: folder, text: t }); clearText()
    const top = addForm.current?.getBoundingClientRect().top
    if (top !== undefined) anchor.current = { top, until: Date.now() + 15_000 }
  }
  // The new row, its chain chips, then a Running row land above the box over several updates; each one scrolls the page by the
  // same amount so the box stays under the finger. Safari has no scroll anchoring, and Chrome's can pick a node above the growth.
  const addForm = useRef<HTMLFormElement>(null), anchor = useRef<{ top: number; until: number } | null>(null)
  useLayoutEffect(() => {
    const a = anchor.current
    if (!a) return
    if (Date.now() > a.until) { anchor.current = null; return }
    const now = addForm.current?.getBoundingClientRect().top
    if (now !== undefined && Math.abs(now - a.top) > 1) window.scrollBy(0, now - a.top)
  })
  // Kenneth scrolling or clicking anywhere lets go, so the page stays where he put it. Typing the next item does not.
  useEffect(() => {
    const off = () => { anchor.current = null }
    const key = (e: KeyboardEvent) => { if (/^(Page|Arrow|Home$|End$| $)/.test(e.key) && !(e.target as Element | null)?.closest?.('input, textarea')) off() }
    const o = { passive: true, capture: true }
    addEventListener('wheel', off, o); addEventListener('touchmove', off, o); addEventListener('pointerdown', off, o); addEventListener('keydown', key, true)
    return () => { removeEventListener('wheel', off, o); removeEventListener('touchmove', off, o); removeEventListener('pointerdown', off, o); removeEventListener('keydown', key, true) }
  }, [])
  const sync = list.sync
  const save = () => {
    if (cancelled.current) { cancelled.current = false; return }
    const t = list.todo.find(x => x.id === editing?.id)
    if (editing?.text.trim() && editing.text.trim() !== t?.text) send({ type: 'hub-todo-edit', path: folder, id: editing.id, text: editing.text.trim() })
    // Enter unmounts the field, and its blur must not send twice.
    cancelled.current = true; setEditing(null)
  }
  const run = (to: string | undefined, ids: string[]) => {
    const was = new Map(list.todo.map(t => [t.id, t.chat]))
    send({ type: 'hub-todo-run', path: folder, ids, ...(to ? { to } : {}) })
    setWait({ path: folder, ids, msg: to ? 'Sent to the chat.' : 'Started a chat on it.', ok: l => runLanded(l.todo, ids, was, to) })
  }
  const done = (t: TodoItem) => { refocus('[aria-label="New to-do item"]'); later([t.id], 'done', `Done: ${t.text}`, { type: 'hub-todo-remove', path: folder, id: t.id }) }
  const drop = (t: TodoItem) => { refocus('[aria-label="New to-do item"]'); later([t.id], 'dismissed', `Dismissed: ${t.text}`, { type: 'hub-todo-dismiss', path: folder, id: t.id }) }
  const keep = (t: TodoItem) => {
    refocus('[aria-label="New to-do item"]')
    send({ type: 'hub-todo-accept', path: folder, id: t.id })
    setWait({ path: folder, ids: [t.id], msg: 'Added to the list.', ok: l => !l.suggested?.some(x => x.id === t.id) })
  }
  const name = (id?: string) => chats.find(c => c.sessionId === id)?.name
  // Never "a finished chat": the name it had then, the one it has now, else the project and day.
  const source = (t: { from?: string; name?: string; at: number }) => t.name ?? name(t.from) ?? `${repoOf(folder)} chat, ${day(t.at)}`
  const jump = (id: string) => {
    const c = chats.find(x => x.sessionId === id)
    send(c?.live ? { type: 'hub-focus-chat', sessionId: id } : { type: 'hub-resume', sessionId: id, ai: c?.ai ?? 'claude' })
  }
  const from = (t: TodoItem) => `${t.from ? `${t.why ? 'Left by' : 'Added by'} ${source(t)}` : 'Added by you'}, ${when(t.at)}`
  const by = (t: TickedItem) => `Done by ${t.by ? name(t.by) ?? `a ${repoOf(folder)} chat` : 'you'}, ${when(t.at)}`
  const others = openElsewhere(todos, folder), folders = Object.keys(todos)
  const targets = runTargets(chats, folder)

  // Long text clamps to two lines; More shows the rest.
  const more = (t: { id: string; text: string }) => t.text.length > LONG
    ? <button type="button" className="hub-link hub-todo-more" aria-expanded={open.includes(t.id)} onClick={() => setOpen(open.includes(t.id) ? open.filter(x => x !== t.id) : [...open, t.id])}>{open.includes(t.id) ? 'Less' : 'More'}</button>
    : null
  const clamp = (t: { id: string; text: string }) => ({ 'data-clamp': t.text.length > LONG ? '' : undefined, 'data-open': open.includes(t.id) || undefined })
  // Short rows still cut off at the panel's edge, so a click opens any row.
  const expand = (t: { id: string }) => setOpen(open.includes(t.id) ? open.filter(x => x !== t.id) : [...open, t.id])
  const edit = (t: TodoItem) => { cancelled.current = false; setEditing({ id: t.id, text: t.text }) }

  const liveChat = (id?: string) => (id ? chats.find(c => c.sessionId === id && c.live) : undefined)
  const Ai = ({ id }: { id?: string }) => { const a = aiPath(id, chats, archive); return a ? <span className="hub-todo-ai" title={a.includes(' to ') ? `Handed over: ${a}` : `Ran in ${a}`}>{a}</span> : null }

  // Rows in the dragged order until the list catches up; prerequisites sit above the item they come before.
  const sorted = order ? [...todo].sort((a, b) => (order.indexOf(a.id) + 1 || 1e6) - (order.indexOf(b.id) + 1 || 1e6)) : todo
  const rows = ordered(sorted), top = rows.filter(r => r.depth === 0).map(r => r.t.id)
  useEffect(() => {
    if (!order) return
    const theirs = ordered(todo).filter(r => r.depth === 0).map(r => r.t.id)
    if (theirs.join() === order.filter(id => theirs.includes(id)).join()) { setOrder(null); return }
    const t = setTimeout(() => setOrder(null), 10_000); return () => clearTimeout(t)
  }, [todo, order])
  const move = (id: string, to: number) => {
    const ids = moved(top, id, to)
    if (ids.join() === top.join()) return
    setOrder(ids); send({ type: 'hub-todo-move', path: folder, ids })
  }
  const live = (id?: string) => !!liveChat(id)
  const pilot = autopilot(list, autoStart, live)
  const num = pilot.num
  const running = rows.filter(r => live(r.t.chat)), queue = rows.filter(r => !live(r.t.chat))
  // The one to do next: what auto-start runs first (the plan's first run, its first prerequisite), unless starting already.
  const next = queue.find(r => r.t.id === pilot.starts.find(id => !busy.has(id)))?.t
  const autoChat = pilot.running.find(s => s.auto)?.chat ?? pilot.running[0]?.chat
  const setPilot = (c: { on?: boolean; paused?: boolean }) => send({ type: 'hub-todo-pilot', path: folder, ...c })
  const chatName = (id?: string) => (id ? chats.find(c => c.sessionId === id)?.name : undefined)
  // What it comes before, so a prerequisite says why it sits there.
  const needed = (t: TodoItem) => { const b = t.before && list.todo.find(x => x.id === t.before); return b ? `needed before "${b.text}"` : '' }

  // Where it runs (with which AI), that its chat stopped, or that it is starting.
  const status = (t: TodoItem) => {
    if (busy.has(t.id)) return <span className="hub-todo-meta" aria-live="polite">Starting...</span>
    if (t.chat && !live(t.chat)) return <span className="hub-todo-status">
      <button type="button" className="hub-link hub-todo-meta" style={{ color: 'var(--hub-blue)' }} title="Its chat stopped before finishing"
        aria-label={`Start ${t.text} again in a new chat`} onClick={() => run(undefined, [t.id])}>Start again</button><Ai id={t.chat} />
    </span>
    return null
  }

  // Drag by the handle with mouse or finger; arrow keys on the handle move one place.
  const overAt = (x: number, y: number) => {
    const li = document.elementFromPoint(x, y)?.closest<HTMLElement>('li[data-top]')
    return li ? top.indexOf(li.dataset.top!) : undefined
  }
  const grip = (t: TodoItem) => <button type="button" className="hub-todo-grip" data-grip={t.id}
    aria-label={`Move ${t.text}. Arrow keys move it up or down.`} title="Drag to reorder"
    onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setDrag({ id: t.id }) }}
    onPointerMove={e => { if (drag?.id === t.id) { const over = overAt(e.clientX, e.clientY); if (over !== undefined && over !== drag.over) setDrag({ id: t.id, over }) } }}
    onPointerUp={() => { if (drag?.id === t.id && drag.over !== undefined) move(t.id, drag.over); setDrag(null) }}
    onPointerCancel={() => setDrag(null)}
    onKeyDown={e => {
      const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
      if (!step) return
      e.preventDefault(); move(t.id, top.indexOf(t.id) + step); refocus(`[data-grip="${t.id}"]`)
    }}>
    <svg aria-hidden width="10" height="14" viewBox="0 0 10 14" fill="currentColor">{[0, 5, 10].flatMap(y => [<circle key={`a${y}`} cx="2" cy={y + 2} r="1.3" />, <circle key={`b${y}`} cx="8" cy={y + 2} r="1.3" />])}</svg>
  </button>

  const editRow = (t: TodoItem, style?: CSSProperties) => <li key={t.id} style={style}>
    <span className="hub-done" aria-hidden><span /></span>
    <form style={{ display: 'flex', flex: 1, minWidth: 0 }} onSubmit={e => { e.preventDefault(); save() }}>
      {/* Enter saves, Shift+Enter breaks the line, Esc cancels. Caret starts at the top so long text reads from its start. */}
      <textarea className="hub-todo-edit" aria-label="Edit to-do item" aria-describedby="todo-edit-keys" autoFocus maxLength={MAX} value={editing!.text}
        rows={Math.min(8, Math.max(2, Math.ceil(editing!.text.length / 60)))}
        ref={el => { if (el && !el.dataset.placed) { el.dataset.placed = '1'; el.setSelectionRange(0, 0); el.scrollTop = 0 } }}
        onChange={e => setEditing({ id: t.id, text: e.target.value })} onBlur={save}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); save(); refocus(`[data-edit="${t.id}"]`) }
          if (e.key === 'Escape') { e.stopPropagation(); cancelled.current = true; setEditing(null); refocus(`[data-edit="${t.id}"]`) }
        }} />
      <span id="todo-edit-keys" hidden>Enter saves, Shift Enter adds a line, Escape cancels</span>
    </form>
  </li>

  const doneBtn = (t: TodoItem) => <button type="button" className="hub-done" aria-label={`Mark ${t.text} done`} onClick={() => done(t)}><span><Check size={10} /></span></button>
  const body = (t: TodoItem, meta: string) => {
    const isOpen = open.includes(t.id)
    return <div className="hub-todo-body">
      <button type="button" className="hub-todo-text" aria-expanded={isOpen} data-open={isOpen || undefined} title={`${t.text}\n${meta}`}
        onClick={() => expand(t)} onDoubleClick={() => edit(t)}>{t.text}</button>
      <span className="hub-todo-src">{meta}</span>
    </div>
  }
  const empty = !todo.length && !mine.length && !suggested.length

  return (
    <section aria-labelledby="todo-title" className="hub-todo-panel" style={panel}>
      <div className="hub-todo-head">
        <h3 id="todo-title" style={{ ...caps, flex: 'none' }} title="Work for later, shared by every chat in the project">To-do</h3>
        {folders.length > 1
          ? <select className="hub-select" aria-label="Project" value={folder} onChange={e => onFolder(e.target.value)}>
              {folders.map(f => <option key={f} value={f}>{repoOf(f)} ({openCount(todos[f]) + finishUp(todos[f]).length})</option>)}
            </select>
          : <span style={{ fontSize: 13, color: 'var(--hub-ink)' }}>{repoOf(folder)}</span>}
        {others > 0 && <span className="hub-todo-else">{others} in other projects</span>}
        <span className="hub-todo-pilot-ctl">
          <button type="button" role="switch" className="hub-switch" aria-checked={pilot.on} aria-describedby="todo-pilot-hint" onClick={() => setPilot({ on: !pilot.on })}>
            <span aria-hidden />Auto-run next
          </button>
          {pilot.on && <button type="button" className="hub-btn sm hub-todo-pause" aria-pressed={pilot.paused} onClick={() => setPilot({ paused: !pilot.paused })}>
            {pilot.paused ? <><Play />Resume</> : <><Bars />Pause</>}
          </button>}
        </span>
        <p id="todo-pilot-hint" className="hub-todo-pilot-hint">Starts the next item by itself when the running one is done. This project only.</p>
      </div>

      <PilotBar pilot={pilot} onOpen={autoChat ? () => jump(autoChat) : undefined} onResume={() => setPilot({ paused: false })} />

      {mine.length > 0 && <div className="hub-todo-group" role="region" aria-labelledby="todo-you-h">
        <h4 id="todo-you-h" className="hub-todo-sub">Only you can do these<span className="hub-todo-n">{mine.length}</span></h4>
        <ul role="list" aria-label="Only you can do these" className="hub-todo hub-todo-needs">{mine.map(t => <li key={t.id}>
          <button type="button" className="hub-done" aria-label={`Mark ${t.text} done`} onClick={() => done(t)}><span><Check size={10} /></span></button>
          <span className="hub-todo-text" {...clamp(t)} title={`${t.text}\n${from(t)}`} onClick={() => expand(t)}>{t.text}</span>
          {more(t)}
        </li>)}</ul>
      </div>}

      {suggested.length > 0 && <div className="hub-todo-group" role="region" aria-labelledby="todo-ok-h">
        <h4 id="todo-ok-h" className="hub-todo-sub" title="Left over when a chat finished. Approve puts it in the queue.">For your OK<span className="hub-todo-n">{suggested.length}</span>
          {suggested.length > 1 && <button type="button" className="hub-link hub-todo-all" onClick={() => {
            const ids = suggested.map(t => t.id)
            for (const id of ids) send({ type: 'hub-todo-accept', path: folder, id })
            refocus('[aria-label="New to-do item"]')
            setWait({ path: folder, ids, msg: `Added ${ids.length} to the queue.`, ok: l => !l.suggested?.some(x => ids.includes(x.id)) })
          }}>Approve all</button>}
        </h4>
        <ul role="list" aria-label="For your OK" className="hub-todo hub-todo-ok">{suggested.map(t => <li key={t.id} aria-busy={busy.has(t.id) || undefined}>
          <div className="hub-todo-body">
            <span className="hub-todo-text" {...clamp(t)} title={`${t.text}\n${t.why ? `${WHY[t.why].label}. ` : ''}${from(t)}`} onClick={() => expand(t)}>{t.text}</span>
            <span className="hub-todo-src">{from(t)}</span>
          </div>
          {more(t)}
          <span className="hub-todo-acts">
            {t.why && <Why why={t.why} />}
            <button type="button" className="hub-btn sm" disabled={busy.has(t.id)} aria-label={`Approve ${t.text}`} onClick={() => keep(t)}>{busy.has(t.id) ? 'Adding...' : 'Approve'}</button>
            <button type="button" className="hub-link" disabled={busy.has(t.id)} aria-label={`Dismiss ${t.text}`} onClick={() => drop(t)}>Dismiss</button>
          </span>
        </li>)}</ul>
      </div>}

      {running.length > 0 && <div className="hub-todo-group">
        <h4 className="hub-todo-sub">Running<span className="hub-todo-n">{running.length}</span></h4>
        <ul role="list" aria-label="Running" className="hub-todo">{running.map(({ t }) => {
          if (editing?.id === t.id) return editRow(t)
          const c = liveChat(t.chat)!, place = placeOf(c.cwd, windows)
          return <li key={t.id}>
            {doneBtn(t)}
            <span className="hub-todo-tag" data-k="run"><Dot color={chipOf(progress.find(p => p.sessionId === t.chat)).color} />{t.run ? `To-do ${t.run}` : 'To-do'}{t.auto ? ' · Auto' : ''}</span>
            {body(t, `${from(t)} · in chat "${chatName(t.chat) ?? 'a chat'}"${place ? `, ${place.name} window` : ''}`)}
            <span className="hub-todo-status"><Ai id={t.chat} />
              <button type="button" className="hub-link" aria-label={`Open ${c.name ?? 'the chat'}, where ${t.text} is running`} onClick={() => jump(t.chat!)}>Open <Arrow /></button>
            </span>
          </li>
        })}</ul>
      </div>}

      <div className="hub-todo-group">
        <h4 className="hub-todo-sub">Queue<span className="hub-todo-n">{queue.length}</span>
          {top.length > 1 && <span className="hub-todo-hint">Drag to reorder</span>}</h4>
        {queue.length > 0 && <ul role="list" aria-label="Queue" className="hub-todo">
          {queue.map(({ t, depth }) => {
            const indent = depth ? { paddingLeft: 10 + depth * 20 } : undefined
            if (editing?.id === t.id) return editRow(t, indent)
            const isOpen = open.includes(t.id), pos = top.indexOf(t.id), first = t === next
            const meta = [from(t), needed(t)].filter(Boolean).join(' · ')
            return <li key={t.id} style={indent} aria-busy={busy.has(t.id) || undefined} data-top={depth ? undefined : t.id} data-next={first || undefined}
              data-drag={drag?.id === t.id || undefined} data-over={drag && drag.id !== t.id && drag.over === pos || undefined}>
              {depth ? null : grip(t)}
              {doneBtn(t)}
              <span className="hub-todo-tag" data-k={first ? 'next' : pilot.held.has(t.id) ? 'held' : 'q'}>{first && <Arrow />}{pilot.held.has(t.id) ? HELD[pilot.held.get(t.id)!] : num.get(t.id) ?? ''}{first ? ' · Next' : ''}</span>
              {body(t, meta)}
              {status(t)}
              {first && !t.chat && !busy.has(t.id) && <button type="button" className="hub-btn sm primary hub-todo-start" onClick={() => run(undefined, [t.id])}>Start now</button>}
              {(first || isOpen) && <div className="hub-todo-row-acts">
                {first && targets.length > 0 && <span className="hub-todo-meta">Or send to:{' '}
                  {targets.slice(0, 3).map((c, i) => <span key={c.sessionId}>{i ? ', ' : ''}<button type="button" className="hub-link hub-todo-send" onClick={() => run(c.sessionId, [t.id])}>{c.name ?? 'running chat'}</button></span>)}
                </span>}
                <span style={{ flex: 1 }} />
                {!first && !t.chat && <button type="button" className="hub-btn sm" onClick={() => run(undefined, [t.id])}>Start now</button>}
                {pos > 0 && <button type="button" className="hub-btn sm" onClick={() => move(t.id, 0)}>Move to top</button>}
                {first && top.length > 1 && pos === 0 && <button type="button" className="hub-link" onClick={() => move(t.id, 1)}>Not now</button>}
                <button type="button" className="hub-link" data-edit={t.id} onClick={() => edit(t)}>Edit</button>
              </div>}
            </li>
          })}
        </ul>}
        {empty && <p className="hub-todo-empty">
          {list.ticked?.length ? 'All done. ' : 'Nothing here yet. '}Add something below, or chats will leave work here when they finish.
        </p>}
        <form ref={addForm} className="hub-todo-add" onSubmit={e => { e.preventDefault(); add() }}>
          <input className="hub-todo-edit" aria-label="New to-do item" placeholder="Add something to do later" maxLength={MAX} value={text} onChange={e => setText(e.target.value)} enterKeyHint="done" />
          <button type="submit" className={`hub-btn sm${text.trim() ? ' primary' : ''}`} disabled={!text.trim()}>Add</button>
          {text.length > MAX * 0.8 && <span className="hub-todo-cap" data-near>{text.length} / {MAX} characters</span>}
        </form>
      </div>

      {!!list.ticked?.length && <details className="hub-fold-list hub-todo-group">
        <summary>
          <b aria-hidden>›</b>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--hub-ink)' }}>Done</span>
          <span className="hub-todo-n">{list.ticked.length}</span>
        </summary>
        <ul role="list" aria-label="Done items" className="hub-todo" data-ticked>
          {list.ticked.map(t => <li key={t.id}>
            <span className="hub-done" aria-hidden style={{ color: 'var(--hub-green)' }}><Check size={12} /></span>
            <span className="hub-todo-text" {...clamp(t)} title={`${t.text}\n${by(t)}`} onClick={() => expand(t)}>{t.text}</span>
            {more(t)}
            <Ai id={t.by} />
            <button type="button" className="hub-link" aria-label={`Put back ${t.text}`} onClick={() => { send({ type: 'hub-todo-restore', path: folder, id: t.id }); say('Put back on the list.') }}>Put back</button>
          </li>)}
        </ul>
        {!!list.cleared && <p className="hub-todo-foot" title="Repeats and stale suggestions; their text is not kept">{list.cleared} older {list.cleared === 1 ? 'repeat' : 'repeats'} cleared</p>}
      </details>}

      <p role="status" style={{ margin: 0, fontSize: 12, color: 'var(--hub-green)', minHeight: said ? undefined : 0 }}>{said}</p>

      {sync && <div className="hub-todo-sync" style={{ color: sync.state === 'failing' ? 'var(--hub-red)' : 'var(--hub-ash)' }}>
        <span title={sync.why} style={{ flex: '1 1 auto', minWidth: 0 }}>{SYNC[sync.state]}{sync.why ? `: ${sync.why}` : ''}</span>
        {sync.canSync && (sync.optIn || sync.state === 'local') && <label className="hub-check" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--hub-ash)' }}
          title="Keeps this list on origin, off every branch, so your other devices see it. Private repos sync by themselves.">
          <input type="checkbox" checked={!!sync.optIn} onChange={() => send({ type: 'hub-todo-sync', path: folder, on: !sync.optIn })} />
          Sync this project
        </label>}
      </div>}
      {sync?.remote && <p className="hub-todo-sync">
        <span style={{ flex: '1 1 200px' }}>The list on origin cannot be read, so sync is stopped. Replacing it pushes only this list.</span>
        <button type="button" className="hub-btn sm"
          onClick={() => { if (replacing) { setReplacing(false); send({ type: 'hub-todo-replace', path: folder, remote: sync.remote! }) } else setReplacing(true) }}>
          {replacing ? 'Press again to overwrite origin\'s copy' : 'Replace the remote list with this one'}
        </button>
      </p>}

      {toast && <div role="status" className="hub-todo-toast">
        <span className="hub-todo-toast-msg">{toast}</span>
        <button type="button" className="hub-btn sm" onClick={undoAll}>{undoable.length > 1 ? 'Undo all' : 'Undo'}</button>
      </div>}
    </section>
  )
}

const Arrow = () => <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 5h6M5.5 2.5 8 5 5.5 7.5" /></svg>
const Bars = () => <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="2" y="1.5" width="2" height="7" rx=".5" /><rect x="6" y="1.5" width="2" height="7" rx=".5" /></svg>
const Play = () => <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M2.5 1.5v7l6-3.5z" /></svg>
// Each state has its own shape and word, so the chain never rests on color.
const ICON: Record<Step['state'], ReactNode> = {
  done: <Check size={10} />, running: <i aria-hidden className="hub-chain-dot" />, next: <Arrow />, queued: <i aria-hidden className="hub-chain-ring" />, held: <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="5" cy="5" r="3.5" /><path d="M2.5 7.5l5-5" /></svg>,
}
const WORD: Record<Step['state'], string> = { done: 'Done', running: 'Running', next: 'Next', queued: 'Queued', held: 'Held' }

/** The chain as chips: done, running, next, queued, held. A run shows as its last item plus its prerequisites. Focusable so a keyboard can read it step by step. */
export function Chain({ steps, label }: { steps: Step[]; label: string }) {
  return <ol className="hub-chain" aria-label={label}>{steps.map(s => <li key={s.id} tabIndex={0} data-s={s.state} aria-label={stepLabel(s)} title={stepLabel(s)}>
    {ICON[s.state]}<b>{s.why ? HELD[s.why] : WORD[s.state]}</b><span className="hub-chain-n">{s.n ?? ''}</span><span className="hub-chain-t">{s.text}{s.pre ? ` +${s.pre} prerequisite${s.pre === 1 ? '' : 's'}` : ''}</span>
  </li>)}</ol>
}

function PilotBar({ pilot, onOpen, onResume }: { pilot: Pilot; onOpen?: () => void; onResume: () => void }) {
  return <div className="hub-pilot" data-mode={pilot.mode} role="region" aria-labelledby="todo-pilot-h">
    <div className="hub-pilot-top">
      {pilot.mode === 'paused' ? <Bars /> : pilot.mode === 'running' ? <i aria-hidden className="hub-chain-dot" /> : null}
      <p id="todo-pilot-h" className="hub-pilot-head" aria-live="polite">{pilot.head}</p>
      {pilot.mode === 'paused' && <button type="button" className="hub-btn sm primary" onClick={onResume}><Play /> Resume</button>}
      {pilot.mode === 'running' && onOpen && <button type="button" className="hub-link" onClick={onOpen}>Open chat <Arrow /></button>}
    </div>
    {pilot.steps.length > 0 && pilot.mode !== 'off' && <Chain steps={pilot.steps} label="Autopilot chain" />}
    <p className="hub-pilot-note">{pilot.note}</p>
  </div>
}

/** Plan page: one lane per project, its chain and whether the autopilot runs, waits, is paused or off. */
export function AutopilotCard({ todos, chats, autoStart = false }: { todos: Record<string, TodoList>; chats: ChatRow[]; autoStart?: boolean }) {
  const lanes = pilotLanes(todos, autoStart, id => chats.some(c => c.sessionId === id && c.live))
  if (!lanes.length) return null
  const on = lanes.filter(l => l.pilot.on && !l.pilot.paused).length, paused = lanes.filter(l => l.pilot.paused).length
  const STATE = { running: 'Running', idle: 'Waiting', off: 'Auto-run off', paused: 'Paused by you', empty: 'Nothing queued' } as const
  return <section aria-labelledby="pilot-card-h" className="hub-pilot-card" style={panel}>
    <h2 id="pilot-card-h" style={caps}><span>Autopilot</span><span>{[`${on} auto-running`, paused ? `${paused} paused` : ''].filter(Boolean).join(' · ')}</span></h2>
    <ul role="list" className="hub-pilot-lanes">{lanes.map(({ folder, pilot }) => <li key={folder} data-mode={pilot.mode}>
      <span className="hub-pilot-lane-name">{repoOf(folder)}</span>
      <span className="hub-pilot-state" data-mode={pilot.mode}>{pilot.mode === 'paused' && <Bars />}{STATE[pilot.mode]}{pilot.mode === 'paused' || pilot.mode === 'off' ? ` · ${pilot.queued} queued` : ''}</span>
      <Chain steps={pilot.steps} label={`${repoOf(folder)} chain`} />
    </li>)}</ul>
  </section>
}
