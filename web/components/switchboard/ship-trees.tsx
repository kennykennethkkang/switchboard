'use client'
import { useEffect, useRef, useState } from 'react'
import type { ShipRepo, ShipTree } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { treeLine, treeState } from '@/lib/ship-list'
import { ago } from '@/lib/look'
import { Switch } from './gear'
import { Sec } from './page-kit'
import { Branch } from './worktree-merge'

const HOLD_MS = 30_000
const when = (at: number) => { const t = ago(at); return t === 'now' ? 'just now' : `${t} ago` }

/** A repo's worktrees on Ship: merge one, all that are ready, or let them merge on their own. They go into the branch the checkout is on. */
export function ShipTrees({ repo, only, globalOff, phone, send, onPick }: {
  repo: ShipRepo; only?: ShipTree; globalOff: boolean; phone: boolean; send: (c: HubCommand) => void; onPick: (id: string) => void
}) {
  // 'all' or a worktree's id: whose confirm is open, and what was just pressed (held until the list shows it, 30 s at most).
  const [ask, setAsk] = useState<string>()
  const [sent, setSent] = useState<string>()
  useEffect(() => { if (!sent) return; const t = setTimeout(() => setSent(undefined), HOLD_MS); return () => clearTimeout(t) }, [sent])
  useEffect(() => { if (repo.merging || repo.merge?.at) setSent(undefined) }, [repo.merging, repo.merge?.at])
  const back = useRef<HTMLButtonElement | null>(null)
  // A merged row takes its button with it; focus then goes to the outcome line.
  const status = useRef<HTMLParagraphElement>(null), pressed = useRef(false)
  useEffect(() => { if (pressed.current && document.activeElement === document.body) { pressed.current = false; status.current?.focus({ preventScroll: true }) } })
  const into = repo.branch ?? 'the checkout'
  const busy = !!repo.merging || !!sent
  const trees = only ? [only] : repo.trees
  const ready = repo.trees.filter(t => treeState(t).can === 'merge')
  const close = () => { setAsk(undefined); requestAnimationFrame(() => (back.current?.isConnected ? back.current : status.current)?.focus()) }
  const go = (id: string, hold: boolean) => {
    if (busy) return
    pressed.current = true
    send(id === 'all' ? { type: 'hub-git', sessionId: repo.id, op: 'merge-all', confirmed: true } : { type: 'hub-git', sessionId: id, op: 'merge-back', confirmed: true })
    if (hold) setSent(id)
    close()
  }
  const open = (id: string) => (e: React.MouseEvent<HTMLButtonElement>) => { back.current = e.currentTarget; setAsk(ask === id ? undefined : id) }
  const confirm = (id: string, text: string, yes: string, hold = true) => ask === id && (
    <div role="alertdialog" aria-label="Confirm merge" aria-describedby="sp-ask" className="wt-ask">
      <p id="sp-ask">{text}</p>
      <span className="wt-acts">
        <button type="button" className="hub-btn sm primary" autoFocus aria-disabled={busy || undefined} onClick={() => go(id, hold)}>{yes}</button>
        <button type="button" className="hub-btn sm" onClick={close}>Cancel</button>
      </span>
    </div>
  )
  const auto = !globalOff && repo.auto
  return (
    <Sec id="sp-trees" title={only ? 'Merge this worktree' : 'Worktrees'} count={only ? undefined : repo.trees.length}
      note={auto ? `Each one merges into ${into} about 2 minutes after its chat ends, as uncommitted changes.` : globalOff ? 'Auto merge is off for every repo in Settings. Merge them here.' : 'Auto merge is off for this repo. Merge them here.'}
      actions={!phone && <Switch label={`Auto merge for ${repo.name}`} text="Auto merge" on={auto} disabled={globalOff} onChange={on => send({ type: 'hub-auto-merge', repo: repo.id, on })} />}>
      {trees.length > 0 && <ul role="list" className="sp-trees">
        {trees.map(t => {
          const s = treeState(t, repo.merging), label = s.can === 'queue' ? 'Merge when it ends' : `Merge into ${into}`
          return (
            <li key={t.id} className="sp-tree" onKeyDown={e => { if (e.key === 'Escape' && ask === t.id) close() }}>
              <span className="sp-tree-name"><Branch /><b>{t.name}</b><span>{treeLine(t)}</span></span>
              <span className="sp-badge" data-tone={s.tone}>{sent === t.id || (sent === 'all' && s.can === 'merge') ? 'Merging' : s.text}</span>
              <span className="sp-tree-acts">
                {!only && <button type="button" className="hub-btn sm" aria-label={`Review ${t.name}`} onClick={() => onPick(t.id)}>Review</button>}
                {!phone && s.can !== 'no' && <button type="button" className={`hub-btn sm${only && s.can === 'merge' && !busy && ask !== t.id ? ' primary' : ''}`} aria-label={`${label}: ${t.name}`} aria-disabled={busy || undefined} aria-expanded={ask === t.id}
                  onClick={e => { if (!busy) open(t.id)(e) }}>{label}</button>}
              </span>
              {confirm(t.id, s.can === 'queue'
                ? `Merge ${t.name} into the branch you are on as soon as its chat ends? It lands as uncommitted changes after the repo's checks pass.`
                : t.files || t.commits === 0 || !t.branch ? `Merge ${t.name} into ${into}? It lands as uncommitted changes. The repo's checks run first, and it is undone if they fail. Nothing is committed or pushed.`
                : `Merge the ${t.commits === 1 ? 'commit' : `${t.commits} commits`} on ${t.branch} into ${into} and remove the worktree? Nothing is pushed.`,
              s.can === 'queue' ? 'Merge when it ends' : 'Merge', s.can !== 'queue')}
            </li>
          )
        })}
      </ul>}
      {!trees.length && <p className="sp-empty">No worktrees here. A chat started with Own worktree shows up in this list.</p>}
      {!only && !phone && ready.length > 1 && <div className="sp-all-wrap" onKeyDown={e => { if (e.key === 'Escape' && ask === 'all') close() }}>
        <button type="button" className="hub-btn sm sp-all" aria-disabled={busy || undefined} aria-expanded={ask === 'all'} onClick={e => { if (!busy) open('all')(e) }}>Merge all {ready.length} into {into}</button>
        {confirm('all', `Merge ${ready.length} worktrees into ${into}? The repo's checks run after each one, and one that breaks them is undone and kept. Nothing is committed or pushed.`, 'Merge all')}
      </div>}
      {phone && ready.length > 0 && <p className="sp-empty">Merge from the Mac.</p>}
      <p ref={status} tabIndex={-1} className="sp-merge" role="status" data-bad={!busy && repo.merge && !repo.merge.ok ? true : undefined}>
        {busy ? 'Merging. The repo\'s checks run first, this can take a few minutes.' : repo.merge ? `${repo.merge.text} (${when(repo.merge.at)})` : ''}
      </p>
    </Sec>
  )
}
