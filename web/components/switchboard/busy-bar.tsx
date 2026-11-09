'use client'

// Thin bar across the top while any command is out or the extension says it is busy.
import { useSyncExternalStore } from 'react'
import { pending } from '@/hooks/in-flight'

export function BusyBar() {
  const busy = useSyncExternalStore(pending.subscribe, pending.busy, () => false)
  return <div className="hub-busy-bar" data-on={busy || undefined} role="progressbar" aria-label="Working" aria-hidden={!busy} />
}
