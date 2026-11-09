'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { clearDraft, getDraft, setDraft } from '@/lib/drafts'

/**
 * A text box value that survives re-renders, chat switches, reloads and killed tabs.
 * clear() empties the box and drops the saved copy at once, so a reopen or reload never brings back sent text.
 * A failed send puts its text back from memory (message-box), which saves it again.
 * restored is true while the box shows a draft from before and nothing has been typed.
 */
export function useDraft(key: string): [string, (v: string) => void, () => void, boolean] {
  const [value, setValue] = useState('')
  const [restored, setRestored] = useState(false)
  const pending = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const keyRef = useRef(key)

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    if (pending.current !== null) setDraft(keyRef.current, pending.current)
    pending.current = null
  }, [])

  useEffect(() => {
    keyRef.current = key
    const v = getDraft(key)
    setValue(v)
    setRestored(!!v)
    const hide = () => { if (document.visibilityState === 'hidden') flush() }
    addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', hide)
    return () => { flush(); removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', hide) }
  }, [key, flush])

  const set = useCallback((v: string) => {
    setValue(v)
    setRestored(false)
    pending.current = v
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 300)
  }, [flush])

  const clear = useCallback(() => {
    pending.current = null
    clearTimeout(timer.current)
    clearDraft(keyRef.current)
    setValue('')
    setRestored(false)
  }, [])

  return [value, set, clear, restored]
}
