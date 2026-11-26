'use client'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { answerBlocks, citations, inline, siteOf } from '@/lib/research'
import { ADDED } from '../../../extension/src/hub/research-question'
import { withoutActions } from '@/lib/workbench'
import { ReportActions } from './workbench'
import {
  addedLine, addFolder, ask, baseName, command, deleteFolder, folderOf, hueOf, loadBody, move, names, nameTaken, organize, pick, renameFolder, set, st, unseen, when,
  type ResearchItem, type St,
} from './research-state'

const P = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
export const Ico = {
  folder: <svg {...P}><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.8l1.4 1.6h4.8A1.5 1.5 0 0 1 14 6.1v5.4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" /></svg>,
  back: <svg {...P}><path d="M10 3 5 8l5 5" /></svg>,
  dots: <svg {...P}><circle cx="3.5" cy="8" r=".8" fill="currentColor" /><circle cx="8" cy="8" r=".8" fill="currentColor" /><circle cx="12.5" cy="8" r=".8" fill="currentColor" /></svg>,
  plus: <svg {...P}><path d="M8 3v10M3 8h10" /></svg>,
  spark: <svg {...P}><path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.6 1.6M10.4 10.4 12 12M12 4l-1.6 1.6M5.6 10.4 4 12" /></svg>,
  move: <svg {...P}><path d="M2 8h9M8 4.5 11.5 8 8 11.5M14 3v10" /></svg>,
  check: <svg {...P}><path d="M3 8.5 6.5 12 13 4.5" /></svg>,
  send: <svg {...P}><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" /></svg>,
  tray: <svg {...P}><path d="M2.5 9.5 4 3.5h8l1.5 6M2.5 9.5v3h11v-3h-3.2a2.3 2.3 0 0 1-4.6 0z" /></svg>,
}

export function Chip({ project }: { project?: string }) {
  return <span className="rl-chip" data-general={project ? undefined : ''} style={project ? { ['--h' as string]: hueOf(project) } : undefined}>{project ? baseName(project) : 'General'}</span>
}

export function Conf({ level }: { level?: 'high' | 'medium' | 'low' }) {
  if (!level) return null
  const n = level === 'high' ? 3 : level === 'medium' ? 2 : 1
  return <span className="rl-conf" data-level={level}><span className="rl-conf-bars" aria-hidden>{[1, 2, 3].map(i => <i key={i} data-on={i <= n || undefined} />)}</span>{level[0].toUpperCase() + level.slice(1)} confidence</span>
}
const confOf = (body: string) => body.match(/confidence:?\**\s*(high|medium|low)/i)?.[1].toLowerCase() as 'high' | 'medium' | 'low' | undefined

/** A button that opens a small panel next to it: Escape and outside clicks close it, arrows move between items. On phones the panel is a bottom sheet.
 * step names the screen inside it, so a new one is placed and focused again; onClose resets it. */
export function Pop({ label, trigger, className, align = 'end', step, onClose, children }: { label: string; trigger: ReactNode; className?: string; align?: 'start' | 'end'; step?: string; onClose?: () => void; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null), btn = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null)
  const close = (back = true) => { setOpen(false); onClose?.(); if (back) btn.current?.focus({ preventScroll: true }) }
  useLayoutEffect(() => {
    const p = panel.current, b = btn.current
    if (!open || !p || !b) return
    const r = b.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, align === 'end' ? r.right - w : r.left))
    p.style.left = `${left}px`
    p.style.top = `${r.bottom + 6 + h > window.innerHeight - 8 ? Math.max(8, r.top - 6 - h) : r.bottom + 6}px`
    requestAnimationFrame(() => p.querySelector<HTMLElement>('input, textarea, [role^="menuitem"], button')?.focus({ preventScroll: true }))
  }, [open, align, step])
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) close(false) }
    const away = (e: Event) => { if (!panel.current?.contains(e.target as Node)) close(false) }
    // A phone keyboard opening resizes the window; the sheet stays.
    const sized = () => { if (!panel.current?.contains(document.activeElement)) close(false) }
    document.addEventListener('pointerdown', down)
    window.addEventListener('resize', sized)
    document.addEventListener('scroll', away, true)
    return () => { document.removeEventListener('pointerdown', down); window.removeEventListener('resize', sized); document.removeEventListener('scroll', away, true) }
  }, [open])
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return }
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])]
    if (!items.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const i = items.indexOf(document.activeElement as HTMLElement)
    items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus()
  }
  return (
    <span className={`rl-pop ${className ?? ''}`} ref={wrap} onKeyDown={keys} onBlur={e => { if (open && !wrap.current?.contains(e.relatedTarget as Node | null) && e.relatedTarget) close(false) }}>
      <button type="button" ref={btn} className="rl-pop-btn" aria-label={label} title={label} aria-haspopup="true" aria-expanded={open} onClick={e => { e.stopPropagation(); if (open) close(); else setOpen(true) }}>{trigger}</button>
      {open && <div className="rl-pop-panel" ref={panel} role="group" aria-label={label}>{children(() => close())}</div>}
    </span>
  )
}

function NameForm({ initial, action, onDone, hint }: { initial: string; action: string; onDone: (name: string) => void; hint?: string }) {
  const [v, setV] = useState(initial)
  const taken = nameTaken(v, initial)
  const go = (e: FormEvent) => { e.preventDefault(); if (v.trim() && !taken) onDone(v.trim()) }
  return (
    <form className="rl-nameform" onSubmit={go}>
      <label>Folder name<input value={v} onChange={e => setV(e.target.value)} maxLength={40} autoComplete="off" spellCheck={false} aria-invalid={taken || undefined} /></label>
      {taken && <small role="alert">That name is taken.</small>}
      {hint && !taken && <small>{hint}</small>}
      <button type="submit" className="rl-btn is-primary" disabled={!v.trim() || taken}>{action}</button>
    </form>
  )
}

/** Move a report: a menu that works with keyboard and touch, beside drag and drop. */
export function MoveMenu({ r, label = 'Move to folder', text }: { r: ResearchItem; label?: string; text?: string }) {
  const s = st
  const [mode, setMode] = useState<'list' | 'new'>('list')
  if (!s.folders) return null
  const cur = folderOf(s, r)
  return (
    <Pop label={label} className="rl-move" step={mode} onClose={() => setMode('list')} trigger={<>{Ico.move}{text && <span>{text}</span>}</>}>
      {close => mode === 'new'
        ? <NameForm initial="" action="Make and move" onDone={n => { move([r.id], n); close() }} />
        : <div className="rl-menu" role="menu" aria-label="Move to">
          {names(s).map(n => <button key={n} type="button" role="menuitemradio" aria-checked={cur === n} onClick={() => { if (cur !== n) move([r.id], n); close() }}>{Ico.folder}<span>{n}</span>{cur === n && Ico.check}</button>)}
          <button type="button" role="menuitemradio" aria-checked={!cur} onClick={() => { if (cur) move([r.id], undefined); close() }}>{Ico.tray}<span>Unfiled</span>{!cur && Ico.check}</button>
          <hr />
          <button type="button" role="menuitem" onClick={() => setMode('new')}>{Ico.plus}<span>New folder</span></button>
        </div>}
    </Pop>
  )
}

export function NewFolder({ text = 'New folder', className }: { text?: string; className?: string }) {
  return <Pop label="New folder" align="start" className={className} trigger={<>{Ico.plus}<span>{text}</span></>}>{close => <NameForm initial="" action="Make folder" onDone={n => { addFolder(n); close() }} />}</Pop>
}

/** Rename and delete for one folder. */
export function FolderActions({ name, count }: { name: string; count: number }) {
  const [mode, setMode] = useState<'menu' | 'rename' | 'delete'>('menu')
  return (
    <Pop label={`Folder ${name}`} className="rl-fa" step={mode} onClose={() => setMode('menu')} trigger={Ico.dots}>
      {close => mode === 'rename'
        ? <NameForm initial={name} action="Rename" onDone={n => { renameFolder(name, n); close() }} />
        : mode === 'delete'
          ? <div className="rl-confirm"><p>Delete {name}? {count ? `Its ${count} ${count === 1 ? 'report goes' : 'reports go'} back to Unfiled. No report is deleted.` : 'It has no reports.'}</p><div><button type="button" className="rl-btn is-danger" onClick={() => { deleteFolder(name); close() }}>Delete folder</button><button type="button" className="rl-btn" onClick={() => setMode('menu')}>Cancel</button></div></div>
          : <div className="rl-menu" role="menu"><button type="button" role="menuitem" onClick={() => setMode('rename')}>Rename</button><button type="button" role="menuitem" className="is-danger" onClick={() => setMode('delete')}>Delete folder</button></div>}
    </Pop>
  )
}

/** Smart organize, the auto switch, the result with Undo, and any problem. */
export function OrganizeBar() {
  const f = st.folders
  if (!f) return null
  return (
    <div className="rl-org">
      <div className="rl-org-row">
        <button type="button" className="rl-btn rl-org-go" aria-busy={f.busy || undefined} disabled={f.busy} onClick={() => organize('run')}>
          <span className={f.busy ? 'rl-spin' : undefined} aria-hidden>{Ico.spark}</span>{f.busy ? 'Sorting ...' : 'Smart organize'}
        </button>
        <Pop label="More ways to organize" className="rl-org-more" trigger={Ico.dots}>
          {close => <div className="rl-menu" role="menu"><button type="button" role="menuitem" onClick={() => { organize('all'); close() }}>Re-sort everything</button></div>}
        </Pop>
      </div>
      {f.undo && !f.busy && Date.now() - f.undo.at < UNDO_MS && <p className="rl-org-done" role="status"><span>Filed {f.undo.moved} {f.undo.moved === 1 ? 'report' : 'reports'}</span><button type="button" className="rl-link" onClick={() => organize('undo')}>Undo</button></p>}
      {f.problem && <p className="rl-org-problem" role="alert">{f.problem}</p>}
      <label className="rl-switch">
        <input type="checkbox" role="switch" checked={f.auto} onChange={e => organize(e.target.checked ? 'auto-on' : 'auto-off')} />
        <span className="rl-switch-track" aria-hidden><i /></span>
        <span>File new reports by itself</span>
      </label>
    </div>
  )
}

export function Note({ s }: { s: St }) {
  return <p className="rl-note" role="status" aria-live="polite">{s.note}</p>
}

/** Drop a report on a folder. Touch and keyboard use the Move menu. */
export function useDrop(folder: string | undefined) {
  const [over, setOver] = useState(false)
  const props = {
    onDragOver: (e: DragEvent) => { if (!st.drag) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(true) },
    onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false) },
    onDrop: (e: DragEvent) => {
      e.preventDefault(); setOver(false)
      const r = st.items.find(x => x.id === st.drag)
      set({ drag: undefined })
      if (r && folderOf(st, r) !== folder) move([r.id], folder)
    },
  }
  return [props, over] as const
}

/** Up and down move between the buttons matching sel inside one pane. */
export const useArrows = (sel: string) => {
  const ref = useRef<HTMLElement>(null)
  return [ref, (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>(sel) ?? [])]
    const i = btns.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    const to = btns[Math.max(0, Math.min(btns.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (to) { e.preventDefault(); to.focus() }
  }] as const
}

export function Row({ r, s, onPick, showFolder }: { r: ResearchItem; s: St; onPick: () => void; showFolder?: boolean }) {
  const f = folderOf(s, r)
  return (
    <li className="rl-li-row" draggable onDragStart={e => { e.dataTransfer.setData('text/plain', r.id); e.dataTransfer.effectAllowed = 'move'; set({ drag: r.id }) }} onDragEnd={() => set({ drag: undefined })} data-dragging={s.drag === r.id || undefined}>
      <button type="button" className="rl-row" aria-current={r.id === s.sel ? 'true' : undefined} onClick={onPick}>
        {unseen(s, r) && <span className="rl-new"><span className="sr-only">New: </span></span>}
        <span className="rl-row-q">{r.question}</span>
        <span className="rl-row-meta">
          <Chip project={r.project} /><span>{when(r.at)}</span><span>{r.sources} sources</span>
          {showFolder && f && <span className="rl-row-folder">{f}</span>}
          {!!r.asks?.length && <span className="rl-row-live"><i className="rl-spin" aria-hidden />Researching</span>}
          {!r.asks?.length && r.added && <span className="rl-row-added">+{r.added.n} added</span>}
        </span>
      </button>
      <MoveMenu r={r} label={`Move ${r.question}`} />
    </li>
  )
}

export function RunningAsks({ r, onChat }: { r: ResearchItem; onChat?: (sessionId: string) => void }) {
  if (!r.asks?.length) return null
  return (
    <ul className="rl-asks" aria-label="Follow ups in progress">
      {r.asks.map((a, i) => <li key={`${a.at}-${i}`}>
        <i className="rl-spin" aria-hidden />
        <span className="rl-ask-q">{a.question}</span>
        <span className="rl-ask-state">Researching ...</span>
        {a.sessionId && onChat && <button type="button" className="rl-btn" onClick={() => onChat(a.sessionId!)}>Open chat</button>}
      </li>)}
    </ul>
  )
}

// Unsent questions, kept while other reports are read.
const drafts = new Map<string, string>()
// The hub refuses a longer one.
const ASK_MAX = 2000
const CHIPS = ['What are the risks?', 'Compare the costs', 'Add what changed lately', 'Find counterexamples']

/** Ask more: a question that a research chat digs into, then adds to this same report. */
export function AskBar({ r, onChat }: { r: ResearchItem; onChat?: (sessionId: string) => void }) {
  const [text, write] = useState(drafts.get(r.id) ?? '')
  const setText = (t: string) => { drafts.set(r.id, t); write(t) }
  const area = useRef<HTMLTextAreaElement>(null)
  const send = (e?: FormEvent) => { e?.preventDefault(); const t = text.trim(); if (!t) return; ask(r.id, t); setText('') }
  return (
    <form className="rl-ask" onSubmit={send} aria-label="Ask more about this report">
      <RunningAsks r={r} onChat={onChat} />
      <div className="rl-chips" role="group" aria-label="Quick follow ups">{CHIPS.map(c => <button key={c} type="button" onClick={() => { setText(c); area.current?.focus() }}>{c}</button>)}</div>
      <div className="rl-ask-box">
        <label className="sr-only" htmlFor={`rl-ask-${r.id}`}>Ask more</label>
        <textarea id={`rl-ask-${r.id}`} ref={area} rows={2} maxLength={ASK_MAX} value={text} placeholder="Ask more. The answer is added to this report." onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }} />
        <button type="submit" className="rl-btn is-primary rl-ask-send" disabled={!text.trim()}>{Ico.send}<span>Ask more</span></button>
      </div>
      {text.length > ASK_MAX - 200 && <small className="rl-ask-left" role="status">{text.length} of {ASK_MAX} characters</small>}
    </form>
  )
}

// Undo is offered this long after Smart organize.
const UNDO_MS = 10 * 60_000

type Section = { title: string; text: string }
const isSources = (title: string) => /^Sources(?::|\s+\(\d+\))?$/i.test(title)
// "- [1] Title https://..." or "- [1] [Title](https://...)"
const sourceRow = (l: string) => {
  const n = l.match(/^\s*(?:[-*]\s*)?\[(\d+)\]\s*(.*)$/), url = n?.[2].match(/https?:\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"]/)?.[0]
  return n && url ? [{ n: Number(n[1]), title: n[2].slice(0, n[2].indexOf(url)).replace(/^\[|\]\($/g, '').trim(), url }] : []
}
const split = (text: string): Section[] => {
  const out: Section[] = [{ title: '', text: '' }]
  for (const line of text.split('\n')) {
    const m = line.match(/^##\s+(.*)$/) ?? line.match(/^#+\s+(Sources)(?::|\s+\(\d+\))?\s*$/i)
    if (m) out.push({ title: m[1].trim(), text: '' })
    else out[out.length - 1].text += `${line}\n`
  }
  return out
}

type Added = { id: string; date: string; q: string; text: string }

/** One report. siblings are the ids in the list it was opened from, so Delete can move to the next one. */
export function Report({ r, onBack, onChat, backLabel, siblings }: { r: ResearchItem; onBack?: () => void; onChat?: (sessionId: string) => void; backLabel: string; siblings: string[] }) {
  const [body, setBody] = useState<string>()
  useEffect(() => {
    let live = true
    loadBody(r.id).then(t => { if (live) setBody(t) })
    return () => { live = false }
  }, [r.id, r.added?.at])
  const text = body ?? ''
  const { main, added, srcText } = useMemo(() => {
    const secs = split(text)
    const main = secs.filter(x => !isSources(x.title) && !ADDED.test(x.title)).map(x => (x.title ? `## ${x.title}\n` : '') + x.text).join('\n')
    const added: Added[] = secs.filter(x => ADDED.test(x.title)).map((x, i) => { const m = x.title.match(ADDED)!; return { id: `rl-add-${r.id}-${i}`, date: new Date(`${m[1]}T12:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), q: m[2], text: x.text } })
    const srcText = secs.filter(x => isSources(x.title)).map(x => `## Sources\n${x.text}`).join('\n')
    return { main, added, srcText }
  }, [text, r.id])
  const blocks = useMemo(() => answerBlocks(withoutActions(main).replace(/^\**confidence:?\**.*$/gim, '')), [main])
  const cites = useMemo(() => citations(text), [text])
  const srcs = useMemo(() => srcText.split('\n').flatMap(sourceRow), [srcText])
  const line = (s: string) => inline(s).map((p, i) =>
    p.t === 'b' ? <strong key={i}>{p.s}</strong>
      : p.t === 'code' ? <code key={i}>{p.s}</code>
        : p.t === 'link' ? <a key={i} href={p.href} target="_blank" rel="noreferrer">{p.s}</a>
          : p.t === 'cite' ? (cites[p.n] ? <a key={i} className="rl-cite" href={cites[p.n]} target="_blank" rel="noreferrer" aria-label={`Source ${p.n}`}>{p.n}</a> : <sup key={i}>{p.n}</sup>)
            : <span key={i}>{p.s}</span>)
  const render = (bs: ReturnType<typeof answerBlocks>) => bs.filter(b => !(b.type === 'h' && /^answer$/i.test(b.text))).map((b, i) => b.type === 'h'
    ? <h3 key={i}>{line(b.text)}</h3>
    : b.type === 'li' ? <p key={i} className="rl-li" data-n={b.n || undefined}><span aria-hidden>{b.n ? `${b.n}` : ''}</span><span>{line(b.text)}</span></p>
      : <p key={i}>{line(b.text)}</p>)
  const remove = () => {
    command({ type: 'hub-research-delete', id: r.id })
    const i = siblings.indexOf(r.id)
    const next = siblings[i + 1] ?? siblings[i - 1]
    set({ items: st.items.filter(x => x.id !== r.id), sel: undefined, toast: st.toast === r.id ? undefined : st.toast })
    if (next) pick(next)
    else onBack?.()
  }
  const jump = (id: string) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  }
  return (
    <article className="rl-report" aria-labelledby={`rl-q-${r.id}`}>
      {onBack && <button type="button" className="rl-back" onClick={onBack}>{Ico.back}{backLabel}</button>}
      <AskBar r={r} onChat={onChat} />
      <Note s={st} />
      <header className="rl-report-head">
        <p className="rl-kicker"><Chip project={r.project} /><span>{when(r.at)}</span><span aria-hidden>/</span><span>{r.chat}</span>{folderOf(st, r) && <span className="rl-kicker-folder">{Ico.folder}{folderOf(st, r)}</span>}</p>
        <h2 id={`rl-q-${r.id}`}>{r.question}</h2>
        <div className="rl-stats">
          <Conf level={confOf(text)} />
          <span className="rl-stat"><b>{r.sources}</b> sources</span>
          {r.added && <span className="rl-stat rl-stat-added">{addedLine(r.added)}</span>}
          <span className="rl-stats-acts">
            <MoveMenu r={r} text="Move" label="Move this report to a folder" />
            {onChat && <button type="button" className="rl-btn" onClick={() => onChat(r.sessionId)}>Open chat</button>}
            <button type="button" className="rl-btn is-ghost" onClick={remove}>Delete</button>
          </span>
        </div>
      </header>
      <p className="rl-summary">{r.summary}</p>
      <ReportActions report={r.id} />
      {added.length > 0 && <nav className="rl-jump" aria-label="Jump to a part of this report">
        <span>Jump to</span>
        <button type="button" onClick={() => jump(`rl-q-${r.id}`)}>Original answer</button>
        {added.map(a => <button key={a.id} type="button" onClick={() => jump(a.id)}>Added {a.date}<small>{a.q}</small></button>)}
      </nav>}
      {body === undefined && <p className="rl-empty">Loading report</p>}
      <div className="rl-body">{render(blocks)}</div>
      {added.map(a => <section key={a.id} id={a.id} className="rl-added" aria-labelledby={`${a.id}-h`}>
        <p className="rl-added-tag"><span>Added</span>{a.date}</p>
        <h3 id={`${a.id}-h`}>{a.q}</h3>
        <div className="rl-body">{render(answerBlocks(withoutActions(a.text)))}</div>
      </section>)}
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
