'use client'
import { createContext, useEffect, useState, type ReactNode } from 'react'
import type { HubState } from '@/lib/hub-types'
import { rowsOf, splitA, type Row } from '@/lib/todo-layout'
import { recentDone, shownProjects, titleOf } from '@/lib/todo-view'
import { baseName } from '@/lib/path'
import { PageStats, Seg } from './page-kit'
import { RailCtx } from './today'
import './plan-page.css'

/** True in the narrow layout: every to-do section shows open, whatever was folded before. */
export const ForceOpen = createContext(false)
type Tab = 'decide' | 'queue' | 'running' | 'done'

/** Narrow screens get the tabs layout; the hook follows a resize. */
function useNarrow() {
  const [narrow, set] = useState(false)
  useEffect(() => { const m = matchMedia('(max-width: 760px)'), f = () => set(m.matches); f(); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, [])
  return narrow
}

/** Plan: stats, then the to-do by project. Wide screens get two columns (rail for Today and Jev), 760px and narrower one column with tabs by status. */
export function PlanPage({ hub, folder, todo, today, jev }: { hub: HubState; folder?: string; todo: ReactNode; today: ReactNode; jev: ReactNode }) {
  const b = useNarrow()
  const [tab, setTab] = useState<Tab>('decide'), [proj, setProj] = useState<string | null>(null)
  const now = Date.now(), todos = hub.todos ?? {}
  const live = (id?: string) => !!id && hub.chats.some(c => c.sessionId === id && c.live)
  // Snoozes live in the panel, so a snoozed suggestion still counts here.
  const per = shownProjects(todos, folder, now).map(f => { const d = rowsOf(todos[f] ?? { todo: [] }, live, now, () => false); return { f, a: splitA(d), done: recentDone(todos[f], now).length } })
  const sum = (k: 'decide' | 'running' | 'queue' | 'waiting') => per.reduce((n, p) => n + p.a[k].length, 0)
  const n = { decide: sum('decide'), running: sum('running'), queue: sum('queue') + sum('waiting'), done: per.reduce((x, p) => x + p.done, 0) }
  const first = (k: 'decide' | 'queue') => { for (const p of per) { const r: Row | undefined = k === 'queue' ? p.a.queue.find(x => x.status === 'ready') ?? p.a.queue[0] : p.a.decide[0]; if (r) return { r, f: p.f } } }
  const nx = first('decide') ? { k: 'decide' as const, ...first('decide')! } : first('queue') ? { k: 'queue' as const, ...first('queue')! } : undefined

  // The per-project Done folds open on the Done tab.
  useEffect(() => { if (b && tab === 'done') document.querySelectorAll<HTMLDetailsElement>('.pl-b details[data-sec="done"]').forEach(d => { d.open = true }) }, [b, tab, n.done])
  const reveal = (id: string) => requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[data-sec="${id}"]`)
    el?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  })
  const go = (k: Tab) => { if (b) setTab(k); else reveal(k) }
  const goNext = () => {
    if (!nx) return
    if (b) setTab(nx.k)
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-item="${CSS.escape(nx.r.t.id)}"]`)
      el?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      el?.querySelector<HTMLElement>('.tdx-title')?.focus({ preventScroll: true })
    })
  }

  const chips = per.filter(p => p.a.decide.length + p.a.running.length + p.a.queue.length + p.a.waiting.length + p.done > 0)
  // A picked chip that vanished falls back to All.
  const sel = chips.some(p => baseName(p.f) === proj) ? proj : null
  const shown = per.filter(p => !sel || baseName(p.f) === sel), cnt = (k: 'decide' | 'running' | 'queue' | 'waiting') => shown.reduce((x, p) => x + p.a[k].length, 0)
  const tn = { decide: cnt('decide'), queue: cnt('queue') + cnt('waiting'), running: cnt('running'), done: shown.reduce((x, p) => x + p.done, 0) }
  const stats = <PageStats label="Plan numbers" items={[
    { label: 'To decide', value: n.decide, tone: n.decide ? 'yellow' : undefined, onClick: () => go('decide') },
    { label: 'Queued', value: n.queue, onClick: () => go('queue') },
    { label: 'Running', value: n.running, tone: n.running ? 'blue' : undefined, onClick: () => go('running') },
    { label: 'Done this week', value: n.done, tone: n.done ? 'green' : undefined, onClick: () => go('done') },
  ]} />
  const next = nx && <button type="button" className="pl-next" onClick={goNext}>
    <span className="pl-next-k">{nx.k === 'decide' ? 'Decide next' : 'Up next'}</span>
    <span className="pl-next-t">{titleOf(nx.r.t)}</span>
    <span className="pl-next-p">{baseName(nx.f)}</span>
  </button>
  const rail = <RailCtx.Provider value>{today}{jev}</RailCtx.Provider>

  if (!b) return <div className="pl pl-a">
    {stats}
    <div className="pl-cols">
      <div className="pl-main">{next}{todo && <div id="hub-todo" className="pl-todo">{todo}</div>}</div>
      <aside className="pl-rail" aria-label="Today and Jev">{rail}</aside>
    </div>
  </div>

  // Hide other tabs and other projects by attribute; the to-do panel keeps its own logic.
  const css = `.pl-b .tdx [data-sec]${(tab === 'queue' ? ['queue', 'waiting'] : [tab]).map(k => `:not([data-sec="${k}"])`).join('')}{display:none}`
    + (sel ? `.pl-b .tdx [data-proj]:not([data-proj=${JSON.stringify(sel)}]){display:none}.pl-b .tdx-list:not(:has(> [data-proj=${JSON.stringify(sel)}])){display:none}` : '')
  return <div className="pl pl-b">
    {stats}
    {next}
    <div className="pl-bar">
      <Seg label="Status" value={tab} onChange={setTab} options={[['decide', 'Decide', tn.decide], ['queue', 'Queue', tn.queue], ['running', 'Running', tn.running], ['done', 'Done', tn.done]]} />
      {chips.length > 1 && <div className="pl-chips" role="group" aria-label="Project">
        <button type="button" aria-pressed={!sel} onClick={() => setProj(null)}>All</button>
        {chips.map(p => <button key={p.f} type="button" aria-pressed={sel === baseName(p.f)} onClick={() => setProj(baseName(p.f))}>{baseName(p.f)}</button>)}
      </div>}
    </div>
    <style>{css}</style>
    {tn[tab] === 0 && <p className="pl-empty">Nothing in {tab === 'queue' ? 'the queue' : tab === 'done' ? 'done this week' : tab}.</p>}
    {todo && <div id="hub-todo" className="pl-todo"><ForceOpen.Provider value>{todo}</ForceOpen.Provider></div>}
    <div className="pl-pair">{rail}</div>
  </div>
}
