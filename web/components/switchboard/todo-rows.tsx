'use client'
// Row pieces of the to-do panel: your steps, suggestions and shipped items.
import { useLayoutEffect, useRef, useState } from 'react'
import type { TickedItem, TodoItem } from '@/lib/hub-types'
import { isLong, shippedOf, shortSha } from '@/lib/todo-view'
import { ago } from './look'
import { Check } from './chat-cards'
import './todo-rows.css'

export const when = (at: number) => { const a = ago(at); return a === 'now' ? 'just now' : `${a} ago` }
const X = () => <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3l6 6M9 3l-6 6" /></svg>
const Plus = () => <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M6 2v8M2 6h8" /></svg>

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

/** A hand step: only Kenneth can do it. */
export function YouRow({ t, meta, onDone }: { t: TodoItem; meta: string; onDone: () => void }) {
  return <li className="tdo-row">
    <button type="button" className="hub-done tdo-check" aria-label={`Mark ${t.text} done`} onClick={onDone}><span><Check size={10} /></span></button>
    <div className="tdo-body"><Text text={t.text} /><span className="tdo-meta">{meta}</span></div>
  </li>
}

/** Add and Dismiss as one-tap icon buttons, words for screen readers and on wide screens. */
export function Suggest({ t, meta, busy, onAdd, onDrop }: { t: TodoItem; meta: string; busy?: boolean; onAdd: () => void; onDrop: () => void }) {
  return <li className="tdo-row" data-k="suggest" aria-busy={busy || undefined}>
    <div className="tdo-body"><Text text={t.text} /><span className="tdo-meta">{meta}</span></div>
    <span className="tdo-pair">
      <button type="button" className="hub-btn sm tdo-act" disabled={busy} aria-label={`Add ${t.text} to the list`} onClick={onAdd}><Plus /><span className="tdo-w">{busy ? 'Adding' : 'Add'}</span></button>
      <button type="button" className="hub-btn sm tdo-act tdo-quiet" disabled={busy} aria-label={`Dismiss ${t.text}`} onClick={onDrop}><X /><span className="tdo-w">Dismiss</span></button>
    </span>
  </li>
}
