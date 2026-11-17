'use client'
import { useEffect, useRef, useState } from 'react'
import { MAC_ONLY_GIT, type ChatRow, type GitOp, type RepoFile, type RepoView } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { boxNote } from '@/lib/message-box'
import { branchUrl, resolvePrompt } from '@/lib/pr-card'
import { mergeMessage, splitMessage } from '@/lib/ship-card'
import { caps, panel, repoOf } from './look'
import { PrCard } from './pr-card'
import { CiCard } from './check-cards'
import { useDismiss } from './use-popover'
import { useDraft } from '@/hooks/use-draft'
import './git-panel.css'
import { getDraft } from '@/lib/drafts'

type Git = Omit<Extract<HubCommand, { type: 'hub-git' }>, 'type' | 'sessionId'>
// danger: loses work or history, so the box and its button read red.
type Ask = { text: string; yes: string; cmd: Git; danger?: boolean }

const field = { font: '400 13px/1.4 var(--hub-sans)', padding: '7px 10px', borderRadius: 8, minWidth: 0, background: 'var(--hub-canvas)', color: 'var(--hub-ink)', border: '1px solid var(--hub-hair)' } as const
const TAG: Record<RepoFile['status'], string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U', conflict: '!' }
const MAIN = /^(main|master)$/
// Repo name to the Write commit message reply already handled, so a remount (each chat switch) never offers it again.
const usedDrafts = new Map<string, number>()
const BOX = { filled: 'Also in Source Control.', typed: 'Source Control has your own text, so it was left alone.', missing: 'No Source Control box for this repo in this window.' } as const
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
// origin/main -> origin, main. A new branch publishes to origin/<branch>.
const target = (r: RepoView) => {
  if (!r.upstream) return { remote: 'origin', name: r.branch ?? '' }
  const i = r.upstream.indexOf('/')
  return { remote: r.upstream.slice(0, i), name: r.upstream.slice(i + 1) }
}

/** Kenneth's git buttons for the chat's repo: each one a plain git or gh command in the extension, never run by a chat. */
/** shipping: the Ship card above has the primary button, so Commit steps back. */
export function GitPanel({ repo, sessionId, chat, commit, isVSCode, send, shipping, phone }: {
  repo: RepoView | null | undefined; sessionId: string; chat?: ChatRow; commit?: string; isVSCode: boolean; send: (c: HubCommand) => void; shipping?: boolean; phone?: boolean
}) {
  const mine = repo?.sessionId === sessionId ? repo : null
  // Files flipped from the default (every change but agent files); picking shows the list.
  const [toggled, setToggled] = useState<Set<string>>(new Set())
  const [picking, setPicking] = useState(false)
  const [offerPush, setOfferPush] = useState(false)
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [typed, setTyped] = useState(false)
  // Summary and description saved as one message; a restored draft counts as typed, so the auto-fill leaves it alone.
  const formKey = `commit:${chat?.cwd ?? repo?.name ?? sessionId}`
  const [draft, setDraft, clearDraft, restored] = useDraft(formKey)
  useEffect(() => {
    if (!restored || !draft) return
    const m = splitMessage(draft)
    setSummary(m.summary); setDescription(m.description); setTyped(true)
  }, [restored, draft])
  const keep = (sum: string, desc: string) => setDraft(desc.trim() ? `${sum}\n${desc}` : sum)
  const [menu, setMenu] = useState(false)
  const [newBranch, setNewBranch] = useState('')
  const [ask, setAsk] = useState<Ask | null>(null)
  const sent = useRef<{ op: GitOp; at: number } | undefined>(undefined)
  // seen: the pending message's at once it is in the form; spent: what a commit already used, until the repo reads again.
  const seen = useRef(0), spent = useRef<{ commit?: string; at?: number }>({})
  const branchWrap = useRef<HTMLDivElement>(null), branchBtn = useRef<HTMLButtonElement>(null)
  useDismiss(menu, branchWrap, () => { setMenu(false); branchBtn.current?.focus() })

  // Every finished chat's message since the last commit (or this chat's own) fills the form; once Kenneth types, new ones merge on top.
  const pending = repo?.sessionId === sessionId ? repo.pending : undefined
  const fill = pending && pending.at !== spent.current.at ? pending.text : !pending && commit !== spent.current.commit ? commit : undefined
  useEffect(() => {
    if (typed || !fill) return
    const m = splitMessage(fill)
    setSummary(m.summary); setDescription(m.description)
    seen.current = pending?.at ?? 0
  }, [fill, typed, pending?.at])
  // A chat finishing after Kenneth typed goes on top of his text: its summary first, his lines kept below.
  useEffect(() => {
    if (!typed || !pending || pending.at <= seen.current) return
    seen.current = pending.at
    const m = splitMessage(mergeMessage(`${summary}\n${description}`, pending.text))
    setSummary(m.summary); setDescription(m.description); keep(m.summary, m.description)
  }, [typed, pending?.at]) // eslint-disable-line react-hooks/exhaustive-deps
  // Write commit message (per repo), each reply handled once. Watched from busy to done: fills the form, or waits behind
  // Use draft when Kenneth typed meanwhile. Done before this mount: fills only an empty form with nothing saved.
  const d = mine?.draft
  const watching = useRef(false)
  const [ready, setReady] = useState<string>()
  const applied = useRef('')
  const applyDraft = (text: string) => {
    const m = splitMessage(text)
    applied.current = m.summary + '\n' + m.description
    setSummary(m.summary); setDescription(m.description); keep(m.summary, m.description); setTyped(true); setReady(undefined)
    seen.current = pending?.at ?? seen.current
  }
  useEffect(() => {
    if (d?.busy) { watching.current = true; return }
    const name = mine?.name ?? ''
    if (!d?.text || usedDrafts.get(name) === d.at) return
    usedDrafts.set(name, d.at)
    const mineNow = (typed && !!(summary.trim() || description.trim())) || !!getDraft(formKey)
    // A form still holding the last draft untouched counts as not typed, so a second click refills it.
    const own = typed && !!(summary.trim() || description.trim()) && summary + '\n' + description !== applied.current
    if (watching.current) { if (own) setReady(d.text); else applyDraft(d.text) }
    else if (!mineNow) applyDraft(d.text)
    watching.current = false
  }, [d?.busy, d?.text, d?.at]) // eslint-disable-line react-hooks/exhaustive-deps
  // A commit that went through clears the form.
  const result = mine?.result
  useEffect(() => {
    if (!result || !sent.current || result.at < sent.current.at) return
    const op = sent.current.op
    // Any outcome ends the wait; a failed commit must not let a later ok (Pull first) clear the form.
    sent.current = undefined
    if (!result.ok) return
    if (op === 'commit' || op === 'commit-push') { setSummary(''); setDescription(''); clearDraft(); spent.current = { commit, at: pending?.at }; setTyped(false); setReady(undefined); applied.current = ''; setToggled(new Set()); setPicking(false) }
    if (op === 'commit') setOfferPush(true)
    if (op === 'push' || op === 'sync' || op === 'commit-push') setOfferPush(false)
  }, [result, commit, pending?.at, clearDraft])

  // null: not a git repo.
  if (!mine) return repo === null ? null : (
    <section aria-label="Git" style={panel}>
      <h3 style={caps}><span>Git</span></h3>
      <p style={{ margin: 0, color: 'var(--hub-ash)', fontSize: 13 }}>Reading git in {chat ? repoOf(chat.cwd) : 'this repo'}…</p>
    </section>
  )
  const r = mine
  const busy = !!r.busy
  const may = (op: GitOp) => !phone || !MAC_ONLY_GIT.has(op)
  const run = (cmd: Git) => { sent.current = { op: cmd.op, at: Date.now() }; setAsk(null); send({ type: 'hub-git', sessionId, ...cmd }) }
  const open = (url: string) => (isVSCode ? send({ type: 'hub-open-url', url }) : window.open(url, '_blank', 'noopener'))
  const ship = r.ship && new Set(r.ship.files)
  const checked = r.files.filter(f => (ship ? ship.has(f.path) : true) !== toggled.has(f.path)).map(f => f.path)
  const left = r.files.length - checked.length
  const t = target(r)
  // Pushing to main or master asks in the page first.
  const pushing = (cmd: Git, what: string) => (MAIN.test(t.name) ? setAsk({ text: `${what} to ${t.remote}/${t.name}?`, yes: 'Push', cmd: { ...cmd, confirmed: true } }) : run(cmd))
  const sync = () => (r.sync.kind === 'push' || r.sync.kind === 'publish' ? pushing({ op: 'sync' }, r.sync.kind === 'push' ? `Push ${plural(r.ahead, 'commit')}` : `Publish ${r.branch}`) : run({ op: 'sync' }))
  const canCommit = !busy && !!summary.trim() && checked.length > 0 && !!r.branch
  // An empty summary takes the chat message's first line, once Kenneth leaves the description.
  const fallback = fill ? splitMessage(fill).summary.trim() : ''
  const fillSummary = () => { if (!summary.trim() && fallback) { setSummary(fallback); keep(fallback, description) } }
  const needSummary = !summary.trim() && checked.length > 0
  const toggle = (p: string) => setToggled(u => { const n = new Set(u); if (n.has(p)) n.delete(p); else n.add(p); return n })
  const all = checked.length === r.files.length
  // Shown whenever there is something to push, so the phone can push commits made before a reload; a fresh commit also offers publishing.
  const canPush = !!r.branch && (r.upstream ? r.ahead > 0 : offerPush)
  const compare = r.github && r.branch && `${branchUrl(r.github, 'compare', t.name)}?expand=1`
  const head = r.log[0]
  const createPr = r.github && r.upstream && !MAIN.test(t.name) && (isVSCode
    ? <button type="button" className="hub-btn sm" disabled={busy} onClick={() => run({ op: 'pr' })} title="gh pr create --fill --web, or the compare page">Create pull request</button>
    : compare && <a className="hub-btn sm" style={{ textDecoration: 'none' }} href={compare} target="_blank" rel="noopener noreferrer">Create pull request ↗</a>)
  // The chat itself merges and fixes; a chat that cannot take a message gets a new one in its folder.
  const resolve = () => {
    if (!r.merge || !chat) return
    const text = resolvePrompt(r.merge)
    send(boxNote(chat) ? { type: 'hub-new-chat', path: chat.cwd, text, remote: false } : { type: 'hub-send', sessionId, text })
  }

  return (
    <section aria-label="Git" aria-busy={busy} style={panel}>
      <h3 style={caps}>
        <span>Git · {r.name}</span>
        {r.github && <button type="button" className="hub-link" style={{ padding: '2px 4px', font: 'inherit', textTransform: 'none' }}
          onClick={() => open(r.branch && r.upstream ? branchUrl(r.github!, 'tree', t.name) : r.github!)}>Open on GitHub ↗</button>}
      </h3>

      <div ref={branchWrap} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <button ref={branchBtn} type="button" className="hub-btn sm" style={{ fontFamily: 'var(--hub-mono)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          aria-expanded={menu} onClick={() => setMenu(!menu)} title="Switch, create or delete a branch">
          {r.branch ?? 'detached HEAD'} ▾
        </button>
        <span style={{ font: '400 12px/1 var(--hub-mono)', color: 'var(--hub-ash)' }}
          title={r.upstream ? `Against ${r.upstream}` : 'No upstream yet'}>{r.upstream ? `↑${r.ahead} ↓${r.behind}` : 'not published'}</span>
        {may('sync') && <button type="button" className="hub-btn sm" style={{ marginLeft: 'auto' }} disabled={busy || !r.branch} onClick={sync}
          title={r.sync.kind === 'publish' ? `git push -u origin ${r.branch}` : `git ${r.sync.kind}`}>{r.busy === 'sync' ? 'Working…' : r.sync.label}</button>}

      {menu && <div role="group" aria-label="Branches" style={{ flexBasis: '100%', display: 'grid', gap: 6, padding: 10, borderRadius: 8, border: '1px solid var(--hub-hair)', background: 'var(--hub-canvas)' }}>
        <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2, maxHeight: 220, overflowY: 'auto' }}>
          {r.branches.map(b => {
            const here = b === r.branch
            return <li key={b} style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
              <button type="button" className="hub-link" disabled={busy} aria-current={here || undefined}
                onClick={() => { setMenu(false); if (here) return; if (r.files.length) setAsk({ text: `Stash ${plural(r.files.length, 'changed file')} and switch to ${b}? Pop stash brings them back.`, yes: 'Stash and switch', cmd: { op: 'switch', branch: b, stash: true } }); else run({ op: 'switch', branch: b }) }}
                title={here ? 'Current branch' : `git switch ${b}`}
                style={{ flex: 1, minWidth: 0, textAlign: 'left', font: '400 12px/1.3 var(--hub-mono)', color: here ? 'var(--hub-ink)' : undefined, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {here ? '● ' : ''}{b}
              </button>
              {!here && !MAIN.test(b) && may('delete-branch') && <button type="button" className="hub-link" aria-label={`Delete ${b}`} disabled={busy}
                onClick={() => setAsk({ text: `Delete the local branch ${b}? git keeps it if it has unmerged commits.`, yes: 'Delete', danger: true, cmd: { op: 'delete-branch', branch: b, confirmed: true } })}>✕</button>}
            </li>
          })}
        </ul>
        <form style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} onSubmit={e => { e.preventDefault(); if (newBranch.trim()) { run({ op: 'create', branch: newBranch.trim() }); setNewBranch(''); setMenu(false) } }}>
          <input aria-label="New branch name" placeholder="new-branch-name" value={newBranch} onChange={e => setNewBranch(e.target.value)} style={{ ...field, flex: '1 1 140px', fontFamily: 'var(--hub-mono)', fontSize: 12 }} />
          <button type="submit" className="hub-btn sm" disabled={busy || !newBranch.trim()}>New branch</button>
        </form>
      </div>}
      </div>

      {r.merge
        ? <PrCard repo={r} create={createPr} busy={busy || !chat} onOpen={open} onResolve={resolve} />
        : <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12 }}>
            {r.pr
              ? <button type="button" className="hub-link" style={{ padding: '2px 0', fontSize: 12, textAlign: 'left' }} onClick={() => open(r.pr!.url)}>
                  PR {r.pr.state.toLowerCase()}: {r.pr.title} ↗
                </button>
              : createPr}
          </div>}

      {r.ci && <CiCard run={r.ci} busy={busy} onOpen={() => open(r.ci!.url)} onRerun={() => run({ op: 'rerun' })} />}

      {r.files.length > 0
        ? <>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--hub-ash)' }}>
              <span title={r.ship?.kept.length ? `Left out: ${r.ship.kept.join(', ')}` : undefined}>
                {toggled.size ? `${checked.length} of ${plural(r.files.length, 'file')} included` : `${plural(checked.length, 'file')}, all included${left ? ` (${left} agent ${left === 1 ? 'file' : 'files'} left out)` : ''}`}
              </span>
              <button type="button" className="hub-link" style={{ padding: '2px 4px', fontSize: 12 }} aria-expanded={picking} onClick={() => setPicking(!picking)}>{picking ? 'Done picking' : 'Pick files'}</button>
            </div>
            {picking && <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--hub-ash)' }}>
              <input type="checkbox" checked={all} ref={el => { if (el) el.indeterminate = !all && checked.length > 0 }}
                onChange={() => setToggled(new Set(r.files.filter(f => (ship ? ship.has(f.path) : true) === all).map(f => f.path)))} />
              {checked.length} of {plural(r.files.length, 'file')} checked
            </label>}
            {picking && <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 0, maxHeight: 260, overflowY: 'auto', border: '1px solid var(--hub-hair)', borderRadius: 6 }}>
              {r.files.map(f => (
                <li key={f.path}>
                  <label className="hub-check" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', minHeight: 30, cursor: 'pointer' }} title={f.from ? `${f.from} → ${f.path}` : f.path}>
                    <input type="checkbox" checked={checked.includes(f.path)} onChange={() => toggle(f.path)} />
                    <span style={{ flex: 1, minWidth: 0, font: '400 12px/1.4 var(--hub-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left' }}><bdi>{f.path}</bdi></span>
                    <span aria-label={f.status} style={{ font: '500 11px/1 var(--hub-mono)', color: f.status === 'deleted' || f.status === 'conflict' ? 'var(--hub-red)' : f.status === 'modified' || f.status === 'renamed' ? 'var(--hub-yellow)' : 'var(--hub-green)' }}>{TAG[f.status]}</span>
                  </label>
                </li>
              ))}
            </ul>}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12, color: d?.error ? 'var(--hub-red)' : 'var(--hub-ash)' }}>
              {/* aria-disabled while busy so keyboard focus stays on the button */}
              <button type="button" className="hub-btn sm" disabled={!r.files.length} aria-disabled={!!d?.busy}
                title="Haiku reads every uncommitted change and the finished chats' messages, then fills this form and Source Control"
                onClick={() => { if (!d?.busy) send({ type: 'hub-draft-commit', sessionId }) }}>{d?.busy ? 'Writing…' : 'Write commit message'}</button>
              <span role="status">
                {d && !d.busy && (d.error ?? BOX[d.box ?? 'missing'])}
                {ready && <>Draft ready<button type="button" className="hub-link" style={{ padding: '2px 4px', fontSize: 12 }} onClick={() => applyDraft(ready)}>Use draft</button></>}
              </span>
            </div>
            <input className="git-summary" aria-label="Commit summary" placeholder="Summary (required)" aria-describedby={needSummary ? 'git-need-summary' : undefined} aria-invalid={needSummary && !!description.trim() || undefined} value={summary} onChange={e => { setSummary(e.target.value); keep(e.target.value, description); setTyped(true) }} style={{ ...field, fontWeight: 500 }} />
            <textarea aria-label="Commit description" placeholder="Description: what this commit did, one bullet per line" rows={Math.min(12, Math.max(3, description.split('\n').length + 1))} value={description} onChange={e => { setDescription(e.target.value); keep(summary, e.target.value); setTyped(true) }} onBlur={fillSummary} style={{ ...field, resize: 'vertical' }} />
            {needSummary && <p id="git-need-summary" style={{ margin: 0, fontSize: 12, color: description.trim() ? 'var(--hub-yellow)' : 'var(--hub-ash)' }}>
              Add a summary to commit.{fallback && <> <button type="button" className="hub-link" style={{ padding: '2px 4px', fontSize: 12 }} onClick={fillSummary}>Use "{fallback.length > 48 ? `${fallback.slice(0, 48)}...` : fallback}"</button></>}
            </p>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" className={`hub-btn sm${shipping ? '' : ' primary'}`} style={{ flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} disabled={!canCommit}
                onClick={() => run({ op: 'commit', files: checked, summary, description })}>{r.busy === 'commit' ? 'Committing…' : `Commit to ${r.branch ?? 'branch'}`}</button>
              {may('commit-push') && <button type="button" className={shipping ? 'hub-link' : 'hub-btn sm'} style={shipping ? { fontSize: 12 } : undefined} disabled={!canCommit}
                onClick={() => pushing({ op: 'commit-push', files: checked, summary, description }, `Commit ${plural(checked.length, 'file')} and push`)}>{r.busy === 'commit-push' ? 'Working…' : 'Commit & push'}</button>}
            </div>
          </>
        : <p style={{ margin: 0, fontSize: 13, color: 'var(--hub-ash)' }}>Nothing to commit.</p>}

      {canPush && <button type="button" className="hub-btn sm primary" disabled={busy}
        onClick={() => pushing({ op: 'push' }, r.upstream ? `Push ${plural(r.ahead, 'commit')}` : `Publish ${r.branch}`)}
        title={`Fast-forward ${r.branch} to ${t.remote}/${t.name}, never forced`}>{r.busy === 'push' ? 'Pushing…' : `Push to ${t.remote}/${t.name}`}</button>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginLeft: -8 }}>
        {head && (!r.upstream || r.ahead > 0) && <button type="button" className="hub-link" disabled={busy} title="git reset --soft HEAD~1: the commit's changes stay, staged"
          onClick={() => setAsk({ text: `Undo the last commit, "${head.subject}"? Its changes stay as staged files.`, yes: 'Undo', danger: true, cmd: { op: 'undo', confirmed: true } })}>Undo last commit</button>}
        {r.files.length > 0 && <button type="button" className="hub-link" disabled={busy} onClick={() => run({ op: 'stash' })} title="git stash push -u">Stash</button>}
        {r.worktree && may('merge-back') && <button type="button" className="hub-link" disabled={busy} title="git merge into the main checkout, then remove this worktree. Never pushes."
          onClick={() => setAsk({ text: `Merge ${r.branch} into the main checkout? The worktree is removed too unless a chat is still running in it. Nothing is pushed.`, yes: 'Merge back', cmd: { op: 'merge-back', confirmed: true } })}>Merge back</button>}
        {r.stashes > 0 && <button type="button" className="hub-link" disabled={busy} onClick={() => run({ op: 'pop' })} title="git stash pop">Pop stash ({r.stashes})</button>}
        {checked.length > 0 && may('discard') && <button type="button" className="hub-link" disabled={busy} style={{ color: 'var(--hub-red)' }}
          onClick={() => setAsk({ text: `Discard the changes in ${plural(checked.length, 'checked file')}? New files are deleted. This cannot be undone.`, yes: 'Discard', danger: true, cmd: { op: 'discard', files: checked, confirmed: true } })}>Discard checked ({checked.length})</button>}
      </div>

      {ask && <div role="alertdialog" aria-label="Confirm" onKeyDown={e => { if (e.key === 'Escape') setAsk(null) }} style={{ display: 'grid', gap: 8, padding: 10, borderRadius: 8, border: `1px solid ${ask.danger ? 'var(--hub-red)' : 'var(--hub-hair-strong)'}`, background: ask.danger ? 'var(--hub-red-soft)' : 'var(--hub-elev)', color: 'var(--hub-ink)', fontSize: 13 }}>
        <span>{ask.text}</span>
        <span style={{ display: 'flex', gap: 8 }}>
          {/* Danger: focus starts on Cancel, so a stray Enter loses nothing. */}
          <button type="button" className={`hub-btn sm ${ask.danger ? 'danger' : 'primary'}`} autoFocus={!ask.danger} onClick={() => run(ask.cmd)}>{ask.yes}</button>
          <button type="button" className="hub-btn sm" autoFocus={ask.danger} onClick={() => setAsk(null)}>Cancel</button>
        </span>
      </div>}

      <p aria-live="polite" style={{ margin: 0, fontSize: 12, minHeight: 0, color: r.result?.ok === false ? 'var(--hub-red)' : 'var(--hub-mute)' }}>
        {r.busy ? 'Running git…' : r.result?.text ?? ''}
      </p>

      {r.log.length > 0 && <details className="hub-fold-list">
        <summary style={{ fontSize: 12, color: 'var(--hub-mute)' }}><b aria-hidden>›</b>Recent commits</summary>
        <ol role="list" style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'grid', gap: 2 }}>
          {r.log.map(l => <li key={l.hash} style={{ display: 'flex', gap: 8, fontSize: 12, minWidth: 0 }}>
            <code style={{ font: '400 12px/1.5 var(--hub-mono)', color: 'var(--hub-ash)' }}>{l.hash}</code>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--hub-body)' }}>{l.subject}</span>
            <span style={{ color: 'var(--hub-ash)', whiteSpace: 'nowrap' }}>{l.when}</span>
          </li>)}
        </ol>
      </details>}
    </section>
  )
}
