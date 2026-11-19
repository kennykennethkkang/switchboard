import type { CrowdLive } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { caps, label, panel } from './look'
import { LiveFeed } from './live-feed'

const pct = (n: number, of: number) => of ? Math.round(n / of * 100) : 0

export function CrowdVotes({ crowd, send }: { crowd: CrowdLive; send: (m: HubCommand) => void }) {
  const decided = crowd.votes.reduce((s, v) => s + v.n, 0)
  const lead = Math.max(0, ...crowd.votes.map(v => v.n))
  const progress = pct(crowd.done, crowd.items)
  const leader = crowd.votes.find(v => v.n === lead && lead)
  return (
    <section className="cp-card" aria-label="Crowd A/B votes" style={panel}>
      <h2 style={caps}><span>Votes</span><span style={{ color: crowd.ended ? 'var(--hub-green)' : crowd.stopped ? 'var(--hub-red)' : 'var(--hub-blue)' }}>{crowd.ended ? 'Finished' : crowd.stopped ? 'Stopped' : 'Running'}</span></h2>
      <strong style={{ color: 'var(--hub-ink)', fontSize: 15 }}>
        {crowd.ended ? (leader ? `${leader.label} leads with ${pct(leader.n, decided)}%` : 'No clear favourite') : crowd.stopped ? `Stopped at ${crowd.done} of ${crowd.items} ratings` : `${crowd.done} of ${crowd.items} ratings in`}
      </strong>
      {!crowd.ended && (
        <div role="progressbar" aria-label="Ratings in" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}
          style={{ height: 6, borderRadius: 99, background: 'var(--hub-hair)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: 'var(--hub-blue)', transition: 'width 200ms ease' }} />
        </div>
      )}
      <div style={{ display: 'grid', gap: 8 }}>
        {crowd.votes.map(v => (
          <div key={v.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 7em) 1fr 3.2em', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ color: 'var(--hub-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.label}</span>
            <div style={{ height: 8, borderRadius: 99, background: 'var(--hub-hair)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct(v.n, decided)}%`, background: v.n === lead && lead ? 'var(--hub-green)' : 'var(--hub-mute)', transition: 'width 200ms ease' }} />
            </div>
            <span style={{ color: 'var(--hub-ash)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct(v.n, decided)}%</span>
          </div>
        ))}
      </div>
      <span style={{ ...label, textTransform: 'none' }}>{decided} decided, {crowd.noPreference} no preference</span>
      {crowd.stopped && !crowd.ended && (
        <>
          <span style={{ color: 'var(--hub-red)', fontSize: 13 }}>No new ratings for 5 minutes. The run probably stopped.</span>
          <button type="button" className="hub-btn" style={{ justifySelf: 'start' }} onClick={() => send({ type: 'hub-live-dismiss', kind: 'crowd', id: crowd.run })}>Dismiss</button>
        </>
      )}
    </section>
  )
}

export function CrowdRatings({ crowd }: { crowd: CrowdLive }) {
  return (
    <section className="cp-card" aria-label="Newest crowd ratings" style={panel}>
      <h2 style={caps}><span>Newest ratings</span><span>Out of 4</span></h2>
      <LiveFeed label="Newest ratings" rows={crowd.feed.map((f, i) => ({
        key: `${f.at}-${i}-${f.option}`,
        head: <>{f.who}: <span style={{ color: 'var(--hub-ink)' }}>{f.option}</span>{f.appeal !== undefined && ` ${f.appeal.toFixed(1)}`}{f.reason && f.reason !== 'none' && `, ${f.reason}`}</>,
        text: f.why,
      }))} />
    </section>
  )
}
