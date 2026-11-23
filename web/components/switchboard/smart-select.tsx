'use client'
import { useState } from 'react'
import { bestByKind, keptPct, kindLabel, recentPicks, SMART_KINDS, verdictLabel, type SmartState } from '@/lib/smart'
import './smart-select.css'

const when = (at: number) => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** Hit rate per kind: picks kept over picks judged, summed across tasks. */
export function SmartSummary({ smart }: { smart: SmartState }) {
  const rows = SMART_KINDS.map(([kind, label]) => {
    const rs = smart.rates.filter(r => r.kind === kind)
    return { label, n: rs.reduce((s, r) => s + r.n, 0), useful: rs.reduce((s, r) => s + r.useful, 0) }
  }).filter(r => r.n > 0)
  if (!rows.length) return <p className="ss-none">Nothing learned yet. A pick counts once its chat is approved.</p>
  return (
    <ul className="ss-sum" aria-label="Hit rate per kind">
      {rows.map(r => {
        const p = keptPct(r)
        return (
          <li key={r.label}>
            <span className="ss-sum-k">{r.label}</span>
            <span className="ss-sum-bar" aria-hidden><i style={{ width: `${p}%` }} /></span>
            <strong>{p}%</strong>
            <span className="ss-rate">of {r.n}</span>
          </li>
        )
      })}
    </ul>
  )
}

/** The best pick per task, one card per kind. */
export function SmartTables({ smart }: { smart: SmartState }) {
  const groups = bestByKind(smart.rates)
  if (!groups.length) return null
  return (
    <div className="ss-kinds">
      {groups.map(g => (
        <section key={g.kind} className="cp-card ss-kind" aria-label={`${g.label} picks`}>
          <h3>{g.label}</h3>
          <ul>
            {g.rows.map(r => <li key={r.task}><span className="ss-task">{r.task}</span><strong>{r.pick}</strong><span className="ss-rate">kept {keptPct(r)}% of {r.n}</span></li>)}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** Newest picks, 6 at first, 10 more per press. */
export function SmartPicks({ smart }: { smart: SmartState }) {
  const [n, setN] = useState(6)
  const all = recentPicks(smart.picks, 200)
  if (!all.length) return null
  return (
    <div className="ss-recent" aria-label="Recent picks">
      <ul>
        {all.slice(0, n).map(p => (
          <li key={`${p.session}-${p.kind}-${p.at}`}>
            <div className="ss-top">
              <span className="ss-title">{p.title ?? 'Chat'}</span>
              <span className="ss-badge" data-v={p.verdict}>{verdictLabel(p.verdict)}</span>
            </div>
            <div className="ss-pick"><span className="ss-kind-tag">{kindLabel(p.kind)}</span><strong>{p.pick}</strong>
              {p.final && p.final !== p.pick && <span className="ss-final">switched to <strong>{p.final}</strong></span>}
              <time className="ss-when">{when(p.at)}</time></div>
            <p className="ss-why">{p.why}</p>
          </li>
        ))}
      </ul>
      {n < all.length && <button type="button" className="hub-btn ss-more" onClick={() => setN(n + 10)}>Show more ({all.length - n} left)</button>}
    </div>
  )
}
