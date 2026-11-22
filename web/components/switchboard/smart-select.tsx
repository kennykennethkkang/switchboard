import { bestByKind, keptText, kindLabel, recentPicks, verdictLabel, type SmartState } from '@/lib/smart'
import './smart-select.css'

const when = (at: number) => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** Live > Smart select: what each pick settled on per task, then the latest picks and whether they held. */
export function SmartSelect({ smart }: { smart: SmartState }) {
  const groups = bestByKind(smart.rates), recent = recentPicks(smart.picks)
  return (
    <div className="ss">
      {groups.length ? (
        <div className="ss-kinds">
          {groups.map(g => (
            <section key={g.kind} className="cp-card ss-kind" aria-label={`${g.label} picks`}>
              <h3>{g.label}</h3>
              <ul>
                {g.rows.map(r => <li key={r.task}><span className="ss-task">{r.task}</span><strong>{r.pick}</strong><span className="ss-rate">{keptText(r)}</span></li>)}
              </ul>
            </section>
          ))}
        </div>
      ) : <p className="ss-none">Nothing learned yet. A pick counts once its chat is approved.</p>}
      {!!recent.length && (
        <section className="cp-card ss-recent" aria-label="Recent picks">
          <h3>Recent picks</h3>
          <ul>
            {recent.map(p => (
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
        </section>
      )}
    </div>
  )
}
