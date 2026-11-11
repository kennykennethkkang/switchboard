'use client'
import type { ReactNode } from 'react'
import type { limitMeters } from '@/lib/limits'
import { plural } from './chat-cards'
import './layout.css'

/** "No dev servers", "Armasu :3000", "3 dev servers". */
const devText = (dev: { running: number; label: string }[]) => {
  const on = dev.filter(d => d.running > 0)
  const n = on.reduce((a, d) => a + d.running, 0)
  return !n ? 'No dev servers' : n === 1 ? on[0].label : plural(n, 'dev server')
}

/** Bottom bar. narrow: one line of meters and the Awake and Calls chips; the rest hides (also under 760px). */
export function StatusBar({ meters, dev, onDev, awake, onAwake, calls, onCalls, phone, ship, narrow }: {
  meters: ReturnType<typeof limitMeters>; dev: { running: number; label: string }[]; onDev: () => void
  awake?: boolean; onAwake: (on: boolean) => void; calls: boolean; onCalls: (on: boolean) => void
  phone?: ReactNode; ship?: ReactNode; narrow?: boolean
}) {
  const on = dev.some(d => d.running > 0)
  return (
    <footer className="sb" data-narrow={narrow || undefined} aria-label="Status">
      <span className="sb-meters">
        {meters.map(m => <span key={m.kind} className="hub-limit" data-level={m.level} title={m.reset || undefined}>
          <i aria-hidden><b style={{ transform: `scaleX(${Math.min(100, m.percent ?? 0) / 100})` }} /></i>
          {m.label} {m.level === 'out' ? 'out' : m.percent === undefined ? 'no data' : `${m.percent}%`}
          {m.reset && <span className="sr-only">, {m.reset}</span>}
        </span>)}
      </span>
      <button type="button" className="sb-btn sb-dev" data-on={on || undefined} onClick={onDev} title="Dev servers: open Ship">
        <i aria-hidden />{devText(dev)}
      </button>
      <span className="sb-end">
        {ship && <span className="sb-slot">{ship}</span>}
        {awake !== undefined && <button type="button" className="sb-btn sb-toggle" aria-pressed={awake} onClick={() => onAwake(!awake)}
          title="Keeps this Mac awake so Switchboard and dev servers answer from anywhere. With the lid closed, only while on power.">
          {awake ? 'Awake' : 'Keep awake'}</button>}
        <button type="button" className="sb-btn sb-toggle" aria-pressed={calls} onClick={() => onCalls(!calls)} title="Phone mode: call me instead of asking in chats">
          {calls ? 'Calls on' : 'Call me'}</button>
        {phone && <span className="sb-slot">{phone}</span>}
      </span>
    </footer>
  )
}
