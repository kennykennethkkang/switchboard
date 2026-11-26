'use client'
// Usage: what Claude and Codex used and what it would cost at API list prices. The numbers come from /hub/usage (extension/src/hub/usage.ts).
import { useEffect, useState } from 'react'
import type { HubState } from '@/lib/hub-types'
import type { Meter } from '@/lib/limits'
import { byDay, cacheHitRate, groupBy, inRange, loadUsage, priorTotals, tokens, topChats, totals, usd, type Range, type UsageReport } from '@/lib/usage'
import { demoUsage } from '@/lib/usage-demo'
import { trendText } from '@/lib/budget-ui'
import { formatDuration } from '@/lib/duration'
import type { HubCommand } from '@/lib/vscode-bridge'
import { Sec, Seg } from './page-kit'
import { SpendLimits } from './spend-limits'
import './usage.css'

const EVERY_MS = 60_000
const RANGES: [Range, string][] = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days']]
const PLAIN: Record<Range, string> = { today: 'today', '7d': 'in 7 days', '30d': 'in 30 days' }
const BEFORE: Record<Range, string> = { today: 'yesterday', '7d': 'the 7 days before', '30d': 'the 30 days before' }
export type Kind = 'input' | 'cacheWrite' | 'cacheRead' | 'output'
const KINDS: [Kind, string, string][] = [
  ['input', 'New input', 'Text the model read for the first time'],
  ['cacheWrite', 'Saved to cache', 'Text stored so later turns can reread it cheaply'],
  ['cacheRead', 'Reread from cache', 'Earlier text read again at a fraction of the input price'],
  ['output', 'Output', 'What the model wrote, thinking included'],
]
const ago = (at: number) => { const w = formatDuration(Date.now() - at, 'ago'); return w === 'now' ? 'just now' : `${w} ago` }
const pct = (n: number) => n > 0 && n < 0.01 ? '<1%' : n < 1 && n > 0.99 ? '>99%' : `${Math.round(n * 100)}%`
const modelName = (m: string) => m.replace(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?=-|$).*/, (_, n: string, a: string, b?: string) => `${n[0].toUpperCase()}${n.slice(1)} ${b ? `${a}.${b}` : a}`)
  .replace(/^gpt-([\d.]+)(?:-(\w+))?.*/, (_, v: string, n?: string) => n ? `GPT-${v} ${n[0].toUpperCase()}${n.slice(1)}` : `GPT-${v}`)
const roleName = (r: string) => r === 'lead' ? 'Main chat' : r === 'subagent' ? 'Other agents' : r

/** Reads the report when the page opens and every minute while it shows. The demo has a sample. */
function useReport(isDemo: boolean) {
  const [got, set] = useState<{ report?: UsageReport; problem?: string }>({})
  useEffect(() => {
    if (isDemo) { set({ report: demoUsage() }); return }
    let on = true
    const read = () => { void loadUsage().then(r => { if (on) set(was => typeof r === 'string' ? { report: was.report, problem: r } : { report: r }) }) }
    read()
    const t = setInterval(() => { if (!document.hidden) read() }, EVERY_MS)
    return () => { on = false; clearInterval(t) }
  }, [isDemo])
  return got
}

/** "up 12% on yesterday"; nothing when there is nothing to compare. */
function change(now: number, was: number | undefined, when: string) {
  if (was === undefined || was <= 0) return undefined
  const d = now / was - 1
  return Math.abs(d) < 0.01 ? `same as ${when}` : `${d > 0 ? 'up' : 'down'} ${Math.round(Math.abs(d) * 100)}% on ${when}`
}

function Limits({ meters, resets, only }: { meters: Meter[]; resets?: number; only: 'claude' | 'codex' }) {
  const shown = meters.filter(m => m.kind.startsWith('codex_') === (only === 'codex'))
  return <>
    <ul role="list" className="us-limits">
      {shown.map(m => <li key={m.kind} className="hub-limit" data-level={m.level}>
        <span><b>{m.label === 'Codex week' ? 'Week' : m.label.replace(/^Codex /, '')}</b><span className="us-num">{m.level === 'out' ? 'out' : m.percent === undefined ? 'no data' : `${m.percent}%`}</span></span>
        <i aria-hidden><b style={{ transform: `scaleX(${Math.min(100, m.percent ?? 0) / 100})` }} /></i>
        <small>{m.reset ?? ' '}</small>
      </li>)}
    </ul>
    {!!resets && only !== 'claude' && <p className="us-fine">{resets === 1 ? 'One free Codex limit reset is' : `${resets} free Codex limit resets are`} waiting in your account.</p>}
  </>
}

type Point = { day: string; parts: { key: string; name: string; value: number; label: string }[]; sum: number; label: string }

const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const longDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })

/** Stacked bars, one per day. Hover, focus or arrow keys show a day; the token rows above are the legend. */
function Days({ points, label }: { points: Point[]; label: string }) {
  const [at, setAt] = useState<number>()
  const max = Math.max(...points.map(p => p.sum), 0)
  // Nothing picked reads the highest day, so a hover never moves the page.
  const p = (at === undefined ? points.find(x => x.sum === max) : points[at]) ?? points[0]
  const every = Math.ceil(points.length / 6)
  const move = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
    if (!step) return
    e.preventDefault()
    setAt(i => Math.max(0, Math.min(points.length - 1, (i ?? points.length) + step)))
  }
  return (
    <div className="us-chart">
      <div className="us-key">
        <span className="us-read" aria-live="polite"><b>{longDay(p.day)}</b> {p.label}{at === undefined && max > 0 && ', the highest day'}</span>
      </div>
      <div className="us-bars" role="group" tabIndex={0} aria-label={`${label}, one bar per day. Arrow keys read a day.`} onKeyDown={move} onMouseLeave={() => setAt(undefined)} onBlur={() => setAt(undefined)}>
        {points.map((d, i) => (
          <div key={d.day} className="us-bar" data-on={i === at || undefined} onMouseEnter={() => setAt(i)} onClick={() => setAt(i)}>
            <div style={{ height: max ? `${d.sum / max * 100}%` : 0 }}>
              {d.parts.filter(x => x.value > 0).map(x => <i key={x.key} data-c={x.key} style={{ flexGrow: x.value / d.sum }} />)}
            </div>
            {i % every === (points.length - 1) % every && <small>{shortDay(d.day)}</small>}
          </div>
        ))}
      </div>
      <ul role="list" className="us-tip">{p.parts.map(x => <li key={x.key}><i data-c={x.key} aria-hidden />{x.name}<span className="us-num">{x.label}</span></li>)}</ul>
    </div>
  )
}

type Unit = 'cost' | 'tokens'
function DayChart({ report, range, ai, unit }: { report: UsageReport; range: Range; ai: 'claude' | 'codex'; unit: Unit }) {
  const fmt = unit === 'cost' ? usd : tokens
  // Today alone makes one bar, so the chart keeps a week around it.
  const points: Point[] = byDay(report, range === 'today' ? '7d' : range, ai).map(d => {
    const parts = KINDS.map(([key, name]) => { const value = unit === 'cost' ? d.total.split[key] : d.total[key]; return { key, name, value, label: fmt(value) } })
    const sum = parts.reduce((a, x) => a + x.value, 0)
    return { day: d.day, parts, sum, label: fmt(sum) }
  })
  return <div className="us-days"><h3>{unit === 'cost' ? 'Cost per day' : 'Tokens per day'}</h3><Days points={points} label={`${ai === 'claude' ? 'Claude' : 'Codex'} ${unit} per day`} /></div>
}

type Group = 'model' | 'project' | 'role' | 'ai'
function Breakdown({ report, range }: { report: UsageReport; range: Range }) {
  const [by, setBy] = useState<Group>('model')
  const rows = groupBy(inRange(report, range), by)
  const top = rows[0]?.costUsd ?? 0
  return (
    <Sec id="us-by" title="Breakdown" actions={<Seg label="Break down by" value={by} onChange={setBy} options={[['model', 'Model'], ['project', 'Project'], ['role', 'Role']]} />}>
      {rows.length ? <div className="us-scroll"><table className="us-table us-by">
        <thead><tr><th scope="col">{by === 'model' ? 'Model' : by === 'project' ? 'Project' : 'Role'}</th><th scope="col">In</th><th scope="col">Out</th><th scope="col">Reread</th><th scope="col">Share</th><th scope="col">Cost</th></tr></thead>
        <tbody>{rows.slice(0, 12).map(r => <tr key={r.key}>
          <th scope="row"><span>{by === 'model' ? modelName(r.key) : by === 'role' ? roleName(r.key) : r.key}{r.unpriced && <small>no list price</small>}</span><i className="us-share" aria-hidden><b style={{ transform: `scaleX(${top ? r.costUsd / top : 0})` }} /></i></th>
          <td>{tokens(r.input + r.cacheWrite)}</td><td>{tokens(r.output)}</td><td>{tokens(r.cacheRead)}</td><td>{pct(r.share)}</td><td>{usd(r.costUsd)}</td>
        </tr>)}</tbody>
      </table></div> : <p className="us-fine">Nothing used {PLAIN[range]}.</p>}
    </Sec>
  )
}

function Chats({ report, range, live, onOpen }: { report: UsageReport; range: Range; live: (id: string) => boolean; onOpen: (id: string) => void }) {
  const [more, setMore] = useState(false)
  const rows = topChats(report, range)
  const shown = rows.slice(0, more ? 50 : 6)
  return (
    <Sec id="us-chats" title="Costliest chats" count={rows.length}>
      {rows.length ? <div className="us-scroll"><table className="us-table us-chats">
        <thead><tr><th scope="col">Chat</th><th scope="col">Agents</th><th scope="col">Tokens</th><th scope="col">Last used</th><th scope="col">Cost</th></tr></thead>
        <tbody>{shown.map(c => <tr key={c.sessionId}>
          <th scope="row"><i data-c={c.ai} aria-hidden /><span>{live(c.sessionId) ? <button type="button" className="hub-link" onClick={() => onOpen(c.sessionId)}>{c.label}</button> : c.label}<small>{c.project}{c.ai === 'codex' && ', Codex'}</small></span></th>
          <td>{c.agents || ''}</td><td>{tokens(c.tokens)}</td><td>{ago(c.lastAt)}</td><td>{usd(c.costUsd)}</td>
        </tr>)}</tbody>
      </table></div> : <p className="us-fine">No chats used tokens {PLAIN[range]}.</p>}
      {rows.length > 6 && <button type="button" className="hub-btn" style={{ justifySelf: 'start' }} onClick={() => setMore(!more)}>{more ? 'Show fewer' : `Show ${Math.min(rows.length, 50) - 6} more`}</button>}
    </Sec>
  )
}

/** Paid tools outside the two plans: what each ran this month and its cap, and Jev's runs. */
function PaidTools({ hub, send }: { hub: HubState; send: (m: HubCommand) => void }) {
  const jev = hub.jev.reduce((a, r) => a + r.costUsd, 0)
  if (!hub.spend?.length && !hub.jev.length) return null
  return (
    <Sec id="us-paid" title="Paid tools" note="Billed for real, outside your Claude and Codex plans.">
      {hub.jev.length > 0 && <p className="us-fine">Jev, {hub.jev.length} recent run{hub.jev.length === 1 ? '' : 's'}: {jev < 0.1 ? `$${jev.toFixed(4)}` : usd(jev)}</p>}
      <div className="us-paid"><SpendLimits hub={hub} send={send} /></div>
    </Sec>
  )
}

/** Codex counts its account's tokens itself; runs that kept no transcript here show only in that total. */
function CodexTotal({ hub, report, range }: { hub: HubState; report: UsageReport; range: Range }) {
  const days = new Set(byDay(report, range, 'codex').map(d => d.day))
  const counted = (hub.codexDaily ?? []).filter(d => days.has(d.day)).reduce((a, d) => a + d.tokens, 0)
  const here = totals(inRange(report, range, 'codex')).tokens
  if (counted <= here * 1.05) return null
  return <p className="us-fine">Codex counts {tokens(counted)} tokens on your account {PLAIN[range]}. {tokens(here)} of them have a transcript on this machine and are priced here.</p>
}

const NOTE = 'Costs are API list prices. Your plans already cover this work, so read them as what it is worth, not a bill.'

export function UsagePage({ hub, isDemo, meters, send, onOpen, live }: { hub: HubState; isDemo: boolean; meters: Meter[]; send: (m: HubCommand) => void; onOpen: (id: string) => void; live: (id: string) => boolean }) {
  const { report, problem } = useReport(isDemo)
  const [range, setRange] = useState<Range>('7d'), [unit, setUnit] = useState<Unit>('cost')
  if (!report) return <p className="us-fine" role="status">{problem ? `Could not read usage: ${problem}` : 'Reading the last 30 days of chats. The first read takes about half a minute.'}</p>
  const c = totals(inRange(report, range, 'claude')), x = totals(inRange(report, range, 'codex'))
  const week = (kind: string) => meters.find(m => m.kind === kind)?.percent
  const cw = week('seven_day'), xw = week('codex_seven_day'), y = hub.trend
  return (
    <div className="us">
      <div className="us-filters">
        <Seg label="Time" value={range} onChange={setRange} options={RANGES} />
        <Seg label="Daily chart" value={unit} onChange={setUnit} options={[['cost', 'Cost'], ['tokens', 'Tokens']]} />
        <span className="us-fine">{NOTE}</span>
      </div>
      {problem && <p className="us-fine" role="status">Not updated since {ago(report.at)}: {problem}</p>}
      <p className="us-say">
        {c.costUsd + x.costUsd > 0 && <>Claude's work is worth {usd(c.costUsd)} {PLAIN[range]}, Codex's {usd(x.costUsd)}. </>}
        {cw !== undefined && xw !== undefined && <>Claude has {Math.max(0, 100 - cw)}% of its week left, Codex has {Math.max(0, 100 - xw)}%.{cw - xw > 25 && ' What Codex does not use is lost when its week resets.'}</>}
      </p>
      <div className="us-two">
        {([['claude', 'Claude', c], ['codex', 'Codex', x]] as const).map(([k, name, u]) => {
          const than = change(u.costUsd, priorTotals(report, range, k)?.costUsd, BEFORE[range])
          return (
            <section key={k} className="us-ai" aria-labelledby={`us-${k}`}>
              <header><h2 id={`us-${k}`}>{name}</h2><span className="us-cost"><strong>{usd(u.costUsd)}</strong>{than && <small>{than}</small>}</span></header>
              <Limits meters={meters} only={k} resets={hub.codexResets} />
              {k === 'codex' && <CodexTotal hub={hub} report={report} range={range} />}
              <dl className="us-nums">
                {KINDS.map(([kind, word, why]) => <div key={kind} title={why}><dt><i data-c={kind} aria-hidden />{word}{kind === 'output' && u.thinking > 0 && <small>{tokens(u.thinking)} thinking</small>}</dt><dd>{tokens(u[kind])}</dd><dd>{usd(u.split[kind])}</dd></div>)}
                {u.searches > 0 && <div><dt>Web searches</dt><dd>{u.searches.toLocaleString('en-US')}</dd><dd>{usd(u.split.search)}</dd></div>}
                <div className="us-sum"><dt>Replies</dt><dd>{u.calls.toLocaleString('en-US')}</dd><dd>{u.calls > 0 && `${usd(u.costUsd / u.calls)} each`}</dd></div>
                <div title="Share of input reread from cache, and what it saved against fresh input"><dt>Saved by cache</dt><dd>{pct(cacheHitRate(u))}</dd><dd>{usd(u.savedUsd)}</dd></div>
              </dl>
              <DayChart report={report} range={range} ai={k} unit={unit} />
            </section>
          )
        })}
      </div>
      <div className="us-half"><Breakdown report={report} range={range} /><Chats report={report} range={range} live={live} onOpen={onOpen} /></div>
      {y && <p className="us-fine">Yesterday: chats {trendText(y.chats)}. Cost of closed chats {trendText(y.costUsd, true)}.</p>}
      <PaidTools hub={hub} send={send} />
    </div>
  )
}
