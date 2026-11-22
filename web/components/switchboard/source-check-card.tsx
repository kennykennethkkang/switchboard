'use client'
import { useState } from 'react'
import { ago } from '@/lib/look'
import { bandTone, siteOf, summaryLine, type Source, type SourceRun } from '@/lib/source-check'
import { vscodeBridge, type HubCommand } from '@/lib/vscode-bridge'
import { caps, panel } from './look'
import './source-check-card.css'

// "Citations: 6 of 6 links resolve" reads as a bold name and its reason; other lines stay plain.
function Why({ line }: { line: string }) {
  const i = line.indexOf(': ')
  return i > 0 && i <= 26 ? <><b>{line.slice(0, i)}</b> {line.slice(i + 2)}</> : <>{line}</>
}

function Row({ s }: { s: Source }) {
  const { host, path } = siteOf(s.url), tone = bandTone(s.band)
  return (
    <li>
      {/* Open when the band says to look closer; a Reliable source stays folded. */}
      <details className="sc-src" data-tone={tone.color} open={tone.look || undefined}>
        <summary>
          <span className="sc-site" title={s.url}><strong>{host}</strong>{path && <span>{path}</span>}</span>
          <span className="sc-chip">{s.band}</span>
          <span className="sc-score">{Math.round(s.score)}</span>
          <span className="sc-bar" role="img" aria-label={`Score ${Math.round(s.score)} of 100`}><b style={{ width: `${Math.min(100, Math.max(0, s.score))}%` }} /></span>
        </summary>
        {s.reasons.length
          ? <ul className="sc-why" aria-label={`Why ${host} scored ${Math.round(s.score)}`}>{s.reasons.map((r, i) => <li key={i}><Why line={r} /></li>)}</ul>
          : <p className="sc-none">No detail was saved for this source.</p>}
      </details>
    </li>
  )
}

/** The report is a file on the Mac, so only VS Code can open it; a browser says so beside the button. */
function OpenReport({ report, send }: { report: string; send: (m: HubCommand) => void }) {
  const [said, setSaid] = useState(false)
  const open = () => {
    if (/^https?:\/\//.test(report)) return vscodeBridge?.isVSCode ? send({ type: 'hub-open-url', url: report }) : void window.open(report, '_blank', 'noopener')
    if (vscodeBridge?.isVSCode) vscodeBridge.openFile(report)
    else setSaid(true)
  }
  return (
    <>
      <button type="button" className="hub-btn" onClick={open}>Open report</button>
      {said && <span role="status" className="sc-said">The report is a file on your Mac. Open it from the Switchboard panel in VS Code.</span>}
    </>
  )
}

/** One source-check run: the question, a tally, then a row per source with its band, score and strongest reasons. */
export function SourceCheckCard({ run, send, now = Date.now() }: { run: SourceRun; send: (m: HubCommand) => void; now?: number }) {
  return (
    <section className="cp-card sc-run" aria-label={`Source check: ${run.question}`} style={panel}>
      <h3 style={caps}><span>{run.done ? 'Checked' : 'Checking'}</span><span style={{ color: run.done ? 'var(--hub-ash)' : 'var(--hub-blue)' }}>{run.done ? `${ago(run.at, now)} ago` : 'Running'}</span></h3>
      <strong className="sc-q">{run.question}</strong>
      <span className="sc-sum">{summaryLine(run.sources)}</span>
      <ul className="sc-rows" aria-label="Sources">{run.sources.map(s => <Row key={s.url} s={s} />)}</ul>
      {run.report && <div className="sc-acts"><OpenReport report={run.report} send={send} /></div>}
    </section>
  )
}
