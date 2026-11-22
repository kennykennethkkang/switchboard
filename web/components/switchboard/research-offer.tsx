'use client'
// usage-meter's research offers (HubState.researchOffers), in the Needs you strip's look. Lane HOME mounts it beside that strip.
import type { HubState } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { moveToResearch } from '@/lib/research-offer'

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
                <span className="hub-stuck-q">This chat looks like research. Move it to Research?</span>
                {o.reason && <span className="hub-stuck-meta">{o.reason}</span>}
              </span>
              <span className="hub-stuck-acts">
                <button type="button" className="hub-btn primary sm" disabled={!move} aria-label={`Move ${name(o.sessionId)} to Research`}
                  title={move ? 'Starts a research chat with the same ask in ~/Documents/Research. This chat keeps running.' : 'No ask from you in this chat to move'}
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
