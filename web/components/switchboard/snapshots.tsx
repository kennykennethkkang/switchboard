'use client'

// History > Snapshots: what aar and self-improve saved before editing the kit, rules, agents or memory, with Undo.
import { useState } from 'react'
import type { HubState } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { caps } from './look'
import { ago } from '@/lib/look'

export function Snapshots({ hub, send }: { hub: Pick<HubState, 'snapshots'>; send: (c: HubCommand) => void }) {
  const [open, setOpen] = useState(false)
  const [sure, setSure] = useState<string>()
  const list = hub.snapshots ?? []
  return (
    <section aria-label="Snapshots" style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 6, minWidth: 0 }}>
      <button type="button" className="hub-link hub-fold" aria-expanded={open} style={{ ...caps, alignItems: 'center', width: '100%', padding: '8px 4px' }}
        onClick={() => { if (!open) send({ type: 'hub-snapshots' }); setOpen(!open); setSure(undefined) }}>
        <span>Snapshots{open && <span style={{ color: 'var(--hub-mute)', marginLeft: 4 }}>{list.length}</span>}</span>
        <b aria-hidden>›</b>
      </button>
      {open && <p style={{ margin: '0 4px 4px', color: 'var(--hub-ash)', fontSize: 12, lineHeight: 1.5 }}>Saved before a skill edits the kit, rules, agents or memory. Undo puts the files back; the current state is saved first.</p>}
      {open && (list.length
        ? <ul role="list" aria-label="Snapshots, newest first" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
            {list.map(s => (
              <li key={s.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', minHeight: 32, padding: '0 4px', minWidth: 0 }}>
                <span style={{ flex: '1 1 140px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--hub-ink)', fontSize: 13 }} title={s.paths.join('\n')}>{s.label}</span>
                <span className="hub-num" style={{ fontSize: 12, color: 'var(--hub-ash)' }}>{s.paths.length} file{s.paths.length === 1 ? '' : 's'} · {ago(s.at)}</span>
                {sure === s.id
                  ? <span role="group" aria-label={`Undo ${s.label}`} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <button type="button" className="hub-btn sm" onClick={() => { send({ type: 'hub-snapshot-restore', id: s.id }); setSure(undefined) }}>Restore {s.paths.length} file{s.paths.length === 1 ? '' : 's'}</button>
                      <button type="button" className="hub-link" onClick={() => setSure(undefined)}>Cancel</button>
                    </span>
                  : <button type="button" className="hub-btn sm" onClick={() => setSure(s.id)}>Undo</button>}
                {!!s.skipped?.length && <p role="status" style={{ flexBasis: '100%', margin: 0, color: 'var(--hub-ash)', fontSize: 12, lineHeight: 1.5, overflowWrap: 'anywhere' }}>Undo skipped {s.skipped.length} file{s.skipped.length === 1 ? '' : 's'} outside your home folder: {s.skipped.map(p => p.replace(/ \(outside home\)$/, '')).join(', ')}</p>}
              </li>
            ))}
          </ul>
        : <p role="status" style={{ margin: '0 4px', color: 'var(--hub-ash)', fontSize: 12 }}>No snapshots yet.</p>)}
    </section>
  )
}
