'use client'
import { useEffect, useReducer, useRef, useState, type CSSProperties } from 'react'
import { useDraft } from '@/hooks/use-draft'
import type { ArchivedChat, ChatProgress, ChatRow, TickedItem, TodoItem, TodoList, TodoWhy, WindowInfo } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { aiPath, finishUp, moved, openCount, openElsewhere, ordered, runLanded, runTargets } from '@/lib/todo'
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
export function TodoPanel({ folder: home, todos, chats, progress = [], windows, archive = [], send }: { folder: string; todos: Record<string, TodoList>; chats: ChatRow[]; progress?: ChatProgress[]; windows?: WindowInfo[]; archive?: ArchivedChat[]; send: (c: HubCommand) => void }) {
  const [folder, setFolder] = useState(home)
  const list = todos[folder] ?? todos[home]
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
  }
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
  // The one to do next: the first row not already running.
  const next = rows.find(r => !liveChat(r.t.chat) && !busy.has(r.t.id))?.t
  const rest = rows.filter(r => r.t !== next)

  // Where it runs (with which AI), that its chat stopped, or that it comes first.
  const status = (t: TodoItem, depth: number) => {
    if (busy.has(t.id)) return <span className="hub-todo-meta" aria-live="polite">Starting...</span>
    const chat = liveChat(t.chat)
    if (chat) {
      const place = placeOf(chat.cwd, windows)
      return <span className="hub-todo-status">
        <button type="button" className="hub-link hub-todo-meta" title={`In ${chat.name ?? 'a chat'}${place ? `, ${place.name} window` : ''}`}
          aria-label={`Open ${chat.name ?? 'the chat'}, where ${t.text} is running`} onClick={() => jump(t.chat!)}>
          <Dot color={chipOf(progress.find(p => p.sessionId === t.chat)).color} />Running
        </button><Ai id={t.chat} />
      </span>
    }
    if (t.chat) return <span className="hub-todo-status">
      <button type="button" className="hub-link hub-todo-meta" style={{ color: 'var(--hub-blue)' }} title="Its chat stopped before finishing"
        aria-label={`Start ${t.text} again in a new chat`} onClick={() => run(undefined, [t.id])}>Start again</button><Ai id={t.chat} />
    </span>
    if (depth > 0) return <span className="hub-todo-meta" style={{ color: 'var(--hub-yellow)' }}>Do first</span>
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

  const empty = !todo.length && !mine.length && !suggested.length

  return (
    <section aria-labelledby="todo-title" className="hub-todo-panel" style={panel}>
      <div className="hub-todo-head">
        <h3 id="todo-title" style={{ ...caps, flex: 'none' }} title="Work for later, shared by every chat in the project">To-do</h3>
        {folders.length > 1
          ? <select className="hub-select" aria-label="Project" value={folder} onChange={e => setFolder(e.target.value)}>
              {folders.map(f => <option key={f} value={f}>{repoOf(f)} ({openCount(todos[f]) + finishUp(todos[f]).length})</option>)}
            </select>
          : <span style={{ fontSize: 13, color: 'var(--hub-ink)' }}>{repoOf(folder)}</span>}
        {others > 0 && <span className="hub-todo-else">{others} in other projects</span>}
      </div>

      <form className="hub-todo-add" onSubmit={e => { e.preventDefault(); add() }}>
        <input className="hub-todo-edit" aria-label="New to-do item" placeholder="Add something to do later" maxLength={MAX} value={text} onChange={e => setText(e.target.value)} enterKeyHint="done" />
        <button type="submit" className={`hub-btn sm${text.trim() ? ' primary' : ''}`} disabled={!text.trim()}>Add</button>
        {text.length > MAX * 0.8 && <span className="hub-todo-cap" data-near>{text.length} / {MAX} characters</span>}
      </form>

      {mine.length > 0 && <div className="hub-todo-group">
        <h4 className="hub-todo-sub">Only you can do these<span className="hub-todo-n">{mine.length}</span></h4>
        <ul role="list" aria-label="Only you can do these" className="hub-todo hub-todo-needs">{mine.map(t => <li key={t.id}>
          <button type="button" className="hub-done" aria-label={`Mark ${t.text} done`} onClick={() => done(t)}><span><Check size={10} /></span></button>
          <span className="hub-todo-text" {...clamp(t)} title={`${t.text}\n${from(t)}`} onClick={() => expand(t)}>{t.text}</span>
          {more(t)}
        </li>)}</ul>
      </div>}

      {next && (editing?.id === next.id
        ? <ul role="list" className="hub-todo">{editRow(next)}</ul>
        : <div className="hub-todo-next" role="group" aria-labelledby="todo-next-h">
          <p id="todo-next-h" className="hub-todo-kicker">Do next</p>
          <p className="hub-todo-next-text" {...clamp(next)} onDoubleClick={() => edit(next)}>{next.text}</p>
          {more(next)}
          <p className="hub-todo-next-meta">{from(next)}{rows.find(r => r.t === next)!.depth > 0 && <span style={{ color: 'var(--hub-yellow)' }}>, needed before the next item</span>}{next.chat && <>, its chat stopped <Ai id={next.chat} /></>}</p>
          <div className="hub-todo-next-acts">
            <button type="button" className="hub-btn sm primary" onClick={() => run(undefined, [next.id])}>{next.chat ? 'Start again' : 'Start in a new chat'}</button>
            <button type="button" className="hub-btn sm" aria-label={`Mark ${next.text} done`} onClick={() => done(next)}><Check size={11} /> Done</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="hub-link" data-edit={next.id} onClick={() => edit(next)}>Edit</button>
            {top.length > 1 && top.includes(next.id) && <button type="button" className="hub-link" onClick={() => move(next.id, top.indexOf(next.id) + 1)}>Not now</button>}
          </div>
          {targets.length > 0 && <p className="hub-todo-next-meta">Or send it to a running chat:{' '}
            {targets.slice(0, 3).map((c, i) => <span key={c.sessionId}>{i ? ', ' : ''}<button type="button" className="hub-link hub-todo-send" onClick={() => run(c.sessionId, [next.id])}>{c.name ?? 'running chat'}</button></span>)}
          </p>}
        </div>)}

      {rest.length > 0 && <div className="hub-todo-group">
        <h4 className="hub-todo-sub">{next ? 'After that' : 'In progress'}<span className="hub-todo-n">{rest.length}</span>
          {top.length > 1 && <span className="hub-todo-hint">Drag to reorder</span>}</h4>
        <ul role="list" aria-label={next ? 'After that' : 'In progress'} className="hub-todo">
          {rest.map(({ t, depth }) => {
            const indent = depth ? { paddingLeft: 10 + depth * 20 } : undefined
            if (editing?.id === t.id) return editRow(t, indent)
            const isOpen = open.includes(t.id), pos = top.indexOf(t.id)
            return <li key={t.id} style={indent} aria-busy={busy.has(t.id) || undefined} data-top={depth ? undefined : t.id}
              data-drag={drag?.id === t.id || undefined} data-over={drag && drag.id !== t.id && drag.over === pos || undefined}>
              {depth ? null : grip(t)}
              <button type="button" className="hub-done" aria-label={`Mark ${t.text} done`} onClick={() => done(t)}><span><Check size={10} /></span></button>
              <button type="button" className="hub-todo-text" aria-expanded={isOpen} data-open={isOpen || undefined} title={`${t.text}\n${from(t)}`}
                onClick={() => expand(t)} onDoubleClick={() => edit(t)}>{t.text}</button>
              {status(t, depth)}
              {isOpen && <div className="hub-todo-row-acts">
                <span className="hub-todo-meta">{from(t)}</span>
                <span style={{ flex: 1 }} />
                {!t.chat && <button type="button" className="hub-btn sm" onClick={() => run(undefined, [t.id])}>Start in a new chat</button>}
                {pos > 0 && <button type="button" className="hub-btn sm" onClick={() => move(t.id, 0)}>Move to top</button>}
                <button type="button" className="hub-btn sm" data-edit={t.id} onClick={() => edit(t)}>Edit</button>
              </div>}
            </li>
          })}
        </ul>
      </div>}

      {empty && <p className="hub-todo-empty">
        {list.ticked?.length ? 'All done. ' : 'Nothing here yet. '}Add something above, or chats will leave work here when they finish.
      </p>}

      {suggested.length > 0 && <details className="hub-fold-list hub-todo-group" open={suggested.length <= 3}>
        <summary title="Left over when a chat finished. Add one to the list or dismiss it.">
          <b aria-hidden>›</b>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--hub-ink)' }}>Suggested by finished chats</span>
          <span className="hub-todo-n">{suggested.length}</span>
        </summary>
        <ul role="list" aria-label="Suggested by finished chats" className="hub-todo">{suggested.map(t => <li key={t.id} aria-busy={busy.has(t.id) || undefined}>
          <span className="hub-todo-text" {...clamp(t)} title={`${t.text}\n${t.why ? `${WHY[t.why].label}. ` : ''}${from(t)}`} onClick={() => expand(t)}>{t.text}</span>
          {more(t)}
          {t.why && <Why why={t.why} />}
          <span className="hub-todo-acts">
            <button type="button" className="hub-btn sm" disabled={busy.has(t.id)} aria-label={`Add ${t.text} to the list`} onClick={() => keep(t)}>{busy.has(t.id) ? 'Adding...' : 'Add'}</button>
            <button type="button" className="hub-link" disabled={busy.has(t.id)} aria-label={`Dismiss ${t.text}`} onClick={() => drop(t)}>Dismiss</button>
          </span>
        </li>)}</ul>
      </details>}

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
