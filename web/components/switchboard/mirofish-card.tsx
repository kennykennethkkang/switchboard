import type { MirofishState } from '@/lib/hub-types'
import { caps, label, panel } from './look'

const duration = (ms?: number) => {
  if (ms === undefined) return 'unknown'
  const minutes = Math.max(0, Math.round(ms / 60_000))
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function MirofishCard({ mirofish }: { mirofish: MirofishState }) {
  const writing = mirofish.step !== 'rounds'
  return (
    <section className="cp-card" aria-label="MiroFish simulation progress" style={panel}>
      <h2 style={caps}>MiroFish</h2>
      <strong style={{ color: 'var(--hub-ink)', fontSize: 14 }}>
        {writing ? (mirofish.reportReady ? 'Simulation complete' : 'Writing report') : `Round ${mirofish.round} of ${mirofish.rounds}`}
      </strong>
      <div role="progressbar" aria-label="Simulation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(mirofish.percent)}
        style={{ height: 6, borderRadius: 99, background: 'var(--hub-hair)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, mirofish.percent))}%`, background: 'var(--hub-blue)', transition: 'width 200ms ease' }} />
      </div>
      <div style={{ display: 'flex', gap: 16, color: 'var(--hub-ash)', fontSize: 12 }}>
        <span><span style={label}>Elapsed </span>{duration(mirofish.elapsedMs)}</span>
        {!writing && <span><span style={label}>Estimate </span>{duration(mirofish.etaMs)}</span>}
      </div>
      {mirofish.reportReady && mirofish.reportExcerpt && <p style={{ margin: 0, color: 'var(--hub-body)', fontSize: 13, lineHeight: 1.5 }}>{mirofish.reportExcerpt}</p>}
      <a className="hub-btn" href="http://localhost:3100" target="_blank" rel="noreferrer" style={{ justifySelf: 'start', textDecoration: 'none' }}>Open MiroFish</a>
    </section>
  )
}
