'use client'
// One chat's deep research as it happens: searches, sources, researcher lanes, the answer.
// A Research-space chat gets it as its own tab; a project chat gets it inline on the Chats page.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { vscodeBridge } from '@/lib/vscode-bridge'
import type { ChatState, HubState } from '@/lib/hub-types'
import { answerBlocks, citations, elapsedOf, emptyRun, fmtElapsed, inline, isCited, isRealResearch, looksLikeAnswer, reduceResearch, siteOf, visibleLanes, type FeedItem, type Lane, type ResearchRun } from '@/lib/research'
import { DEMO_CHAT, DEMO_SESSION, demoScript } from '@/lib/research-demo'
import { researchRun, startResearchStore, subscribeResearch } from '@/lib/research-store'
import './research-panel.css'

const DEMO_OK = process.env.NEXT_PUBLIC_DEMO !== '0'
const LEAD = 'orchestrator'
const HUES = ['var(--hub-w-cobalt)', 'var(--hub-w-teal)', 'var(--hub-w-amber)', 'var(--hub-w-rose)', 'var(--hub-w-violet)', 'var(--hub-w-lime)']
const DEMO_LOOP_MS = 15_000

// Dev iframe and localhost: the store starts here, not in webview-entry.
if (typeof window !== 'undefined') startResearchStore()

function useResearch(sessionId: string, demo: boolean, given?: HubState) {
  const [demoRun, setRun] = useState<ResearchRun>(emptyRun)
  const live = useSyncExternalStore(subscribeResearch, () => researchRun(sessionId), () => researchRun(sessionId))
  const [own, setHub] = useState<HubState | null>(null)
  const [take, setTake] = useState(0)
  const [ended, setEnded] = useState(false)

  useEffect(() => {
    if (!demo) return
    setRun(emptyRun())
    setEnded(false)
    const steps = demoScript()
    const t0 = Date.now()
    const timers = steps.map(s => setTimeout(() => setRun(r => reduceResearch(r, s.event, DEMO_SESSION, t0 + s.at)), s.at + 450))
    const last = steps[steps.length - 1].at + 450
    timers.push(setTimeout(() => setEnded(true), last))
    timers.push(setTimeout(() => setTake(n => n + 1), last + DEMO_LOOP_MS))
    return () => timers.forEach(clearTimeout)
  }, [demo, take])

  useEffect(() => {
    if (demo || given || !vscodeBridge) return
    return vscodeBridge.onHub(setHub)
  }, [demo, given])

  return { run: demo ? demoRun : live, hub: given ?? own, replay: () => setTake(n => n + 1), ended }
}

function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) { setNow(Date.now()); return }
    const t = setInterval(() => { if (!document.hidden) setNow(Date.now()) }, 1000)
    return () => clearInterval(t)
  }, [on])
  return now
}

const openUrl = (url: string) => {
  if (vscodeBridge?.isVSCode) vscodeBridge.sendHub({ type: 'hub-open-url', url })
  else window.open(url, '_blank', 'noopener,noreferrer')
}

const Svg = ({ children, size = 14 }: { children: ReactNode; size?: number }) => (
  <svg aria-hidden width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)
const IcFind = () => <Svg><path d="M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM11 11l3.5 3.5" /></Svg>
const IcCheck = ({ size }: { size?: number }) => <Svg size={size}><path d="m3.5 8.5 3 3 6-7" /></Svg>
const IcTwice = () => <Svg><path d="m1.5 8.5 3 3 6-7M7.5 11.5l6-7" /></Svg>
const IcFail = () => <Svg><path d="M8 4.5v4M8 11.2v.3" /></Svg>
const IcTerm = () => <Svg><path d="M2.5 3.5h11v9h-11zM5 7l2 1.5L5 10M8.5 10.5h2.5" /></Svg>
const IcReplay = () => <Svg><path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.5v2.5h2.5" /></Svg>

type Who = { label: string; color: string }

function SourceRow({ s, who, cited }: { s: Extract<FeedItem, { kind: 'source' }>; who: Who; cited: boolean }) {
  const site = siteOf(s.url)
  const state = s.state === 'reading' ? 'Reading' : s.state === 'failed' ? 'Could not open' : s.reads > 1 ? `Read, re-checked` : 'Read'
  return (
    <button type="button" className="rp-src" data-state={s.state} onClick={() => openUrl(s.url)} title={s.url}>
      <span className="rp-mono" style={{ ['--mono' as string]: HUES[site.hue] }} aria-hidden>{site.letter}</span>
      <span className="rp-src-text">
        <span className="rp-src-line">
          <span className="rp-host">{site.host}</span>
          {cited && <span className="rp-cited">Cited</span>}
        </span>
        <span className="rp-path">{site.path || '/'}</span>
      </span>
      <span className="rp-who" style={{ ['--who' as string]: who.color }}><i aria-hidden /><span className="rp-who-name">{who.label}</span></span>
      <span className="rp-state" aria-label={state} title={state}>
        {s.state === 'reading' ? <span className="rp-spin" aria-hidden /> : s.state === 'failed' ? <IcFail /> : s.reads > 1 ? <IcTwice /> : <IcCheck />}
      </span>
    </button>
  )
}

function SearchRow({ s, who }: { s: Extract<FeedItem, { kind: 'search' }>; who: Who }) {
  return (
    <div className="rp-search" data-state={s.state}>
      <span className="rp-search-ic" aria-hidden><IcFind /></span>
      <span className="rp-query"><span className="rp-type">{s.query}</span></span>
      <span className="rp-who" style={{ ['--who' as string]: who.color }}><i aria-hidden /><span className="rp-who-name">{who.label}</span></span>
      <span className="sr-only">{s.state === 'running' ? 'searching' : 'searched'}</span>
    </div>
  )
}

function LaneCard({ lane, color, on, onPick }: { lane: Lane; color: string; on: boolean; onPick: () => void }) {
  const meta = [`${lane.sources} source${lane.sources === 1 ? '' : 's'}`, lane.searches ? `${lane.searches} search${lane.searches === 1 ? '' : 'es'}` : ''].filter(Boolean).join(' · ')
  return (
    <button type="button" className="rp-lane" data-state={lane.state} aria-pressed={on} onClick={onPick} style={{ ['--lane' as string]: color }} title={lane.brief ?? lane.task}>
      <span className="rp-lane-head">
        <span className="rp-lane-mark" aria-hidden>{lane.state === 'done' ? <IcCheck size={11} /> : <i />}</span>
        <span className="rp-lane-task">{lane.task}</span>
      </span>
      <span className="rp-lane-meta">{meta}</span>
      <span className="rp-lane-last">{lane.state === 'done' ? 'Returned' : lane.last ?? 'Starting'}</span>
    </button>
  )
}

function Answer({ text, drafting }: { text: string; drafting: boolean }) {
  const blocks = useMemo(() => answerBlocks(text), [text])
  const cites = useMemo(() => citations(text), [text])
  const report = looksLikeAnswer(text)
  const line = (s: string) => inline(s).map((p, i) =>
    p.t === 'b' ? <strong key={i}>{p.s}</strong>
      : p.t === 'code' ? <code key={i}>{p.s}</code>
        : p.t === 'link' ? <button type="button" key={i} className="rp-link" onClick={() => openUrl(p.href)} title={p.href}>{p.s}</button>
          : p.t === 'cite' ? (cites[p.n]
            ? <button type="button" key={i} className="rp-cite" onClick={() => openUrl(cites[p.n])} title={cites[p.n]} aria-label={`Source ${p.n}`}>{p.n}</button>
            : <sup key={i} className="rp-cite is-plain">{p.n}</sup>)
            : <span key={i}>{p.s}</span>)
  return (
    <section className="rp-answer" data-drafting={drafting || undefined} data-note={!report || undefined} aria-label={report ? 'Answer' : 'Latest from the lead'} aria-busy={drafting}>
      <header className="rp-answer-head">
        <span className="rp-answer-mark" aria-hidden />
        <span>{!report ? 'From the lead' : drafting ? 'Writing the answer' : 'Answer'}</span>
      </header>
      <div className="rp-answer-body">
        {blocks.map((b, i) => (
          <div key={i} className="rp-block" data-type={b.type} style={{ ['--d' as string]: `${Math.min(i, 6) * 30}ms` }}>
            {b.type === 'h' ? <h3>{line(b.text)}</h3>
              : b.type === 'li' ? <p className="rp-li"><span className="rp-li-mark" aria-hidden>{b.n ? `${b.n}.` : ''}</span><span>{line(b.text)}</span></p>
                : <p>{line(b.text)}</p>}
          </div>
        ))}
        {drafting && report && <span className="rp-caret" aria-hidden />}
      </div>
    </section>
  )
}

const stateLabel = (status: ResearchRun['status'], chat?: ChatState) =>
  chat === 'needs-you' ? 'Needs you' : status === 'done' ? 'Done' : status === 'running' ? 'Researching' : 'Waiting'

/** inline: sits on the Chats page under the chat, and shows nothing until research starts. */
export function ResearchPanel({ sessionId, inline: inPage, hub: given }: { sessionId: string; inline?: boolean; hub?: HubState }) {
  const demo = DEMO_OK && sessionId === DEMO_SESSION
  const { run, hub, replay, ended } = useResearch(sessionId, demo, given)
  const chat = hub?.chats.find(c => c.sessionId === sessionId)
  const progress = hub?.progress.find(p => p.sessionId === sessionId)
  // The chat stopping ends the run too, when no lead agent_complete came.
  const status: ResearchRun['status'] = run.status === 'running' && progress && progress.state !== 'working' ? 'done' : run.status
  const live = status === 'running'
  const now = useNow(live)
  const lanes = visibleLanes(run)
  const [filter, setFilter] = useState<string>()
  const [more, setMore] = useState(false)
  const laneColor = (name: string) => { const l = lanes.find(x => x.name === name); return l ? HUES[l.order % HUES.length] : 'var(--hub-mute)' }
  const whoOf = (agent: string): Who => agent === LEAD ? { label: 'Lead', color: 'var(--hub-mute)' } : { label: lanes.find(l => l.name === agent)?.task ?? agent, color: laneColor(agent) }
  const feed = filter ? run.feed.filter(f => f.agent === filter) : run.feed
  const sources = run.feed.filter(f => f.kind === 'source').length
  const searches = run.feed.length - sources
  const name = demo ? DEMO_CHAT : chat?.name
  const question = run.question ?? run.lastUser ?? name ?? 'Research'
  const long = question.length > 160
  const label = stateLabel(status, progress?.state)
  const doneLanes = lanes.filter(l => l.state === 'done').length

  // New rows cascade in, each with a delay fixed at its first render.
  const delays = useRef(new Map<number, number>())
  if (run.feed.length === 0) delays.current.clear()
  let batch = 0
  for (const f of feed) if (!delays.current.has(f.id)) delays.current.set(f.id, Math.min(batch++, 10) * 35)

  // Stay pinned to the newest row unless the reader scrolled up.
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const [behind, setBehind] = useState(false)
  const toEnd = (smooth: boolean) => {
    const el = scroller.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduce ? 'smooth' : 'auto' })
  }
  useLayoutEffect(() => {
    if (pinned.current) toEnd(true)
    else setBehind(true)
  }, [feed.length, run.answer, lanes.length])
  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (pinned.current) setBehind(false)
  }

  const canFocus = !!vscodeBridge?.isVSCode && !demo
  if (inPage && (status === 'waiting' || !isRealResearch(run))) return null

  return (
    <div className={inPage ? 'rp' : 'hub rp'} data-status={status} data-inline={inPage || undefined}>
      <div className="rp-shell">
        <header className="rp-head">
          <div className="rp-bar" aria-hidden><span style={{ transform: `scaleX(${status === 'done' ? 1 : lanes.length ? Math.max(0.06, doneLanes / lanes.length) : 0})` }} /></div>
          <div className="rp-top">
            <span className="rp-status" role="status" data-chat={progress?.state}>
              <span className="rp-dot" aria-hidden />
              {label}
            </span>
            <span className="rp-time">{fmtElapsed(elapsedOf(run, now))}</span>
            {run.depth && <span className="rp-chip">{run.depth[0].toUpperCase() + run.depth.slice(1)}</span>}
            {demo && <span className="rp-chip is-demo" title="A scripted run, no chat behind it">Demo</span>}
            <span className="rp-grow" />
            {demo && <button type="button" className="hub-btn sm rp-btn" onClick={() => { pinned.current = true; setFilter(undefined); replay() }} aria-label="Replay"><IcReplay /><span className="rp-btn-text">Replay</span></button>}
            <button type="button" className="hub-btn sm rp-btn" disabled={!canFocus} onClick={() => vscodeBridge?.sendHub({ type: 'hub-focus-chat', sessionId })}
              title={canFocus ? 'Show the chat’s terminal' : 'Shows the chat’s terminal when a real chat is open in VS Code'} aria-label="Show terminal"><IcTerm /><span className="rp-btn-text">Terminal</span></button>
          </div>
          <h1 className="rp-q" data-clamp={long && !more ? '' : undefined}>{question}</h1>
          <div className="rp-sub">
            {long && <button type="button" className="rp-more" aria-expanded={more} onClick={() => setMore(m => !m)}>{more ? 'Less' : 'More'}</button>}
            {name && <span className="rp-chat">{name}</span>}
            {lanes.length > 0 && <span>{doneLanes}/{lanes.length} researchers back</span>}
            {searches > 0 && <span>{searches} search{searches === 1 ? '' : 'es'}</span>}
            {sources > 0 && <span>{sources} source{sources === 1 ? '' : 's'}</span>}
          </div>
        </header>

        <div className="rp-scroll" ref={scroller} onScroll={onScroll}>
          {status === 'waiting' && (
            <div className="rp-empty">
              <span className="rp-empty-dot" aria-hidden />
              <p>Waiting for the research to start</p>
              <p className="rp-empty-sub">Searches, sources and researchers show up here as the chat works.</p>
            </div>
          )}

          {lanes.length > 0 && (
            <section className="rp-section" aria-label="Researchers">
              <h2 className="rp-label">Researchers{filter && <button type="button" className="rp-clear" onClick={() => setFilter(undefined)}>Show all</button>}</h2>
              <div className="rp-lanes">
                {lanes.map(l => <LaneCard key={l.name} lane={l} color={HUES[l.order % HUES.length]} on={filter === l.name} onPick={() => setFilter(f => (f === l.name ? undefined : l.name))} />)}
              </div>
            </section>
          )}

          {feed.length > 0 && (
            <section className="rp-section" aria-label="Searches and sources">
              <h2 className="rp-label">{filter ? `${whoOf(filter).label}` : 'Searches and sources'}</h2>
              <ol className="rp-feed">
                {feed.map(f => {
                  return (
                    <li key={f.id} className="rp-row" style={{ ['--d' as string]: `${delays.current.get(f.id) ?? 0}ms` }}>
                      {f.kind === 'search' ? <SearchRow s={f} who={whoOf(f.agent)} /> : <SourceRow s={f} who={whoOf(f.agent)} cited={isCited(run.answer, f.url)} />}
                    </li>
                  )
                })}
              </ol>
            </section>
          )}

          {run.answer && <Answer text={run.answer} drafting={live} />}

          {demo && ended && (
            <div className="rp-end">
              <button type="button" className="hub-btn rp-btn" onClick={() => { pinned.current = true; setFilter(undefined); replay(); scroller.current?.scrollTo({ top: 0 }) }}><IcReplay />Play the demo again</button>
            </div>
          )}
        </div>

        {behind && (
          <button type="button" className="rp-jump" onClick={() => { pinned.current = true; setBehind(false); toEnd(true) }}>New activity</button>
        )}
      </div>
    </div>
  )
}
