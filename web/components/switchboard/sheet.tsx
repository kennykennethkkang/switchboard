'use client'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

/** A modal panel over the page, a native dialog so focus stays inside and Esc works from anywhere.
 *  The close button or a press on the backdrop closes it too; focus goes back to what opened it. */
export function Sheet({ title, wide, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  const [was] = useState(() => typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null)
  const box = useRef<HTMLDialogElement>(null)
  const head = useId()
  // An Escape a menu or field inside already used (preventDefault) only backs out of that, not the sheet.
  const used = useRef(false)
  useEffect(() => {
    const d = box.current
    if (!d) return
    if (!d.open) d.showModal()
    // showModal lands on Close; the first field is what a sheet is opened for.
    d.querySelector<HTMLElement>('[autofocus], input, textarea, select, button:not([data-close])')?.focus()
    return () => { d.close(); was?.focus?.() }
  }, [was])
  return (
    <dialog ref={box} role="dialog" aria-modal="true" aria-labelledby={head} className={`hub-sheet${wide ? ' wide' : ''}`}
      onKeyDown={e => { if (e.key === 'Escape' && e.defaultPrevented) { used.current = true; setTimeout(() => { used.current = false }) } }}
      onCancel={e => { e.preventDefault(); if (!used.current) onClose() }}
      // A press on the dialog itself, not its content, is on the backdrop.
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="hub-sheet-in">
        <div className="hub-sheet-h">
          <h2 id={head}>{title}</h2>
          <button type="button" className="hub-btn icon" data-close aria-label={`Close ${title}`} onClick={onClose}>
            <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8" /></svg>
          </button>
        </div>
        <div className="hub-sheet-b">{children}</div>
      </div>
    </dialog>
  )
}
