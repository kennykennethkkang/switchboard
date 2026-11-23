'use client'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { answerBlocks, citations, inline, siteOf } from '@/lib/research'
import type { HubState } from '@/lib/hub-types'
import type { Page } from '@/lib/route'
import { postCommand } from '@/lib/hub-remote'
import { demoResearch, demoResearchBody } from '@/lib/hub-demo'
import { vscodeBridge, type HubCommand } from '@/lib/vscode-bridge'
import './research-library.css'

export type ResearchItem = NonNullable<HubState['research']>[number]

type St = { items: ResearchItem[]; sel?: string; seen: Record<string, true>; toast?: string; filter: string; ready: boolean }
const EMPTY: St = { items: [], seen: {}, filter: 'all', ready: false }
let st = EMPTY
const subs = new Set<() => void>()
const set = (p: Partial<St>) => { st = { ...st, ...p }; subs.forEach(f => f()) }
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
const useLib = () => useSyncExternalStore(sub, () => st, () => EMPTY)

// Reports newer than this page load toast; older unseen ones only wait in the list.
const LOADED = Date.now()
const announced = new Set<string>()

const unseen = (s: St, r: ResearchItem) => !r.seen && !s.seen[r.id]
export const useResearchUnseen = () => { const s = useLib(); return s.items.filter(r => unseen(s, r)).length }

/** Inside the editor the bridge sends; in the browser app the hub's /hub/command takes it. */
const command = (c: HubCommand) => { if (vscodeBridge?.isVSCode) vscodeBridge.sendHub(c); else void postCommand(c) }
const loadBody = (id: string): Promise<string> => vscodeBridge?.researchRead(id) ?? Promise.resolve(demoResearchBody(id) ?? '')

const pick = (id: string) => {
  const r = st.items.find(x => x.id === id)
  if (r && unseen(st, r)) command({ type: 'hub-research-seen', id })
  set({ sel: id, seen: { ...st.seen, [id]: true }, toast: st.toast === id ? undefined : st.toast })
}

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p
const hueOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
const when = (at: number) => {
  const m = Math.round((Date.now() - at) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 24 * 60) return `${Math.round(m / 60)} h ago`
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
const confOf = (body: string) => body.match(/confidence:?\**\s*(high|medium|low)/i)?.[1].toLowerCase() as 'high' | 'medium' | 'low' | undefined

function Chip({ project }: { project?: string }) {
  return <span className="rl-chip" data-general={project ? undefined : ''} style={project ? { ['--h' as string]: hueOf(project) } : undefined}>{project ? baseName(project) : 'General'}</span>
}

function Conf({ level }: { level?: 'high' | 'medium' | 'low' }) {
  if (!level) return null
  const n = level === 'high' ? 3 : level === 'medium' ? 2 : 1
  return <span className="rl-conf" data-level={level}><span className="rl-conf-bars" aria-hidden>{[1, 2, 3].map(i => <i key={i} data-on={i <= n || undefined} />)}</span>{level[0].toUpperCase() + level.slice(1)} confidence</span>
}

/** Feeds the store and shows the "Research finished" toast for a new report. Mount once in the shell. */
export function ResearchSignal({ items, go, page }: { items?: ResearchItem[]; go: (p: Page) => void; page: Page }) {
  const s = useLib()
  useEffect(() => {
    const list = items ?? demoResearch(LOADED)
    const fresh = list.find(r => !r.seen && !announced.has(r.id) && (items === undefined || r.at > LOADED))
    if (fresh) announced.add(fresh.id)
    set({ items: list, sel: list.some(r => r.id === st.sel) ? st.sel : list[0]?.id, ready: true, toast: fresh ? fresh.id : st.toast })
  }, [items])
  const toast = s.toast
  // Gone on its own after a while, so it never sits over a report.
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => set({ toast: undefined }), 9000)
    return () => clearTimeout(t)
  }, [toast])
  const r = s.items.find(x => x.id === s.toast)
  const view = () => {
    if (!r) return
    pick(r.id)
    go('research')
  }
  return (
    <div className="rl-toast-host" role="status" aria-live="polite">
      {r && page !== 'research' && <div className="rl-toast" key={r.id}>
        <span className="rl-toast-mark" aria-hidden><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5 6.5 12 13 4.5" /></svg></span>
        <div className="rl-toast-text">
          <strong>Research finished</strong>
          <span>{r.question}</span>
          <small><Chip project={r.project} />{r.sources} sources</small>
        </div>
        <div className="rl-toast-acts">
          <button type="button" className="rl-btn is-primary" onClick={view}>View</button>
          <button type="button" className="rl-btn is-ghost" aria-label="Dismiss" onClick={() => set({ toast: undefined })}>
            <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        </div>
      </div>}
    </div>
  )
}

function Report({ r, onBack, onChat }: { r: ResearchItem; onBack?: () => void; onChat?: (sessionId: string) => void }) {
  const [body, setBody] = useState<string>()
  useEffect(() => {
    let live = true
    setBody(undefined)
    void loadBody(r.id).then(t => { if (live) setBody(t) })
    return () => { live = false }
  }, [r.id])
  const text = body ?? ''
  const [prose, srcText] = useMemo(() => { const i = text.search(/^#+\s*Sources\s*$/m); return i < 0 ? [text, ''] : [text.slice(0, i), text.slice(i)] }, [text])
  const blocks = useMemo(() => answerBlocks(prose.replace(/^\**confidence:?\**.*$/gim, '')), [prose])
  const cites = useMemo(() => citations(text), [text])
  const srcs = useMemo(() => srcText.split('\n').map(l => l.match(/^\s*[-*]?\s*\[(\d+)\]\s*(.*?)\s*(https?:\/\/\S+)\s*$/)).filter(Boolean).map(m => ({ n: Number(m![1]), title: m![2], url: m![3] })), [srcText])
  const line = (s: string) => inline(s).map((p, i) =>
    p.t === 'b' ? <strong key={i}>{p.s}</strong>
      : p.t === 'code' ? <code key={i}>{p.s}</code>
        : p.t === 'link' ? <a key={i} href={p.href} target="_blank" rel="noreferrer">{p.s}</a>
          : p.t === 'cite' ? (cites[p.n] ? <a key={i} className="rl-cite" href={cites[p.n]} target="_blank" rel="noreferrer" aria-label={`Source ${p.n}`}>{p.n}</a> : <sup key={i}>{p.n}</sup>)
            : <span key={i}>{p.s}</span>)
  const remove = () => {
    command({ type: 'hub-research-delete', id: r.id })
    const rest = st.items.filter(x => x.id !== r.id)
    set({ items: rest, sel: rest[0]?.id, toast: st.toast === r.id ? undefined : st.toast })
    onBack?.()
  }
  return (
    <article className="rl-report" key={r.id} aria-labelledby={`rl-q-${r.id}`}>
      {onBack && <button type="button" className="rl-back" onClick={onBack}>
        <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3 5 8l5 5" /></svg>All research
      </button>}
      <header className="rl-report-head">
        <p className="rl-kicker"><Chip project={r.project} /><span>{when(r.at)}</span><span aria-hidden>/</span><span>{r.chat}</span></p>
        <h2 id={`rl-q-${r.id}`}>{r.question}</h2>
        <div className="rl-stats">
          <Conf level={confOf(text)} />
          <span className="rl-stat"><b>{r.sources}</b> sources</span>
          {onChat && <button type="button" className="rl-btn" onClick={() => onChat(r.sessionId)}>Open chat</button>}
          <button type="button" className="rl-btn is-ghost" onClick={remove}>Delete</button>
        </div>
      </header>
      <p className="rl-summary">{r.summary}</p>
      {body === undefined && <p className="rl-empty">Loading report</p>}
      <div className="rl-body">
        {blocks.filter(b => !(b.type === 'h' && /^answer$/i.test(b.text))).map((b, i) => b.type === 'h'
          ? <h3 key={i}>{line(b.text)}</h3>
          : b.type === 'li' ? <p key={i} className="rl-li" data-n={b.n || undefined}><span aria-hidden>{b.n ? `${b.n}` : ''}</span><span>{line(b.text)}</span></p>
            : <p key={i}>{line(b.text)}</p>)}
      </div>
      {srcs.length > 0 && <section className="rl-sources" aria-label="Sources">
        <h3>Sources</h3>
        <ol>{srcs.map(s => { const site = siteOf(s.url); return (
          <li key={s.n}><a href={s.url} target="_blank" rel="noreferrer">
            <span className="rl-fav" style={{ ['--h' as string]: site.hue }} aria-hidden>{site.letter}</span>
            <span className="rl-src-t"><b>{s.title || site.host}</b><small>{site.host}</small></span>
            <span className="rl-src-n">{s.n}</span>
          </a></li>) })}</ol>
      </section>}
    </article>
  )
}

/** List plus reader. Narrow containers show one at a time. */
export function ResearchLibrary({ onChat }: { onChat?: (sessionId: string) => void }) {
  const s = useLib()
  const [solo, setSolo] = useState(false)
  const projects = [...new Set(s.items.map(r => r.project).filter((p): p is string => !!p))]
  const shown = s.items.filter(r => s.filter === 'all' || (s.filter === 'general' ? !r.project : r.project === s.filter))
  const sel = s.items.find(r => r.id === s.sel)
  const listRef = useRef<HTMLUListElement>(null)
  const keys = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const btns = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const i = btns.indexOf(document.activeElement as HTMLButtonElement)
    const to = btns[Math.max(0, Math.min(btns.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (to) { e.preventDefault(); to.focus() }
  }
  if (!s.ready) return null
  const filters: [string, string][] = [['all', 'All'], ...projects.map(p => [p, baseName(p)] as [string, string]), ['general', 'General']]
  return (
    <div className="rl" data-solo={solo || undefined}>
      <div className="rl-side">
        <div className="rl-filter" role="group" aria-label="Filter research">
          {filters.map(([k, label]) => <button title={k} key={k} type="button" aria-pressed={s.filter === k} onClick={() => set({ filter: k })}>{label}</button>)}
        </div>
        <ul className="rl-list" ref={listRef} onKeyDown={keys}>
          {shown.map(r => <li key={r.id}>
            <button type="button" className="rl-row" aria-current={r.id === s.sel ? 'true' : undefined} onClick={() => { pick(r.id); setSolo(true) }}>
              {unseen(s, r) && <span className="rl-new"><span className="sr-only">New: </span></span>}
              <span className="rl-row-q">{r.question}</span>
              <span className="rl-row-meta"><Chip project={r.project} /><span>{when(r.at)}</span><span>{r.sources} sources</span></span>
            </button>
          </li>)}
          {!shown.length && <li className="rl-empty">No research here yet. Ask a chat to research something and the report lands here.</li>}
        </ul>
      </div>
      <div className="rl-main">{sel ? <Report r={sel} onChat={onChat} onBack={() => setSolo(false)} /> : <p className="rl-empty">Pick a report.</p>}</div>
    </div>
  )
}

/** The Research page, in the left rail (Coder and Simple views). */
export function ResearchPage({ onChat }: { onChat?: (sessionId: string) => void }) {
  return <div className="rl-page"><ResearchLibrary onChat={onChat} /></div>
}
