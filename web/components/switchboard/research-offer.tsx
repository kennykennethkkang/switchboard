'use client'
// usage-meter's research offers (HubState.researchOffers), in the Needs you strip's look. Lane HOME mounts it beside that strip.
import type { HubState } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { moveToResearch } from '@/lib/research-offer'
import { researchNow } from '@/lib/research-now'

/** Move starts the chat's newest ask again in the Research space and drops the offer; Stay only drops it. */
export function ResearchOffers({ hub, send }: { hub: HubState; send: (c: HubCommand) => void }) {
  const offers = hub.researchOffers ?? []
  if (!offers.length) return null
  const name = (id: string) => hub.chats.find(c => c.sessionId === id)?.name || 'A chat'
  const stay = (sessionId: string) => send({ type: 'hub-research-dismiss', sessionId })
  return (
    <section className="hub-stuck" aria-label="Research offers">
      <ul role="list">
        {offers.map(o => {
          const move = moveToResearch(hub, o.sessionId)
          return (
            <li key={o.sessionId}>
              <i aria-hidden />
              <span className="hub-stuck-text">
                <span className="hub-stuck-who"><b>{name(o.sessionId)}</b></span>
                <span className="hub-stuck-q">This chat looks like research (reading the web and writing up sources). Move it to Research?</span>
                {o.reason && <span className="hub-stuck-meta">{o.reason}</span>}
              </span>
              <span className="hub-stuck-acts">
                <button type="button" className="hub-btn primary sm" disabled={!move} aria-label={`Move ${name(o.sessionId)} to Research`}
                  title={move ? 'Starts a research chat with the same ask in the Research window. This chat keeps running.' : 'No ask from you in this chat to move'}
                  onClick={() => { if (move) { send(move); stay(o.sessionId) } }}>Move</button>
                <button type="button" className="hub-btn sm" aria-label={`Stay: keep ${name(o.sessionId)} where it is`} onClick={() => stay(o.sessionId)}>Stay</button>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Ship's Research tracker: each chat doing web research, who in it is doing it, and what for. Hidden when none is. */
export function ResearchTracker({ hub, send, onOpen }: { hub: HubState; send: (c: HubCommand) => void; onOpen: (sessionId: string) => void }) {
  const rows = researchNow(hub)
  if (!rows.length) return null
  const live = rows.filter(r => r.live).length
  return (
    <section className="hub-stuck" aria-label="Research tracker">
      <h2 className="hub-stuck-who" style={{ margin: '0 0 6px', fontSize: 12 }}>Research {live ? `· ${live} running` : '· finished lately'}</h2>
      <ul role="list">
        {rows.map(r => (
          <li key={r.sessionId} data-live={r.live}>
            <i aria-hidden />
            <span className="hub-stuck-text">
              <span className="hub-stuck-who">{r.live ? 'Researching' : 'Researched'} for <b>{r.chat}</b>{r.project && r.project !== r.chat ? ` in ${r.project}` : ''}</span>
              <span className="hub-stuck-q">{r.doing}</span>
              <span className="hub-stuck-meta">
                {r.searches} {r.searches === 1 ? 'search' : 'searches'}, {r.sources} {r.sources === 1 ? 'source' : 'sources'}{r.forAsk ? ` · for your ask: ${r.forAsk}` : ''}
              </span>
            </span>
            <span className="hub-stuck-acts">
              <button type="button" className="hub-btn primary sm" aria-label={`Open the research tab for ${r.chat}`} title="Opens this chat's research tab: searches, sources and the answer as it comes in"
                onClick={() => send({ type: 'hub-research-open', sessionId: r.sessionId })}>Open research</button>
              <button type="button" className="hub-btn sm" aria-label={`Go to ${r.chat}`} onClick={() => onOpen(r.sessionId)}>Chat</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
