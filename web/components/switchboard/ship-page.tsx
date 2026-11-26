'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { HubState, ShipRepo, ShipTree } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { repoLine, shipOf, treeLine, treeState } from '@/lib/ship-list'
import { chipOf, type Card } from './chat-cards'
import { PageStats, Sec } from './page-kit'
import { ShipTrees } from './ship-trees'
import { Branch } from './worktree-merge'
import './worktree-merge.css'
import './sp-ship.css'

type Pick = { repo: ShipRepo; tree?: ShipTree }
type Props = {
  hub: HubState; cards: Card[]; rows: { ready: ShipRepo[]; clean: ShipRepo[] }; pick?: Pick; onPick: (id: string) => void; onChat: (id: string) => void
  phone: boolean; send: (c: HubCommand) => void
  dev: ReactNode; terminals: ReactNode; tracker: ReactNode; changes: ReactNode; git: ReactNode
}

const nameOf = (c: Card) => c.chat.name || c.chat.sessionId.slice(0, 8)

function Row({ r, pick, onPick }: { r: ShipRepo; pick?: Pick; onPick: (id: string) => void }) {
  return (
    <li>
      <button type="button" className="sp-item" aria-pressed={pick?.repo.id === r.id && !pick.tree} onClick={() => onPick(r.id)}>
        <span className="sp-item-name"><b>{r.name}</b><span>{repoLine(r)}</span></span>
        {r.merging ? <span className="sp-badge" data-tone="blue">Merging</span> : r.branch && <span className="sp-badge">{r.branch}</span>}
      </button>
      {r.trees.length > 0 && <ul role="list" className="sp-sub-list">
        {r.trees.map(t => {
          const s = treeState(t, r.merging)
          return <li key={t.id}><button type="button" className="sp-item sm" aria-pressed={pick?.tree?.id === t.id} onClick={() => onPick(t.id)}>
            <span className="sp-item-name"><b><Branch />{t.name}</b><span>{treeLine(t)}</span></span>
            <span className="sp-badge" data-tone={s.tone}>{s.text}</span>
          </button></li>
        })}
      </ul>}
    </li>
  )
}

function Detail({ hub, cards, pick, onPick, onChat, phone, send, dev, terminals, tracker, changes, git }: Props & { pick: Pick }) {
  const { repo: row, tree } = pick
  const id = tree?.id ?? row.id
  const ch = hub.changes?.sessionId === id ? hub.changes : null
  const repo = hub.repo?.sessionId === id ? hub.repo : null
  // hub.changes lists the folder's uncommitted set, repo.files the whole repo's.
  const shown = ch?.files.length
  const files = repo?.files.length ?? (tree ?? row).files
  const ci = repo?.ci
  const ciText = !ci ? 'None' : ci.status !== 'completed' ? 'Running' : ci.conclusion === 'success' ? 'Passing' : (ci.conclusion ?? 'Done')
  const chats = cards.filter(c => { const at = shipOf([row], c.chat.cwd); return at && at.tree?.id === tree?.id })
  const into = row.branch ?? 'the checkout'
  const next = !repo ? 'Reading the repo...'
    : tree ? (treeState(tree, row.merging).can === 'merge' ? `Merge it into ${into}.` : treeState(tree, row.merging).text + '.')
    : row.merging ? 'A worktree is merging. Wait for its checks.'
    : repo.files.length ? `Commit the ${repo.files.length} uncommitted ${repo.files.length === 1 ? 'file' : 'files'}.`
    : repo.ahead > 0 ? (repo.pr ? 'Push the new commits to the open PR.' : 'Push, then open a PR.')
    : repo.pr && repo.pr.state.toUpperCase() === 'OPEN' ? 'Merge the PR once checks pass.'
    : row.trees.some(t => treeState(t).can === 'merge') ? `Merge the worktrees into ${into}.`
    : 'Nothing to ship.'
  // A repo whose last worktree just merged keeps the card, and its outcome, up here.
  const top = !!tree || row.trees.length > 0 || !!row.merge || !!row.merging
  const trees = <ShipTrees key={`trees-${row.id}`} repo={row} only={tree} globalOff={hub.controls.switchboard.autoMerge === false} phone={phone} send={send} onPick={onPick} />
  return (
    <div className="sp-detail" data-loading={!repo || undefined}>
      <header className="sp-head">
        <h2>{tree ? tree.name : row.name}</h2>
        <span className="sp-sub">{tree ? `${row.name} · ${tree.branch ?? 'detached'}` : row.branch ?? 'detached HEAD'}</span>
        {tree && <button type="button" className="hub-link" onClick={() => onPick(row.id)}>Back to {row.name}</button>}
      </header>
      {chats.length > 0 && <ul role="list" className="sp-chats" aria-label="Chats in this folder">
        {chats.map(c => <li key={c.chat.sessionId}><button type="button" className="sp-chat" title="Open this chat" onClick={() => onChat(c.chat.sessionId)}>
          <i aria-hidden style={{ background: chipOf(c.progress).color }} />{nameOf(c)}<span>{chipOf(c.progress).label}</span>
        </button></li>)}
      </ul>}
      <PageStats label="Ship status" items={[
        { label: 'Uncommitted files', value: files, tone: files ? 'yellow' : undefined, hint: shown !== undefined && shown !== files ? `${shown} shown in Changes` : undefined },
        ...(tree ? [{ label: 'Commits not merged', value: tree.commits, tone: tree.commits ? 'blue' as const : undefined }, { label: 'Merges into', value: into }] : [
          { label: 'Commits ahead', value: repo ? repo.ahead : row.ahead, tone: (repo?.ahead ?? row.ahead) ? 'blue' as const : undefined },
          { label: 'PR', value: repo?.pr ? `${repo.pr.number ? `#${repo.pr.number} ` : ''}${repo.pr.state.toLowerCase()}` : 'None' },
          { label: 'CI', value: ciText, tone: ciText === 'Passing' ? 'green' as const : ciText === 'Running' ? 'yellow' as const : ci ? 'red' as const : undefined },
        ]),
      ]} />
      <p className="sp-next"><b>Next</b><span>{next}</span>{!tree && files > 3 && <button type="button" className="hub-link" onClick={() => document.getElementById('hub-git')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })}>Go to commit</button>}</p>
      {top && trees}
      <div className="sp-work">{changes}<div id="hub-git" className="sp-work">{git}</div></div>
      {!top && trees}
      <Sec id="sp-more" title="Servers and terminals" note="Dev servers, shells and research runs for these projects.">
        <div className="sp-more">{dev}{terminals}{tracker}</div>
      </Sec>
    </div>
  )
}

/** Ship: pick a repo or worktree on the left, chat or no chat; its changes and git on the right. On phone the list folds behind Switch. */
export function ShipPage(p: Props) {
  const { hub, rows, pick, onPick } = p
  const [open, setOpen] = useState(false)
  const toggle = useRef<HTMLButtonElement>(null)
  // Narrow: the list folds under the focused row, so focus goes to the button that opens it.
  const choose = (id: string) => { onPick(id); if (open) { setOpen(false); toggle.current?.focus() } }
  const row = (r: ShipRepo) => <Row key={r.id} r={r} pick={pick} onPick={choose} />
  // Opens when the pick moves into it.
  const inClean = !!pick && rows.clean.some(r => r.id === pick.repo.id)
  const [cleanOpen, setCleanOpen] = useState(false)
  useEffect(() => { if (inClean) setCleanOpen(true) }, [inClean])
  return (
    <div className="sp-a">
      <div className="sp-side" data-open={open || undefined}>
        <button ref={toggle} type="button" className="sp-switch" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span>Switch repo</span><b>{pick ? pick.tree ? `${pick.repo.name} · ${pick.tree.name}` : pick.repo.name : 'None'}</b><i aria-hidden>{open ? '\u2303' : '\u2304'}</i>
        </button>
        <nav className="sp-list" aria-label="Repos and worktrees">
          <div className="sp-group">
            <h3>Ready to ship<span className="pk-n">{rows.ready.length}</span></h3>
            {rows.ready.length > 0 ? <ul role="list">{rows.ready.map(row)}</ul> : <p className="sp-empty">{hub.ship ? 'Everything is committed and pushed.' : 'Reading your repos...'}</p>}
          </div>
          {rows.clean.length > 0 && <div className="sp-group">
            <button type="button" className="sp-fold" aria-expanded={cleanOpen} onClick={() => setCleanOpen(!cleanOpen)}><b aria-hidden>›</b>Nothing to ship<span className="pk-n">{rows.clean.length}</span></button>
            {cleanOpen && <ul role="list">{rows.clean.map(row)}</ul>}
          </div>}
        </nav>
      </div>
      {pick ? <Detail {...p} pick={pick} /> : <p className="sp-empty">{hub.ship ? 'No repos in the picked projects.' : 'Reading your repos...'}</p>}
    </div>
  )
}
