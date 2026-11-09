'use client'
// Settings list of what Switchboard ships or installs from others. Data in lib/credits.ts.
import { CREDITS } from '@/lib/credits'

export function Credits() {
  return (
    <ul aria-label="Credits" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, fontSize: 12 }}>
      {CREDITS.map(c => (
        <li key={c.name} style={{ minWidth: 0 }}>
          {c.url ? <a className="hub-link" style={{ display: 'inline-flex', alignItems: 'center' }} href={c.url} target="_blank" rel="noreferrer">{c.name}</a> : <span>{c.name}</span>}
          <span style={{ color: 'var(--hub-ash)' }}> by {c.by}, {c.license}. {c.what}</span>
        </li>
      ))}
    </ul>
  )
}
