'use client'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { rankItems, type SwitchItem } from '@/lib/switcher'
import { ALMOST, STATE } from './look'

const Marked = ({ text, hits }: { text: string; hits: number[] }) => {
  const on = new Set(hits)
  return <>{[...text].map((ch, i) => (on.has(i) ? <mark key={i}>{ch}</mark> : ch))}</>
}

/** What the switcher lends Jarvis: its text, its input and a slot for Jarvis's ask. */
export type AskBits = { value: string; onValue: (v: string) => void; input: RefObject<HTMLInputElement | null>; askRef: { current?: () => void } }

/** Cmd+K: type part of a name or command, arrows to move, Enter to open, Esc to close. Focus stays in the dialog. */
/** tint: the window color of a result's folder. jarvis: text that is no chat pick offers Ask Jarvis, and the reply shows here. filter: the project chips. */
export function Switcher({ items, tint, onPick, onClose, jarvis, filter }: {
  items: SwitchItem[]; tint?: (item: SwitchItem) => string | undefined; onPick: (item: SwitchItem) => void; onClose: () => void
  jarvis?: (bits: AskBits) => ReactNode; filter?: ReactNode
}) {
  const [was] = useState(() => typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null)
  useEffect(() => () => was?.focus(), [was])
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const askRef = useRef<() => void>(undefined)
  const list = useId()
  const ranked = useMemo(() => rankItems(items, q).slice(0, 50), [items, q])
  const asking = !!jarvis && !!q.trim()
  const n = ranked.length + (asking ? 1 : 0)
  const sel = Math.min(at, Math.max(0, n - 1))
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    input.current?.focus()
    return () => back?.focus?.()
  }, [])
  useEffect(() => { document.getElementById(`${list}-${sel}`)?.scrollIntoView({ block: 'nearest' }) }, [sel, list])
  const ask = () => askRef.current?.()
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (e.key === 'Tab') {
      // Plain Find: the input is the one stop. With Jarvis or the filter, Tab cycles inside the dialog.
      if (!jarvis && !filter) { e.preventDefault(); return }
      const stops = [...e.currentTarget.querySelectorAll<HTMLElement>('input, button:not([disabled]), a[href], summary')]
      const i = stops.indexOf(document.activeElement as HTMLElement)
      if (e.shiftKey ? i <= 0 : i === stops.length - 1) { e.preventDefault(); stops[e.shiftKey ? stops.length - 1 : 0]?.focus() }
      return
    }
    // Arrows and Enter belong to the input; Enter on a chip or Confirm is that button's own.
    if (e.target !== input.current) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setAt((sel + (e.key === 'ArrowDown' ? 1 : -1) + n) % Math.max(1, n)) }
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (ranked[sel]) onPick(ranked[sel].item); else if (asking) ask() }
  }
  const label = jarvis ? 'Find a chat or command, or ask Jarvis' : 'Find a chat or command'
  return (
    <div className="hub-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={label} className="hub-palette" data-ask={jarvis ? '' : undefined} onKeyDown={key}>
        <input ref={input} value={q} onChange={e => { setQ(e.target.value); setAt(0) }} placeholder={jarvis ? label : 'Find a chat or command'}
          role="combobox" aria-expanded="true" aria-controls={list} aria-autocomplete="list" aria-activedescendant={n ? `${list}-${sel}` : undefined} />
        {filter && <div className="pal-filter">{filter}</div>}
        <ul id={list} role="listbox" aria-label="Results" onMouseDown={e => e.preventDefault()}>
          {ranked.map(({ item, hits }, i) => {
            const prev = ranked[i - 1]?.item
            const head = item.kind === 'command' && !(prev?.kind === 'command' && prev.group === item.group)
            return [
              head && <li key={`h:${i}`} role="presentation" className="pal-group" style={{ font: '600 11px/1 var(--hub-mono)', color: 'var(--hub-ash)', cursor: 'default', textTransform: 'uppercase', letterSpacing: '.06em' }}>{item.group}</li>,
              <li key={`${item.kind}:${item.id}`} id={`${list}-${i}`} role="option" aria-selected={i === sel}
                onMouseMove={() => setAt(i)} onClick={() => onPick(item)}>
                {item.kind === 'command' ? <>
                  <span title={item.label} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><Marked text={item.label} hits={hits} /></span>
                  {item.hint && <span style={{ font: '400 12px/1 var(--hub-mono)', color: 'var(--hub-ash)' }}>{item.hint}</span>}
                </> : <>
                  <span title={item.version > 1 ? `${item.name} v${item.version}` : item.name} style={{ display: 'flex', alignItems: 'center', minWidth: 0, whiteSpace: 'nowrap' }}>
                    <i aria-hidden style={{ flex: 'none', width: 3, height: 14, borderRadius: 2, marginRight: 10, background: tint?.(item) ?? 'transparent' }} />
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}><Marked text={item.name} hits={hits} />{item.version > 1 && ' '}</span>
                    {item.version > 1 && <span className="hub-chip ver" style={{ flex: 'none', marginLeft: 6 }}>v{item.version}</span>}
                  </span>
                  {item.kind === 'live'
                    ? (s => <span className="hub-chip" style={{ color: s.color, background: s.soft }}><i aria-hidden />{item.chip ?? s.label}</span>)(item.almost ? ALMOST : STATE[item.state])
                    : <span style={{ font: '400 12px/1 var(--hub-mono)', color: 'var(--hub-ash)' }}>History</span>}
                </>}
              </li>,
            ]
          })}
          {asking && (
            <li id={`${list}-${ranked.length}`} role="option" aria-selected={sel === ranked.length} className="pal-ask"
              onMouseMove={() => setAt(ranked.length)} onClick={ask}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Ask Jarvis: <b>{q.trim()}</b></span>
            </li>
          )}
          {!n && <li role="presentation" style={{ color: 'var(--hub-ash)', cursor: 'default' }}>{jarvis ? 'Type a chat name or command, or a question for Jarvis.' : 'Nothing matches.'}</li>}
        </ul>
        {jarvis?.({ value: q, onValue: v => { setQ(v); setAt(0) }, input, askRef })}
        <p aria-hidden>↑↓ move · Enter open · Esc close</p>
      </div>
    </div>
  )
}
