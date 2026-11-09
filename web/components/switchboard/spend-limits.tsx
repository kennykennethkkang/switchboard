'use client'
// Settings rows for paid-guard: how each paid tool is held, and what it ran this month. The extension writes spend-policy.json.
import type { HubState, SpendMode } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { label } from './look'

const MODES: Array<[SpendMode, string]> = [['provider', 'Run if the site confirms a limit'], ['cap', 'Run up to a monthly cap'], ['ask', 'Ask every time']]

export function SpendLimits({ hub, send }: { hub: HubState; send: (m: HubCommand) => void }) {
  if (!hub.spend?.length) return null
  return (
    <>
      <h4 style={{ ...label, lineHeight: 1, margin: '16px 0 4px' }}>Spend limits</h4>
      {hub.spend.map(r => {
        const used = r.mode === 'cap' ? `$${r.usd.toFixed(2)} of $${r.monthlyUsd.toFixed(2)} this month (estimate)` : `${r.calls} call${r.calls === 1 ? '' : 's'} this month`
        const saveCap = (v: string) => {
          const n = Number(v)
          if (v.trim() && Number.isFinite(n) && n >= 0 && n !== r.monthlyUsd) send({ type: 'hub-spend', key: r.key, mode: r.mode, monthlyUsd: n })
        }
        return (
          <div key={r.key} className="hub-set-row">
            <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
              <span style={{ color: 'var(--hub-ink)' }}>{r.label}</span>
              <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--hub-ash)' }}>{used}</span>
            </span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {r.mode === 'cap' && (
                <input key={r.monthlyUsd} type="number" min={0} step={1} inputMode="decimal" className="hub-search" aria-label={`${r.label} monthly cap in dollars`}
                  defaultValue={r.monthlyUsd} style={{ width: 72 }}
                  onBlur={e => saveCap(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveCap(e.currentTarget.value) }} />
              )}
              <select className="hub-select" aria-label={`${r.label} spend mode`} value={r.mode}
                onChange={e => send({ type: 'hub-spend', key: r.key, mode: e.target.value as SpendMode })}>
                {MODES.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
              </select>
            </span>
          </div>
        )
      })}
    </>
  )
}
