'use client'
// The center picture in the style this viewer picked: Orbit (the default), Relay, Lanes, Constellation or Deck.
// Same props as Orbit; the pick lives in localStorage like the tool-calls switch.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ChatProgress } from '@/lib/hub-types'
import { VIEWS, VIEW_KEY, parseView, type View } from '@/lib/orbit-views'
import { Orbit } from '../orbit'
import { Relay } from './relay'
import { Lanes } from './lanes'
import { Constellation } from './constellation'
import { Deck } from './deck'
import type { ViewProps } from './parts'
import { RoleDrawer, type DrawerProps } from './drawer'
import './orbits.css'

const TITLE: Record<View, string> = { orbit: 'Orbit', relay: 'Relay', lanes: 'Lanes', constellation: 'Constellation', deck: 'Deck' }
const PICTURE = { relay: Relay, lanes: Lanes, constellation: Constellation, deck: Deck }
// Where Desk shows its right rail, the drawer takes the rail's place and the picture keeps its width.
// With no rail it sits beside the picture from this width (the picture stays over 540px); narrower, it is a bottom sheet.
const SIDE_MIN = 900
type Place = 'rail' | 'side' | 'sheet'
// The rail is a side column only while it sticks; stacked under the chat (or on a phone) it is static.
const railOf = () => {
  const el = document.querySelector<HTMLElement>('.desk-right')
  return el && getComputedStyle(el).position === 'sticky' ? el : null
}

/** all: every chat's progress, for the time left; demo: the drawer shows sample runs; onFocus, onCopy: its actions. */
type Props = Omit<ViewProps, 'pick' | 'picked'> & { all?: ChatProgress[]; demo?: boolean } & Partial<Pick<DrawerProps, 'onFocus' | 'onCopy'>>

export function OrbitView({ all = [], demo, onFocus, onCopy, ...props }: Props) {
  const [view, setView] = useState<View>('orbit')
  const group = useRef<HTMLDivElement>(null), root = useRef<HTMLDivElement>(null)
  const [picked, setPicked] = useState<string>()
  const [place, setPlace] = useState<Place>('side')
  const [rail, setRail] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const el = root.current
    if (!el) return
    const measure = () => {
      const r = railOf()
      setRail(r)
      setPlace(r ? 'rail' : el.clientWidth >= SIDE_MIN ? 'side' : 'sheet')
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [])
  // The rail's own content steps aside while the drawer holds it.
  const inRail = !!picked && place === 'rail' && !!rail
  useEffect(() => {
    if (!inRail || !rail) return
    rail.setAttribute('data-drawer', '')
    return () => rail.removeAttribute('data-drawer')
  }, [inRail, rail])
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
  const pick = (v: View, focus = false) => {
    setView(v)
    try { localStorage.setItem(VIEW_KEY, v) } catch { /* no storage */ }
    if (focus) group.current?.querySelector<HTMLElement>(`[data-v="${v}"]`)?.focus()
  }
  // Arrows move the choice, as a radio group does; Home and End jump to the ends.
  const keys = (e: KeyboardEvent) => {
    const i = VIEWS.indexOf(view), n = VIEWS.length
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
    if (to < 0) return
    e.preventDefault(); pick(VIEWS[to], true)
  }
  const Picture = view === 'orbit' ? null : PICTURE[view]
  const v = { ...props, pick: pickRole, picked }
  const drawer = picked && <RoleDrawer chat={props.chat} role={picked} all={all} demo={demo} sheet={!side} onClose={close} onFocus={onFocus} onCopy={onCopy} />
  return (
    <div ref={root} className="ov">
      <div ref={group} role="radiogroup" aria-label="Picture style" className="ov-seg hub-seg" onKeyDown={keys}>
        {VIEWS.map(v => <button key={v} type="button" role="radio" data-v={v} aria-checked={v === view} tabIndex={v === view ? 0 : -1} onClick={() => pick(v)}>{TITLE[v]}</button>)}
      </div>
      {/* A new style or chat fades in; picked from the keyboard (instant), it just swaps. */}
      <div className="ov-split" data-side={picked && place === 'side' ? '' : undefined}>
        <div className="ov-pic">
          {Picture ? <div key={`${view}:${props.chat.id}`} className="ov-fade" data-instant={props.instant || undefined}><Picture {...v} /></div>
            : <Orbit {...v} />}
        </div>
        {picked && !inRail && drawer}
      </div>
      {inRail && createPortal(drawer, rail!)}
    </div>
  )
}
