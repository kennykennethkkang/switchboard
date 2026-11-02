'use client'
import { useState } from 'react'
import type { ChatProgress, RepoView } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { short } from '@/lib/pr-card'
import { checks, laneRows, shipAction, splitMessage } from '@/lib/ship-card'
import { caps, panel } from './look'
import { CommitText } from './commit-text'
import { CopyCommit } from './chat-cards'

const mono = { font: '400 12px/1.5 var(--hub-mono)' } as const
const ROW = 30, LANE = [10, 26], HEAD = 'var(--hub-blue)', BASE = 'var(--hub-violet)'
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const sum = (fs: { added: number; removed: number }[]) => fs.reduce((t, f) => ({ a: t.a + f.added, r: t.r + f.removed }), { a: 0, r: 0 })
const Counts = ({ a, r }: { a: number; r: number }) => <span style={{ ...mono, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}><span style={{ color: 'var(--hub-green)' }}>+{a}</span> <span style={{ color: 'var(--hub-red)' }}>-{r}</span></span>
const Stat = ({ n, word, warn }: { n: number | string; word: string; warn?: boolean }) => (
  <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, fontSize: 12, color: 'var(--hub-ash)' }}>
    <b style={{ font: '500 13px/1 var(--hub-mono)', fontVariantNumeric: 'tabular-nums', color: warn ? 'var(--hub-yellow)' : 'var(--hub-ink)' }}>{n}</b>{word}
  </span>
)

/** HEAD's lane and the base's, newest at the top, joining at the fork. */
function Lanes({ r }: { r: RepoView }) {
  const rows = laneRows(r.lanes)
  if (!rows.length) return null
  const y = (i: number) => i * ROW + ROW / 2
  const head = rows.findIndex(x => x.lane === 0), base = rows.findIndex(x => x.lane === 1)
  const fork = r.lanes?.fork ? rows.length - 1 : -1
  const lastBase = rows.map(x => x.lane).lastIndexOf(1)
  const forkY = fork >= 0 ? y(fork) : y(rows.length - 1) + ROW / 2
  const branch = r.branch ?? 'HEAD', against = r.lanes!.against
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 6 }}>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12, color: 'var(--hub-ash)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: HEAD }} /><code style={{ ...mono, color: 'var(--hub-body)' }}>{branch}</code></span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: BASE }} /><code style={{ ...mono, color: 'var(--hub-body)' }}>{against}</code></span>
      </span>
      <div style={{ position: 'relative', minWidth: 0 }}>
        <svg aria-hidden width={36} height={rows.length * ROW} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
          {head >= 0 && <line x1={LANE[0]} x2={LANE[0]} y1={y(head)} y2={forkY} stroke={HEAD} strokeWidth={2} strokeLinecap="round" />}
          {base >= 0 && <path d={`M${LANE[1]} ${y(base)} V${y(lastBase)} ${fork >= 0 ? `C${LANE[1]} ${forkY - 4} ${LANE[0]} ${forkY - ROW / 2} ${LANE[0]} ${forkY}` : `V${forkY}`}`}
            fill="none" stroke={BASE} strokeWidth={2} strokeLinecap="round" />}
          {rows.map((x, i) => x.commit.side === 'fork'
            ? <circle key={x.commit.hash} cx={LANE[0]} cy={y(i)} r={4.5} fill="var(--hub-canvas)" stroke="var(--hub-ash)" strokeWidth={2} />
            : <circle key={x.commit.hash} cx={LANE[x.lane]} cy={y(i)} r={4.5} fill={x.lane ? BASE : HEAD} stroke="var(--hub-canvas)" strokeWidth={2} />)}
        </svg>
        <ol role="list" aria-label={`Commits on ${branch} and ${against}`} style={{ listStyle: 'none', margin: 0, padding: '0 0 0 40px', display: 'grid' }}>
          {rows.map(({ commit: c, lane }) => (
            <li key={c.hash} style={{ height: ROW, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, color: c.side === 'fork' ? 'var(--hub-ash)' : 'var(--hub-body)' }}>
                <span className="sr-only">{c.side === 'fork' ? 'Split point: ' : lane ? `On ${against}: ` : `On ${branch}: `}</span>{c.subject || c.hash}
              </span>
              <span style={{ ...mono, color: 'var(--hub-ash)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                <code style={{ color: 'var(--hub-mute)' }}>{c.hash.slice(0, 7)}</code> · {c.author} · {short(c.at)}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function Files({ title, files }: { title: string; files: { path: string; added: number; removed: number }[] }) {
  const [all, setAll] = useState(false)
  if (!files.length) return null
  const t = sum(files), shown = all ? files : files.slice(0, 5)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 4, minWidth: 0 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'var(--hub-ash)' }}>
        <span>{title} · {plural(files.length, 'file')}</span><Counts a={t.a} r={t.r} />
      </span>
      <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', border: '1px solid var(--hub-hair)', borderRadius: 6 }}>
        {shown.map(f => (
          <li key={f.path} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px', minHeight: 26 }} title={f.path}>
            <span style={{ ...mono, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left', color: 'var(--hub-body)' }}><bdi>{f.path}</bdi></span>
            <Counts a={f.added} r={f.removed} />
          </li>
        ))}
      </ul>
      {files.length > shown.length && <button type="button" className="hub-link" style={{ justifySelf: 'start', padding: '2px 0', fontSize: 12 }} onClick={() => setAll(true)}>{files.length - shown.length} more</button>}
    </div>
  )
}

/** A finished chat's repo at a glance, and Kenneth's one press to ship it. Chats never press it. */
export function ShipCard({ repo, progress, sessionId, send, onCopy }: {
  repo: RepoView | null | undefined; progress: ChatProgress; sessionId: string
  send: (c: HubCommand) => void; onCopy: (text: string) => Promise<boolean>
}) {
  // The files on screen when Kenneth pressed; the server refuses if its own list differs by then.
  const [asking, setAsking] = useState<string[] | null>(null)
  const [sentAt, setSentAt] = useState(0)
  const r = repo?.sessionId === sessionId ? repo : null
  if (!r) return null
  const act = shipAction(r)
  const msg = progress.commit ? splitMessage(progress.commit) : undefined
  // What git gets: the trailer is gone, so the card shows and copies the same.
  const text = msg && [msg.summary, msg.description].filter(Boolean).join('\n\n')
  const m = r.merge, conflicts = m?.conflicts ?? []
  const target = r.upstream ?? `origin/${r.branch}`
  const busy = !!r.busy
  const result = sentAt && r.result && r.result.at >= sentAt ? r.result : undefined
  const needsMsg = act.kind === 'ship' && !msg?.summary
  const run = (cmd: Omit<Extract<HubCommand, { type: 'hub-git' }>, 'type' | 'sessionId'>) => { setAsking(null); setSentAt(Date.now()); send({ type: 'hub-git', sessionId, ...cmd }) }
  const ask = act.kind === 'ship'
    ? `Commit ${plural(act.files.length, 'file')} to ${r.branch} and push to ${target}?`
    : `Push ${r.branch} to ${target}?`

  return (
    <section aria-label="Ship" aria-busy={busy} style={{ ...panel, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <h3 style={caps}><span>Ship · {r.name}</span><span style={{ textTransform: 'none' }}>{r.branch ?? 'detached'} → {target}</span></h3>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
        {r.upstream ? <><Stat n={`↑${r.ahead}`} word="ahead" /><Stat n={`↓${r.behind}`} word="behind" warn={r.behind > 0} /></> : <Stat n="new" word="branch, not pushed yet" />}
        {m && m.base !== r.branch && <Stat n={m.behind} word={`behind ${m.base}`} warn={m.behind > 0} />}
        {m?.files ? <Stat n={m.files} word={m.files === 1 ? 'conflict' : 'conflicts'} warn /> : null}
      </div>

      <Lanes r={r} />

      {conflicts.length > 0 && <div role="note" style={{ display: 'grid', gap: 4, padding: '8px 10px', borderRadius: 8, background: 'var(--hub-yellow-soft, var(--hub-canvas))', border: '1px solid var(--hub-hair)', fontSize: 12 }}>
        <span style={{ color: 'var(--hub-yellow)' }}>Would conflict with {m!.base}</span>
        {conflicts.map(c => <code key={c.path} style={{ ...mono, color: 'var(--hub-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.path}>{c.path}{c.line ? `:${c.line}` : ''} <span style={{ color: 'var(--hub-ash)' }}>· {c.by}</span></code>)}
        {m!.files > conflicts.length && <span style={{ color: 'var(--hub-ash)' }}>and {m!.files - conflicts.length} more</span>}
      </div>}

      <Files title={r.upstream ? `Not on ${r.upstream} yet` : 'Not pushed yet'} files={r.outgoing ?? []} />

      {progress.tests && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: 12 }} title={progress.tests.command}>
        {checks(progress.tests).map(c => <span key={c.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--hub-body)' }}>
          <i aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: c.ok ? 'var(--hub-green)' : 'var(--hub-red)' }} />
          {c.name} {c.ok ? 'passed' : 'failed'}{c.detail && <span style={{ color: 'var(--hub-ash)' }}>· {c.detail}</span>}
        </span>)}
        <span style={{ ...mono, color: 'var(--hub-ash)', marginLeft: 'auto' }}>{short(progress.tests.at)}</span>
      </div>}

      {text ? <CommitText text={text} max={200} /> : <p style={{ margin: 0, fontSize: 12, color: 'var(--hub-ash)' }}>The chat left no commit message.</p>}

      {asking && (act.kind === 'ship' || act.kind === 'push')
        ? <div role="alertdialog" aria-label="Confirm commit and push" onKeyDown={e => { if (e.key === 'Escape') setAsking(null) }} style={{ display: 'grid', gap: 8, padding: 10, borderRadius: 8, border: '1px solid var(--hub-hair-strong)', background: 'var(--hub-canvas)', fontSize: 13, color: 'var(--hub-ink)' }}>
            <span>{ask}{act.kind === 'ship' && act.kept.length > 0 && <span style={{ color: 'var(--hub-ash)' }}> Leaves out {act.kept.join(', ')}.</span>}</span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="hub-btn sm primary" autoFocus disabled={busy}
                onClick={() => run({ op: 'ship', files: asking, summary: msg?.summary ?? '', description: msg?.description ?? '', confirmed: true })}>{act.kind === 'ship' ? 'Commit & push' : 'Push'}</button>
              <button type="button" className="hub-btn sm" onClick={() => setAsking(null)}>Cancel</button>
            </span>
          </div>
        : <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            {text && <CopyCommit small text={text} onCopy={onCopy} />}
            {(act.kind === 'pull' || act.kind === 'merge') && <span style={{ fontSize: 12, color: 'var(--hub-yellow)' }}>{act.note}</span>}
            {act.kind === 'merge'
              ? <span role="status" style={{ padding: '6px 12px', fontSize: 12, marginLeft: 'auto', color: 'var(--hub-yellow)', fontWeight: 500 }}>{act.label}</span>
              : act.kind === 'pull'
              ? <button type="button" className="hub-btn sm" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => run({ op: 'sync' })} title="git pull --ff-only">Pull first</button>
              : <button type="button" className="hub-btn sm primary" style={{ marginLeft: 'auto' }} disabled={busy || act.kind === 'none' || needsMsg}
                  title={needsMsg ? 'The chat left no commit message' : act.kind === 'none' ? act.label : undefined} onClick={() => setAsking(act.kind === 'ship' || act.kind === 'push' ? act.files : null)}>
                  {r.busy === 'ship' ? 'Pushing…' : act.label}
                </button>}
          </div>}

      <p aria-live="polite" style={{ margin: 0, fontSize: 12, color: result?.ok === false ? 'var(--hub-red)' : 'var(--hub-mute)' }}>
        {busy && sentAt ? 'Running git…' : result?.text ?? ''}
      </p>
    </section>
  )
}
