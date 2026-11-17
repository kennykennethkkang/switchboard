import { useEffect, useState, type RefObject } from 'react'

/**
 * Remembers what had focus (read at first render, before showModal moves it) and gives it back on close.
 * With a dialog ref it also shows the dialog modal and closes it; onOpen then places focus inside.
 * No ref: for a panel that is not a native dialog, only the focus return.
 */
export function useDialog(ref?: RefObject<HTMLDialogElement | null>, onOpen?: (d: HTMLDialogElement) => void) {
  const [was] = useState(() => typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null)
  useEffect(() => {
    const d = ref?.current
    if (d && !d.open) { d.showModal(); onOpen?.(d) }
    return () => { d?.close(); was?.focus?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [was])
}
