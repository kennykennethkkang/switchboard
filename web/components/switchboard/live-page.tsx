import type { ReactNode } from 'react'
import type { CrowdLive, HubState, MirofishReport, MirofishState } from '@/lib/hub-types'
import { crowdStory, eta, liveHeadline, mfRunning, mirofishStory, type Story } from '@/lib/live-story'
import { runningChecks } from '@/lib/source-check'
import type { SmartState } from '@/lib/smart'
import type { HubCommand } from '@/lib/vscode-bridge'
import { SmartSelect } from './smart-select'
import { SourceCheckCard } from './source-check-card'
import './live-page.css'

type Send = (m: HubCommand) => void

/** Runs still moving: a MiroFish sim in its rounds or report, a crowd-ab run not ended, a source check still being written. */
export const liveCount = (h: Pick<HubState, 'mirofish' | 'crowdAb'> & Partial<Pick<HubState, 'sourceChecks'>>) =>
  (h.mirofish && mfRunning(h.mirofish) ? 1 : 0) + (h.crowdAb && !h.crowdAb.ended && !h.crowdAb.stopped ? 1 : 0) + runningChecks(h.sourceChecks)

function Section({ id, title, blurb, children }: { id: string; title: string; blurb: string; children: ReactNode }) {
  return (
    <section className="lv-sec" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <p className="lv-sub">{blurb}</p>
      {children}
    </section>
  )
}

const tone = (s: Story) => s.tone === 'bad' ? 'bad' : s.tone === 'done' ? 'done' : 'run'
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
const notEnglish = (t: string) => /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(t)
const pct = (n: number, of: number) => of ? Math.round(n / of * 100) : 0

// Enough Markdown for MiroFish reports: headings, rules, quotes, lists, bold, paragraphs.
const inline = (t: string): ReactNode[] => t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith('**') && p.endsWith('**') ? <strong key={i} style={{ color: 'var(--hub-ink)' }}>{p.slice(2, -2)}</strong> : p)
function ReportText({ markdown }: { markdown: string }) {
  const blocks = markdown.replace(/\r/g, '').split(/\n{2,}/).map(b => b.trim()).filter(Boolean)
  return <div style={{ display: 'grid', gap: 12, fontSize: 14, lineHeight: 1.65, color: 'var(--hub-body)' }}>
    {blocks.map((b, i) => {
      if (/^(-{3,}|\*{3,})$/.test(b)) return <hr key={i} style={{ border: 0, borderTop: '1px solid var(--hub-hair)', margin: '4px 0', width: '100%' }} />
      if (/^\d+\.\s/.test(b)) return <ol key={i} style={{ margin: 0, paddingLeft: 20, listStyle: 'decimal' }}>{b.split('\n').map((l, j) => <li key={j}>{inline(l.replace(/^\d+\.\s+/, ''))}</li>)}</ol>
      const h = b.match(/^(#{1,6})\s+(.*)$/)
      if (h) return <strong key={i} style={{ color: 'var(--hub-ink)', fontSize: h[1].length <= 2 ? 16 : 14, marginTop: 8 }}>{inline(h[2])}</strong>
      if (b.startsWith('>')) return <blockquote key={i} style={{ margin: 0, paddingLeft: 12, borderLeft: '2px solid var(--hub-hair-strong)', color: 'var(--hub-mute)' }}>{inline(b.replace(/^>\s?/gm, ''))}</blockquote>
      if (/^[-*]\s/.test(b)) return <ul key={i} style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>{b.split('\n').map((l, j) => <li key={j}>{inline(l.replace(/^[-*]\s+/, ''))}</li>)}</ul>
      return <p key={i} style={{ margin: 0 }}>{inline(b)}</p>
    })}
  </div>
}

/** One line a person can read before opening a report: the summary, else the quote or first paragraph. */
function takeaway(r: MirofishReport): string {
  if (r.summary) return r.summary
  const body = (r.markdown ?? '').replace(/^#\s+.*\n+/, '').split(/\n{2,}/).map(b => b.trim()).find(b => b && !/^#{1,6}\s/.test(b) && !/^(-{3,}|\*{3,})$/.test(b))
  return (body ?? '').replace(/^>\s?/gm, '').replace(/\*\*/g, '').replace(/\n/g, ' ')
}

function reactions(crowd?: CrowdLive, mirofish?: MirofishState, max = 5) {
  const c = (crowd?.feed ?? []).slice(0, max).map((f, i) => ({
    key: `c${f.at}-${i}`, who: f.who, said: !!f.why,
    text: f.why ?? `Gave ${f.option} ${f.appeal !== undefined ? `${f.appeal.toFixed(1)} out of 4` : 'a rating'}${f.reason && f.reason !== 'none' ? `, for ${f.reason}` : ''}.`,
  }))
  // A post with no text (a like, a follow) reads as one sentence with no attribution under it.
  const m = (mirofish?.feed ?? []).slice(0, max).map((p, i) => {
    const did = `${p.who} ${p.action}${p.platform ? ` on ${p.platform}` : ''}`
    return p.text ? { key: `m${p.at}-${i}`, who: did, said: true, text: p.text } : { key: `m${p.at}-${i}`, said: false, text: `${did}.` }
  })
  return { c, m }
}

// No aria-live here: the verdict line carries the announcements.
function Quotes({ rows }: { rows: { key: string; who?: string; text: string; said: boolean }[] }) {
  if (!rows.length) return null
  return (
    <ul className="lv-quotes lv-ticker" aria-label="Newest reactions">
      {rows.map((r, i) => (
        <li key={r.key} className={i === 0 ? 'hub-feed-new' : undefined}>
          {r.said ? <q>{r.text}</q> : <em>{r.text}</em>}
          {r.who && <span>{r.who}</span>}
        </li>
      ))}
    </ul>
  )
}

// Bars scale to the top count; name, count, share and the "Most votes" tag are text, so color is never the only cue.
function Bars({ crowd }: { crowd: CrowdLive }) {
  const total = crowd.votes.reduce((s, v) => s + v.n, 0)
  const top = Math.max(0, ...crowd.votes.map(v => v.n))
  const solo = top > 0 && crowd.votes.filter(v => v.n === top).length === 1
  return (
    <ul className="lv-bars" aria-label="Votes per option">
      {crowd.votes.map(v => {
        const lead = solo && v.n === top
        return (
          <li key={v.label} className="lv-bar" data-lead={lead}>
            <span className="lv-bar-name">{v.label}{lead && <> <span className="lv-lead">Most votes</span></>}</span>
            <span className="lv-bar-n"><b>{v.n}</b> {v.n === 1 ? 'vote' : 'votes'}, {pct(v.n, total)}%</span>
            <span className="lv-bar-track" aria-hidden><span style={{ width: `${pct(v.n, top || 1)}%` }} /></span>
          </li>
        )
      })}
    </ul>
  )
}

function Ring({ pct, big, small, label }: { pct: number; big: string; small: string; label: string }) {
  const r = 52, c = 2 * Math.PI * r
  return (
    <div className="lv-ring" role="img" aria-label={label}>
      <svg viewBox="0 0 120 120" aria-hidden>
        <circle cx="60" cy="60" r={r} className="lv-ring-bg" />
        <circle cx="60" cy="60" r={r} className="lv-ring-fg" strokeDasharray={`${c * Math.min(100, pct) / 100} ${c}`} transform="rotate(-90 60 60)" />
      </svg>
      <div aria-hidden><b>{big}</b><span>{small}</span></div>
    </div>
  )
}

function Reports({ reports, send }: { reports: MirofishReport[]; send: Send }) {
  if (!reports.length) return null
  return (
    <section className="lv-sec" aria-labelledby="lv-reports">
      <h2 id="lv-reports">Reports to read</h2>
      <p className="lv-sub">Each MiroFish run ends in a written report. The takeaway is under the title; open one to read it all.</p>
      <ul className="lv-reports">
        {reports.map(r => (
          <li key={r.simId}>
            <details>
              <summary>
                <span className="lv-r-title">{r.title}</span>
                <span className="lv-r-take">{takeaway(r)}</span>
                <span className="lv-r-meta">{when(r.at)}{r.translated ? ', translated to English' : ''}</span>
              </summary>
              <div className="lv-r-body">
                {r.requirement && <p className="lv-r-q"><b>The question:</b> {r.requirement}</p>}
                {!r.translated && notEnglish(`${r.title} ${r.markdown ?? ''}`) && <p className="lv-r-q" role="status">MiroFish wrote this one in Chinese. The English version is on the way and replaces it here in a minute or two.</p>}
                {r.markdown ? <ReportText markdown={r.markdown.replace(/^#\s+.*\n+/, '')} /> : r.summary && <p>{r.summary}</p>}
                <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-mirofish-report', simId: r.simId })}>Open in VS Code</button>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Polite live region on the verdict only; it stays mounted so a change is announced. Bad tone keeps the head out of sight, the line says it.
function Verdict({ s, of }: { s: Story; of: string }) {
  return (
    <p className="lv-verdict-line">
      <strong aria-live="polite" aria-atomic>{s.tone !== 'bad' ? `${s.head}. ` : <span className="lv-sr">{of}: {s.head}. </span>}</strong>{s.line}
    </p>
  )
}

const mfPct = (m: MirofishState) => m.step === 'rounds' ? m.percent : m.step === 'report' ? m.reportPercent ?? 0 : 100

export function LivePage({ mirofish, crowd, reports = [], sourceChecks = [], smart, send }: { smart?: SmartState; mirofish?: MirofishState; crowd?: CrowdLive; reports?: MirofishReport[]; sourceChecks?: HubState['sourceChecks']; send: Send }) {
  const hasSmart = !!smart && (smart.picks.length > 0 || smart.rates.length > 0)
  if (!mirofish && !crowd && !reports.length && !sourceChecks?.length && !hasSmart) return (
    <section className="cp-card" style={{ display: 'grid', gap: 6, padding: '32px 4px', color: 'var(--hub-ash)' }}>
      <strong style={{ color: 'var(--hub-ink)', fontSize: 15 }}>Nothing running</strong>
      <span>Long checks show up here as they run: a source check on a research answer, a crowd of simulated users rating a design, or a MiroFish simulation. Finished MiroFish reports are saved and kept here, in English.</span>
    </section>
  )
  const cs = crowd && crowdStory(crowd), ms = mirofish && mirofishStory(mirofish)
  const rx = reactions(crowd, mirofish)
  return (
    <div className="lv">
      {(cs || ms) && <p className="lv-headline">{liveHeadline(mirofish, crowd, reports.length)}</p>}
      <div className="lv-boards">
        {crowd && cs && (
          <section className="lv-board" data-tone={tone(cs)} data-live={!crowd.ended && !crowd.stopped} aria-label="Crowd test scoreboard">
            <header><span className="lv-k"><i className="lv-dot" aria-hidden />Crowd test</span><span className="lv-pill">{crowd.ended ? 'Finished' : crowd.stopped ? 'Stopped' : 'Live'}</span></header>
            <div className="lv-big"><b>{crowd.done}</b><span>of {crowd.items} ratings</span></div>
            <Bars crowd={crowd} />
            <p className="lv-sub">{crowd.noPreference} had no preference.</p>
            <Verdict s={cs} of="Crowd test" />
            {crowd.stopped && !crowd.ended && <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-live-dismiss', kind: 'crowd', id: crowd.run })}>Dismiss</button>}
            <Quotes rows={rx.c} />
          </section>
        )}
        {mirofish && ms && (
          <section className="lv-board" data-tone={tone(ms)} data-live={mfRunning(mirofish)} aria-label="MiroFish scoreboard">
            <header><span className="lv-k"><i className="lv-dot" aria-hidden />MiroFish simulation</span><span className="lv-pill">{mirofish.stalled && mirofish.step === 'rounds' ? 'Stalled' : ms.tone === 'bad' ? 'Needs a look' : mirofish.step === 'done' ? 'Finished' : mirofish.step === 'report' ? 'Writing' : 'Live'}</span></header>
            {mirofish.step === 'rounds'
              ? <Ring pct={mfPct(mirofish)} big={`${mirofish.round}/${mirofish.rounds}`} small="rounds" label={`${mirofish.round} of ${mirofish.rounds} rounds`} />
              : mirofish.step === 'report'
                ? <Ring pct={mfPct(mirofish)} big={`${mirofish.reportPercent ?? 0}%`} small="report" label={`Report ${mirofish.reportPercent ?? 0}% written`} />
                : <Ring pct={100} big="Done" small={mirofish.saved ? 'saved' : 'report'} label={ms.head} />}
            <Verdict s={ms} of="MiroFish" />
            <p className="lv-sub">{mirofish.elapsedMs !== undefined && `Started ${eta(mirofish.elapsedMs)} ago \u00b7 `}Sim {mirofish.simId}</p>
            <div className="lv-acts">
              <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-mirofish-open', simId: mirofish.simId })}>Open in MiroFish</button>
              {mirofish.stalled && mirofish.step === 'rounds' && <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-live-dismiss', kind: 'mirofish', id: mirofish.simId })}>Dismiss</button>}
            </div>
            {mirofish.feed?.some(p => p.translated) && <p className="lv-sub">Posts translated to English</p>}
            <Quotes rows={rx.m} />
          </section>
        )}
      </div>
      <Reports reports={reports} send={send} />
      {!!sourceChecks?.length && (
        <Section id="live-source" title="Source check" blurb="How far to trust each source behind a research answer. Each is judged from outside the page, by its outlet and what it cites, never by how it looks.">
          <div className="sc-list">{sourceChecks.map(r => <SourceCheckCard key={r.id} run={r} send={send} />)}</div>
        </Section>
      )}
      {smart && hasSmart && (
        <Section id="live-smart" title="Smart select" blurb="What Switchboard picked for ponytail level, model, effort, roles and questions, and whether the pick held. A pick counts as useful when the chat is approved without a switch, a send back or a model move up.">
          <SmartSelect smart={smart} />
        </Section>
      )}
    </div>
  )
}
