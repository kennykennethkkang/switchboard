'use client'
import { useEffect, useState } from 'react'
import { needsLines, todayLine, tokenText, type Today } from '@/lib/today'
import type { TaskTotals } from '@/lib/progress'
import type { DailyTrend } from '@/lib/hub-types'
import { trendText } from '@/lib/budget-ui'
import { panel } from './look'
import { TaskBar } from './chat-cards'

const lab = { font: '500 13px/1.6 var(--hub-sans)', color: 'var(--hub-ash)', margin: 0 } as const
const KEY = 'hub-today-open'

/** One card on top: what is next, what got approved today, what runs, and what today cost. tasks: summed over the open chats. next: the project's top hand step and first Up next item. */
export function TodayCard({ today, tasks, next, trend }: { today: Today; tasks?: TaskTotals; next?: { you?: string; up?: string }; trend?: DailyTrend; /** Unused: the heading counts its own list. switchboard.tsx still passes it. */ needsCount?: number }) {
  const sum = [today.tokens !== undefined ? `${tokenText(today.tokens)} tokens today` : '', today.openCostUsd !== undefined ? `open chats $${today.openCostUsd.toFixed(2)}` : ''].filter(Boolean).join(' · ')
  const jev = today.jev, needs = needsLines(today, next?.you)
  // Collapsed by default: Now already shows the same things. The choice sticks per browser.
  const [open, setOpen] = useState(false)
  useEffect(() => { try { setOpen(localStorage.getItem(KEY) === '1') } catch {} }, [])
  const toggle = () => setOpen(o => { try { localStorage.setItem(KEY, o ? '0' : '1') } catch {} return !o })
  const head = { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 12px', margin: 0, font: '600 14px/1.4 var(--hub-sans)', color: 'var(--hub-ink)' } as const
  return (
    <section aria-label="Today" className="hub-today" style={panel}>
      <h2 style={{ ...head, margin: 0 }}>
        <button type="button" aria-expanded={open} className="hub-link" onClick={toggle} style={{ font: 'inherit', color: 'inherit', padding: '4px 0', minHeight: 32 }}>{open ? '▾' : '▸'} Today</button>
        <span style={{ font: '400 13px/1.4 var(--hub-sans)', color: 'var(--hub-mute)' }} title="Tokens: today's input, output and cache writes. Open chats: what the chats open now have cost since they started.">{open ? sum : todayLine(today, needs.length)}</span>
      </h2>
      {open && <>
      {tasks && tasks.total > 0 && <div style={{ display: 'grid', gap: 6, marginBottom: 4 }}>
        <span className="hub-num" style={{ fontSize: 13, color: 'var(--hub-body)' }}>{tasks.text}</span>
        <TaskBar done={tasks.done} total={tasks.total} label="Tasks done across open chats" />
      </div>}
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '6px 16px', alignItems: 'baseline', margin: 0 }}>
        {needs.length > 0 && <>
          <dt style={{ ...lab, color: 'var(--hub-yellow)' }}>Your moves ({needs.length})</dt>
          <dd style={{ margin: 0, color: 'var(--hub-ink)' }}>
            <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>{needs.map((n, i) => <li key={i} style={{ overflowWrap: 'anywhere' }}>{n}</li>)}</ul>
          </dd>
        </>}
        {next?.up && <>
          <dt style={lab}>Up next</dt>
          <dd style={{ margin: 0, color: 'var(--hub-body)' }}>{next.up}</dd>
        </>}
        <dt style={lab}>Done ({today.done.length})</dt>
        <dd style={{ margin: 0, color: today.done.length ? 'var(--hub-body)' : 'var(--hub-ash)' }}>{today.done.join(' · ') || 'Nothing approved yet'}</dd>
        {jev && <>
          <dt style={lab}>Jev</dt>
          <dd style={{ margin: 0 }} title="Jev, TypeSafe's decision model, run by the claude-x-jev skill; reported by the usage mod">
            {jev.runs} run{jev.runs === 1 ? '' : 's'}, ${jev.costUsd.toFixed(jev.costUsd < 0.1 ? 4 : 2)}
          </dd>
        </>}
        {trend && <>
          <dt style={lab} title="Yesterday, with the change from the day before and the same weekday last week">Yesterday</dt>
          <dd className="hub-num" style={{ margin: 0, display: 'flex', flexWrap: 'wrap', gap: 6, color: 'var(--hub-body)', fontSize: 13 }}>
            {([['chats', trend.chats], ['cost', trend.costUsd, true], ['approved', trend.approved], ['sent back', trend.sentBack]] as const).map(([name, v, usd]) =>
              <span key={name} style={{ maxWidth: '100%', boxSizing: 'border-box', overflowWrap: 'anywhere', padding: '1px 8px', border: '1px solid var(--hub-hair)', borderRadius: 6 }}><span style={{ color: 'var(--hub-ash)' }}>{name}</span> {trendText(v, usd)}</span>)}
          </dd>
        </>}
        {today.working.length > 0 && <>
          <dt style={lab}>Working ({today.working.length})</dt>
          <dd style={{ margin: 0 }}>{today.working.join(' · ')}</dd>
        </>}
      </dl>
      </>}
    </section>
  )
}
