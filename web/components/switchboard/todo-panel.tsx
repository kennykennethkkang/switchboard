'use client'
import { useEffect, useRef, useState } from 'react'
import type { ChatProgress, ChatRow, TickedItem, TodoItem, TodoList, TodoWhy, WindowInfo } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { finishUp, openCount, openElsewhere, ordered, runCount, runLanded, runTargets } from '@/lib/todo'
import { ago, caps, panel, placeOf, repoOf } from './look'
import { Check, chipOf } from './chat-cards'
export { todoFolder } from '@/lib/todo'

const MAX = 300
const SYNC = { synced: 'Synced with origin', local: 'Only on this Mac', failing: 'Sync failing' } as const
// After a row goes away, focus lands somewhere useful instead of the page.
const refocus = (sel: string) => requestAnimationFrame(() => document.querySelector<HTMLElement>(sel)?.focus())
const WHY: Record<TodoWhy, { label: string; color: string }> = {
  blocked: { label: 'Blocked', color: 'var(--hub-red)' },
  you: { label: 'Needs you', color: 'var(--hub-yellow)' },
  scope: { label: 'Out of scope', color: 'var(--hub-mute)' },
  later: { label: 'For later', color: 'var(--hub-mute)' },
  missed: { label: 'Asked, not covered', color: 'var(--hub-teal)' },
}
const day = (at: number) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const when = (at: number) => { const a = ago(at); return a === 'now' ? 'just now' : `${a} ago` }
const Dot = ({ color }: { color: string }) => <i aria-hidden className="hub-todo-dot" style={{ background: color }} />
// Why a chat left it, as a dot in the tick's slot; the words are its title and label.
const Why = ({ why }: { why: TodoWhy }) => <span className="hub-done" role="img" aria-label={WHY[why].label} title={WHY[why].label}><Dot color={WHY[why].color} /></span>

/** Future work for a project, kept across chats until done. Select items to run them in a new chat or send them to a running one. */
/** windows: the chat a row runs in names its window on hover. */
export function TodoPanel({ folder: home, todos, chats, progress = [], windows, send }: { folder: string; todos: Record<string, TodoList>; chats: ChatRow[]; progress?: ChatProgress[]; windows?: WindowInfo[]; send: (c: HubCommand) => void }) {
  const [folder, setFolder] = useState(home)
  const list = todos[folder] ?? todos[home]
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  // Escape cancels; the blur that follows must not save.
  const cancelled = useRef(false)
  const [replacing, setReplacing] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [said, setSaid] = useState('')
  useEffect(() => { if (!said) return; const t = setTimeout(() => setSaid(''), 2500); return () => clearTimeout(t) }, [said])
  // A message waits for the list to show the change; a refused one never says it went.
  const [wait, setWait] = useState<{ path: string; msg: string; ok: (l: TodoList) => boolean } | null>(null)
  useEffect(() => { const l = wait && todos[wait.path]; if (l && wait.ok(l)) { setSaid(wait.msg); setWait(null) } }, [todos, wait])
  // Never shown: the change did not land in time, so a later one (a handoff) cannot set it off.
  useEffect(() => { if (!wait) return; const t = setTimeout(() => setWait(null), 15_000); return () => clearTimeout(t) }, [wait])
  // Kenneth's hand steps show only under Finish up.
  const todo = list.todo.filter(t => t.why !== 'you'), mine = finishUp(list)
  const suggested = (list.suggested ?? []).filter(t => t.why !== 'you')
  const sel = selecting && todo.length > 0
  // Items that left the list (done here or elsewhere) drop out of the pick.
  const live = picked.filter(id => todo.some(t => t.id === id))
  const stopSelecting = () => { setSelecting(false); setPicked([]) }
  const add = () => { if (text.trim()) { send({ type: 'hub-todo-add', path: folder, text: text.trim() }); setText('') } }
  const sync = list.sync
  const save = () => {
    if (cancelled.current) { cancelled.current = false; return }
    const t = list.todo.find(x => x.id === editing?.id)
    if (editing?.text.trim() && editing.text.trim() !== t?.text) send({ type: 'hub-todo-edit', path: folder, id: editing.id, text: editing.text.trim() })
    // Enter unmounts the field, and its blur must not send twice.
    cancelled.current = true; setEditing(null)
  }
  const toggle = (id: string) => setPicked(live.includes(id) ? live.filter(x => x !== id) : [...live, id])
  const run = (to?: string, ids = live) => {
    const was = new Map(list.todo.map(t => [t.id, t.chat]))
    send({ type: 'hub-todo-run', path: folder, ids, ...(to ? { to } : {}) }); stopSelecting()
    setWait({ path: folder, msg: to ? 'Sent to the chat.' : 'Starting a chat on it.', ok: l => runLanded(l.todo, ids, was, to) })
  }
  const done = (t: TodoItem) => { refocus('[aria-label="New to-do item"]'); send({ type: 'hub-todo-remove', path: folder, id: t.id }); setWait({ path: folder, msg: `Done: ${t.text}`, ok: l => ![...l.todo, ...l.suggested ?? []].some(x => x.id === t.id) }) }
  const name = (id?: string) => chats.find(c => c.sessionId === id)?.name
  // Never "a finished chat": the name it had then, the one it has now, else the project and day.
  const source = (t: { from?: string; name?: string; at: number }) => t.name ?? name(t.from) ?? `${repoOf(folder)} chat, ${day(t.at)}`
  const jump = (id: string) => {
    const c = chats.find(x => x.sessionId === id)
    send(c?.live ? { type: 'hub-focus-chat', sessionId: id } : { type: 'hub-resume', sessionId: id, ai: c?.ai ?? 'claude' })
  }
  const decide = (t: TodoItem, accept: boolean) => {
    refocus('[aria-label="New to-do item"]')
    send({ type: accept ? 'hub-todo-accept' : 'hub-todo-dismiss', path: folder, id: t.id })
    if (accept) setWait({ path: folder, msg: `Added: ${t.text}`, ok: l => l.todo.some(x => x.text === t.text) })
  }
  // An accepted hand step has no tray to go back to, so Dismiss ticks it; Put back undoes that.
  const dismiss = (t: TodoItem) => (list.todo.includes(t) ? done(t) : decide(t, false))
  const from = (t: TodoItem) => `${t.from ? `${t.why ? 'Left by' : 'Added by'} ${source(t)}` : 'Added by you'}, ${when(t.at)}`
  const by = (t: TickedItem) => `Done by ${t.by ? name(t.by) ?? `a ${repoOf(folder)} chat` : 'you'}, ${when(t.at)}`
  const others = openElsewhere(todos, folder), folders = Object.keys(todos)
  const n = runCount(todo, live), targets = runTargets(chats, folder)
  const empty = !todo.length && !mine.length && !suggested.length

  // One short fragment at most: where it runs, that its chat ended, that it comes first, or why it was left.
  const fragment = (t: TodoItem, depth: number) => {
    const chat = t.chat ? chats.find(c => c.sessionId === t.chat) : undefined
    if (t.chat && chat?.live) {
      const place = placeOf(chat.cwd, windows)
      return <button type="button" className="hub-link hub-todo-meta" title={`In ${chat.name ?? 'a chat'}${place ? `, ${place.name} window` : ''}`}
        aria-label={`Open ${chat.name ?? 'the chat'}, where ${t.text} is running`} onClick={() => jump(t.chat!)}>
        <Dot color={chipOf(progress.find(p => p.sessionId === t.chat)).color} />Running
      </button>
    }
    if (t.chat) return <button type="button" className="hub-link hub-todo-meta" style={{ color: 'var(--hub-blue)' }} title="Its chat ended"
      aria-label={`Start ${t.text} again in a new chat`} onClick={() => run(undefined, [t.id])}>Start again</button>
    if (depth > 0) return <span className="hub-todo-meta" style={{ color: 'var(--hub-yellow)' }}>Needed first</span>
    if (t.why) return <span className="hub-todo-meta" role="img" aria-label={WHY[t.why].label} title={WHY[t.why].label}><Dot color={WHY[t.why].color} /></span>
    return null
  }

  return (
    <section aria-labelledby="todo-title" style={panel} onKeyDown={e => { if (sel && e.key === 'Escape') stopSelecting() }}>
      <div className="hub-todo-head">
        <h3 id="todo-title" style={{ ...caps, flex: 'none' }} title="Shared by every chat in the project">To-do</h3>
        {folders.length > 1
          ? <select className="hub-select" aria-label="Project" value={folder} onChange={e => { setFolder(e.target.value); stopSelecting() }}>
              {folders.map(f => <option key={f} value={f}>{repoOf(f)} ({openCount(todos[f])})</option>)}
            </select>
          : <span style={{ fontSize: 13, color: 'var(--hub-ink)' }}>{repoOf(folder)}</span>}
        {others > 0 && <span className="hub-todo-n" style={{ marginLeft: 'auto' }} title="Open items in other projects">{others} elsewhere</span>}
      </div>

      {mine.length > 0 && <div className="hub-todo-group">
        <div className="hub-todo-sub" title="Steps only you can do. Tick one when it is done; a chat you tell it is done ticks it too.">
          <h4>Finish up</h4><span className="hub-todo-n">{mine.length}</span>
        </div>
        <ul role="list" aria-label="Finish up" className="hub-todo">{mine.map(t => <li key={t.id}>
          <button type="button" className="hub-done" aria-label={`Mark ${t.text} done`} onClick={() => done(t)}><span><Check size={10} /></span></button>
          <span className="hub-todo-text" title={`${t.text}\n${from(t)}`}>{t.text}</span>
          <button type="button" className="hub-link" aria-label={`Dismiss ${t.text}`} onClick={() => dismiss(t)}>Dismiss</button>
        </li>)}</ul>
      </div>}

      {suggested.length > 0 && <div className="hub-todo-group">
        <div className="hub-todo-sub" title="Left over when a chat finished. Not in the to-do until you accept.">
          <h4>Suggested</h4><span className="hub-todo-n">{suggested.length}</span>
        </div>
        <ul role="list" aria-label="Suggested items" className="hub-todo">{suggested.map(t => <li key={t.id}>
          {t.why ? <Why why={t.why} /> : <span className="hub-done" aria-hidden />}
          <span className="hub-todo-text" title={`${t.text}\n${t.why ? `${WHY[t.why].label}. ` : ''}${from(t)}`}>{t.text}</span>
          <span className="hub-todo-acts">
            <button type="button" className="hub-btn sm" aria-label={`Accept ${t.text} into the to-do`} onClick={() => decide(t, true)}>Accept</button>
            <button type="button" className="hub-link" aria-label={`Dismiss ${t.text}`} onClick={() => decide(t, false)}>Dismiss</button>
          </span>
        </li>)}</ul>
      </div>}

      {todo.length > 0 && <div className="hub-todo-group">
        <div className="hub-todo-sub">
          <h4>Open</h4><span className="hub-todo-n">{todo.length}</span>
          <button type="button" className="hub-link" style={{ marginLeft: 'auto' }} aria-pressed={sel} onClick={() => (sel ? stopSelecting() : setSelecting(true))}>
            {sel ? 'Cancel' : 'Select to run'}
          </button>
        </div>
        <ul role="list" aria-label="To-do items" className="hub-todo">
          {ordered(todo).map(({ t, depth }) => {
            const indent = { paddingLeft: 10 + depth * 20 }
            if (sel) return <li key={t.id} data-picked={live.includes(t.id) || undefined} style={indent}>
              <label className="hub-check hub-pick hub-todo-pick">
                <input type="checkbox" aria-label={`Pick ${t.text} to run`} checked={live.includes(t.id)} onChange={() => toggle(t.id)} />
                <span className="hub-todo-text" title={t.text}>{t.text}</span>
                {depth > 0 && <span className="hub-todo-meta" style={{ color: 'var(--hub-yellow)' }}>Needed first</span>}
              </label>
            </li>
            if (editing?.id === t.id) return <li key={t.id} style={indent}>
              <span className="hub-done" aria-hidden><span /></span>
              <form style={{ display: 'flex', flex: 1, minWidth: 0 }} onSubmit={e => { e.preventDefault(); save() }}>
                <input className="hub-todo-edit" aria-label="Edit to-do item" autoFocus maxLength={MAX} value={editing.text} onChange={e => setEditing({ id: t.id, text: e.target.value })} onBlur={save}
                  onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); cancelled.current = true; setEditing(null); refocus(`[data-edit="${t.id}"]`) } }} />
              </form>
            </li>
            return <li key={t.id} style={indent}>
              <button type="button" className="hub-done" aria-label={`Mark ${t.text} done`} onClick={() => done(t)}><span><Check size={10} /></span></button>
              <button type="button" className="hub-todo-text" data-edit={t.id} aria-label={`Edit ${t.text}`} title={`${t.text}\n${from(t)}`}
                onClick={() => { cancelled.current = false; setEditing({ id: t.id, text: t.text }) }}>{t.text}</button>
              {fragment(t, depth)}
            </li>
          })}
        </ul>
      </div>}

      {empty && <p style={{ margin: 0, fontSize: 13, color: 'var(--hub-ash)' }}>Nothing saved for later.</p>}

      {!!list.ticked?.length && <details className="hub-fold-list hub-todo-group">
        <summary>
          <b aria-hidden>›</b>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--hub-ink)' }}>Finished</span>
          <span className="hub-todo-n">{list.ticked.length}</span>
        </summary>
        <ul role="list" aria-label="Finished items" className="hub-todo" data-ticked>
          {list.ticked.map(t => <li key={t.id}>
            <span className="hub-done" aria-hidden style={{ color: 'var(--hub-green)' }}><Check size={12} /></span>
            <span className="hub-todo-text" title={`${t.text}\n${by(t)}`}>{t.text}</span>
            <button type="button" className="hub-link" aria-label={`Put back ${t.text}`} onClick={() => send({ type: 'hub-todo-restore', path: folder, id: t.id })}>Put back</button>
          </li>)}
        </ul>
      </details>}

      <p role="status" style={{ margin: 0, fontSize: 12, color: 'var(--hub-green)', minHeight: said ? undefined : 0 }}>{said}</p>

      {/* Picking and adding share one slot, so the list above never moves. */}
      {sel
        ? <div role="toolbar" aria-label="Run the picked items" className="hub-todo-bar">
            <span style={{ fontSize: 12, color: 'var(--hub-ash)', flex: '1 1 120px' }}>
              {live.length ? `${live.length} picked${n > live.length ? `, ${n - live.length} needed first` : ''}` : 'Pick items to run'}
            </span>
            <button type="button" className="hub-link" onClick={() => setPicked(live.length === todo.length ? [] : todo.map(t => t.id))}>{live.length === todo.length ? 'Clear' : 'Pick all'}</button>
            <button type="button" className="hub-btn sm primary" disabled={!live.length} onClick={() => run()}>Run in new chat</button>
            {targets.map(c => <button key={c.sessionId} type="button" className="hub-btn sm" disabled={!live.length} onClick={() => run(c.sessionId)}>Send to {c.name ?? 'running chat'}</button>)}
          </div>
        : <form className="hub-todo-bar" onSubmit={e => { e.preventDefault(); add() }}>
            <input className="hub-todo-edit" aria-label="New to-do item" placeholder="Add something for later" maxLength={MAX} value={text} onChange={e => setText(e.target.value)} style={{ flex: '1 1 160px' }} />
            <button type="submit" className="hub-btn sm" disabled={!text.trim()}>Add</button>
          </form>}

      {sync && <div className="hub-todo-sync" style={{ color: sync.state === 'failing' ? 'var(--hub-red)' : 'var(--hub-ash)' }}>
        <span title={sync.why} style={{ flex: '1 1 auto', minWidth: 0 }}>{SYNC[sync.state]}{sync.why ? `: ${sync.why}` : ''}</span>
        {sync.canSync && (sync.optIn || sync.state === 'local') && <label className="hub-check" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--hub-ash)' }}
          title="Pushes this list to origin on refs/switchboard/todo, so other devices see it. Private repos sync by themselves.">
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
    </section>
  )
}
