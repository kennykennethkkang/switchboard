'use client'
// The Agents picture in the style this viewer picked: Orbit (the default) and Lanes as tabs, Relay, Constellation and Deck under More.
// Same props as Orbit; the pick lives in localStorage like the tool-calls switch.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useDismiss } from '../use-popover'
import type { ChatProgress } from '@/lib/hub-types'
import { VIEW_KEY, parseView, type View } from '@/lib/orbit-views'
import { Orbit } from '../orbit'
import { Relay } from './relay'
import { Lanes } from './lanes'
import { Constellation } from './constellation'
import { Deck } from './deck'
import type { ViewProps } from './parts'
import { RoleDrawer, type DrawerProps } from './drawer'
import { WaitArcs } from './wait-arc'
import type { LinkChip } from '@/lib/wait-links'
import './orbits.css'

const TITLE: Record<View, string> = { orbit: 'Orbit', relay: 'Relay', lanes: 'Lanes', constellation: 'Constellation', deck: 'Deck' }
const TABS = ['orbit', 'lanes'] as const, MORE = ['relay', 'constellation', 'deck'] as const
const PICTURE = { relay: Relay, lanes: Lanes, constellation: Constellation, deck: Deck }
// The drawer sits beside the picture from this width (the picture stays over 540px); narrower, it is a bottom sheet.
const SIDE_MIN = 900
type Place = 'side' | 'sheet'

/** all: every chat's progress, for the time left; demo: the drawer shows sample runs; onFocus, onCopy: its actions. */
type Props = Omit<ViewProps, 'pick' | 'picked'> & { all?: ChatProgress[]; demo?: boolean; links?: LinkChip[] } & Partial<Pick<DrawerProps, 'onFocus' | 'onCopy'>>

export function OrbitView({ all = [], demo, links = [], onFocus, onCopy, ...props }: Props) {
  const [view, setView] = useState<View>('orbit')
  const root = useRef<HTMLDivElement>(null)
  const [picked, setPicked] = useState<string>()
  const [place, setPlace] = useState<Place>('side')
  useEffect(() => {
    const el = root.current
    if (!el) return
    const measure = () => setPlace(el.clientWidth >= SIDE_MIN ? 'side' : 'sheet')
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [])
  const side = place !== 'sheet'
  // Another chat closes it.
  useEffect(() => setPicked(undefined), [props.chat.id])
  // Back to the node it opened from; in another view that is the same role's node there.
  const close = () => {
    const role = picked
    setPicked(undefined)
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-node="${role}"]`)?.focus())
  }
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    if (!picked || !side) return
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('dialog[open]')) closeRef.current() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [picked, side])
  const pickRole = (role: string) => setPicked(r => (r === role ? undefined : role))
  useEffect(() => { try { setView(parseView(localStorage.getItem(VIEW_KEY))) } catch { /* no storage: Orbit */ } }, [])
  const pick = (v: View) => {
    setView(v)
    try { localStorage.setItem(VIEW_KEY, v) } catch { /* no storage */ }
  }
  const Picture = view === 'orbit' ? null : PICTURE[view]
  const v = { ...props, pick: pickRole, picked }
  const drawer = picked && <RoleDrawer chat={props.chat} role={picked} all={all} demo={demo} sheet={!side} onClose={close} onFocus={onFocus} onCopy={onCopy} />
  return (
    <div ref={root} className="ov">
      <div className="ov-head">
        <h3 className="ov-title">Agents</h3>
        <div role="group" aria-label="Picture style" className="ov-seg hub-seg">
          {TABS.map(v => <button key={v} type="button" data-v={v} aria-pressed={v === view} onClick={() => pick(v)}>{TITLE[v]}</button>)}
          <MoreViews view={view} onPick={pick} />
        </div>
      </div>
      {/* A new style or chat fades in; picked from the keyboard (instant), it just swaps. */}
      <div className="ov-split" data-side={picked && place === 'side' ? '' : undefined}>
        <div className="ov-pic">
          {Picture ? <div key={`${view}:${props.chat.id}`} className="ov-fade" data-instant={props.instant || undefined}><Picture {...v} /></div>
            : <Orbit {...v} />}
          {view === 'orbit' && <WaitArcs chatId={props.chat.id} chips={links} />}
        </div>
        {drawer}
      </div>
    </div>
  )
}

/** Relay, Constellation and Deck in a menu; the button names the one picked. Arrows move, Esc closes. */
function MoreViews({ view, onPick }: { view: View; onPick: (v: View) => void }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null), btn = useRef<HTMLButtonElement>(null)
  const close = () => { setOpen(false); btn.current?.focus() }
  useDismiss(open, wrap, () => setOpen(false))
  useEffect(() => {
    if (open) (wrap.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? wrap.current?.querySelector<HTMLElement>('[role="menuitemradio"]'))?.focus()
  }, [open])
  const at = (MORE as readonly string[]).includes(view) ? view : undefined
  const keys = (e: KeyboardEvent) => {
    const all = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])]
    const i = all.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus() }
    else if (e.key === 'Tab') setOpen(false)
  }
  return (
    <span ref={wrap} className="ov-more" onKeyDown={keys}>
      <button ref={btn} type="button" className="ov-more-btn" data-on={at ? '' : undefined} aria-haspopup="menu" aria-expanded={open}
        aria-label={at ? `More styles, ${TITLE[at]} picked` : 'More styles'} onClick={() => setOpen(!open)}>
        {at ? TITLE[at] : 'More'}
        <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 3.5 5 6.5 8 3.5" /></svg>
      </button>
      {open && <span role="menu" aria-label="More picture styles" className="hub-menu ov-menu">
        {MORE.map(v => <button key={v} type="button" role="menuitemradio" aria-checked={v === view} tabIndex={-1} data-v={v} onClick={() => { onPick(v); close() }}>{TITLE[v]}</button>)}
      </span>}
    </span>
  )
}
