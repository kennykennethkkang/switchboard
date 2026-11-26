'use client'
// The Now page: the pass board, or the old lanes at ?layout=classic. It reads NowPage's own props, so counts and actions match it.
import { useEffect, useId, useState, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import type { ArchivedChat, ChatProgress, HubState, TodoList } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { chatRun, stageView } from '@/lib/stages-ui'
import { chatShown } from '@/lib/chat-state'
import { laneRow } from '@/lib/now'
import { busyLine } from '@/lib/eta'
import { chatMeta, cookTitle, layoutOf, needChip, nextCardIndex, nextRows, nextTag, type NextRow, type NowLayout } from '@/lib/now-board'
import { doneGroups, gateTitle, track, verify, type DoneKind, type StepState } from '@/lib/stations'
import { inProjects } from '@/lib/archive'
import { ago } from '@/lib/look'
import { CardStages } from './stages'
import type { NowPage } from './now-page'
import type { Card } from './chat-cards'
import './layout.css'
import './now-board.css'

type PageProps = ComponentProps<typeof NowPage>
/** projects: the picked project filter, so Done's stopped chats follow it like the rest. */
type Extra = { hub: HubState; send: (c: HubCommand) => void; todo?: { folder: string; list?: TodoList }; onPlan: () => void; projects?: string[] }

/** page: the NowPage element the shell already builds; the line board reads its props. */
export function NowLayouts({ page, ...extra }: Extra & { page: ReactElement<PageProps> }) {
  const [layout, setLayout] = useState<NowLayout>('line')
  useEffect(() => { setLayout(layoutOf(location.search)) }, [])
  return layout === 'classic' ? page : <NowLine {...page.props} {...extra} />
}

type Props = PageProps & Extra
const NARROW = '(max-width: 760px)'

function useNarrow() {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => { const m = matchMedia(NARROW); const on = () => setNarrow(m.matches); on(); m.addEventListener('change', on); return () => m.removeEventListener('change', on) }, [])
  return narrow
}

/** Phone: sticks to the top while Your call has two or more cards; a tap scrolls to the next one below it, then wraps.
 *  Only shown once the Your call heading has scrolled off the top, so it is a way back, not a copy of the heading. */
function NeedChip({ n }: { n: number }) {
  const label = needChip(n)
  const [away, setAway] = useState(false)
  useEffect(() => {
    const h = document.getElementById('nb-call')
    if (!h || !label) return
    const io = new IntersectionObserver(([e]) => setAway(!e.isIntersecting && e.boundingClientRect.top < 0))
    io.observe(h)
    return () => io.disconnect()
  }, [label])
  if (!label) return null
  const go = (e: React.MouseEvent<HTMLButtonElement>) => {
    const chip = e.currentTarget.getBoundingClientRect().bottom
    const cards = [...document.querySelectorAll<HTMLElement>('.nb-lane[data-lane=call] .hub-stuck > ul > li')].filter(c => c.offsetParent)
    // a card scrolled here rests at its scroll-margin-top, below the chip; that one counts as current
    const rest = cards[0] ? parseFloat(getComputedStyle(cards[0]).scrollMarginTop) || 0 : 0
    const i = nextCardIndex(cards.map(c => c.getBoundingClientRect().top), Math.max(chip, rest))
    cards[i]?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }
  return <div className="nb-need-pin"><button type="button" className="nb-need" data-away={away || undefined} onClick={go}>{label}<b aria-hidden>↓</b></button></div>
}

const BACK = { gate: 'a red gate', review: 'review' } as const
// A shape beside each state's colour, so the track reads without colour.
const MARK: Partial<Record<StepState, string>> = { done: '✓', fail: '✕', back: '↩', skip: '–' }

/** One progress model per card: the stage run's stages when it has one, else Research, Build, Gate, Review, Your call from its roles and last test run.
 *  A stage sent back or waiting on review opens the stage list in place, with Looks good and Redo. */
function Track({ hub, sessionId, progress, send }: { hub: HubState; sessionId: string; progress?: ChatProgress; send: (c: HubCommand) => void }) {
  const found = chatRun(hub, sessionId)
  const v = found && stageView(found.run.stages)
  if (v && (v.gate >= 0 || found.run.stages[v.at]?.status === 'redo')) return <CardStages hub={hub} sessionId={sessionId} send={send} inline />
  const t = track(progress, found?.run)
  const g = t.gate
  return (
    <div className="nb-track">
      <ol className="nb-steps" data-stages={t.stages || undefined} aria-label={found ? v!.line : 'Stations'}>
        {t.steps.map(s => <li key={s.id} data-st={s.state} title={s.title}><i aria-hidden /><span>{MARK[s.state] && <b aria-hidden>{MARK[s.state]}</b>}<span className="nb-lbl">{s.label}</span><span className="nb-sr">, {s.title.split(': ').pop()}</span></span></li>)}
      </ol>
      {(t.round > 1 || g) && <p className="nb-track-meta">
        {t.round > 1 && <span className="nb-rounds" title={`Round ${t.round}: sent back by ${BACK[t.back!]}`}>{Array.from({ length: t.round }, (_, i) => <b key={i} data-cur={i === t.round - 1 || undefined}>R{i + 1}</b>)}<span className="nb-sr"> sent back by {BACK[t.back!]}</span></span>}
        {g && <span className="nb-gate" data-st={!t.fresh ? 'stale' : g.ok ? 'ok' : 'fail'} title={gateTitle(g)}>
          <b>Gate</b> <span>{!t.fresh ? `last run ${g.ok ? 'passed' : 'failed'}, rerun due` : g.total !== undefined ? g.ok ? `${g.total - (g.failed ?? 0)} of ${g.total} passed` : `${g.failed ?? '?'} of ${g.total} failed` : g.ok ? 'passed' : 'failed'}</span> <code>{g.command}</code>
        </span>}
      </p>}
    </div>
  )
}

/** Verified once a review finished after the last edit and the gate passed after it; the evidence opens on tap. */
function Verified({ progress, now }: { progress?: ChatProgress; now: number }) {
  const v = verify(progress)
  if (!v) return null
  const when = (at: number) => { const w = ago(at, now); return w === 'now' ? 'just now' : `${w} ago` }
  return (
    <details className="nb-verify" data-ok={v.ok || undefined}>
      <summary title={v.ok ? 'Review and gate both after the last edit' : v.reasons.join(', ')}><span><i aria-hidden>{v.ok ? '✓' : '!'}</i>{v.ok ? 'Verified' : 'Unverified'}</span></summary>
      <ul>
        {v.reasons.map(r => <li key={r} data-bad>{r[0].toUpperCase() + r.slice(1)}</li>)}
        {v.gate && <li>Gate <code>{v.gate.command}</code> {v.gate.ok ? 'passed' : 'failed'}{v.gate.total !== undefined ? ` (${v.gate.total - (v.gate.failed ?? 0)} of ${v.gate.total})` : ''}, {when(v.gate.at)}</li>}
        {v.review && <li>{v.review.role} finished {when(v.review.at ?? v.review.startedAt)}</li>}
        <li>Last edit {when(v.edit)}</li>
      </ul>
    </details>
  )
}

/** fold: on a phone the lane shows as one count row until opened. */
const FIRST = 3 // keep in step with the n+4 in now-board.css
function Lane({ id, title, count, tone, empty, fold, cap, children }: { id: string; title: string; count: number; tone: string; empty: string; fold?: boolean; cap?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const capped = cap && count > FIRST && !all
  const body = useId()
  const shut = fold && !open
  const head = <><span className="nb-title" data-tone={tone}><i aria-hidden />{title}</span><span className="nb-count">{count}</span></>
  return (
    <section className="now-lane nb-lane" data-lane={id} data-shut={shut || undefined} data-cap={capped || undefined} aria-labelledby={`nb-${id}`}>
      <h2 id={`nb-${id}`} className="nb-head">
        {fold ? <button type="button" className="nb-fold" aria-expanded={open} aria-controls={open ? body : undefined} onClick={() => setOpen(o => !o)}>{head}<b aria-hidden>›</b></button> : head}
      </h2>
      {!shut && <div id={body} className="nb-body">{count === 0 || !children ? <p className="now-empty">{empty}</p> : children}
        {capped && <button type="button" className="hub-btn sm nb-more" onClick={() => setAll(true)}>Show {count - FIRST} more</button>}</div>}
    </section>
  )
}

function CookTicket({ card, hub, send, tint, list, onOpen, now }: { card: Card; hub: HubState; send: (c: HubCommand) => void; tint?: string; list?: TodoList; onOpen: (id: string) => void; now: number }) {
  const r = laneRow(card)
  const m = chatMeta(card.chat, card.progress, hub.live)
  const stuck = chatShown(card.progress, hub.stuck) === 'stuck' ? (hub.stuck ?? []).filter(i => i.sessionId === r.id) : []
  const t = track(card.progress, chatRun(hub, r.id)?.run)
  // a stage run names its own current step on the track; the task list can disagree with it, so only what still runs shows
  const step = t.stages ? busyLine(card.progress) : r.step
  return (
    <li className="nb-ticket" data-stuck={stuck.length > 0 || undefined} style={tint ? { borderLeftColor: tint } : undefined}>
      {t.back && t.at === 'build' && <span className="nb-back"><b aria-hidden>↩</b> Sent back by {BACK[t.back]}</span>}
      <button type="button" className="nb-open" onClick={() => onOpen(r.id)} title={`Open ${r.name} in Chats`}>
        <strong className="nb-cook">{cookTitle(r.name, r.id, list)}</strong>
        <span className="nb-sub">{r.project}</span>
      </button>
      <Track hub={hub} sessionId={r.id} progress={card.progress} send={send} />
      {step && <code className="now-step">{step}</code>}
      <span className="nb-foot"><span className="nb-cost">{m.cost ?? 'No cost yet'}</span>{m.time && <span className="nb-cost">{m.time}</span>}<Verified progress={card.progress} now={now} /></span>
      {stuck.map(i => (
        <span key={i.id} className="nb-stuck" role="group" aria-label={`Stuck in ${r.name}`}>
          <span className="nb-stuck-text"><b>Stuck</b> {i.what}</span>
          <button type="button" className="hub-btn sm" title={i.kind === 'agent' ? 'Tell the chat to check on this subagent' : i.pid ? 'Stop it and tell the chat to rerun it if needed' : 'Tell the chat to stop and rerun it'} onClick={() => send({ type: 'hub-stuck-fix', sessionId: i.sessionId, id: i.id })}>Fix</button>
        </span>
      ))}
    </li>
  )
}

type HeldWhy = NonNullable<TodoList['plan']>['held'][number]['why']
function NextTicket({ row, n, held, hold, start, onPlan }: { row: NextRow; n?: number; held?: HeldWhy; hold?: NonNullable<TodoList['plan']>['hold']; start?: () => void; onPlan: () => void }) {
  const { t, you } = row
  const { tag, kind } = nextTag(row, n, held)
  const again = kind === 'stopped' ? 'Start again' : 'Start'
  return (
    <li className="nb-ticket nb-next" data-you={you || undefined} data-kind={kind}>
      <span className="nb-tag" data-kind={kind}>{tag}</span>
      <p className="nb-text">{t.short ?? t.text}</p>
      {hold && <span className="nb-hold" data-kind={hold.kind}>{hold.text}</span>}
      <span className="nb-acts">
        {you ? <button type="button" className="hub-btn sm" onClick={onPlan}>Open Plan</button>
          : start && <button type="button" className="hub-btn sm" onClick={start} aria-label={`${again}: ${t.text}`}>{again}</button>}
      </span>
    </li>
  )
}

const DONE: Record<DoneKind, { title: string; word: string }> = { merged: { title: 'Merged', word: 'merged' }, approved: { title: 'Approved', word: 'approved' }, stopped: { title: 'Stopped', word: 'stopped' } }

/** Today's finished chats in three groups: merged (its commit is in the branch or its PR merged), approved, and stopped on their own. */
function useDone(p: Props) {
  const archive = (p.hub.archive ?? []).filter(a => inProjects(a, p.projects ?? []))
  const groups = doneGroups(p.done, archive, p.hub.repo ?? undefined, p.now ?? Date.now())
  return { groups, count: groups.merged.length + groups.approved.length + groups.stopped.length }
}

function DoneList({ p, groups }: { p: Props; groups: Record<DoneKind, ArchivedChat[]> }) {
  const now = p.now ?? Date.now()
  return <>{(Object.keys(DONE) as DoneKind[]).filter(k => groups[k].length).map(k => (
    <div key={k} className="nb-done" data-kind={k}>
      <h3 className="nb-done-head">{DONE[k].title} <span>{groups[k].length}</span></h3>
      <ul className="nb-list">{groups[k].map(a => { const w = ago(k === 'stopped' ? a.archivedAt : a.approvedAt!, now); return (
        <li key={a.sessionId} className="nb-ticket" style={p.tint?.(a.cwd) ? { borderLeftColor: p.tint(a.cwd) } : undefined}>
          <button type="button" className="nb-open" onClick={() => p.onDone(a)} title={`Show ${a.name} in History`}>
            <strong>{a.name}</strong><span className="nb-sub">{a.project} · {DONE[k].word} {w === 'now' ? 'just now' : `${w} ago`}{a.costUsd ? ` · $${a.costUsd.toFixed(2)}` : ''}</span>
          </button>
        </li>) })}</ul>
    </div>
  ))}</>
}

/** Up next rows with their To-do number, why the plan holds them, and Start. */
function useNext(p: Props) {
  const live = (chat?: string) => !!chat && p.hub.chats.some(c => c.sessionId === chat && c.live)
  const rows = nextRows(p.todo?.list, live)
  const num = new Map(p.todo?.list?.plan?.runs.flatMap(r => r.ids.map(id => [id, r.n] as const)))
  const held = new Map(p.todo?.list?.plan?.held.map(h => [h.id, h.why] as const))
  const start = (id: string) => p.todo ? () => p.send({ type: 'hub-todo-run', path: p.todo!.folder, ids: [id] }) : undefined
  return { rows, list: rows.length > 0 && <ul className="nb-list">{rows.map((r, i) => <NextTicket key={r.t.id} row={r} n={num.get(r.t.id)} held={held.get(r.t.id)} hold={i === rows.findIndex(x => !x.you) ? p.todo?.list?.plan?.hold : undefined} start={start(r.t.id)} onPlan={p.onPlan} />)}</ul> }
}

// A kitchen pass: Your call first, then what is cooking, what is queued and what went out today.
export function NowLine(p: Props) {
  const narrow = useNarrow()
  const next = useNext(p)
  const done = useDone(p)
  const now = p.now ?? Date.now()
  return (
    <div className="now nb">
      {p.jarvis}
      {p.filter}
      <div className="nb-line">
        {narrow && <NeedChip n={p.needsCount ?? 0} />}
        <Lane id="call" title="Your call" tone="red" count={p.needsCount ?? 0} cap={narrow} empty="Nothing waits on you.">{p.needs}</Lane>
        <Lane id="cook" title="Cooking" tone="blue" count={p.working.length} empty="No chat is working.">
          {p.working.length > 0 && <ul className="nb-list">{p.working.map(c => <CookTicket key={c.chat.sessionId} card={c} hub={p.hub} send={p.send} tint={p.tint?.(c.chat.cwd)} list={p.todo?.list} onOpen={p.onOpen} now={now} />)}</ul>}
        </Lane>
        <Lane id="next" title="Up next" tone="mute" count={next.rows.length} fold={narrow} empty="Nothing queued. Add a to-do on Plan.">{next.list}</Lane>
        <Lane id="done" title="Done today" tone="green" count={done.count} fold={narrow} empty="Nothing finished yet today.">
          {done.count > 0 && <DoneList p={p} groups={done.groups} />}
        </Lane>
      </div>
    </div>
  )
}
