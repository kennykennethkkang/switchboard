'use client'
import type { JevProject } from '@/lib/hub-types'
import { jevView, setupPrompt } from '@/lib/jev'
import { caps, label, panel } from './look'
import { baseName } from '@/lib/path'

type Send = (m: { type: 'hub-new-chat'; path: string; text: string; remote: boolean }) => void

/** This project's Jev: which jobs are on, the newest runs and their cost, and a button that starts the setup chat. */
export function JevCard({ folder, jev, send }: { folder: string; jev?: JevProject; send: Send }) {
  const v = jevView(jev)
  return (
    <section aria-label={`Jev for ${baseName(folder)}`} style={panel}>
      <h2 style={caps}><span>Jev</span>{v.runs.length > 0 && <span title="What the runs listed here cost">{v.cost}</span>}</h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {v.jobs.map(j => (
          <li key={j.key} title={j.tip} style={{ font: '500 12px/1 var(--hub-sans)', padding: '5px 8px', borderRadius: 999, border: `1px solid ${j.on ? 'var(--hub-violet)' : 'var(--hub-hair)'}`,
            color: j.on ? 'var(--hub-ink)' : 'var(--hub-ash)' }}>
            {j.label}{j.on ? <span className="sr-only"> on</span> : ' off'}
          </li>
        ))}
      </ul>
      {v.runs.length > 0 && <div style={{ display: 'grid', gap: 2 }}>
        <span style={label}>Last runs</span>
        {v.runs.map((r, i) => <span key={i} className="hub-num" style={{ fontSize: 13, color: 'var(--hub-body)' }}>{r}</span>)}
      </div>}
      <button type="button" className="hub-btn" style={{ justifySelf: 'start' }} onClick={() => send({ type: 'hub-new-chat', path: folder, text: setupPrompt(folder), remote: false })}
        title="Starts a chat here that drafts this repo's presets, checks them on real items and turns the jobs on for this project only">
        {v.anyOn ? 'Set up Jev again' : 'Set up Jev'}
      </button>
    </section>
  )
}
