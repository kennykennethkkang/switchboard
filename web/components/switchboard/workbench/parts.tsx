'use client'
import { useEffect, useRef, useState } from 'react'
import type { HubState } from '@/lib/hub-types'
import { AREA_WORD, isStale, STATUS_WORD, undoPlan, whenWord, type ActionState, type Area, type Change, type ChangeStatus, type ReportAction } from '@/lib/workbench'
import { actionsOf, apply, clearNote, feedWorkbench, idOf, isSample, reset, select, skip, start, undo, useWorkbench } from '@/lib/workbench-store'
import './workbench.css'

export type Act = ReportAction & { state: ActionState }
type Src = { report: string; question: string }

export const Chip = ({ area }: { area: Area }) => <span className="wb-chip" data-area={area}>{AREA_WORD[area]}</span>

export const Safety = ({ ask }: { ask: boolean }) => ask
  ? <span className="wb-safe" data-ask><svg aria-hidden width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2.5 14 13H2zM8 6.5v3M8 11.3h.01" /></svg>Asks first</span>
  : <span className="wb-safe"><svg aria-hidden width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.5v3h3" /></svg>Undoable</span>

export const Badge = ({ state, stale }: { state: ActionState | ChangeStatus; stale?: boolean }) =>
  <span className="wb-badge" data-state={stale ? 'failed' : state}><i aria-hidden />{stale ? 'Unfinished' : STATUS_WORD[state]}</span>

/** Feeds the store. Mount once in the shell. */
export function WorkbenchSignal({ adjust, path }: { adjust?: HubState['adjust']; path?: string }) {
  useEffect(() => feedWorkbench(adjust, path), [adjust, path])
  return null
}

export function DeviceStrip() {
  const { device } = useWorkbench()
  if (!device) return null
  return <p className="wb-device"><svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3.5h10v7H3zM1.5 12.5h13" /></svg><span>{device}</span></p>
}

/** Starts a Workbench chat. */
export function Composer() {
  const s = useWorkbench()
  const [text, setText] = useState('')
  const id = 'wb-ask'
  return (
    <form className="wb-composer" onSubmit={e => { e.preventDefault(); if (text.trim()) { start(text); setText('') } }}>
      <label htmlFor={id}>What should change on this Mac?</label>
      <div className="wb-composer-row">
        <input id={id} value={text} onChange={e => setText(e.target.value)} placeholder="For example: free up disk space, or make the terminal start faster" autoComplete="off" />
        <button type="submit" className="wb-btn is-primary" disabled={!text.trim()}>Start chat</button>
      </div>
      {s.note && <p className="wb-note" role="status">{s.note} <button type="button" className="wb-link" onClick={clearNote}>Dismiss</button></p>}
    </form>
  )
}

/** Undo with an inline confirm that shows exactly what will run. */
export function UndoButton({ c, compact }: { c: Change; compact?: boolean }) {
  const s = useWorkbench()
  const [ask, setAsk] = useState(false)
  const said = s.said?.id === c.id ? s.said.text : undefined
  const changed = !!said && /refusing changed file/.test(said)
  const keep = useRef<HTMLButtonElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const was = useRef(false)
  useEffect(() => {
    if (ask) { keep.current?.focus(); keep.current?.closest('.wb-confirm')?.scrollIntoView({ block: 'nearest' }) }
    else if (was.current) trigger.current?.focus()
    was.current = ask
  }, [ask])
  if (c.noUndo) return <p className="wb-noundo">Cannot be undone. {c.noUndo}</p>
  if (c.status === 'undone') return null
  if (s.undoing[c.id]) return <span className="wb-working" role="status">Undoing</span>
  return (
    <div className="wb-undo-wrap" data-compact={compact || undefined}>
      <button ref={trigger} type="button" className="wb-btn" aria-expanded={ask} onClick={() => setAsk(a => !a)}>Undo</button>
      {said && <p className="wb-problem" role="status">{changed ? 'Not undone: the file changed after this change.' : `Not undone: ${said}`}</p>}
      {ask && <div className="wb-confirm" role="group" aria-label={`Undo ${c.title}`} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setAsk(false) } }}>
        <p>Undo will run, in this order:</p>
        <ol>{undoPlan(c).map((l, i) => <li key={i}><code>{l}</code></li>)}</ol>
        <small>{changed ? 'The file has newer edits. Undo anyway puts the old file back and keeps a copy of the newer one.' : 'It stops if a file changed after this change.'}</small>
        <div className="wb-acts">
          <button type="button" className="wb-btn is-danger" onClick={() => { undo(c.id, changed); setAsk(false) }}>{changed ? 'Undo anyway' : 'Run undo'}</button>
          <button ref={keep} type="button" className="wb-btn" onClick={() => setAsk(false)}>Keep it</button>
        </div>
      </div>}
    </div>
  )
}

/** One suggested change. `open` shows the detail lines; collapsed shows the title row and buttons only. */
export function ActionCard({ src, a, open = true, selected, onSelect, showFrom = true }: { src: Src; a: Act; open?: boolean; selected?: boolean; onSelect?: () => void; showFrom?: boolean }) {
  const s = useWorkbench()
  const [sure, setSure] = useState(false)
  const change = s.changes.find(c => c.report === src.report && c.action === a.key)
  const starting = !!s.starting[idOf(src.report, a.key)]
  const live = a.state === 'open' || starting
  const go = () => { if (a.ask && !sure) setSure(true); else { setSure(false); apply(src.report, [a.key]) } }
  const label = a.area === 'project' ? 'Start chat' : a.state === 'undone' || a.state === 'failed' ? 'Apply again' : 'Apply'
  return (
    <article className="wb-card" data-state={a.state} data-sel={selected || undefined} aria-label={a.title}>
      <div className="wb-card-top">
        <h3>{onSelect ? <button type="button" className="wb-title-btn" aria-expanded={open} onClick={onSelect}>{a.title}</button> : a.title}</h3>
        {a.state !== 'new' && <Badge state={a.state} stale={change && isStale(change)} />}
      </div>
      <p className="wb-meta"><Chip area={a.area} />{a.area !== 'project' && <Safety ask={a.ask} />}{a.cites.length > 0 && <span className="wb-cites">Sources {a.cites.join(', ')}</span>}</p>
      {open && <>
        <p className="wb-detail">{a.detail}</p>
        <p className="wb-undo">{a.area === 'project' ? 'Starts a chat in that project; its own git history is the undo.' : a.ask ? 'Cannot be undone. The chat asks before it runs.' : a.undo ? <>Undo: {a.undo}</> : 'The chat saves an undo before it changes anything.'}</p>
        {showFrom && <p className="wb-from">From the report: {src.question}</p>}
      </>}
      <div className="wb-acts">
        {(a.state === 'new' || a.state === 'undone' || a.state === 'failed') && !starting && !sure && <>
          <button type="button" className="wb-btn is-primary" onClick={go}>{label}</button>
          {a.state === 'new' && <button type="button" className="wb-btn" onClick={() => skip(src.report, a.key)}>Skip</button>}
        </>}
        {live && <span className="wb-working" role="status">{starting ? 'Starting a chat' : 'Working on it'}</span>}
        {a.state === 'applied' && change && <UndoButton c={change} compact />}
      </div>
      {sure && <div className="wb-confirm" role="group" aria-label={`Apply ${a.title}`} onKeyDown={e => { if (e.key === 'Escape') setSure(false) }}>
        <p>This cannot be undone. {a.detail}</p>
        <div className="wb-acts">
          <button type="button" className="wb-btn is-primary" autoFocus onClick={go}>Apply anyway</button>
          <button type="button" className="wb-btn" onClick={() => setSure(false)}>Not now</button>
        </div>
      </div>}
    </article>
  )
}


export function ApplyAll({ report, list }: { report: string; list: Act[] }) {
  const { starting } = useWorkbench()
  const todo = list.filter(a => a.state === 'new' && !a.ask && a.area !== 'project' && !starting[idOf(report, a.key)]), n = todo.length
  return <button type="button" className="wb-btn" disabled={!n} onClick={() => apply(report, todo.map(a => a.key))}>Apply all undoable ({n})</button>
}

/** The full record of one change: what, where, when, check, and Undo. */
export function ChangeDetail({ c, onChat }: { c: Change; onChat?: (id: string) => void }) {
  return (
    <div className="wb-detail-pane">
      <header className="wb-cd-head">
        <h2>{c.title}</h2>
        <p className="wb-meta"><Chip area={c.area} /><Badge state={c.status} stale={isStale(c)} /><span>{whenWord(c.at)}</span></p>
      </header>
      <dl className="wb-dl">
        <div><dt>Why</dt><dd>{c.why}</dd></div>
        <div><dt>Where</dt><dd><code>{c.target}</code></dd></div>
        <div><dt>When</dt><dd>{new Date(c.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{c.undoneAt ? `, undone ${whenWord(c.undoneAt)}` : ''}</dd></div>
        {c.files.length > 0 && <div><dt>Files</dt><dd><ul className="wb-files">{c.files.map(f => <li key={f.path}><code>{f.path}</code><span>{f.before === null ? 'new file' : f.after === null ? 'moved away' : 'backed up'}</span></li>)}</ul></dd></div>}
        {c.check && <div><dt>Check</dt><dd><code>{c.check.cmd}</code><span className="wb-check" data-ok={c.check.ok}>{c.check.ok ? 'Passed' : 'Failed'}</span><pre>{c.check.out}</pre></dd></div>}
        {c.problem && <div><dt>Problem</dt><dd className="wb-problem">{c.problem}</dd></div>}
        {c.undo && <div><dt>Undo command</dt><dd><code>{c.undo}</code></dd></div>}
      </dl>
      <div className="wb-acts">
        <UndoButton c={c} />
        {c.sessionId && onChat && <button type="button" className="wb-btn" onClick={() => onChat(c.sessionId!)}>Open chat</button>}
      </div>
    </div>
  )
}

/** The Actions block under a research report. Renders nothing when the report has none. */
export function ReportActions({ report }: { report: string }) {
  const s = useWorkbench()
  const list = actionsOf(s, report)
  const sg = s.suggestions.find(x => x.report === report)
  if (!sg || !list.length) return null
  const src = { report, question: sg.question }
  return (
    <section className="wb-actions" aria-labelledby={`wb-act-${report}`}>
      <header>
        <h3 id={`wb-act-${report}`}>Actions<span className="wb-count">{list.length}</span></h3>
        <ApplyAll report={report} list={list} />
      </header>
      <p className="wb-hint">Changes this report suggests. Each one is logged in Workbench.</p>
      <div className="wb-stack">{list.map(a => <ActionCard key={a.key} src={src} a={a} showFrom={false} selected={s.sel === idOf(report, a.key)} onSelect={() => select(idOf(report, a.key))} />)}</div>
    </section>
  )
}

export function ResetSample() {
  if (!isSample()) return null
  return <button type="button" className="wb-link wb-reset" onClick={reset}>Reset sample data</button>
}
