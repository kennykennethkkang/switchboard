'use client'
// To-do: chips up top, then Decide, Running, one Queue grouped by project, Waiting and Done.
import { useContext, useEffect, useId, useState, type ReactNode } from 'react'
import { useDraft } from '@/hooks/use-draft'
import type { ArchivedChat, ChatRow, TodoList, WindowInfo } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { autopilot, moved, ordered, runTargets } from '@/lib/todo'
import { closedOf, countA, splitA, splitKnown, rowsOf, stepTo, toggled, type Row, type Section } from '@/lib/todo-layout'
import { shownProjects } from '@/lib/todo-view'
import { baseName } from '@/lib/path'
import { panel, caps } from './look'
import { ItemRow, Shipped } from './todo-rows'
import { ForceOpen } from './plan-page'
import { MAX, refocus, useTodoOps, type Ops } from './todo-ops'
import './todo-panel.css'

type Props = {
  folder: string; todos: Record<string, TodoList>; chats: ChatRow[]; windows?: WindowInfo[]; archive?: ArchivedChat[]
  /** The global Auto-start, which a project's own Auto-run overrides. */
  autoStart?: boolean
  /** Project folders the app lists; a to-do list outside them shows under Other folders. */
  known?: string[]
  send: (c: HubCommand) => void
}
const SYNC = { synced: 'Synced across your devices', local: 'Only on this Mac', failing: 'Sync failing' } as const
const CLOSED_KEY = 'switchboard.todo.closed'
const SECTIONS: Array<[Section, string]> = [['decide', 'Decide'], ['running', 'Running'], ['queue', 'Queue'], ['waiting', 'Waiting']]
type Data = ReturnType<typeof rowsOf>
type Fold = { open: (k: Section) => boolean; set: (k: Section, open: boolean) => void; id: (k: Section) => string }
type Ctx = { ops: Ops; todos: Record<string, TodoList>; data: (f: string) => Data; autoStart: boolean; many: boolean; fold: Fold }

/** Collapsed sections, kept on this device. */
function useFold(uid: string): Fold {
  const [closed, setClosed] = useState<string[]>([])
  useEffect(() => { try { setClosed(closedOf(localStorage.getItem(CLOSED_KEY))) } catch { /* storage blocked: all open */ } }, [])
  return {
    open: k => !closed.includes(k),
    set: (k, open) => {
      if (closed.includes(k) !== open) return
      const next = toggled(closed, k)
      setClosed(next)
      try { localStorage.setItem(CLOSED_KEY, JSON.stringify(next)) } catch { /* holds until reload */ }
    },
    id: k => `${uid}-${k}`,
  }
}

export function TodoPanel({ folder, todos, chats, windows, archive, autoStart = false, known, send }: Props) {
  const ops = useTodoOps({ todos, chats, archive, windows, send })
  const now = Date.now(), uid = useId(), fold = useFold(uid)
  const shown = shownProjects(todos, folder, now)
  const { main, other } = splitKnown(shown, known)
  const data = (f: string): Data => {
    const r = rowsOf(todos[f] ?? { todo: [] }, ops.live, now, ops.isSnoozed), keep = (x: Row) => !ops.hidden.has(x.t.id)
    return { ...r, open: r.open.filter(keep), inbox: r.inbox.filter(keep) }
  }
  const ctx: Ctx = { ops, todos, data, autoStart, many: shown.length > 1, fold }
  const n = countA(main.map(data)), none = SECTIONS.every(([k]) => !n[k])
  // A jump opens a collapsed section first, then scrolls once it has rendered.
  const jump = (k: Section) => {
    fold.set(k, true)
    requestAnimationFrame(() => {
      const el = document.getElementById(fold.id(k)), reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
      el?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
      el?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true })
    })
  }
  return <section aria-labelledby={`${uid}-h`} className="tdo tdx" style={panel}>
    <h3 id={`${uid}-h`} style={{ ...caps, flex: 'none' }} title="Work for later, shared by every chat in the project">To-do</h3>
    {none
      ? <p className="tdx-tally">Nothing waiting on you</p>
      : <nav className="tdx-chips" aria-label="Jump to a section">
        {SECTIONS.map(([k, label]) => <button key={k} type="button" className="hub-btn sm" disabled={!n[k]} onClick={() => jump(k)}>{label}<span className="hub-todo-n">{n[k]}</span></button>)}
      </nav>}
    <AddBox ops={ops} folders={shown} folder={folder} />
    {ops.snoozedCount > 0 && <button type="button" className="hub-link tdx-wake" onClick={ops.wake}>{ops.snoozedCount} snoozed. Show {ops.snoozedCount === 1 ? 'it' : 'them'} again</button>}
    {none && <p className="tdx-empty">Nothing here yet. Add something above, or chats will leave work here when they finish.</p>}
    <InboxView folders={main} ctx={ctx} />
    {other.length > 0 && <details className="tdx-other">
      <summary>Other folders<span className="hub-todo-n">{other.length}</span></summary>
      <p className="tdx-meta">Lists for folders that are not one of your projects.</p>
      <InboxView folders={other} ctx={{ ...ctx, fold: { open: () => true, set: () => {}, id: () => '' } }} />
    </details>}
    <SyncFold folders={shown} todos={todos} ops={ops} />
    <p role="status" className="tdx-said">{ops.said}</p>
    {ops.toast && <div role="status" className="hub-todo-toast">
      <span className="hub-todo-toast-msg">{ops.toast}</span>
      <button type="button" className="hub-btn sm" onClick={ops.undoAll}>{ops.undoable.length > 1 ? 'Undo all' : 'Undo'}</button>
    </div>}
  </section>
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** One box for every project: the project picker sits beside it. */
function AddBox({ ops, folders, folder }: { ops: Ops; folders: string[]; folder: string }) {
  const [project, setProject] = useState(folder)
  useEffect(() => setProject(folder), [folder])
  const [text, setText, clearText] = useDraft('todo:new')
  const projects = folders.includes(folder) ? folders : [folder, ...folders]
  const go = () => { if (ops.add(project, text) === 'ok') { clearText(); refocus('[data-add]') } }
  return <form className="tdx-add" onSubmit={e => { e.preventDefault(); go() }}>
    <input className="hub-todo-edit" data-add aria-label="New to-do item" placeholder="Add something to do later" maxLength={MAX} value={text} onChange={e => setText(e.target.value)} enterKeyHint="done" />
    {projects.length > 1 && <select className="hub-select" aria-label="Project for the new item" value={project} onChange={e => setProject(e.target.value)}>
      {projects.map(f => <option key={f} value={f}>{baseName(f)}</option>)}
    </select>}
    <button type="submit" className={`hub-btn sm${text.trim() ? ' primary' : ''}`} disabled={!text.trim()}>Add</button>
    {text.length > MAX * 0.8 && <span className="hub-todo-cap" data-near>{text.length} / {MAX} characters</span>}
  </form>
}

/** Auto-run for one project: the switch, Pause while it is on, and what it does in one line. */
function PilotCtl({ folder, ops, todos, autoStart }: { folder: string; ops: Ops; todos: Record<string, TodoList>; autoStart: boolean }) {
  const uid = useId(), pilot = autopilot(todos[folder] ?? { todo: [] }, autoStart, ops.live)
  return <>
    <span className="tdx-pilot">
      <button type="button" role="switch" className="hub-switch" aria-checked={pilot.on} aria-describedby={`${uid}-h`} onClick={() => ops.setPilot(folder, { on: !pilot.on })}><span aria-hidden />Auto-run</button>
      {pilot.on && <button type="button" className="hub-btn sm" aria-pressed={pilot.paused} onClick={() => ops.setPilot(folder, { paused: !pilot.paused })}>{pilot.paused ? 'Resume' : 'Pause'}</button>}
    </span>
    <span id={`${uid}-h`} className="tdx-meta tdx-note">Auto-run starts the next item in this queue when nothing here is running.</span>
    {pilot.hold && <p className="hub-hold tdx-note" data-kind={pilot.hold.kind}>{pilot.hold.text}</p>}
  </>
}
const pausedTag = (folder: string, ctx: Ctx) => autopilot(ctx.todos[folder] ?? { todo: [] }, ctx.autoStart, ctx.ops.live).paused && <span className="tdx-tag" data-k="paused">Paused</span>
/** The id auto-run starts first, so its row is tagged Next. */
const nextId = (folder: string, ctx: Ctx) => autopilot(ctx.todos[folder] ?? { todo: [] }, ctx.autoStart, ctx.ops.live).starts.find(id => !ctx.ops.busy.has(id))

function Block({ k, title, n, hint, fold, children }: { k: Section; title: string; n: number; hint?: string; fold: Fold; children: ReactNode }) {
  // Forced open (narrow Plan, headers hidden): the saved fold choice stays untouched.
  const force = useContext(ForceOpen)
  return <details id={fold.id(k) || undefined} data-sec={k} className="tdx-block" open={force || fold.open(k)} onToggle={e => { if (!force) fold.set(k, e.currentTarget.open) }}>
    <summary className="tdx-h">{title}<span className="hub-todo-n">{n}</span>{hint && <span className="tdx-keys">{hint}</span>}</summary>
    {children}
  </details>
}

function Done({ folder, rows, ops, older }: { folder: string; rows: Data['done']; ops: Ops; older?: number }) {
  if (!rows.length) return null
  return <details className="tdo-fold" data-sec="done" data-proj={baseName(folder)}>
    <summary>{baseName(folder)}: {rows.length} done this week{rows.some(t => 'shipped' in t && t.shipped) ? ', some by commit' : ''}</summary>
    <ul role="list" aria-label={`${baseName(folder)}: done`} className="tdo-list">{rows.map(t => <Shipped key={t.id} t={t} onBack={() => ops.restore(folder, t.id)} />)}</ul>
    {!!older && <p className="tdo-foot">{older} older done {older === 1 ? 'item' : 'items'} hidden</p>}
  </details>
}
const olderOf = (l: TodoList | undefined, shown: number) => Math.max(0, (l?.ticked?.length ?? 0) - shown)

function InboxView({ folders, ctx }: { folders: string[]; ctx: Ctx }) {
  const { ops, data, many, fold } = ctx
  const per = folders.map(f => ({ f, d: data(f), a: splitA(data(f)) }))
  const pick = (k: 'decide' | 'running' | 'waiting') => per.flatMap(({ f, a }) => a[k].map(r => ({ f, r })))
  const decide = pick('decide'), running = pick('running'), waiting = pick('waiting')
  return <>
    {decide.length > 0 && <Block k="decide" title="Decide" n={decide.length} hint="Select a row: 1 Accept, 2 Decline, H Snooze" fold={fold}>
      <ul role="list" aria-label="Decide" className="tdx-list">{decide.map(({ f, r }) => <ItemRow key={r.t.id} folder={f} row={r} ops={ops} project={many} keys />)}</ul>
    </Block>}
    {running.length > 0 && <Block k="running" title="Running" n={running.length} fold={fold}>
      <ul role="list" aria-label="Running" className="tdx-list">{running.map(({ f, r }) => <ItemRow key={r.t.id} folder={f} row={r} ops={ops} project={many} />)}</ul>
    </Block>}
    {per.some(p => p.a.queue.length > 0) && <Block k="queue" title="Queue" n={sum(per.map(p => p.a.queue.length))} fold={fold}>
      {per.filter(p => p.a.queue.length > 0).map(({ f, d, a }) => <QueueGroup key={f} folder={f} rows={a.queue} all={d.open} ctx={ctx} />)}
    </Block>}
    {waiting.length > 0 && <Block k="waiting" title="Waiting" n={waiting.length} fold={fold}>
      <ul role="list" aria-label="Waiting" className="tdx-list">{waiting.map(({ f, r }) => <ItemRow key={r.t.id} folder={f} row={r} ops={ops} project={many} />)}</ul>
    </Block>}
    {per.map(({ f, d }) => <Done key={f} folder={f} rows={d.done} ops={ops} older={olderOf(ctx.todos[f], d.done.length)} />)}
    <Idle folders={per.filter(p => !p.a.queue.length).map(p => p.f)} ctx={ctx} />
  </>
}

/** Projects with nothing queued fold into one line; each keeps its Auto-run switch inside. */
function Idle({ folders, ctx }: { folders: string[]; ctx: Ctx }) {
  if (!folders.length) return null
  return <details className="tdo-fold" data-sec="queue">
    <summary>{folders.length} {folders.length === 1 ? 'project' : 'projects'} with nothing queued: {folders.map(baseName).join(', ')}</summary>
    {folders.map(f => <div key={f} className="tdx-lanehead" data-quiet><span className="tdx-pname">{baseName(f)}</span><PilotCtl folder={f} ops={ctx.ops} todos={ctx.todos} autoStart={ctx.autoStart} /></div>)}
  </details>
}

const Up = ({ down }: { down?: boolean }) => <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={down ? { transform: 'rotate(180deg)' } : undefined}><path d="M3 7.5 6 4.5l3 3" /></svg>

/** One project's queue. A mouse drags the grip (arrow keys work on it too); touch gets Move up and Move down. */
function QueueGroup({ folder, rows, all, ctx }: { folder: string; rows: Row[]; all: Row[]; ctx: Ctx }) {
  const { ops } = ctx
  const [order, setOrder] = useState<string[] | null>(null), [drag, setDrag] = useState<{ id: string; over?: number } | null>(null)
  const topAll = all.filter(r => r.depth === 0 && r.t.why !== 'you').map(r => r.t.id)
  // The order just moved shows until the list comes back in it.
  const byId = new Map(rows.map(r => [r.t.id, r]))
  const shownRows = order ? ordered(rows.map(r => r.t).sort((a, b) => (order.indexOf(a.id) + 1 || 1e6) - (order.indexOf(b.id) + 1 || 1e6))).map(({ t, depth }) => ({ ...byId.get(t.id)!, depth })) : rows
  const shownTop = shownRows.filter(r => !r.depth).map(r => r.t.id), cur = order ?? topAll
  useEffect(() => {
    if (!order) return
    if (topAll.join() === order.filter(id => topAll.includes(id)).join()) { setOrder(null); return }
    const t = setTimeout(() => setOrder(null), 10_000); return () => clearTimeout(t)
  }, [topAll.join(), order])
  const move = (id: string, to: number) => {
    const ids = moved(cur, id, to)
    if (ids.join() === cur.join()) return
    setOrder(ids); ops.move(folder, ids)
  }
  const step = (id: string, dir: -1 | 1) => { const to = stepTo(cur, shownTop, id, dir); if (to !== undefined) move(id, to) }
  const overAt = (x: number, y: number) => {
    const li = document.elementFromPoint(x, y)?.closest<HTMLElement>('li[data-top]')
    return li ? cur.indexOf(li.dataset.top!) : undefined
  }
  const next = nextId(folder, ctx), targets = runTargets(ops.chats, folder), pos = (id: string) => cur.indexOf(id)
  // trailing dots and spaces would double up before ". Arrow keys"
  const title = (r: Row) => (r.t.short ?? r.t.text).trim().replace(/[\s.]+$/, '')
  const grip = (r: Row) => <button type="button" className="tdx-grip" data-grip={r.t.id} aria-label={`Move ${title(r)}. Arrow keys move it up or down.`} title="Drag to reorder"
    onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setDrag({ id: r.t.id }) }}
    onPointerMove={e => { if (drag?.id === r.t.id) { const over = overAt(e.clientX, e.clientY); if (over !== undefined && over !== drag.over) setDrag({ id: r.t.id, over }) } }}
    onPointerUp={() => { if (drag?.id === r.t.id && drag.over !== undefined) move(r.t.id, drag.over); setDrag(null) }}
    onPointerCancel={() => setDrag(null)}
    onKeyDown={e => {
      const dir = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
      if (!dir) return
      e.preventDefault(); step(r.t.id, dir); refocus(`[data-grip="${r.t.id}"]`)
    }}>
    <svg aria-hidden width="10" height="14" viewBox="0 0 10 14" fill="currentColor">{[0, 5, 10].flatMap(y => [<circle key={`a${y}`} cx="2" cy={y + 2} r="1.3" />, <circle key={`b${y}`} cx="8" cy={y + 2} r="1.3" />])}</svg>
  </button>
  // After a move focus stays on the same button, or the other one once it hits an end.
  const moves = (r: Row) => {
    const i = shownTop.indexOf(r.t.id), at = `[data-moves="${r.t.id}"]`
    const go = (dir: -1 | 1) => {
      step(r.t.id, dir)
      requestAnimationFrame(() => (document.querySelector<HTMLElement>(`${at} [data-dir="${dir}"]:not(:disabled)`) ?? document.querySelector<HTMLElement>(`${at} button:not(:disabled)`))?.focus())
    }
    return shownTop.length > 1 && <span className="tdx-moves" data-moves={r.t.id}>
      <button type="button" className="hub-btn sm" data-dir={-1} disabled={i === 0} aria-label={`Move up: ${title(r)}`} title="Move up" onClick={() => go(-1)}><Up /></button>
      <button type="button" className="hub-btn sm" data-dir={1} disabled={i === shownTop.length - 1} aria-label={`Move down: ${title(r)}`} title="Move down" onClick={() => go(1)}><Up down /></button>
    </span>
  }
  return <div className="tdx-group" data-proj={baseName(folder)}>
    <div className="tdx-lanehead">
      <span className="tdx-pname">{baseName(folder)}{pausedTag(folder, ctx)}<span className="tdx-meta">{rows.length} queued{topAll.length > 1 && <span className="tdx-dragnote"> · drag to reorder</span>}</span></span>
      <PilotCtl folder={folder} ops={ops} todos={ctx.todos} autoStart={ctx.autoStart} />
    </div>
    <ul role="list" aria-label={`${baseName(folder)}: queue`} className="tdx-list">
      {shownRows.map(r => <ItemRow key={r.t.id} folder={folder} row={r} ops={ops} project={false} next={r.t.id === next && !r.depth} targets={targets}
        onTop={r.depth === 0 && pos(r.t.id) > 0 ? () => move(r.t.id, 0) : undefined}
        drag={r.depth ? undefined : { grip: grip(r), moves: moves(r), li: { 'data-top': r.t.id, 'data-drag': drag?.id === r.t.id || undefined, 'data-over': drag && drag.id !== r.t.id && drag.over === pos(r.t.id) || undefined } as never }} />)}
    </ul>
  </div>
}

/** How each project's list syncs, folded away until it matters. */
function SyncFold({ folders, todos, ops }: { folders: string[]; todos: Record<string, TodoList>; ops: Ops }) {
  const [replacing, setReplacing] = useState<string | null>(null)
  const rows = folders.filter(f => todos[f]?.sync)
  if (!rows.length) return null
  const bad = rows.some(f => todos[f]!.sync!.state === 'failing' || todos[f]!.sync!.remote)
  return <details className="tdo-fold" open={bad || undefined}>
    <summary>Sync{bad ? ': needs a look' : ''}</summary>
    {rows.map(f => {
      const sync = todos[f]!.sync!
      return <div key={f} className="tdx-sync">
        <div className="hub-todo-sync" style={{ color: sync.state === 'failing' ? 'var(--hub-red)' : 'var(--hub-ash)' }}>
          <span title={sync.why} style={{ flex: '1 1 auto', minWidth: 0 }}>{baseName(f)}: {SYNC[sync.state]}{sync.why ? `: ${sync.why}` : ''}</span>
          {sync.canSync && (sync.optIn || sync.state === 'local') && <label className="hub-check" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--hub-ash)' }}
            title="Keeps this list on origin, off every branch, so your other devices see it. Private repos sync by themselves.">
            <input type="checkbox" checked={!!sync.optIn} onChange={() => ops.send({ type: 'hub-todo-sync', path: f, on: !sync.optIn })} />
            Sync this project
          </label>}
        </div>
        {sync.remote && <p className="hub-todo-sync">
          <span style={{ flex: '1 1 200px' }}>The list on origin cannot be read, so sync is stopped. Replacing it pushes only this list.</span>
          <button type="button" className="hub-btn sm" onClick={() => { if (replacing === f) { setReplacing(null); ops.send({ type: 'hub-todo-replace', path: f, remote: sync.remote! }) } else setReplacing(f) }}>
            {replacing === f ? 'Press again to overwrite origin\'s copy' : 'Replace the remote list with this one'}
          </button>
        </p>}
      </div>
    })}
  </details>
}
