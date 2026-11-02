'use client'
import { useEffect, useState } from 'react'
import type { ChatProgress, ChatRow, TodoItem, TodoList, TodoWhy, WindowInfo } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { finishUp, openElsewhere, ordered, runCount, runLanded, runTargets } from '@/lib/todo'
import { ago, caps, panel, placeOf, repoOf } from './look'
import { Check, chipOf } from './chat-cards'
export { todoFolder } from '@/lib/todo'

const field = { font: '400 13px/1.4 var(--hub-sans)', padding: '7px 10px', borderRadius: 8, minWidth: 0, background: 'var(--hub-canvas)', color: 'var(--hub-ink)', border: '1px solid var(--hub-hair)' } as const
const row = { display: 'flex', alignItems: 'center', gap: 8, minHeight: 30, minWidth: 0 } as const
const tag = { fontSize: 12, color: 'var(--hub-ash)', whiteSpace: 'nowrap' } as const
const MAX = 300
const SYNC = { synced: 'Synced with origin', local: 'Only on this Mac', failing: 'Sync failing' } as const
// After a row goes away, focus lands somewhere useful instead of the page.
const refocus = (sel: string) => requestAnimationFrame(() => document.querySelector<HTMLElement>(sel)?.focus())
const hint = { margin: 0, fontSize: 12, lineHeight: 1.45, color: 'var(--hub-ash)' } as const
const meta = { display: 'block', marginTop: 2, fontSize: 12, lineHeight: 1.4, color: 'var(--hub-ash)' } as const
const WHY: Record<TodoWhy, { label: string; color: string }> = {
  blocked: { label: 'Blocked', color: 'var(--hub-red)' },
  you: { label: 'Needs you', color: 'var(--hub-yellow)' },
  scope: { label: 'Out of scope', color: 'var(--hub-mute)' },
  later: { label: 'For later', color: 'var(--hub-mute)' },
  missed: { label: 'Asked, not covered', color: 'var(--hub-teal)' },
}
const day = (at: number) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const dot = ' \u00b7 '
const when = (at: number) => { const a = ago(at); return a === 'now' ? 'just now' : `${a} ago` }

/** Future work for a project, kept across chats until done. Pick items to run them in a new chat or send them to a running one. */
/** windows: the chat a row runs in names its window on hover. */
export function TodoPanel({ folder: home, todos, chats, progress = [], windows, send }: { folder: string; todos: Record<string, TodoList>; chats: ChatRow[]; progress?: ChatProgress[]; windows?: WindowInfo[]; send: (c: HubCommand) => void }) {
  const [folder, setFolder] = useState(home)
  const list = todos[folder] ?? todos[home]
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [replacing, setReplacing] = useState(false)
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
  // Items that left the list (done here or elsewhere) drop out of the pick.
  const live = picked.filter(id => todo.some(t => t.id === id))
  const add = () => { if (text.trim()) { send({ type: 'hub-todo-add', path: folder, text: text.trim() }); setText('') } }
  const sync = list.sync
  const save = () => { if (editing?.text.trim()) send({ type: 'hub-todo-edit', path: folder, id: editing.id, text: editing.text.trim() }); setEditing(null) }
  const toggle = (id: string) => setPicked(live.includes(id) ? live.filter(x => x !== id) : [...live, id])
  const run = (to?: string, ids = live) => {
    const was = new Map(list.todo.map(t => [t.id, t.chat]))
    send({ type: 'hub-todo-run', path: folder, ids, ...(to ? { to } : {}) }); setPicked([])
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
  const suggested = (list.suggested ?? []).filter(t => t.why !== 'you')
  const decide = (t: TodoItem, accept: boolean) => {
    refocus('[aria-label="New to-do item"]')
    send({ type: accept ? 'hub-todo-accept' : 'hub-todo-dismiss', path: folder, id: t.id })
    if (accept) setWait({ path: folder, msg: `Added: ${t.text}`, ok: l => l.todo.some(x => x.text === t.text) })
  }
  const others = openElsewhere(todos, folder), folders = Object.keys(todos)
  const n = runCount(todo, live), targets = runTargets(chats, folder)
  return (
    <section aria-labelledby="todo-title" style={panel}>
      <h3 id="todo-title" style={caps}><span>To-do for later</span><span style={{ textTransform: 'none' }}>Shared by every chat</span></h3>
      <div style={{ ...row, flexWrap: 'wrap', fontSize: 13, marginTop: -4 }}>
        {folders.length > 1
          ? <select className="hub-select" aria-label="Project" value={folder} onChange={e => { setFolder(e.target.value); setPicked([]) }}>
              {folders.map(f => <option key={f} value={f}>{repoOf(f)} ({todos[f].todo.length})</option>)}
            </select>
          : <span style={{ color: 'var(--hub-ink)' }}>{repoOf(folder)}</span>}
        {others > 0 && <span style={{ color: 'var(--hub-ash)', fontSize: 12 }}>{others} in other projects</span>}
      </div>
      {mine.length > 0 && <div style={{ display: 'grid', gap: 6 }}>
        <h4 style={caps}><span>Finish up</span><span>{mine.reduce((n, [, xs]) => n + xs.length, 0)}</span></h4>
        <p style={hint}>Steps only you can do, left by chats. Tick one when it is done; a chat you tell it is done ticks it too.</p>
        {mine.map(([chat, xs]) => <div key={chat} style={{ display: 'grid', gap: 4 }}>
          <span style={{ ...meta, marginTop: 0 }}>{chat}</span>
          <ul role="list" aria-label={`Finish up for ${chat}`} className="hub-todo">{xs.map(t => <li key={t.id} style={{ ...row, alignItems: 'flex-start' }}>
            <label className="hub-check" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: '1 1 auto', minWidth: 0, cursor: 'pointer', fontSize: 13, color: 'var(--hub-ink)', paddingTop: 5 }}>
              <input type="checkbox" checked={false} aria-label={`Mark ${t.text} done`} onChange={() => done(t)} style={{ margin: '1px 0 0', flex: 'none' }} />
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{t.text}<span style={meta}>{when(t.at)}</span></span>
            </label>
            {/* An accepted one has no tray to go back to: its tick is the only way off. */}
            {!list.todo.includes(t) && <button type="button" className="hub-link" style={{ fontSize: 12, flex: 'none' }} aria-label={`Dismiss ${t.text}`} onClick={() => decide(t, false)}>Dismiss</button>}
          </li>)}</ul>
        </div>)}
      </div>}
      {suggested.length > 0 && <div style={{ display: 'grid', gap: 6 }}>
        <h4 style={caps}><span>Suggested by finished chats</span><span>{suggested.length}</span></h4>
        <p style={hint}>Left over when a chat finished. Not in the to-do until you accept.</p>
        <ul role="list" aria-label="Suggested items" className="hub-todo">
          {suggested.map(t => <li key={t.id} style={{ ...row, alignItems: 'flex-start', flexWrap: 'wrap', columnGap: 10, rowGap: 4 }}>
            <span style={{ flex: '1 1 220px', minWidth: 0, fontSize: 13, color: 'var(--hub-ink)', paddingTop: 4, overflowWrap: 'anywhere' }}>
              {t.text}
              <span style={meta}>
                {t.why && <span style={{ color: WHY[t.why].color }}>{WHY[t.why].label}</span>}{t.why && dot}
                {t.from
                  ? <button type="button" className="hub-link" style={{ fontSize: 12, padding: 0, color: 'var(--hub-blue)' }} aria-label={`Open the chat ${source(t)}`} onClick={() => jump(t.from!)}>{source(t)}</button>
                  : source(t)}
                {dot}<span style={{ whiteSpace: 'nowrap' }}>{when(t.at)}</span>
              </span>
            </span>
            <span style={{ display: 'flex', gap: 4, flex: 'none', marginLeft: 'auto', alignItems: 'center' }}>
              <button type="button" className="hub-btn sm" aria-label={`Accept ${t.text} into the to-do`} onClick={() => decide(t, true)}>Accept</button>
              <button type="button" className="hub-link" style={{ fontSize: 12 }} aria-label={`Dismiss ${t.text}`} onClick={() => decide(t, false)}>Dismiss</button>
            </span>
          </li>)}
        </ul>
      </div>}
      {todo.length > 0 && <p style={hint}>Future work, saved for a later chat. Pick items to run them now.</p>}
      {todo.length > 1 && <label className="hub-check hub-pick" style={{ ...row, minHeight: 24, fontSize: 12, color: 'var(--hub-mute)', cursor: 'pointer', paddingLeft: 11 }}>
        <input type="checkbox" checked={live.length === todo.length} ref={el => { if (el) el.indeterminate = live.length > 0 && live.length < todo.length }}
          onChange={() => setPicked(live.length === todo.length ? [] : todo.map(t => t.id))} />
        Pick all
      </label>}
      {todo.length
        ? <ul role="list" aria-label="To-do items" className="hub-todo">
            {ordered(todo).map(({ t, depth }) => {
              if (editing?.id === t.id) return <li key={t.id} style={{ paddingLeft: 10 + depth * 20 }}>
                <form style={{ display: 'flex', gap: 6 }} onSubmit={e => { e.preventDefault(); save() }}>
                  <input aria-label="Edit to-do item" autoFocus maxLength={MAX} value={editing.text} onChange={e => setEditing({ id: t.id, text: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Escape') { setEditing(null); refocus(`[data-edit="${t.id}"]`) } }} style={{ ...field, flex: 1 }} />
                  <button type="submit" className="hub-btn sm">Save</button>
                </form>
              </li>
              const chat = t.chat ? chats.find(c => c.sessionId === t.chat) : undefined
              const ended = !!t.chat && !chat?.live
              const chipColor = chipOf(progress.find(p => p.sessionId === t.chat)).color
              return <li key={t.id} data-picked={live.includes(t.id) || undefined} style={{ ...row, alignItems: 'flex-start', paddingLeft: 10 + depth * 20 }}>
                <label className="hub-check hub-pick" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: '1 1 auto', minWidth: 0, cursor: 'pointer', fontSize: 13, color: 'var(--hub-ink)', paddingTop: 5 }}>
                  <input type="checkbox" aria-label={`Pick ${t.text} to run`} checked={live.includes(t.id)} onChange={() => toggle(t.id)} style={{ margin: '1px 0 0' }} />
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    {t.text}
                    <span style={meta}>
                      {depth > 0 && <><span style={{ color: 'var(--hub-yellow)' }}>Needed first</span>{dot}</>}
                      {t.from ? `${t.why ? 'Left by' : 'Added by'} ${source(t)}` : 'Added by you'}
                      {t.why && <>{dot}<span style={{ color: WHY[t.why].color }}>{WHY[t.why].label}</span></>}
                      {dot}<span style={{ whiteSpace: 'nowrap' }}>{when(t.at)}</span>
                      {t.chat && !ended && <>{dot}<span title={placeOf(chat?.cwd, windows) && `In the ${placeOf(chat?.cwd, windows)!.name} window`} style={{ color: 'var(--hub-mute)' }}>
                        <i aria-hidden style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: chipColor, marginRight: 5, verticalAlign: 1 }} />
                        running in {chat?.name ?? 'a chat'}
                      </span></>}
                      {ended && <>{dot}chat ended</>}
                    </span>
                  </span>
                </label>
                {ended && <button type="button" className="hub-link" style={{ fontSize: 12, color: 'var(--hub-blue)', flex: 'none' }} aria-label={`Start ${t.text} again in a new chat`} onClick={() => run(undefined, [t.id])}>Start again</button>}
                <span className="hub-todo-acts" style={{ display: 'flex', gap: 2, flex: 'none', marginLeft: 'auto' }}>
                  <button type="button" className="hub-link" style={{ fontSize: 12 }} data-edit={t.id} aria-label={`Edit ${t.text}`} onClick={() => setEditing({ id: t.id, text: t.text })}>Edit</button>
                  <button type="button" className="hub-link" style={{ fontSize: 12 }} aria-label={`Mark ${t.text} done`}
                    onClick={() => done(t)}>Done</button>
                </span>
              </li>
            })}
          </ul>
        : <p style={{ margin: 0, fontSize: 13, color: 'var(--hub-ash)' }}>Nothing saved for later. Add an item here, accept a suggestion, or a chat adds one with todo_add.</p>}
      {live.length > 0 && <div role="toolbar" aria-label="Run the picked items" style={{ ...row, flexWrap: 'wrap', padding: '8px 10px', borderRadius: 8, background: 'var(--hub-canvas)', border: '1px solid var(--hub-hair)' }}>
        <span style={{ fontSize: 12, color: 'var(--hub-ash)', flex: '1 1 120px' }}>{live.length} picked to run{n > live.length ? `, ${n - live.length} needed first` : ''}</span>
        <button type="button" className="hub-btn sm primary" onClick={() => run()}>Run in new chat</button>
        {targets.map(c => <button key={c.sessionId} type="button" className="hub-btn sm" onClick={() => run(c.sessionId)}>Send to {c.name ?? 'running chat'}</button>)}
        <button type="button" className="hub-link" style={{ fontSize: 12 }} onClick={() => setPicked([])}>Clear</button>
      </div>}
      {!!list.ticked?.length && <details className="hub-fold-list">
        <summary>
          <b aria-hidden>›</b>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--hub-ink)' }}>Finished</span>
          <span style={tag}>{list.ticked.length}</span>
        </summary>
        <p style={{ ...hint, margin: '6px 0' }}>Done items, newest first. Put one back if it still needs doing.</p>
        <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
          {list.ticked.map(t => <li key={t.id} style={{ ...row, flexWrap: 'wrap', columnGap: 8, rowGap: 0, paddingLeft: 11 }}>
            <span style={{ display: 'flex', gap: 10, alignItems: 'baseline', flex: '1 1 220px', minWidth: 0, fontSize: 13, color: 'var(--hub-mute)' }}>
              <span style={{ color: 'var(--hub-green)', alignSelf: 'center', display: 'inline-flex', width: 18, justifyContent: 'center' }}><Check size={12} /></span>
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{t.text}<span style={{ ...tag, marginLeft: 6 }}>by {t.by ? name(t.by) ?? `a ${repoOf(folder)} chat, ${day(t.at)}` : 'you'}</span></span>
            </span>
            <button type="button" className="hub-link" style={{ fontSize: 12, marginLeft: 'auto', color: 'var(--hub-blue)' }} aria-label={`Put back ${t.text}`}
              onClick={() => send({ type: 'hub-todo-restore', path: folder, id: t.id })}>Put back</button>
          </li>)}
        </ul>
      </details>}
      <p role="status" style={{ margin: 0, fontSize: 12, color: 'var(--hub-green)', minHeight: said ? undefined : 0 }}>{said}</p>
      <form style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} onSubmit={e => { e.preventDefault(); add() }}>
        <input aria-label="New to-do item" placeholder="Add something for later" maxLength={MAX} value={text} onChange={e => setText(e.target.value)} style={{ ...field, flex: '1 1 160px' }} />
        <button type="submit" className="hub-btn sm" disabled={!text.trim()}>Add</button>
      </form>
      {sync && <p style={{ ...row, flexWrap: 'wrap', margin: 0, fontSize: 12, color: sync.state === 'failing' ? 'var(--hub-red)' : 'var(--hub-ash)' }} title={sync.why}>
        {SYNC[sync.state]}{sync.why ? `: ${sync.why}` : ''}
      </p>}
      {sync?.canSync && (sync.optIn || sync.state === 'local') && <label className="hub-check" style={{ ...row, fontSize: 12, color: 'var(--hub-ash)', cursor: 'pointer' }}
        title="Pushes this list to origin on refs/switchboard/todo, so other devices see it. Private repos sync by themselves.">
        <input type="checkbox" checked={!!sync.optIn} onChange={() => send({ type: 'hub-todo-sync', path: folder, on: !sync.optIn })} />
        Sync this project
      </label>}
      {sync?.remote && <p style={{ ...row, flexWrap: 'wrap', margin: 0, fontSize: 12, color: 'var(--hub-ash)' }}>
        <span style={{ flex: '1 1 200px' }}>The list on origin cannot be read, so sync is stopped. Replacing it pushes only this list.</span>
        <button type="button" className="hub-btn sm"
          onClick={() => { if (replacing) { setReplacing(false); send({ type: 'hub-todo-replace', path: folder, remote: sync.remote! }) } else setReplacing(true) }}>
          {replacing ? 'Press again to overwrite origin\'s copy' : 'Replace the remote list with this one'}
        </button>
      </p>}

    </section>
  )
}
