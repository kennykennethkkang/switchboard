'use client'
import { useEffect, useId, useRef, useState, type FocusEvent, type PointerEvent as PE, type RefObject } from 'react'

/** While open, Escape or a press outside wrap calls close. */
export function useDismiss(open: boolean, wrap: RefObject<HTMLElement | null>, close: () => void) {
  const shut = useRef(close)
  shut.current = close
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') shut.current() }
    const down = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) shut.current() }
    document.addEventListener('keydown', key)
    document.addEventListener('pointerdown', down)
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', down) }
  }, [open, wrap])
}

/**
 * A hover-or-click popover: a mouse opens it on hover and a click keeps it, a tap or Enter toggles it, keyboard focus opens it.
 * Escape or a press outside closes it from anywhere; the mouse leaving keeps it while the button has focus.
 */
export function usePopover() {
  const [open, setOpen] = useState(false)
  const id = useId()
  const wrapRef = useRef<HTMLSpanElement>(null), btnRef = useRef<HTMLButtonElement>(null), mouse = useRef(false)
  useDismiss(open, wrapRef, () => setOpen(false))
  return {
    open, id,
    wrap: {
      ref: wrapRef,
      // Touch sends pointer enter and leave around every tap; only a mouse hovers.
      onPointerEnter: (e: PE) => { if (e.pointerType === 'mouse') setOpen(true) },
      onPointerLeave: (e: PE) => { if (e.pointerType === 'mouse' && document.activeElement !== btnRef.current) setOpen(false) },
    },
    button: {
      ref: btnRef, 'aria-expanded': open, 'aria-controls': id,
      // Hover already opened it for a mouse, so a mouse click keeps it; a tap or Enter toggles.
      onPointerDown: (e: PE) => { mouse.current = e.pointerType === 'mouse' },
      onClick: () => { const keep = mouse.current; mouse.current = false; setOpen(o => keep || !o) },
      // A mouse press focuses too; only keyboard focus opens it, or the click would toggle it straight back.
      onFocus: (e: FocusEvent<HTMLButtonElement>) => { if (e.currentTarget.matches(':focus-visible')) setOpen(true) },
      onBlur: () => setOpen(false),
    },
  }
}
