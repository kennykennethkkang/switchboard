import { useState, type ReactNode } from 'react'
import type { MirofishReport } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { caps, panel } from './look'

// Enough Markdown for MiroFish reports: headings, rules, quotes, lists, bold, paragraphs.
const inline = (t: string): ReactNode[] => t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith('**') && p.endsWith('**') ? <strong key={i} style={{ color: 'var(--hub-ink)' }}>{p.slice(2, -2)}</strong> : p)
export function ReportText({ markdown }: { markdown: string }) {
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

const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
const notEnglish = (t: string) => /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(t)

/** Saved MiroFish reports: the list on the left, the picked one to read on the right (stacked on a phone). */
export function MirofishReports({ reports, send }: { reports: MirofishReport[]; send: (m: HubCommand) => void }) {
  const [pick, setPick] = useState(reports[0].simId)
  const r = reports.find(x => x.simId === pick) ?? reports[0]
  const waiting = !r.translated && notEnglish(`${r.title} ${r.markdown ?? ''}`)
  return (
    <section className="cp-card hub-reports" aria-label="Saved MiroFish reports" style={{ ...panel, padding: 0, gap: 0 }}>
      <nav aria-label="Reports">
        <h3 style={{ ...caps, padding: '14px 18px 6px' }}>Reports</h3>
        <ul className="hub-reports-list">
          {reports.map(x => (
            <li key={x.simId}>
              <button type="button" aria-current={x.simId === r.simId} onClick={() => setPick(x.simId)}>
                <span style={{ color: 'var(--hub-ink)', fontSize: 13, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{x.title}</span>
                <span style={{ color: 'var(--hub-ash)', fontSize: 12 }}>{when(x.at)}{x.translated ? ' · translated' : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <article className="hub-report-read" aria-label={r.title}>
        <strong style={{ color: 'var(--hub-ink)', fontSize: 18, lineHeight: 1.35 }}>{r.title}</strong>
        <span style={{ color: 'var(--hub-ash)', fontSize: 12 }}>{when(r.at)} · {r.simId}{r.translated ? ' · translated from Chinese' : ''}</span>
        {r.requirement && <span style={{ color: 'var(--hub-mute)', fontSize: 13 }}><span style={{ color: 'var(--hub-ash)' }}>Question: </span>{r.requirement}</span>}
        {waiting && <span role="status" style={{ color: 'var(--hub-yellow)', fontSize: 13 }}>MiroFish wrote this one in Chinese. The English version is on the way and replaces it here in a minute or two.</span>}
        <div style={{ borderTop: '1px solid var(--hub-hair)', paddingTop: 12 }}>
          {r.markdown ? <ReportText markdown={r.markdown.replace(/^#\s+.*\n+/, '')} /> : r.summary && <p style={{ margin: 0 }}>{r.summary}</p>}
        </div>
        <button type="button" className="hub-btn" style={{ justifySelf: 'start' }} onClick={() => send({ type: 'hub-mirofish-report', simId: r.simId })}>Open in VS Code</button>
      </article>
    </section>
  )
}
