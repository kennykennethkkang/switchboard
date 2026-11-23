'use client'
import type { KeyboardEvent } from 'react'
import type { HubState } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { LOCKED } from './tool-chips'
import './tool-precedence.css'

type Prec = 'always' | 'auto' | 'never'
const SAY: Record<Prec, string> = { always: 'Always on', auto: 'Auto', never: 'Never' }
const ORDER: Prec[] = ['always', 'auto', 'never']
const short = (n: string) => n.split('@')[0]
const HINT = 'Smart select turns off what a new chat does not need. Always on is never turned off; Never stays off unless you turn it on in a chat.'

/** Jev's 'needed (0.91)' reads as 'needed, 91% sure'; the number is P(needed), so 'not needed (0.12)' is 88% sure. */
const plain = (w: string) => w.replace(/\b(not needed|needed) \((0(?:\.\d+)?|1(?:\.0+)?)\)/, (_, v, n) => `${v}, ${Math.round((v === 'needed' ? +n : 1 - +n) * 100)}% sure`)

/** The newest smart pick line per tool, with the chat it came from. */
function reasons(hub: HubState) {
  const out: Record<string, { why: string; chat?: string }> = {}
  const recs = Object.entries(hub.tools?.smart ?? {}).sort((a, b) => b[1].at - a[1].at)
  for (const [id, r] of recs) for (const [n, why] of Object.entries(r.why)) out[n] ??= { why, chat: hub.chats.find(c => c.sessionId === id)?.name }
  return out
}

/** Kenneth's per-tool precedence for smart select, in Settings, Installed. A three-way switch per row. */
export function ToolPrecedence({ hub, send }: { hub: HubState; send: (c: HubCommand) => void }) {
  const prec = hub.tools?.precedence ?? {}
  const of = (n: string): Prec => prec[n] ?? 'auto'
  const why = reasons(hub)
  const tools = hub.installed.filter(i => (i.kind === 'plugin' || i.kind === 'skill') && !(i.kind === 'plugin' && LOCKED.includes(short(i.name))))
    .sort((a, b) => short(a.name).localeCompare(short(b.name)))
  const set = (name: string, value: Prec) => send({ type: 'hub-tool-precedence', name, value })
  if (!tools.length) return null
  const count = (p: Prec) => tools.filter(t => of(t.name) === p).length
  const said = [count('always') && `${count('always')} always on`, count('never') && `${count('never')} never auto-on`].filter(Boolean).join(', ') || 'All auto'

  const label = (n: string, kind: string) => {
    const w = why[n]
    return (
      <span className="tp-label">
        <span className="tp-name">{short(n)}<span className="tp-kind">{kind}</span></span>
        {w && <span className="tp-why">{plain(w.why)}{w.chat && <span className="tp-from"> · {w.chat}</span>}</span>}
      </span>
    )
  }

  // Arrow keys move the pick, as a radio group does.
  const keys = (e: KeyboardEvent, n: string) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const to = ORDER[(ORDER.indexOf(of(n)) + d + 3) % 3]
    set(n, to)
    const box = e.currentTarget
    requestAnimationFrame(() => box.querySelector<HTMLElement>(`[data-v="${to}"]`)?.focus())
  }
  return (
    <details className="hub-fold-list tp" open>
      <summary><b aria-hidden>›</b><span className="tp-head">Smart select per tool</span><span className="tp-count">{said}</span></summary>
      <p className="tp-hint">{HINT}</p>
      <ul role="list" className="tp-list">
        {tools.map(t => (
          <li key={t.name} className="tp-row">
            {label(t.name, t.kind)}
            <span role="radiogroup" aria-label={`${short(t.name)} in smart select`} className="tp-seg" onKeyDown={e => keys(e, t.name)}>
              {ORDER.map(p => <button key={p} type="button" role="radio" data-v={p} aria-checked={of(t.name) === p} tabIndex={of(t.name) === p ? 0 : -1}
                onClick={() => { if (of(t.name) !== p) set(t.name, p) }}>{SAY[p]}</button>)}
            </span>
          </li>
        ))}
      </ul>
      <p className="tp-hint">{LOCKED.join(', ')} are on in every chat.</p>
    </details>
  )
}
