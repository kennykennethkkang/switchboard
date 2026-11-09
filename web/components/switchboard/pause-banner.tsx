'use client'
import { useEffect, useRef, useState } from 'react'
import type { LimitPause } from '@/lib/hub-types'
import { countdown, resetText } from '@/lib/limits'
import { CARP, CARP_PAL, pixGrid } from '@/lib/sprites/carp'

const KIND: Record<string, string> = { five_hour: 'five-hour', seven_day: 'weekly' }
export const pauseTitle = (p: LimitPause) => `Paused at ${p.percent}% of the ${KIND[p.kind] ?? p.kind} limit`
const held = (n: number) => `${n} chat${n === 1 ? '' : 's'} held`

// The Board's golden carp king, ink ringed to 16x11.
const CARP_PX = pixGrid(CARP, CARP_PAL)
const Carp = () => (
  <svg className="hub-carp" aria-hidden width="24" height="17" viewBox="0 0 16 11" shapeRendering="crispEdges">
    {CARP_PX.flatMap((row, y) => row.map((col, x) => col && <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={col} />))}
  </svg>
)

/** The usage auto pause across the top: why, a live countdown, how many chats wait, and Resume now. Says Resumed for 4 s once it lifts. */
export function PauseBanner({ pause, onResume, onCancel }: { pause?: LimitPause; onResume: () => void; onCancel: () => void }) {
  const last = useRef<LimitPause>(undefined)
  const [resumed, setResumed] = useState<LimitPause>()
  const [, tick] = useState(0)
  useEffect(() => {
    if (pause) { last.current = pause; setResumed(undefined); return }
    if (!last.current) return
    setResumed(last.current); last.current = undefined
    const t = setTimeout(() => setResumed(undefined), 4000)
    return () => clearTimeout(t)
  }, [pause])
  useEffect(() => {
    if (!pause?.resumeAt) return
    const t = setInterval(() => tick(n => n + 1), 15_000)
    return () => clearInterval(t)
  }, [pause?.resumeAt])
  const p = pause ?? resumed
  if (!p) return null
  const now = Date.now(), n = p.chats.length
  return (
    <section className="hub-pause" data-state={pause ? 'paused' : 'resumed'} aria-label="Usage pause">
      <i aria-hidden>{pause
        ? <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="1.5" y="1" width="2.5" height="8" rx="0.8" /><rect x="6" y="1" width="2.5" height="8" rx="0.8" /></svg>
        : <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 5.2 4.2 7.4 8 3" /></svg>}</i>
      <span className="hub-pause-text">
        <strong role="status">{pause ? pauseTitle(pause) : 'Resumed'}</strong>
        <span className="hub-num"><Carp />{pause
          ? [pause.resumeAt && `resumes in ${countdown(pause.resumeAt, now)} · ${resetText(pause.resumeAt, now)}`, held(n)].filter(Boolean).join(' · ')
          : `${n} chat${n === 1 ? '' : 's'} picking up in order`}</span>
      </span>
      {pause && <span className="hub-pause-acts">
        <button type="button" className="hub-btn" onClick={onResume} title="Resume every held chat now, in order">Resume now</button>
        <button type="button" className="hub-btn" onClick={onCancel} title="Drop the pause; held chats stay stopped">Cancel</button>
      </span>}
    </section>
  )
}
