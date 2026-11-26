'use client'

/** Memory option n1: a notebook. Places on the left, the notes in one list, the open note read in full with its links as chips. */
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Dot, Flags, Loading, NoteReader, Search, Shell, bySup, flagsOf, homes, isNote, kindLabel, matches, shortLabel, useGraph, type ViewProps } from './memory-kit'
import './memory-notebook.css'

const ALL = 'All notes', ISSUES = 'Needs a look'

// top: the Map | Notebook switch when a map trial hosts the notebook.
export function MemoryNotebook({ isDemo, onClose, top }: ViewProps & { top?: ReactNode }) {
  const { graph, problem } = useGraph(isDemo)
  const [place, setPlace] = useState(ALL)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string>()
  // Phone only: the reader covers the list until Back.
  const [reading, setReading] = useState(false)
  const findRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const readerRef = useRef<HTMLElement>(null)

  const d = useMemo(() => {
    if (!graph) return undefined
    const { home, order } = homes(graph), flags = flagsOf(graph), notes = graph.nodes.filter(isNote)
    const places = order.map(p => ({ p, n: notes.filter(n => home(n) === p).length })).filter(x => x.n)
    return { home, flags, notes, places }
  }, [graph])
  const rows = useMemo(() => !d ? [] : d.notes
    .filter(n => place === ALL || (place === ISSUES ? d.flags.has(n.id) : d.home(n) === place))
    .filter(n => matches(n, q)).sort((a, b) => Number(a.kind === 'rule') - Number(b.kind === 'rule') || bySup(a, b)), [d, place, q])
  const pick = (id: string, focus = false) => {
    setOpen(id); setReading(true)
    if (focus) requestAnimationFrame(() => readerRef.current?.focus())
  }
  const node = graph?.nodes.find(n => n.id === (open ?? rows[0]?.id))
  // Up and down walk the list without leaving it.
  const walk = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const bs = [...(listRef.current?.querySelectorAll('button') ?? [])], i = bs.indexOf(document.activeElement as HTMLButtonElement)
    const next = bs[Math.max(0, Math.min(bs.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (next) { e.preventDefault(); next.focus(); next.click() }
  }
  return (
    <Shell className="nb" onClose={onClose} findRef={findRef} onEsc={() => { if (reading && matchMedia('(max-width: 760px)').matches) { setReading(false); return true } return false }}>
      {!graph || !d || !d.notes.length ? <Loading problem={problem} empty={!!graph} /> : (
        <div className="mnb-grid" data-reading={reading ? '' : undefined}>
          <nav className="mnb-places" aria-label="Places">
            <header><h2>Memory</h2><p>{d.notes.length} notes</p>{top}</header>
            <ul>
              {[{ p: ALL, n: d.notes.length }, ...d.places, { p: ISSUES, n: new Set([...d.flags.keys()].filter(id => d.notes.some(n => n.id === id))).size }].map(({ p, n }) => (
                <li key={p} data-issues={p === ISSUES ? '' : undefined}><button type="button" aria-pressed={place === p} onClick={() => { setPlace(p); setOpen(undefined) }}>
                  <span>{p}</span><b>{n}</b>
                </button></li>
              ))}
            </ul>
          </nav>
          <div className="mnb-list">
            <Search value={q} onChange={setQ} label="Search notes" inputRef={findRef} onEnter={() => rows[0] && pick(rows[0].id, true)} />
            <ul ref={listRef} aria-label={`${place}, ${rows.length} notes`} onKeyDown={walk}>
              {rows.map(n => (
                <li key={n.id}><button type="button" aria-current={n.id === node?.id ? 'true' : undefined} data-sup={n.superseded ? '' : undefined} onClick={() => pick(n.id)}>
                  <span className="mnb-row-h"><Dot n={n} /><b>{shortLabel(n)}</b></span>
                  {n.description && <span className="mnb-row-d">{n.description}</span>}
                  <span className="mnb-row-m"><small>{place === ALL || place === ISSUES ? d.home(n) : kindLabel(n)}</small><Flags list={d.flags.get(n.id)} /></span>
                </button></li>
              ))}
            </ul>
            {!rows.length && <p className="mnb-none">{q ? `No note has "${q.trim()}" in its name or description.` : 'Nothing here.'}</p>}
          </div>
          {node && (
            <NoteReader g={graph} node={node} home={d.home} flags={d.flags} onOpen={id => pick(id, true)} innerRef={readerRef}>
              <button type="button" className="mnb-back" onClick={() => { setReading(false); requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>('[aria-current]')?.focus()) }}>
                <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3 5 8l5 5" /></svg>{place}
              </button>
            </NoteReader>
          )}
        </div>
      )}
    </Shell>
  )
}
