'use client'
import { useEffect, useRef } from 'react'
import type { LimitPause } from '@/lib/hub-types'
import { pauseLine, type Meter } from '@/lib/limits'

/** Usage detail from the Agents board: each window with its percent and reset, and the pause line while one holds. */
export function UsageDialog({ meters, pause, onClose }: { meters: Meter[]; pause?: LimitPause; onClose: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null)
  useEffect(() => { dlg.current?.showModal() }, [])
  return (
    <dialog ref={dlg} className="hub hub-dark" aria-label="Usage and limits" onClose={onClose} onClick={e => { if (e.target === dlg.current) dlg.current?.close() }}
      style={{ margin: 'auto', width: 'min(420px, calc(100vw - 32px))', padding: 16, border: '1px solid var(--hub-hair)', borderRadius: 12, background: 'var(--hub-surface)', color: 'var(--hub-body)' }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 15, color: 'var(--hub-ink)' }}>Usage and limits</h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
        {meters.map(m => (
          <li key={m.kind} className="hub-limit" data-level={m.level} style={{ display: 'grid', gap: 4, whiteSpace: 'normal' }}>
            <span style={{ display: 'flex', justifyContent: 'space-between' }}><b>{m.label}</b><span>{m.level === 'out' ? 'out' : m.percent === undefined ? 'no data' : `${m.percent}%`}</span></span>
            <span aria-hidden style={{ height: 4, borderRadius: 2, background: 'var(--hub-hair)', overflow: 'hidden' }}><b style={{ display: 'block', height: '100%', background: 'currentColor', transform: `scaleX(${Math.min(100, m.percent ?? 0) / 100})`, transformOrigin: 'left' }} /></span>
            {m.reset && <span style={{ color: 'var(--hub-ash)' }}>{m.reset}</span>}
          </li>
        ))}
      </ul>
      {pause && <p style={{ margin: '12px 0 0', color: 'var(--hub-yellow)' }}>{pauseLine(pause)}</p>}
      <button type="button" className="hub-btn" style={{ marginTop: 14 }} onClick={() => dlg.current?.close()}>Close</button>
    </dialog>
  )
}
