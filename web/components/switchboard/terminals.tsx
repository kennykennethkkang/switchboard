'use client'
import { useState } from 'react'
import type { HubState, TerminalRow } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { caps } from './look'

const STATE: Record<TerminalRow['state'], { text: string; color: string; bg: string }> = {
  running: { text: 'running', color: 'var(--hub-green)', bg: 'var(--hub-green-soft)' },
  ended: { text: 'ended', color: 'var(--hub-ash)', bg: 'transparent' },
  exited: { text: 'exited', color: 'var(--hub-ash)', bg: 'transparent' },
}
const row = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6, minWidth: 0 } as const
const label = { color: 'var(--hub-ink)', fontWeight: 500, minWidth: 0, flex: '1 1 80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const

/** This window's terminals by owner: Switchboard's chat terminals (plus chats with none, to Open) or the ones you opened. */
export function Terminals({ hub, send }: { hub: HubState; send: (c: HubCommand) => void }) {
  const [tab, setTab] = useState<'switchboard' | 'user'>('switchboard')
  if (!hub.terminals) return null
  const shown = hub.terminals.filter(t => t.owner === tab)
  const missing = tab === 'switchboard' ? hub.noTerminal ?? [] : []
  const count = (o: TerminalRow['owner']) => hub.terminals!.filter(t => t.owner === o).length
  return (
    <section aria-label="Terminals" style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
      <h3 style={caps}>
        <span>Terminals</span>
        <span role="tablist" aria-label="Who opened them" style={{ display: 'flex', gap: 4 }}>
          {(['switchboard', 'user'] as const).map(o => (
            <button key={o} type="button" role="tab" aria-selected={tab === o} className="hub-btn sm" onClick={() => setTab(o)}
              style={tab === o ? { color: 'var(--hub-ink)', borderColor: 'var(--hub-ink)' } : undefined}>
              {o === 'switchboard' ? 'Switchboard' : 'Mine'} {count(o)}
            </button>
          ))}
        </span>
      </h3>
      <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {shown.map(t => (
          <li key={t.id} style={row}>
            <span title={t.chat && t.chat !== t.name ? `${t.name} (${t.chat})` : t.name} style={label}>{t.name}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {t.sessionId && <span className="hub-chip" style={{ color: STATE[t.state].color, background: STATE[t.state].bg }}><i aria-hidden />{STATE[t.state].text}</span>}
              <button type="button" className="hub-btn sm" onClick={() => send({ type: 'hub-terminal', id: t.id, act: 'show' })}>Show</button>
              {t.owner === 'switchboard' && t.state !== 'running' && <button type="button" className="hub-btn sm" onClick={() => send({ type: 'hub-terminal', id: t.id, act: 'close' })}>Close</button>}
            </span>
          </li>
        ))}
        {missing.map(c => (
          <li key={c.sessionId} style={row}>
            <span style={label}>{c.name ?? c.sessionId.slice(0, 8)}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="hub-chip" style={{ color: 'var(--hub-ash)' }}><i aria-hidden />no terminal</span>
              <button type="button" className="hub-btn sm" title="Resume it in a new terminal" onClick={() => send({ type: 'hub-resume', sessionId: c.sessionId, ai: c.ai ?? 'claude' })}>Open</button>
            </span>
          </li>
        ))}
        {!shown.length && !missing.length && <li style={{ color: 'var(--hub-ash)', fontSize: 12 }}>{tab === 'switchboard' ? 'No chat terminals in this window' : 'No terminals of yours'}</li>}
      </ul>
    </section>
  )
}
