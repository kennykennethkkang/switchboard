import type { CrowdLive, HubState, MirofishReport, MirofishState } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { CrowdRatings, CrowdVotes } from './crowd-card'
import { MirofishActivity, MirofishCard } from './mirofish-card'
import { MirofishReports } from './mirofish-reports'

/** Runs still moving: a MiroFish sim in its rounds or report, a crowd-ab run not ended. */
export const liveCount = (h: Pick<HubState, 'mirofish' | 'crowdAb'>) => (h.mirofish && h.mirofish.step !== 'done' && !h.mirofish.stalled ? 1 : 0) + (h.crowdAb && !h.crowdAb.ended && !h.crowdAb.stopped ? 1 : 0)

function Section({ id, title, blurb, children }: { id: string; title: string; blurb: string; children: React.ReactNode }) {
  return (
    <section className="hub-live-sec" aria-labelledby={id}>
      <header className="hub-live-head">
        <h2 id={id}>{title}</h2>
        <p>{blurb}</p>
      </header>
      {children}
    </section>
  )
}

export function LivePage({ mirofish, crowd, reports = [], send }: { mirofish?: MirofishState; crowd?: CrowdLive; reports?: MirofishReport[]; send: (m: HubCommand) => void }) {
  if (!mirofish && !crowd && !reports.length) return (
    <section className="cp-card" style={{ display: 'grid', gap: 6, padding: '32px 4px', color: 'var(--hub-ash)' }}>
      <strong style={{ color: 'var(--hub-ink)', fontSize: 15 }}>Nothing running</strong>
      <span>A MiroFish simulation or a crowd-ab run shows up here as it happens. Finished MiroFish reports are saved and kept here, in English.</span>
    </section>
  )
  return (
    <div className="hub-live">
      {(mirofish || !!reports.length) && (
        <Section id="live-mirofish" title="MiroFish" blurb="Simulated people react to an idea over several rounds. Each run ends in a report, saved here.">
          {mirofish && (
            <div className="hub-live-row">
              <MirofishCard mirofish={mirofish} send={send} />
              {!!mirofish.feed?.length && <MirofishActivity feed={mirofish.feed} />}
            </div>
          )}
          {!!reports.length && <MirofishReports reports={reports} send={send} />}
        </Section>
      )}
      {crowd && (
        <Section id="live-crowd" title="Crowd A/B" blurb="Synthetic users rate each option alone; the higher rating is their vote.">
          <div className="hub-live-row">
            <CrowdVotes crowd={crowd} send={send} />
            {!!crowd.feed.length && <CrowdRatings crowd={crowd} />}
          </div>
        </Section>
      )}
    </div>
  )
}
