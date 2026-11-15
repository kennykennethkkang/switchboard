'use client'
import type { ChatProgress, ChatRow } from '@/lib/hub-types'
import { chipOf } from './chat-cards'

type Props = { targets: ChatRow[]; progress: ChatProgress[]; project: string; picked: string[]; onToggle: (id: string) => void }

const nameOf = (c: ChatRow) => c.name || c.sessionId.slice(0, 8)
const aiOf = (c: ChatRow) => c.ai === 'codex' ? 'Codex' : 'Claude'
const stateOf = (c: ChatRow, progress: ChatProgress[]) => chipOf(progress.find(p => p.sessionId === c.sessionId))

// Every live chat as a chip under the goal; tap to pick, several allowed.
export function WaitOnChips({ targets, progress, project, picked, onToggle }: Props) {
  return (
    <div className="hub-waiton-chips" role="group" aria-labelledby="waiton-label">
      <span id="waiton-label" className="hub-waiton-label">Wait on</span>
      {targets.length
        ? targets.map(c => {
          const s = stateOf(c, progress)
          const on = picked.includes(c.sessionId)
          return <button key={c.sessionId} type="button" className="hub-waiton-chip" aria-pressed={on} title={`${nameOf(c)} · ${aiOf(c)} · ${s.label}`} onClick={() => onToggle(c.sessionId)}>
            <i style={{ background: on ? undefined : s.color }} aria-hidden /><span>{nameOf(c)}</span>
          </button>
        })
        : <span className="hub-waiton-empty">No live chats in {project || 'this project'}</span>}
    </div>
  )
}
