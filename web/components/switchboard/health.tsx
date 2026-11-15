'use client'

// Settings: Check health button, the result lines, and Fix safe ones.
import type { HubState } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { ago } from './look'

const TONE = { ok: 'var(--hub-green)', warn: 'var(--hub-yellow)', fail: 'var(--hub-red)' } as const
const WORD = { ok: 'OK', warn: 'Warn', fail: 'Fail' } as const

export function Health({ hub, send }: { hub: Pick<HubState, 'health'>; send: (c: HubCommand) => void }) {
  const h = hub.health, busy = !!h?.busy, results = h?.results ?? []
  const fixable = results.filter(r => r.fixable && r.status !== 'ok')
  return (
    <div className="hub-set-row" style={{ display: 'grid', gap: 8 }}>
      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
          <span style={{ color: 'var(--hub-ink)' }}>Check health</span>
          <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--hub-ash)' }}>{h?.at ? `Last run ${ago(h.at)} ago. ` : ''}Hook server, kit version, mods, CLIs, hub port and MCP config.</span>
        </span>
        <span style={{ display: 'inline-flex', gap: 8 }}>
          {fixable.length > 0 && <button type="button" className="hub-btn" disabled={busy} onClick={() => send({ type: 'hub-health-fix' })} title="Reruns the kit and mod install for the fixable lines only">Fix safe ones</button>}
          <button type="button" className="hub-btn" disabled={busy} onClick={() => send({ type: 'hub-health' })}>{busy ? 'Checking' : 'Check health'}</button>
        </span>
      </span>
      {results.length > 0 && <ul role="list" aria-label="Health results" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
        {results.map(r => (
          <li key={r.id} style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr)', gap: 8, alignItems: 'baseline', fontSize: 13 }}>
            <span style={{ font: '500 11px/1 var(--hub-mono)', letterSpacing: 0.4, textTransform: 'uppercase', color: TONE[r.status] }}>{WORD[r.status]}</span>
            <span style={{ color: 'var(--hub-ink)', overflowWrap: 'anywhere' }}>{r.label}{r.detail && <span style={{ color: 'var(--hub-ash)' }}> {r.detail}</span>}{r.fixable && r.status !== 'ok' && <span style={{ color: 'var(--hub-mute)' }}> (fixable)</span>}</span>
          </li>
        ))}
      </ul>}
    </div>
  )
}
