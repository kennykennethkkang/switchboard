'use client'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { CrowdLive, HubState, MirofishReport, MirofishState } from '@/lib/hub-types'
import { crowdStory, mfRunning, mirofishStory, type Story } from '@/lib/live-story'
import { runningChecks } from '@/lib/source-check'
import type { SmartState } from '@/lib/smart'
import type { HubCommand } from '@/lib/vscode-bridge'
import { SmartPicks, SmartSummary, SmartTables } from './smart-select'
import { PageStats, Seg } from './page-kit'
import { SourceCheckCard } from './source-check-card'
import './live-page.css'

type Send = (m: HubCommand) => void

/** Runs still moving: a MiroFish sim in its rounds or report, a crowd-ab run not ended, a source check still being written. */
export const liveCount = (h: Pick<HubState, 'mirofish' | 'crowdAb'> & Partial<Pick<HubState, 'sourceChecks'>>) =>
  (h.mirofish && mfRunning(h.mirofish) ? 1 : 0) + (h.crowdAb && !h.crowdAb.ended && !h.crowdAb.stopped ? 1 : 0) + runningChecks(h.sourceChecks)

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

// One report: takeaway on one line, the full text on demand.
function ReportRow({ r, send }: { r: MirofishReport; send: Send }) {
  return (
    <li className="lv-rep">
      <details>
        <summary>
          <span className="lv-r-title">{r.title}</span>
          <span className="lv-r-meta">{when(r.at)}</span>
          <span className="lv-r-take">{takeaway(r)}</span>
        </summary>
        <div className="lv-r-body">
          {r.requirement && <p className="lv-r-q"><b>The question:</b> {r.requirement}</p>}
          {!r.translated && notEnglish(`${r.title} ${r.markdown ?? ''}`) && <p className="lv-r-q" role="status">MiroFish wrote this one in Chinese. The English version is on the way and replaces it here in a minute or two.</p>}
          {r.markdown ? <ReportText markdown={r.markdown.replace(/^#\s+.*\n+/, '')} /> : r.summary && <p>{r.summary}</p>}
          <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-mirofish-report', simId: r.simId })}>Open in VS Code</button>
        </div>
      </details>
    </li>
  )
}

function ReportList({ reports, send, max }: { reports: MirofishReport[]; send: Send; max?: number }) {
  const [all, setAll] = useState(false)
  const shown = max && !all ? reports.slice(0, max) : reports
  return (
    <>
      <ul className="lv-reps" aria-label="MiroFish reports">{shown.map(r => <ReportRow key={r.simId} r={r} send={send} />)}</ul>
      {shown.length < reports.length && <button type="button" className="hub-btn lv-more" onClick={() => setAll(true)}>Show all {reports.length} reports</button>}
    </>
  )
}

const mfPct = (m: MirofishState) => m.step === 'rounds' ? m.percent : m.step === 'report' ? m.reportPercent ?? 0 : 100
const crowdLive = (c?: CrowdLive) => !!c && !c.ended && !c.stopped

type Props = { smart?: SmartState; mirofish?: MirofishState; crowd?: CrowdLive; reports?: MirofishReport[]; sourceChecks?: HubState['sourceChecks']; send: Send }

const mfPill = (m: MirofishState, s: Story) => m.stalled && m.step === 'rounds' ? 'Stalled' : s.tone === 'bad' ? 'Needs a look' : m.step === 'done' ? 'Finished' : m.step === 'report' ? 'Writing' : 'Live'

function MfActs({ mirofish, send }: { mirofish: MirofishState; send: Send }) {
  return (
    <div className="lv-acts">
      <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-mirofish-open', simId: mirofish.simId })}>Open in MiroFish</button>
      {mirofish.stalled && mirofish.step === 'rounds' && <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-live-dismiss', kind: 'mirofish', id: mirofish.simId })}>Dismiss</button>}
    </div>
  )
}

// Dense row for the tabbed layout: name, state, progress bar, one line of detail.
function RunRow({ name, pill, tn, pct: p, line, live, children }: { name: string; pill: string; tn: string; pct?: number; line: string; live?: boolean; children?: ReactNode }) {
  return (
    <li className="lv-run" data-tone={tn} data-live={live}>
      <div className="lv-run-top"><span className="lv-k"><i className="lv-dot" aria-hidden />{name}</span><span className="lv-pill">{pill}</span></div>
      {p !== undefined && <div className="lv-prog" role="progressbar" aria-label={`${name} progress`} aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${p}%` }} /></div>}
      <p className="lv-run-line">{line}</p>
      {children}
    </li>
  )
}

function RunningRows({ mirofish, crowd, sourceChecks, send }: Pick<Props, 'mirofish' | 'crowd' | 'sourceChecks' | 'send'>) {
  const cs = crowd && crowdStory(crowd), ms = mirofish && mirofishStory(mirofish)
  const checks = (sourceChecks ?? []).filter(r => !r.done)
  const showCrowd = crowd && cs && crowdLive(crowd), showMf = mirofish && ms && mfRunning(mirofish)
  const any = !!showCrowd || !!showMf || checks.length > 0
  if (!any) return <p className="lv-idle">Nothing is running right now.</p>
  return (
    <ul className="lv-runs" aria-label="Running now">
      {crowd && cs && showCrowd && <RunRow name="Crowd test" pill="Live" tn={tone(cs)} pct={pct(crowd.done, crowd.items)} line={cs.line} live />}
      {mirofish && ms && showMf && <RunRow name="MiroFish simulation" pill={mfPill(mirofish, ms)} tn={tone(ms)} pct={mfPct(mirofish)} line={ms.line} live={mfRunning(mirofish)}><MfActs mirofish={mirofish} send={send} /></RunRow>}
      {checks.map(r => <RunRow key={r.id} name="Source check" pill="Running" tn="run" live line={`${r.question} · ${r.sources.length} source${r.sources.length === 1 ? '' : 's'} scored so far`} />)}
    </ul>
  )
}

// What finished: the crowd verdict, if over, then the newest MiroFish takeaways.
function CrowdResult({ crowd, send }: { crowd?: CrowdLive; send: Send }) {
  if (!crowd || crowdLive(crowd)) return null
  const s = crowdStory(crowd)
  return (
    <div className="lv-res" data-tone={tone(s)}>
      <span className="lv-k">Crowd test</span>
      <strong>{s.head}</strong>
      <span className="lv-sub">{s.line}</span>
      {crowd.stopped && !crowd.ended && <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-live-dismiss', kind: 'crowd', id: crowd.run })}>Dismiss</button>}
    </div>
  )
}

// A stalled or failed sim is not running, so it is listed here with a way to clear it.
const mfStuck = (m?: MirofishState) => !!m && !mfRunning(m) && mirofishStory(m).tone === 'bad'
function MfStuck({ mirofish, send }: { mirofish?: MirofishState; send: Send }) {
  if (!mirofish || !mfStuck(mirofish)) return null
  const s = mirofishStory(mirofish)
  return (
    <div className="lv-res" data-tone="bad">
      <span className="lv-k">MiroFish simulation</span>
      <strong>{s.head}</strong>
      <span className="lv-sub">{s.line}</span>
      <div className="lv-acts">
        <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-mirofish-open', simId: mirofish.simId })}>Open in MiroFish</button>
        <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-live-dismiss', kind: 'mirofish', id: mirofish.simId })}>Dismiss</button>
      </div>
    </div>
  )
}

const checkCards = (runs: NonNullable<HubState['sourceChecks']>, send: Send) => <div className="sc-list">{runs.map(r => <SourceCheckCard key={r.id} run={r} send={send} compact />)}</div>

export function LivePage({ mirofish, crowd, reports = [], sourceChecks = [], smart, send }: Props) {
  const [tab, setTab] = useState<'run' | 'res' | 'rep' | 'smart'>('run')
  const hasSmart = !!smart && (smart.picks.length > 0 || smart.rates.length > 0)
  if (!mirofish && !crowd && !reports.length && !sourceChecks?.length && !hasSmart) return (
    <section className="cp-card" style={{ display: 'grid', gap: 6, padding: '32px 4px', color: 'var(--hub-ash)' }}>
      <strong style={{ color: 'var(--hub-ink)', fontSize: 15 }}>Nothing running</strong>
      <span>Long checks show up here as they run: a source check on a research answer, a crowd of simulated users rating a design, or a MiroFish simulation. Finished MiroFish reports are saved and kept here, in English.</span>
    </section>
  )
  const running = liveCount({ mirofish, crowdAb: crowd, sourceChecks })
  const rates = smart?.rates ?? []
  const nAll = rates.reduce((s, r) => s + r.n, 0), kept = nAll ? Math.round(100 * rates.reduce((s, r) => s + r.useful, 0) / nAll) : undefined
  const done = (sourceChecks ?? []).filter(r => r.done)
  const resN = (mfStuck(mirofish) ? 1 : 0) + (crowd && !crowdLive(crowd) ? 1 : 0) + Math.min(reports.length, 3) + done.length
  const stats = <PageStats label="Live summary" items={[
    { label: 'Running now', value: running, tone: running ? 'blue' : undefined, hint: running ? undefined : 'all quiet', onClick: () => setTab('run') },
    { label: 'MiroFish reports', value: reports.length, onClick: () => setTab('rep') },
    { label: 'Source checks', value: sourceChecks?.length ?? 0 },
    { label: 'Smart picks kept', value: kept !== undefined ? `${kept}%` : 'none yet', tone: kept !== undefined && kept >= 80 ? 'green' : undefined, hint: nAll ? `of ${nAll} judged` : undefined, onClick: () => setTab('smart') },
  ]} />

  return (
    <div className="lv lv-b pk-page">
      {stats}
      <Seg label="Live view" value={tab} onChange={setTab} options={[['run', 'Running', running], ['res', 'Results', resN], ['rep', 'Reports', reports.length], ['smart', 'Smart', smart?.picks.length ?? 0]]} />
      {tab === 'run' && <RunningRows mirofish={mirofish} crowd={crowd} sourceChecks={sourceChecks} send={send} />}
      {tab === 'res' && <>
        <MfStuck mirofish={mirofish} send={send} />
        <CrowdResult crowd={crowd} send={send} />
        {reports.slice(0, 3).map(r => <p key={r.simId} className="lv-line"><b>{r.title}</b><span>{takeaway(r)}</span></p>)}
        {resN === 0 && <p className="lv-idle">No results yet.</p>}
        {!!done.length && checkCards(done, send)}
      </>}
      {tab === 'rep' && (reports.length ? <ReportList reports={reports} send={send} /> : <p className="lv-idle">No reports saved yet.</p>)}
      {tab === 'smart' && (smart && hasSmart ? <>
        <SmartSummary smart={smart} />
        <details className="lv-fold"><summary>Best pick per task</summary><SmartTables smart={smart} /></details>
        <h3 className="lv-h3">Recent picks</h3><SmartPicks smart={smart} />
      </> : <p className="lv-idle">Nothing learned yet.</p>)}
    </div>
  )
}
