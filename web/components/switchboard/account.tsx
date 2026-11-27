'use client'
import { useEffect, useRef, useState } from 'react'
import type { HubState } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { useHubShared } from '@/hooks/use-hub'
import { ago } from '@/lib/look'
import { useDismiss } from './use-popover'
import './account.css'

export type Update = NonNullable<HubState['update']>
type Send = (c: HubCommand) => void
export const updateOf = (hub: HubState) => hub.update
export const updateCmd = (type: 'hub-update-check' | 'hub-update-reload'): HubCommand => ({ type })
const since = (at: number) => { const a = ago(at); return a === 'now' ? 'just now' : `${a} ago` }

/** The update state in words, and what its button says and sends. */
export function updateLine(u?: Update): { text: string; label: string; cmd?: 'hub-update-check' | 'hub-update-reload'; hot?: boolean } {
  const l = stateLine(u)
  // a note outside an error: another window held the check
  return u?.note && u.state !== 'error' ? { ...l, text: u.note } : l
}

function stateLine(u?: Update): ReturnType<typeof updateLine> {
  if (!u) return { text: 'Version not known yet.', label: 'Check for updates', cmd: 'hub-update-check' }
  switch (u.state) {
    case 'checking': return { text: 'Checking for a newer version.', label: 'Checking' }
    case 'available': return { text: `Version ${u.latest ?? 'new'} is out.`, label: 'Update', cmd: 'hub-update-check', hot: true }
    case 'installed': return { text: `Version ${u.latest ?? 'new'} is installed. Reload to use it.`, label: 'Reload', cmd: 'hub-update-reload', hot: true }
    case 'current': return { text: `Up to date${u.checkedAt ? `, checked ${since(u.checkedAt)}` : ''}.`, label: 'Check again', cmd: 'hub-update-check' }
    case 'error': return { text: u.note ?? 'The check failed.', label: 'Try again', cmd: 'hub-update-check' }
    default: return { text: u.checkedAt ? `Checked ${since(u.checkedAt)}.` : 'Not checked yet.', label: 'Check for updates', cmd: 'hub-update-check' }
  }
}

export function UpdateButton({ hub, send, sm }: { hub: HubState; send: Send; sm?: boolean }) {
  const l = updateLine(updateOf(hub))
  return <button type="button" className={`hub-btn${l.hot ? ' primary' : ''}${sm ? ' sm' : ''}`} disabled={!l.cmd} onClick={() => l.cmd && send(updateCmd(l.cmd))}>{l.label}</button>
}
export const versionLabel = (hub: HubState) => { const u = updateOf(hub); return u?.current ? `Switchboard ${u.current}` : 'Switchboard' }

const PERSON = 'M8 8a2.75 2.75 0 1 0 0-5.5A2.75 2.75 0 0 0 8 8ZM2.75 14c.6-2.6 2.7-4 5.25-4s4.65 1.4 5.25 4'
function Face({ login }: { login?: string }) {
  return <span className="acct-face" aria-hidden>{login ? login[0].toUpperCase() : <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d={PERSON} /></svg>}</span>
}

/**
 * GitHub account and the Switchboard version behind one button. where: rail is a wide row that opens upward,
 * top a round button in the page header. Help and, on a phone, the Coder view switch ride in the menu too.
 */
export function Account({ where, onHelp, simple, onCoder }: { where: 'rail' | 'top'; onHelp: () => void; simple?: boolean; onCoder?: (on: boolean) => void }) {
  const got = useHubShared()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null), btn = useRef<HTMLButtonElement>(null), pop = useRef<HTMLDivElement>(null)
  useDismiss(open, wrap, () => { if (pop.current?.contains(document.activeElement)) btn.current?.focus(); setOpen(false) })
  useEffect(() => { if (open) pop.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true }) }, [open])
  if (!got) return null
  const { hub, send } = got
  const s = hub.sync, u = updateOf(hub), line = updateLine(u)
  const login = s?.on ? s.login : undefined
  const name = s?.on ? `@${login ?? 'github'}` : 'Not signed in'
  return (
    <div ref={wrap} className="acct" data-where={where}>
      <button ref={btn} type="button" className="acct-btn" aria-haspopup="dialog" aria-expanded={open} aria-controls="acct-pop" onClick={() => setOpen(o => !o)}
        aria-label={where === 'top' ? `Account and updates: ${name}${line.hot ? ', update ready' : ''}` : undefined}>
        <Face login={login} />
        {where === 'rail' && <span className="acct-who"><b>{s?.on ? name : 'Sign in'}</b><span>{line.hot ? 'Update ready' : u?.current ? `v${u.current}` : 'Account and updates'}</span></span>}
        {line.hot && <i className="acct-dot" aria-hidden />}
      </button>
      {open && <div ref={pop} id="acct-pop" role="dialog" aria-label="Account and updates" className="hub-pop acct-pop">
        <section className="acct-sec">
          <div className="acct-head"><Face login={login} /><span><b>{name}</b><span>{s?.on ? `GitHub sync, last ${s.last ? since(s.last) : 'never'}` : 'GitHub keeps memory, the vault and settings the same on every computer.'}</span></span></div>
          {s?.note && <p className="acct-note">{s.note}</p>}
          {s?.on
            ? <div className="acct-row"><button type="button" className="hub-btn sm" disabled={s.busy} onClick={() => send({ type: 'hub-sync-now' })}>{s.busy ? 'Syncing' : 'Sync now'}</button><button type="button" className="hub-btn sm" onClick={() => send({ type: 'hub-sync-off' })}>Turn off sync</button></div>
            : <button type="button" className="hub-btn primary acct-wide" onClick={() => send({ type: 'hub-sync-sign-in' })}>Sign in with GitHub</button>}
        </section>
        <section className="acct-sec">
          <div className="acct-head"><span><b>{versionLabel(hub)}</b><span role="status">{line.text}</span></span></div>
          <UpdateButton hub={hub} send={send} sm />
        </section>
        <section className="acct-sec acct-links">
          <button type="button" className="acct-item" onClick={() => { setOpen(false); onHelp() }}>Help</button>
          <a className="acct-item" href="#settings" onClick={() => setOpen(false)}>Settings</a>
          {onCoder && <button type="button" role="switch" aria-checked={!simple} className="nav-coder acct-coder" onClick={() => onCoder(!!simple)}><span>Coder view</span><i aria-hidden /></button>}
        </section>
      </div>}
    </div>
  )
}
