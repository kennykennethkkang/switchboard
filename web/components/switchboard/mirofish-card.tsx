import type { MirofishPost, MirofishState } from '@/lib/hub-types'
import { duration, mirofishStatus, type Stage } from '@/lib/mirofish'
import type { HubCommand } from '@/lib/vscode-bridge'
import { caps, label, panel } from './look'
import { LiveFeed } from './live-feed'

const STAGES: [Stage, string][] = [['rounds', 'Rounds'], ['report', 'Report'], ['saved', 'Saved']]

export function MirofishCard({ mirofish, send }: { mirofish: MirofishState; send: (m: HubCommand) => void }) {
  const s = mirofishStatus(mirofish)
  const at = STAGES.findIndex(([k]) => k === s.stage)
  const color = s.tone === 'bad' ? 'var(--hub-red)' : s.tone === 'done' ? 'var(--hub-green)' : 'var(--hub-blue)'
  return (
    <section className="cp-card" aria-label="MiroFish simulation progress" style={panel}>
      <h2 style={caps}><span>Status</span><span style={{ color }}>{mirofish.stalled && mirofish.step === 'rounds' ? 'Stalled' : s.tone === 'done' ? 'Finished' : s.tone === 'bad' ? 'Needs a look' : 'Running'}</span></h2>
      <ol aria-label="Stages" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {STAGES.map(([k, word], i) => {
          const done = i < at || (i === at && s.tone === 'done'), now = i === at && !done
          return (
            <li key={k} aria-current={now ? 'step' : undefined} style={{ display: 'grid', gap: 4, fontSize: 12, color: done || now ? 'var(--hub-ink)' : 'var(--hub-ash)' }}>
              <span style={{ height: 4, borderRadius: 99, background: done ? 'var(--hub-green)' : now ? color : 'var(--hub-hair)' }} />
              <span>{done ? '✓ ' : ''}{word}</span>
            </li>
          )
        })}
      </ol>
      <strong style={{ color: 'var(--hub-ink)', fontSize: 15 }}>{s.head}</strong>
      <span style={{ color: s.tone === 'bad' ? 'var(--hub-red)' : 'var(--hub-mute)', fontSize: 13 }}>{s.sub}</span>
      {s.bar !== undefined && (
        <div role="progressbar" aria-label={s.stage === 'rounds' ? 'Simulation progress' : 'Report progress'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.bar)}
          style={{ height: 6, borderRadius: 99, background: 'var(--hub-hair)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, s.bar))}%`, background: color, transition: 'width 200ms ease' }} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, color: 'var(--hub-ash)', fontSize: 12 }}>
        <span><span style={label}>Elapsed </span>{duration(mirofish.elapsedMs)}</span>
        <span><span style={label}>Sim </span>{mirofish.simId}</span>
      </div>
      {/* The extension starts MiroFish's web app when it is down, then opens this sim's page. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-mirofish-open', simId: mirofish.simId })}>Open in MiroFish</button>
        {mirofish.stalled && mirofish.step === 'rounds' && <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-live-dismiss', kind: 'mirofish', id: mirofish.simId })}>Dismiss</button>}
      </div>
    </section>
  )
}

/** What the simulated people did most lately; translated posts say so. */
export function MirofishActivity({ feed }: { feed: MirofishPost[] }) {
  const translated = feed.some(p => p.translated)
  return (
    <section className="cp-card" aria-label="MiroFish agent activity" style={panel}>
      <h2 style={caps}><span>Agent activity</span><span>{translated ? 'Translated to English' : 'Newest first'}</span></h2>
      <LiveFeed label="Newest agent actions" rows={feed.map((p, i) => ({
        key: `${p.at}-${i}-${p.who}`,
        head: <><span style={{ color: 'var(--hub-ink)' }}>{p.who}</span> {p.action}{p.platform && ` on ${p.platform}`}</>,
        text: p.text,
      }))} />
    </section>
  )
}
