'use client'
// Start as a split button: the main press starts with the last pick (at first the gear's Auto pick per task), the arrow opens model and effort.
import { useEffect, useId, useRef, useState } from 'react'
import { runFields, type RunPicks as Picks } from '@/lib/model-effort'
import { ModelEffort } from './model-effort'
import { useDismiss } from './use-popover'
import type { RunPicks } from './todo-ops'

const key = (folder: string) => `switchboard.todo.start.${folder}`
const AUTO: Picks = { auto: true }
// The last pick per project; none stored (or blocked storage) leaves it to the gear.
const read = (folder: string): Picks | undefined => {
  try { const v = JSON.parse(localStorage.getItem(key(folder)) ?? 'null'); return v && typeof v.auto === 'boolean' ? v : undefined } catch { return undefined }
}
const Caret = () => <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 4l2.5 2.5L7.5 4" /></svg>

export function Start({ folder, label, title, primary, onStart }: { folder: string; label: string; title: string; primary?: boolean; onStart: (p: RunPicks) => void }) {
  const [open, setOpen] = useState(false), [v, setV] = useState<Picks>(AUTO), [mine, setMine] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null), caret = useRef<HTMLButtonElement>(null), pop = useRef<HTMLDivElement>(null), id = useId()
  useEffect(() => { const r = read(folder); setV(r ?? AUTO); setMine(!!r) }, [folder])
  useDismiss(open, wrap, () => setOpen(false))
  // Escape or Cancel hand focus back to the arrow; a press outside leaves it where it went.
  const shut = () => { setOpen(false); caret.current?.focus() }
  useEffect(() => { if (open) pop.current?.querySelector<HTMLElement>('select, input, button')?.focus() }, [open])
  // With no pick of its own, auto stays off the command so the extension reads the gear's switch.
  const go = (p: Picks, own = mine) => { const { auto, ...rest } = runFields(p, 'claude'); onStart(own ? { auto, ...rest } : rest) }
  const begin = () => {
    try { localStorage.setItem(key(folder), JSON.stringify(v)) } catch { /* nothing stored */ }
    setMine(true); setOpen(false); go(v, true)
  }
  const how = [v.auto ? 'Auto' : [v.model, v.effort, v.ultracode ? 'ultracode' : ''].filter(Boolean).join(' '), v.advisor ? `${v.advisor} advisor` : ''].filter(Boolean).join(', ')
  return <span ref={wrap} className="tdx-start" onKeyDown={e => { if (open && e.key === 'Escape') { e.stopPropagation(); shut() } }}>
    <button type="button" className={`hub-btn sm tdx-go${primary ? ' primary' : ''}`} aria-label={`${label}: ${title}`} onClick={() => go(v)}>{label}</button>
    <button ref={caret} type="button" className={`hub-btn sm tdx-arrow${primary ? ' primary' : ''}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      aria-label={`Choose model and effort for ${title}. Now ${how}`} title={`Model and effort: ${how}`} onClick={() => setOpen(o => !o)}><Caret /></button>
    {open && <div ref={pop} id={id} role="dialog" aria-label="Start options" className="tdx-pop">
      <ModelEffort ai="claude" value={v} onChange={setV} compact task={title} />
      <span className="tdx-pop-acts">
        <button type="button" className="hub-btn sm primary" onClick={begin}>{label}</button>
        <button type="button" className="hub-btn sm" onClick={shut}>Cancel</button>
      </span>
    </div>}
  </span>
}
