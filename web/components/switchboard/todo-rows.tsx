'use client'
// Row pieces of the to-do panel: an item and a shipped one.
import { useId, useLayoutEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'
import type { ChatRow, TickedItem, TodoItem, TodoWhy } from '@/lib/hub-types'
import { aiPath, rowCues, type Cue } from '@/lib/todo'
import { isLong, shippedOf, shortSha, titleOf } from '@/lib/todo-view'
import { waitText, type Row } from '@/lib/todo-layout'
import { ago } from '@/lib/look'
import { baseName } from '@/lib/path'
import { Check } from './chat-cards'
import { MAX, refocus, type Ops } from './todo-ops'
import { Start } from './todo-start'
import './todo-rows.css'

export const when = (at: number) => { const a = ago(at); return a === 'now' ? 'just now' : `${a} ago` }

/** Full text: long rows fold to three lines with Show all, nothing is cut mid-word. */
function Text({ text }: { text: string }) {
  const [open, setOpen] = useState(false), long = isLong(text)
  // Show all only when the fold hides something at this width.
  const ref = useRef<HTMLSpanElement>(null), [over, setOver] = useState(false)
  useLayoutEffect(() => { const e = ref.current; if (e && long && !open) setOver(e.scrollHeight > e.clientHeight + 1) }, [text, long, open])
  return <span className="tdo-text">
    <span ref={ref} data-fold={long && !open || undefined}>{text}</span>
    {long && (over || open) && <button type="button" className="hub-link tdo-more" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show all'}</button>}
  </span>
}

export function Shipped({ t, onBack }: { t: TickedItem; onBack: () => void }) {
  const s = shippedOf(t)
  return <li className="tdo-row" data-k="done">
    <span className="tdo-tick" aria-hidden><Check size={10} /></span>
    <div className="tdo-body">
      <Text text={t.text} />
      <span className="tdo-meta">{s
        ? <>Shipped in <code className="tdo-sha">{shortSha(s)}</code> <span className="tdo-subj">{s.subject}</span> · {when(t.at)}</>
        : <>Ticked {t.by ? 'by a chat' : 'by you'} · {when(t.at)}</>}</span>
    </div>
    <button type="button" className="hub-btn sm tdo-act" aria-label={`Undo, put back ${t.text}`} onClick={onBack}>Undo</button>
  </li>
}

const WHY: Record<TodoWhy, string> = { blocked: 'Blocked', you: 'Your step', scope: 'Out of scope', later: 'For later', missed: 'Asked, not covered' }
const day = (at: number) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const Chevron = () => <svg aria-hidden className="tdx-chev" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 4l2.5 2.5L7.5 4" /></svg>

/** Who left it and when; never "a finished chat". */
export const fromText = (t: TodoItem, folder: string, chats: ChatRow[]) => {
  const name = t.name ?? chats.find(c => c.sessionId === t.from)?.name ?? `${baseName(folder)} chat, ${day(t.at)}`
  return `${t.from ? `${t.why ? 'Left by' : 'Added by'} ${name}` : 'Added by you'}, ${when(t.at)}`
}

type RowProps = {
  folder: string; row: Row; ops: Ops
  /** Name the project on the row (lists that mix projects). */
  project?: boolean
  /** The one auto-run starts first. */
  next?: boolean
  /** Suggestions: 1 accepts, 2 declines, H snoozes, arrows move between rows. */
  keys?: boolean
  /** Running chats in the project that the row can be sent to. */
  targets?: ChatRow[]
  onTop?: () => void
  /** Queue rows: the drag handle, Move up and down for touch, and the li's own drag attributes. */
  drag?: { grip: ReactNode; moves?: ReactNode; li: HTMLAttributes<HTMLLIElement> & { 'data-top'?: string } }
}

/** Cues on a row: a waits-on link jumps to the prerequisite row, a running or from chat opens that chat when it is live. */
function Cues({ cues, ops }: { cues: Cue[]; ops: Ops }) {
  const go = (c: Cue) => {
    if (c.k !== 'waits') return ops.jump(c.to!)
    const el = document.querySelector<HTMLElement>(`[data-item="${CSS.escape(c.to!)}"]`)
    el?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    el?.querySelector<HTMLElement>('.tdx-title')?.focus({ preventScroll: true })
  }
  return <span className="tdx-cues">
    {cues.map((c, i) => {
      const link = c.to && (c.k === 'waits' || ops.live(c.to))
      return <span key={`${c.k}${i}`} className="tdx-cue" data-k={c.k}>
        {link ? <button type="button" className="tdx-cue-go" onClick={() => go(c)}>{c.text}</button> : c.text}
      </span>
    })}
  </span>
}

export function ItemRow({ folder, row, ops, project, next, keys, targets = [], onTop, drag }: RowProps) {
  const { t, status, wait } = row
  const uid = useId(), isOpen = ops.open.includes(t.id), busy = ops.busy.has(t.id), editing = ops.editing?.id === t.id
  const cues = rowCues(t, ops.todos[folder] ?? { todo: [] }, ops.chats)
  const [snoozing, setSnoozing] = useState(false)
  const title = titleOf(t), wt = wait && waitText(wait, day), src = fromText(t, folder, ops.chats)
  const chat = status === 'running' ? ops.chats.find(c => c.sessionId === t.chat) : undefined
  const ai = status === 'running' ? aiPath(t.chat, ops.chats, ops.archive) : undefined
  const ok = wait?.why === 'ok'
  // Every held item can still be started by hand, except a step only you can do.
  const startLabel = ok ? 'Approve and run' : wait?.why === 'stopped' ? 'Start again' : wait ? 'Start anyway' : 'Start'
  const canStart = status === 'ready' || (status === 'waiting' && wait?.why !== 'you')

  const key = (e: KeyboardEvent<HTMLLIElement>) => {
    if ((e.target as HTMLElement).closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return
    const li = e.currentTarget, near = () => (li.nextElementSibling ?? li.previousElementSibling) as HTMLElement | null
    const k = e.key.toLowerCase()
    // 1, 2 and H are for suggestions; an approval row in the same list only takes the arrows.
    const sug = status === 'inbox'
    if (sug && k === '1' && !busy) { e.preventDefault(); const n = near(); ops.accept(folder, t); n?.focus() }
    else if (sug && k === '2' && !busy) { e.preventDefault(); const n = near(); ops.decline(folder, t); n?.focus() }
    else if (sug && k === 'h') { e.preventDefault(); setSnoozing(s => !s) }
    else if (k === 'arrowdown' || k === 'arrowup') {
      const to = (k === 'arrowdown' ? li.nextElementSibling : li.previousElementSibling) as HTMLElement | null
      if (to?.hasAttribute('data-decide')) { e.preventDefault(); to.focus() }
    }
  }

  // Closing the snooze choice hands focus back to the Snooze button.
  const shutSnooze = (from: HTMLElement) => { const li = from.closest('li'); setSnoozing(false); requestAnimationFrame(() => li?.querySelector<HTMLElement>('[aria-label^="Snooze:"]')?.focus()) }

  const lead = status === 'inbox' ? <span className="tdx-dot" aria-hidden />
    : <button type="button" className="hub-done tdx-check" aria-label={`Mark ${title} done`} onClick={() => { refocus('[data-add]'); ops.finish(folder, t) }}><span><Check size={10} /></span></button>

  const meta = status === 'inbox' ? [t.why ? WHY[t.why] : '', src].filter(Boolean).join(' · ')
    : status === 'running' ? `Running in "${chat?.name ?? 'a chat'}"${ai ? ` · ${ai}` : ''}`
    : status === 'waiting' ? wt?.detail : src

  if (editing) return <li className="tdx-row" data-status={status}>
    <span className="tdx-dot" aria-hidden />
    <form className="tdx-edit" onSubmit={e => { e.preventDefault(); ops.save() }}>
      <textarea className="hub-todo-edit" aria-label={`Edit ${title}`} aria-describedby={`${uid}-k`} autoFocus maxLength={MAX} value={ops.editing!.text}
        rows={Math.min(8, Math.max(3, Math.ceil(ops.editing!.text.length / 50)))}
        ref={el => { if (el && !el.dataset.placed) { el.dataset.placed = '1'; el.setSelectionRange(0, 0); el.scrollTop = 0 } }}
        onChange={e => ops.setEditing({ ...ops.editing!, text: e.target.value })}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ops.save() }
          if (e.key === 'Escape') { e.stopPropagation(); ops.setEditing(null) }
        }} />
      <span id={`${uid}-k`} className="tdx-hint">Enter saves, Shift Enter adds a line, Esc cancels</span>
      <span className="tdx-edit-acts">
        <button type="submit" className="hub-btn sm primary">Save</button>
        <button type="button" className="hub-btn sm" onClick={() => ops.setEditing(null)}>Cancel</button>
      </span>
    </form>
  </li>

  return <li className="tdx-row" data-status={status} data-wait={wait?.why} data-item={t.id} data-proj={baseName(folder)} data-next={next || undefined} data-open={isOpen || undefined}
    aria-busy={busy || undefined} tabIndex={keys ? 0 : undefined} data-decide={keys ? t.id : undefined} onKeyDown={keys ? key : undefined} {...drag?.li}>
    {drag?.grip}
    {lead}
    <div className="tdx-body">
      <div className="tdx-line">
        {project && <span className="tdx-proj">{baseName(folder)}</span>}
        {next && <span className="tdx-tag" data-k="next">Next</span>}
        {wt && <span className="tdx-tag" data-k={wait!.why}>{wt.label}</span>}
        {status === 'running' && <span className="tdx-tag" data-k="running">Running</span>}
        <button type="button" className="tdx-title" aria-expanded={isOpen} aria-controls={`${uid}-more`} title={t.text}
          onClick={() => ops.toggle(t.id)} onDoubleClick={() => ops.edit(folder, t)}><span>{title}</span><Chevron /></button>
      </div>
      {cues.length > 0 && <Cues cues={cues} ops={ops} />}
      {meta && <span className="tdx-meta">{busy ? 'Starting...' : meta}</span>}
      {isOpen && <div id={`${uid}-more`} className="tdx-more">
        {title !== t.text && <p className="tdx-full">{t.text}</p>}
        {meta !== src && status !== 'inbox' && <span className="tdx-meta">{src}</span>}
        <div className="tdx-tools">
          {status !== 'inbox' && <button type="button" className="hub-link" aria-label={`Edit ${title}`} onClick={() => ops.edit(folder, t)}>Edit</button>}
          {onTop && <button type="button" className="hub-link" onClick={onTop}>Move to top</button>}
          {canStart && targets.length > 0 && <span className="tdx-send">Or send to
            {targets.slice(0, 3).map(c => <button key={c.sessionId} type="button" className="hub-link" onClick={() => ops.run(folder, [t.id], { to: c.sessionId })}>{c.name ?? 'running chat'}</button>)}
          </span>}
        </div>
      </div>}
      {snoozing && <span className="tdx-snooze" role="group" aria-label="Snooze until" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); shutSnooze(e.currentTarget) } }}>
        <span className="tdx-meta">Snooze until</span>
        <button type="button" className="hub-btn sm" autoFocus onClick={() => { setSnoozing(false); ops.snooze(t, 'tomorrow') }}>Tomorrow</button>
        <button type="button" className="hub-btn sm" onClick={() => { setSnoozing(false); ops.snooze(t, 'week') }}>Next week</button>
        <button type="button" className="hub-link" onClick={e => shutSnooze(e.currentTarget)}>Cancel</button>
      </span>}
    </div>
    <div className="tdx-acts">
      {drag?.moves}
      {status === 'inbox' && <>
        <button type="button" className="hub-btn sm tdx-accept" disabled={busy} aria-label={`Accept: ${title}`} title="Add it to the queue" onClick={() => ops.accept(folder, t)}>Accept{keys && <kbd>1</kbd>}</button>
        <button type="button" className="hub-btn sm" disabled={busy} aria-label={`Decline: ${title}`} title="Drop it" onClick={() => ops.decline(folder, t)}>Decline{keys && <kbd>2</kbd>}</button>
        <button type="button" className="hub-btn sm" disabled={busy} aria-label={`Snooze: ${title}`} aria-expanded={snoozing} title="Hide it for a while" onClick={() => setSnoozing(s => !s)}>Snooze{keys && <kbd>H</kbd>}</button>
      </>}
      {status === 'running' && t.chat && <button type="button" className="hub-btn sm" aria-label={`Open chat: ${title}`} onClick={() => ops.jump(t.chat!)}>Open chat</button>}
      {canStart && !busy && <Start folder={folder} label={startLabel} title={title} primary={next || ok}
        onStart={picks => (ok ? ops.approve(folder, t, picks) : ops.run(folder, [t.id], { picks }))} />}
    </div>
  </li>
}
