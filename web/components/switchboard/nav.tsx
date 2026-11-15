'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { isMap, type Page } from '@/lib/route'
import './nav.css'

const Ic = ({ d }: { d: string }) => <svg className="hub-ic" aria-hidden width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
const ICON = {
  find: 'M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM11 11l3.5 3.5',
  now: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM8 4.5V8l2.5 1.5',
  chats: 'M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z',
  plan: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01',
  ship: 'M8 10.5V2.5M4.5 6 8 2.5 11.5 6M3 13.5h10',
  map: 'M8 2v3M8 5 4 9M8 5l4 4M4 9v2.5M12 9v2.5M2.5 13.5h3M10.5 13.5h3',
  settings: 'M6.84 3.34L7.08 1.46L8.92 1.46L9.16 3.34A4.8 4.8 0 0 1 11.45 4.67L13.2 3.94L14.12 5.53L12.61 6.68A4.8 4.8 0 0 1 12.61 9.32L14.12 10.47L13.2 12.06L11.45 11.33A4.8 4.8 0 0 1 9.16 12.66L8.92 14.54L7.08 14.54L6.84 12.66A4.8 4.8 0 0 1 4.55 11.33L2.8 12.06L1.88 10.47L3.39 9.32A4.8 4.8 0 0 1 3.39 6.68L1.88 5.53L2.8 3.94L4.55 4.67A4.8 4.8 0 0 1 6.84 3.34ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
}

type Counts = { needs: number; chats: number; plan: number; ship: number }

/** Left rail of labelled pages; a fixed bottom tab bar at 760px or less. Map holds its three modes. */
export function Nav({ page, go, counts, onFind, findKey }: { page: Page; go: (p: Page) => void; counts: Counts; onFind: () => void; findKey: string }) {
  const items: [Page, string, keyof typeof ICON, number?, boolean?][] = [
    ['now', 'Now', 'now', counts.needs, true],
    ['chats', 'Chats', 'chats', counts.chats],
    ['plan', 'Plan', 'plan', counts.plan],
    ['ship', 'Ship', 'ship', counts.ship],
    ['map-board', 'Map', 'map'],
    ['settings', 'Settings', 'settings'],
  ]
  return (
    <nav className="nav" aria-label="Pages">
      <strong className="hub-brand nav-brand"><i aria-hidden />Switchboard</strong>
      <button type="button" className="nav-find" aria-haspopup="dialog" onClick={onFind} title="Find a chat or a command">
        <Ic d={ICON.find} /><span>Find</span><kbd>{findKey}</kbd>
      </button>
      <ul>
        {items.map(([p, label, icon, n, hot]) => {
          const on = p === page || (p === 'map-board' && isMap(page))
          return <li key={p}>
            <a href={`#${p}`} className="nav-item" aria-current={on ? 'page' : undefined} onClick={e => { e.preventDefault(); go(p) }}>
              <Ic d={ICON[icon]} /><span>{label}</span>
              {!!n && <span className="nav-n" data-hot={hot || undefined}>{n}<span className="sr-only"> {hot ? 'need you' : 'open'}</span></span>}
            </a>
          </li>
        })}
      </ul>
    </nav>
  )
}

const MODES: [Page, string, string][] = [['map-board', 'Agents', 'Agents'], ['map-flow', 'Code', 'Code'], ['map-memory', 'Memory', 'Memory']]

/**
 * Back plus the Agents / Code / Memory switch. The map views are modal dialogs, so the bar is portaled
 * into the open one; outside it, it would be inert.
 */
export function MapBar({ page, go, onBack }: { page: Page; go: (p: Page) => void; onBack: () => void }) {
  const label = MODES.find(m => m[0] === page)?.[2]
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setHost(null)
    const find = () => { const d = document.querySelector<HTMLElement>(`dialog[open][aria-label="${label}"]`); if (d) { setHost(d); mo.disconnect() } }
    // The map dialogs open with showModal, which sets open; watching only that skips every other DOM change.
    const mo = new MutationObserver(find)
    mo.observe(document.body, { subtree: true, attributeFilter: ['open'] })
    find()
    return () => mo.disconnect()
  }, [label])
  if (!host) return null
  return createPortal(
    <div className="map-bar">
      <button type="button" className="map-back" onClick={onBack}>
        <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3 5 8l5 5" /></svg>Back
      </button>
      <div className="map-modes" role="group" aria-label="Map">
        {MODES.map(([p, word]) => <button key={p} type="button" aria-pressed={p === page} onClick={() => go(p)}>{word}</button>)}
      </div>
    </div>,
    host,
  )
}
