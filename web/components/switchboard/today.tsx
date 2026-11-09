'use client'
import { needsLines, type Today } from '@/lib/today'
import type { TaskTotals } from '@/lib/progress'
import { caps, label, panel } from './look'
import { TaskBar } from './chat-cards'

const lab = { ...label, lineHeight: 1.6 } as const
const kilo = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}K`)

/** One card on top: what is next, what got approved today, what runs, and what today cost. tasks: summed over the open chats. next: the project's top hand step and first Up next item. */
export function TodayCard({ today, tasks, next }: { today: Today; tasks?: TaskTotals; next?: { you?: string; up?: string } }) {
  const sum = [today.tokens !== undefined ? `${kilo(today.tokens)} tokens today` : '', today.openCostUsd !== undefined ? `open chats $${today.openCostUsd.toFixed(2)}` : ''].filter(Boolean).join(' · ')
  const jev = today.jev, needs = needsLines(today, next?.you)
  return (
    <section aria-label="Today" className="hub-today" style={panel}>
      <h2 style={caps}><span>Today</span><span title="Tokens: today's input, output and cache writes. Open chats: what the chats open now have cost since they started.">{sum}</span></h2>
      {tasks && tasks.total > 0 && <div style={{ display: 'grid', gap: 6, marginBottom: 4 }}>
        <span className="hub-num" style={{ fontSize: 13, color: 'var(--hub-body)' }}>{tasks.text}</span>
        <TaskBar done={tasks.done} total={tasks.total} label="Tasks done across open chats" />
      </div>}
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '6px 16px', alignItems: 'baseline', margin: 0 }}>
        {needs.length > 0 && <>
          <dt style={{ ...lab, color: 'var(--hub-yellow)' }}>Your moves {needs.length}</dt>
          <dd style={{ margin: 0, color: 'var(--hub-ink)' }}>
            <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>{needs.map(n => <li key={n} style={{ overflowWrap: 'anywhere' }}>{n}</li>)}</ul>
          </dd>
        </>}
        {next?.up && <>
          <dt style={lab}>Up next</dt>
          <dd style={{ margin: 0, color: 'var(--hub-body)' }}>{next.up}</dd>
        </>}
        <dt style={lab}>Done {today.done.length}</dt>
        <dd style={{ margin: 0, color: today.done.length ? 'var(--hub-body)' : 'var(--hub-ash)' }}>{today.done.join(' · ') || 'Nothing approved yet'}</dd>
        {jev && <>
          <dt style={lab}>Jev</dt>
          <dd style={{ margin: 0 }} title="Jev, TypeSafe's decision model, run by the claude-x-jev skill; reported by the usage mod">
            {jev.runs} run{jev.runs === 1 ? '' : 's'}, ${jev.costUsd.toFixed(jev.costUsd < 0.1 ? 4 : 2)}
          </dd>
        </>}
        {today.working.length > 0 && <>
          <dt style={lab}>Working {today.working.length}</dt>
          <dd style={{ margin: 0 }}>{today.working.join(' · ')}</dd>
        </>}
      </dl>
    </section>
  )
}
