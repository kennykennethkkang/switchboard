'use client'
import type { ReactNode } from 'react'
import { laneRow, type Day } from '@/lib/now'
import type { ArchivedChat } from '@/lib/hub-types'
import { plural, type Card } from './chat-cards'
import { ago } from '@/lib/look'
import './layout.css'

type Tone = 'red' | 'blue' | 'green'

function Lane({ tone, title, count, empty, children }: { tone: Tone; title: string; count?: number; empty: string; children?: ReactNode }) {
  const id = `now-lane-${tone}`
  return (
    <section className="now-lane" aria-labelledby={id}>
      <h2 id={id} className="now-lane-head">
        <span className="now-badge" data-tone={tone}><i aria-hidden />{title}</span>
        {count !== undefined && <span className="now-count">{count}</span>}
      </h2>
      {count === 0 || !children ? <p className="now-empty">{empty}</p> : children}
    </section>
  )
}

function Row({ card, tint, onOpen }: { card: Card; tint?: (c: Card) => string | undefined; onOpen: (id: string) => void }) {
  const r = laneRow(card)
  return (
    <li>
      <button type="button" className="now-row" onClick={() => onOpen(r.id)} title={`Open ${r.name} in Chats`}>
        <strong>{r.name}</strong>
        <span className="now-meta">
          <i aria-hidden style={{ background: tint?.(card) ?? 'var(--hub-mute)' }} />
          <span className="sr-only">{r.project}, </span>
          {[r.role, r.total ? `${r.done} of ${r.total}` : ''].filter(Boolean).join(' · ') || r.project}
          {r.total > 0 && <span className="now-bar" aria-hidden><b style={{ transform: `scaleX(${r.done / r.total})` }} /></span>}
        </span>
        {r.step && <code className="now-step">{r.step}</code>}
      </button>
    </li>
  )
}

function DoneRow({ a, tint, onOpen, now }: { a: ArchivedChat; tint?: (cwd: string) => string | undefined; onOpen: (a: ArchivedChat) => void; now: number }) {
  const when = ago(a.approvedAt!, now)
  return (
    <li>
      <button type="button" className="now-row" onClick={() => onOpen(a)} title={`Show ${a.name} in History`}>
        <strong>{a.name}</strong>
        <span className="now-meta">
          <i aria-hidden style={{ background: tint?.(a.cwd) ?? 'var(--hub-mute)' }} />
          <span className="sr-only">{a.project}, </span>
          {when === 'now' ? 'approved just now' : `approved ${when} ago`}
        </span>
      </button>
    </li>
  )
}

/**
 * needs: the shell's StuckStrip as-is. needsCount: its item count, for the badge; 0 shows the empty line instead.
 * done: chats approved today, from the archive; onDone opens one in History.
 * tint: a folder's project color for a row's dot.
 */
export function NowPage({ day, needs, needsCount, working, done, onOpen, onDone, jarvis, filter, tint, now = Date.now() }: {
  day: Day; needs: ReactNode; needsCount?: number; working: Card[]; done: ArchivedChat[]; onOpen: (id: string) => void; onDone: (a: ArchivedChat) => void
  jarvis?: ReactNode; filter?: ReactNode; tint?: (cwd: string) => string | undefined; now?: number
}) {
  const cost = day.jev ? `$${day.jev.costUsd.toFixed(2)}` : '$0'
  return (
    <div className="now">
      {jarvis}
      <dl className="now-day">
        <div><dt>tasks done today</dt><dd>{day.done} / {day.total}</dd></div>
        <div><dt>{day.working === 1 ? 'chat working' : 'chats working'}</dt><dd>{day.working}</dd></div>
        <div><dt>approved today</dt><dd>{day.approved}</dd></div>
        <div><dt>{day.jev ? `Jev, ${plural(day.jev.runs, 'run')}` : 'Jev, no runs'}</dt><dd>{cost}</dd></div>
      </dl>
      {filter}
      <div className="now-lanes">
        <Lane tone="red" title="Needs you" count={needsCount} empty="Nothing needs you right now.">{needs}</Lane>
        <Lane tone="blue" title="Working" count={working.length} empty="No chat is working.">{working.length > 0 && <ul className="now-rows">{working.map(c => <Row key={c.chat.sessionId} card={c} tint={c => tint?.(c.chat.cwd)} onOpen={onOpen} />)}</ul>}</Lane>
        <Lane tone="green" title="Done today" count={done.length} empty="Nothing finished yet today.">{done.length > 0 && <ul className="now-rows">{done.map(a => <DoneRow key={a.sessionId} a={a} tint={tint} onOpen={onDone} now={now} />)}</ul>}</Lane>
      </div>
    </div>
  )
}
