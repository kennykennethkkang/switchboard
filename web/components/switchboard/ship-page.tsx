'use client'
import { useState, type ReactNode } from 'react'
import type { HubState } from '@/lib/hub-types'
import { projectName } from '@/lib/archive'
import type { Card } from './chat-cards'
import { PageStats, Sec } from './page-kit'
import './sp-ship.css'

type Props = {
  hub: HubState; cards: Card[]; pickedId?: string; onPick: (id: string) => void
  dev: ReactNode; terminals: ReactNode; tracker: ReactNode; changes: ReactNode; git: ReactNode
}

const nameOf = (c: Card) => c.chat.name || c.chat.sessionId.slice(0, 8)

function badge(c: Card) {
  const s = c.progress?.state
  if (s === 'done') return { text: 'Ready to ship', tone: 'green' }
  if (s === 'working') return { text: 'Working', tone: 'blue' }
  return null
}

function Item({ c, on, onPick }: { c: Card; on: boolean; onPick: (id: string) => void }) {
  const b = badge(c)
  return (
    <button type="button" className="sp-item" aria-pressed={on} onClick={() => onPick(c.chat.sessionId)}>
      <span className="sp-item-name">{nameOf(c)}</span>
      {b && <span className="sp-badge" data-tone={b.tone}>{b.text}</span>}
    </button>
  )
}

function Detail({ hub, cards, pickedId, dev, terminals, tracker, changes, git }: Props) {
  const card = cards.find(c => c.chat.sessionId === pickedId)
  if (!card) return <p className="sp-empty">Pick a chat to see its changes and git.</p>
  const ch = hub.changes?.sessionId === pickedId ? hub.changes : null
  const repo = hub.repo?.sessionId === pickedId ? hub.repo : null
  // hub.changes is the folder's uncommitted set, repo.files the whole repo's; neither is per chat.
  const shown = ch?.files.length
  const files = repo?.files.length ?? shown
  const ci = repo?.ci
  const ciText = !ci ? 'None' : ci.status !== 'completed' ? 'Running' : ci.conclusion === 'success' ? 'Passing' : (ci.conclusion ?? 'Done')
  const next = !repo ? 'Reading the repo...'
    : repo.worktree && !repo.files.length ? 'Merge back into the main checkout.'
    : repo.files.length ? `Commit the ${repo.files.length} uncommitted ${repo.files.length === 1 ? 'file' : 'files'}.`
    : repo.ahead > 0 ? (repo.pr ? 'Push the new commits to the open PR.' : 'Push, then open a PR.')
    : repo.pr && repo.pr.state.toUpperCase() === 'OPEN' ? 'Merge the PR once checks pass.'
    : 'Nothing to ship.'
  return (
    <div className="sp-detail" data-loading={!repo || undefined}>
      <header className="sp-head">
        <h2>{nameOf(card)}</h2>
        <span className="sp-sub">{projectName(card.chat)}{repo?.branch ? ` · ${repo.branch}` : ''}</span>
      </header>
      <PageStats label="Ship status" items={[
        { label: 'Uncommitted files', value: files ?? '...', tone: files ? 'yellow' : undefined, hint: shown !== undefined && files !== undefined && shown !== files ? `${shown} shown in Changes` : undefined },
        { label: 'Commits ahead', value: repo ? repo.ahead : '...', tone: repo?.ahead ? 'blue' : undefined },
        { label: 'PR', value: repo?.pr ? `${repo.pr.number ? `#${repo.pr.number} ` : ''}${repo.pr.state.toLowerCase()}` : 'None' },
        { label: 'CI', value: ciText, tone: ciText === 'Passing' ? 'green' : ciText === 'Running' ? 'yellow' : ci ? 'red' : undefined },
      ]} />
      <p className="sp-next"><b>Next</b><span>{next}</span></p>
      <div id="hub-git" className="sp-work">{changes}{git}</div>
      <Sec id="sp-more" title="Servers and terminals" note="Dev servers, shells and research runs for these projects.">
        <div className="sp-more">{dev}{terminals}{tracker}</div>
      </Sec>
    </div>
  )
}

/** Ship: pick a chat (grouped by project) on the left, its changes and git on the right. On phone the list folds behind Switch chat. */
export function ShipPage(p: Props) {
  const { hub, cards, pickedId, onPick } = p
  const [open, setOpen] = useState(false)
  const groups = new Map<string, Card[]>()
  for (const c of cards) { const k = projectName(c.chat); groups.set(k, [...(groups.get(k) ?? []), c]) }
  const names = [...groups.keys()]
  const picked = cards.find(c => c.chat.sessionId === pickedId)
  const item = (c: Card) => <Item key={c.chat.sessionId} c={c} on={c.chat.sessionId === pickedId} onPick={id => { onPick(id); setOpen(false) }} />
  return (
    <div className="sp-a">
      <div className="sp-side" data-open={open || undefined}>
        <button type="button" className="sp-switch" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span>Switch chat</span><b>{picked ? nameOf(picked) : 'None picked'}</b><i aria-hidden>{open ? '\u2303' : '\u2304'}</i>
        </button>
        <nav className="sp-list" aria-label="Chats by project">
          {names.map(n => (
            <div key={n} className="sp-group">
              <h3>{n}<span className="pk-n">{groups.get(n)!.length}</span></h3>
              {groups.get(n)!.map(item)}
            </div>
          ))}
          {!names.length && <p className="sp-empty">No chats in the picked projects.</p>}
        </nav>
      </div>
      <Detail {...p} />
    </div>
  )
}
