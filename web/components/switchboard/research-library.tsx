'use client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HubState } from '@/lib/hub-types'
import type { Page } from '@/lib/route'
import type { HubCommand } from '@/lib/vscode-bridge'
import { Chip, FolderActions, Ico, NewFolder, Note, OrganizeBar, Report, Row, useArrows, useDrop } from './research-parts'
import { ALL, announced, baseName, filtered, folderOf, keyOf, names, pick, projectsOf, set, setSender, st, UNFILED, unseen, useLib, type St } from './research-state'
import './research-library.css'
import './research-parts.css'

export type { ResearchItem } from './research-state'

// Reports newer than this page load toast; older unseen ones only wait in the list.
const LOADED = Date.now()
const isAdded = (r: NonNullable<HubState['research']>[number]) => !!r.added && r.added.at > r.at

export const useResearchUnseen = () => { const s = useLib(); return s.items.filter(r => unseen(s, r)).length }

/** Feeds the store and shows the toast for a new report, or for one that Ask more added to. Mount once in the shell. */
export function ResearchSignal({ items, folders, send, demo, go, page }: { items: HubState['research']; folders: HubState['researchFolders']; send?: (c: HubCommand) => void; demo?: boolean; go: (p: Page) => void; page: Page }) {
  const s = useLib()
  setSender(send)
  useEffect(() => {
    const list = items ?? []
    const fresh = list.find(r => !r.seen && !announced.has(keyOf(r)) && (demo || Math.max(r.at, r.added?.at ?? 0) > LOADED))
    if (fresh) announced.add(keyOf(fresh))
    set({ items: list, folders, sel: st.sel && list.some(r => r.id === st.sel) ? st.sel : st.items.length ? undefined : list[0]?.id, ready: true, toast: fresh ? fresh.id : st.toast })
  }, [items, folders, demo])
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
      {r && page !== 'research' && <div className="rl-toast" key={keyOf(r)}>
        <span className="rl-toast-mark" aria-hidden><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5 6.5 12 13 4.5" /></svg></span>
        <div className="rl-toast-text">
          <strong>{isAdded(r) ? 'Added to your report' : 'Research finished'}</strong>
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

function RailItem({ id, name, count, fresh, on, onPick, real, s }: { id: string; name: string; count: number; fresh: number; on: boolean; onPick: () => void; real: boolean; s: St }) {
  const [drop, over] = useDrop(real ? name : undefined)
  const droppable = real || id === UNFILED
  return (
    <li className="rl-rail-item" data-over={over || undefined} data-drag={s.drag && droppable ? '' : undefined} {...(droppable ? drop : {})}>
      <button type="button" className="rl-rail-btn" aria-current={on ? 'true' : undefined} onClick={onPick}>
        {real ? Ico.folder : Ico.tray}<span className="rl-rail-name" title={name}>{name}</span>
        {fresh > 0 && <span className="rl-new"><span className="sr-only">{fresh} new</span></span>}
        <span className="rl-count">{count}</span>
      </button>
      {real && <FolderActions name={name} count={count} />}
    </li>
  )
}

/** Folder rail, report list and reader, like a mail app. Narrow containers show one pane at a time. */
export function ResearchLibrary({ onChat }: { onChat?: (sessionId: string) => void }) {
  const s = useLib()
  const at = s.at
  const [step, setStep] = useState<'rail' | 'list' | 'reader'>('list')
  const [railRef, railKeys] = useArrows('.rl-rail-btn')
  const [listRef, listKeys] = useArrows('button.rl-row')
  // One pane at a time scrolls the document: a report opens at its top, and Back returns to the same place in the list.
  const listY = useRef(0), main = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    main.current?.scrollTo(0, 0)
    window.scrollTo(0, step === 'list' ? listY.current : 0)
  }, [step, s.sel])
  if (!s.ready) return null
  const flat = !s.folders
  const shown = filtered(s)
  const real = names(s)
  const inAt = (k: string) => k === ALL ? shown : k === UNFILED ? shown.filter(r => !folderOf(s, r)) : shown.filter(r => folderOf(s, r) === k)
  const view = at === UNFILED || real.includes(at) ? at : ALL
  const list = flat ? shown : inAt(view)
  const sel = s.items.find(r => r.id === s.sel)
  const title = flat || view === ALL ? 'All reports' : view === UNFILED ? 'Unfiled' : view
  const rails = [{ id: ALL, name: 'All reports', real: false }, ...real.map(n => ({ id: n, name: n, real: true })), { id: UNFILED, name: 'Unfiled', real: false }]
  const projects = projectsOf(s)
  return (
    <div className="rl" data-step={step} data-flat={flat || undefined}>
      {!flat && <nav className="rl-rail" aria-label="Folders">
        <div className="rl-rail-scroll" ref={railRef as React.RefObject<HTMLDivElement>} onKeyDown={railKeys}>
          <ul>
            {rails.map(x => <RailItem key={x.id} id={x.id} name={x.name} real={x.real} s={s} count={inAt(x.id).length} fresh={inAt(x.id).filter(r => unseen(s, r)).length} on={view === x.id} onPick={() => { set({ at: x.id }); setStep('list') }} />)}
          </ul>
          {!real.length && <p className="rl-rail-empty">No folders yet. Make one, or let Smart organize sort your reports.</p>}
        </div>
        <div className="rl-rail-foot">
          <NewFolder className="rl-newf" />
          <OrganizeBar />
        </div>
      </nav>}
      <div className="rl-pane" ref={listRef as React.RefObject<HTMLDivElement>} onKeyDown={listKeys}>
        {!flat && <button type="button" className="rl-back" onClick={() => setStep('rail')}>{Ico.back}Folders</button>}
        <div className="rl-pane-head">
          <h2 title={title}>{title}</h2><span>{list.length}</span>
          <label className="rl-proj"><span className="sr-only">Project</span>
            <select value={s.filter} onChange={e => set({ filter: e.target.value })}>
              <option value="all">All projects</option>
              {projects.map(p => <option key={p} value={p}>{baseName(p)}</option>)}
              <option value="general">General</option>
            </select>
          </label>
        </div>
        <Note s={s} />
        <ul className="rl-list">{list.map(r => <Row key={r.id} r={r} s={s} showFolder={!flat && view === ALL} onPick={() => { listY.current = window.scrollY; pick(r.id); setStep('reader') }} />)}</ul>
        {!list.length && <p className="rl-empty">{shown.length ? 'Nothing in this folder yet. Drag a report onto it or use Move.' : 'No research here yet. Ask a chat to research something and the report lands here.'}</p>}
      </div>
      <div className="rl-main" ref={main}>
        {sel ? <Report key={sel.id} r={sel} onChat={onChat} onBack={() => setStep('list')} backLabel={title} siblings={list.map(r => r.id)} /> : <p className="rl-empty">Pick a report.</p>}
      </div>
    </div>
  )
}

/** The Research page, in the left rail (Coder and Simple views). */
export function ResearchPage({ onChat }: { onChat?: (sessionId: string) => void }) {
  return <div className="rl-page"><ResearchLibrary onChat={onChat} /></div>
}
