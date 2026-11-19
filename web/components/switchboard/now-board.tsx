'use client'
// The Now page: the line board, or the old lanes at ?layout=classic. It reads NowPage's own props, so counts and actions match it.
import { useEffect, useId, useState, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import type { HubState, Stage, TodoList } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { chatRun, stageView } from '@/lib/stages-ui'
import { laneRow } from '@/lib/now'
import { chatMeta, cookTitle, layoutOf, needChip, nextCardIndex, nextRows, type NextRow, type NowLayout } from '@/lib/now-board'
import { ago } from '@/lib/look'
import type { NowPage } from './now-page'
import type { Card } from './chat-cards'
import './layout.css'
import './now-board.css'

type PageProps = ComponentProps<typeof NowPage>
type Extra = { hub: HubState; send: (c: HubCommand) => void; todo?: { folder: string; list?: TodoList }; onPlan: () => void }

/** page: the NowPage element the shell already builds; the line board reads its props. */
export function NowLayouts({ page, ...extra }: Extra & { page: ReactElement<PageProps> }) {
  const [layout, setLayout] = useState<NowLayout>('line')
  useEffect(() => { setLayout(layoutOf(location.search)) }, [])
  return layout === 'classic' ? page : <NowLine {...page.props} {...extra} />
}

type Props = PageProps & Extra
const WORD: Record<Stage['status'], string> = { todo: 'to do', doing: 'running', done: 'done', redo: 'sent back' }
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

function Chips({ hub, sessionId }: { hub: HubState; sessionId: string }) {
  const run = chatRun(hub, sessionId)?.run
  if (!run) return null
  return (
    <ol className="nb-chips" aria-label={stageView(run.stages).line}>
      {run.stages.map(s => <li key={s.n} data-st={s.status} title={`${s.name}: ${WORD[s.status]}`}>{s.status === 'done' && <span aria-hidden>✓ </span>}{s.role}</li>)}
    </ol>
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

function CookTicket({ card, hub, send, tint, list, onOpen }: { card: Card; hub: HubState; send: (c: HubCommand) => void; tint?: string; list?: TodoList; onOpen: (id: string) => void }) {
  const r = laneRow(card)
  const m = chatMeta(card.chat, card.progress, hub.live)
  const stuck = (hub.stuck ?? []).filter(i => i.sessionId === r.id)
  return (
    <li className="nb-ticket" data-stuck={stuck.length > 0 || undefined} style={tint ? { borderLeftColor: tint } : undefined}>
      <button type="button" className="nb-open" onClick={() => onOpen(r.id)} title={`Open ${r.name} in Chats`}>
        <strong className="nb-cook">{cookTitle(r.name, r.id, list)}</strong>
        <span className="nb-sub">{[r.project, r.role, r.total ? `${r.done} of ${r.total}` : ''].filter(Boolean).join(' · ')}</span>
      </button>
      <Chips hub={hub} sessionId={r.id} />
      {r.step && <code className="now-step">{r.step}</code>}
      <span className="nb-foot"><span className="nb-cost">{m.cost ?? 'No cost yet'}</span>{m.time && <span className="nb-cost">{m.time}</span>}</span>
      {stuck.map(i => (
        <span key={i.id} className="nb-stuck" role="group" aria-label={`Stuck in ${r.name}`}>
          <span className="nb-stuck-text"><b>Stuck</b> {i.what}</span>
          <button type="button" className="hub-btn sm" title={i.kind === 'agent' ? 'Tell the chat to check on this subagent' : i.pid ? 'Stop it and tell the chat to rerun it if needed' : 'Tell the chat to stop and rerun it'} onClick={() => send({ type: 'hub-stuck-fix', sessionId: i.sessionId, id: i.id })}>Fix</button>
        </span>
      ))}
    </li>
  )
}

function NextTicket({ row, n, start, onPlan }: { row: NextRow; n?: number; start?: () => void; onPlan: () => void }) {
  const { t, you } = row
  const tag = you ? 'Your step' : t.why === 'blocked' ? 'Blocked' : n ? `To-do ${n}` : 'To-do'
  return (
    <li className="nb-ticket nb-next" data-you={you || undefined}>
      <span className="nb-tag" data-kind={you ? 'you' : undefined}>{tag}</span>
      <p className="nb-text">{t.text}</p>
      <span className="nb-acts">
        {you ? <button type="button" className="hub-btn sm" onClick={onPlan}>Open Plan</button>
          : start && <button type="button" className="hub-btn sm" onClick={start} aria-label={`Start: ${t.text}`}>Start</button>}
      </span>
    </li>
  )
}

// A kitchen pass: Your call first, then what is cooking, what is queued and what went out today.
export function NowLine(p: Props) {
  const narrow = useNarrow()
  const live = (chat?: string) => !!chat && p.hub.chats.some(c => c.sessionId === chat && c.live)
  const rows = nextRows(p.todo?.list, live)
  const num = new Map(p.todo?.list?.plan?.runs.flatMap(r => r.ids.map(id => [id, r.n] as const)))
  const start = (id: string) => p.todo ? () => p.send({ type: 'hub-todo-run', path: p.todo!.folder, ids: [id] }) : undefined
  const now = p.now ?? Date.now()
  return (
    <div className="now nb">
      {p.jarvis}
      {p.filter}
      <div className="nb-line">
        {narrow && <NeedChip n={p.needsCount ?? 0} />}
        <Lane id="call" title="Your call" tone="red" count={p.needsCount ?? 0} cap={narrow} empty="Nothing waits on you.">{p.needs}</Lane>
        <Lane id="cook" title="Cooking" tone="blue" count={p.working.length} empty="No chat is working.">
          {p.working.length > 0 && <ul className="nb-list">{p.working.map(c => <CookTicket key={c.chat.sessionId} card={c} hub={p.hub} send={p.send} tint={p.tint?.(c.chat.cwd)} list={p.todo?.list} onOpen={p.onOpen} />)}</ul>}
        </Lane>
        <Lane id="next" title="Up next" tone="mute" count={rows.length} fold={narrow} empty="Nothing queued. Add a to-do on Plan.">
          {rows.length > 0 && <ul className="nb-list">{rows.map(r => <NextTicket key={r.t.id} row={r} n={num.get(r.t.id)} start={start(r.t.id)} onPlan={p.onPlan} />)}</ul>}
        </Lane>
        <Lane id="done" title="Done today" tone="green" count={p.done.length} fold={narrow} empty="Nothing approved yet today.">
          {p.done.length > 0 && <ul className="nb-list">{p.done.map(a => { const w = ago(a.approvedAt!, now); return (
            <li key={a.sessionId} className="nb-ticket" style={p.tint?.(a.cwd) ? { borderLeftColor: p.tint(a.cwd) } : undefined}>
              <button type="button" className="nb-open" onClick={() => p.onDone(a)} title={`Show ${a.name} in History`}>
                <strong>{a.name}</strong><span className="nb-sub">{a.project} · {w === 'now' ? 'approved just now' : `approved ${w} ago`}{a.costUsd ? ` · $${a.costUsd.toFixed(2)}` : ''}</span>
              </button>
            </li>) })}</ul>}
        </Lane>
      </div>
    </div>
  )
}
