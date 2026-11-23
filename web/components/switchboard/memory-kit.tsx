'use client'

/** Bits the memory map and notebook share: loading, the dialog shell, notes, homes, health flags, body text with [[links]]. */
import { useDialog } from '@/hooks/use-dialog'
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { GROUPS, demoGraph, groupOf, loadGraph, projectOf, relations, type GraphNode, type Group, type MemoryGraph } from '@/lib/memory-graph'
import './memory-kit.css'

// Group colours as hub tokens, so light and dark both read.
export const TONE: Record<Group, string> = {
  user: 'var(--hub-violet)', feedback: 'var(--hub-green)', 'project-memory': 'var(--hub-blue)', reference: 'var(--hub-teal)', wiki: 'var(--hub-w-lime)',
  raw: 'var(--hub-ash)', project: 'var(--hub-ink)', chat: 'var(--hub-w-amber)', todo: 'var(--hub-yellow)', rule: 'var(--hub-w-rose)',
}

export type ViewProps = { isDemo: boolean; onClose: () => void }
export type Flag = { text: string; bad: boolean }

const NOTE = new Set<GraphNode['kind']>(['memory', 'wiki', 'raw', 'rule'])
export const isNote = (n: GraphNode) => NOTE.has(n.kind)
export const kindLabel = (n: GraphNode) => GROUPS.find(g => g.id === groupOf(n))!.label
export const toneOf = (n: GraphNode) => TONE[groupOf(n)]
export const shortLabel = (n: GraphNode) => (n.kind === 'rule' ? n.label.replace(/^.*\/([^/]+\/CLAUDE\.md)$/, '$1') : n.label)

export function useGraph(isDemo: boolean) {
  const [graph, setGraph] = useState<MemoryGraph>()
  const [problem, setProblem] = useState<string>()
  useEffect(() => {
    let stop = false
    if (isDemo) { setGraph(demoGraph(new URLSearchParams(location.search).has('big'))); return }
    loadGraph().then(g => { if (stop) return; if (typeof g === 'string') setProblem(g); else setGraph(g) }, (e: unknown) => { if (!stop) setProblem(String((e as Error)?.message ?? e)) })
    return () => { stop = true }
  }, [isDemo])
  return { graph, problem }
}

/** Where a note lives: its one project, the vault, or Shared when several projects or none claim it. */
export function homes(g: MemoryGraph) {
  const proj = projectOf(g)
  const home = (n: GraphNode) => proj.get(n.id) ?? (n.kind === 'wiki' || n.kind === 'raw' ? 'Vault wiki' : 'Shared')
  const order = [...g.nodes.filter(n => n.kind === 'project').map(n => n.label), 'Vault wiki', 'Shared']
  return { home, order }
}

/** Each note's health problems as short badges; bad ones are red. */
export function flagsOf(g: MemoryGraph): Map<string, Flag[]> {
  const h = g.health, out = new Map<string, Flag[]>()
  const add = (id: string, text: string, bad = false) => out.set(id, [...(out.get(id) ?? []), { text, bad }])
  h.contradictions.forEach(([a, b]) => { add(a, 'Contradiction', true); add(b, 'Contradiction', true) })
  h.dangling.forEach(id => add(id, 'Broken link', true))
  h.loops.flat().forEach(id => add(id, 'Supersede loop', true))
  h.invalid.forEach(id => add(id, 'Invalid'))
  h.orphans.forEach(id => add(id, 'Unlinked'))
  h.stale.forEach(id => add(id, 'Stale'))
  h.superseded.forEach(id => add(id, 'Superseded'))
  const dup = new Set(h.duplicates)
  g.nodes.filter(n => dup.has(n.label.toLowerCase()) || n.aliases?.some(a => dup.has(a.toLowerCase()))).forEach(n => add(n.id, 'Shared name'))
  return out
}

/** Notes matching q in name, alias or description; superseded last. */
export const matches = (n: GraphNode, q: string) => {
  const s = q.trim().toLowerCase()
  return !s || n.label.toLowerCase().includes(s) || !!n.aliases?.some(a => a.toLowerCase().includes(s)) || !!n.description?.toLowerCase().includes(s)
}
export const bySup = (a: GraphNode, b: GraphNode) => Number(!!a.superseded) - Number(!!b.superseded) || a.label.localeCompare(b.label)

export function Flags({ list }: { list?: Flag[] }) {
  if (!list?.length) return null
  return <span className="mk-flags">{list.map(f => <span key={f.text} className="mk-flag" data-bad={f.bad ? '' : undefined}>{f.text}</span>)}</span>
}

export const Dot = ({ n }: { n: GraphNode }) => <i className="mk-dot" style={{ background: toneOf(n) }} aria-hidden />

/** Body text with light Markdown (headings, lists, fences, **bold**, `code`) and each [[name]] as a chip that opens the note, or a struck chip when nothing has that name. */
export function NoteText({ g, text, onOpen }: { g: MemoryGraph; text: string; onOpen: (id: string) => void }) {
  const find = (name: string) => { const s = name.toLowerCase(); return g.nodes.find(n => n.label.toLowerCase() === s || n.aliases?.some(a => a.toLowerCase() === s)) }
  const link = (name: string) => {
    const hit = find(name)
    return hit
      ? <button type="button" className="mk-wl" onClick={() => onOpen(hit.id)}><Dot n={hit} />{name}</button>
      : <span className="mk-wl" data-broken="" title="No note has this name">{name}</span>
  }
  const inline = (s: string): ReactNode[] => {
    const parts = s.split(/(\[\[[^\]]+\]\]|\*\*[^*\n]+\*\*|`[^`\n]+`)/)
    return parts.map((p, i) => {
      let m = p.match(/^\[\[([^\]]+)\]\]$/)
      if (m) {
        // the comma or full stop after a chip stays on its line
        const tail = parts[i + 1]?.match(/^[,.;:!?)]+/)?.[0] ?? ''
        if (tail) parts[i + 1] = parts[i + 1].slice(tail.length)
        return <span key={i} className="mk-nw">{link(m[1])}{tail}</span>
      }
      if ((m = p.match(/^\*\*(.+)\*\*$/))) return <strong key={i}>{inline(m[1])}</strong>
      if ((m = p.match(/^`(.+)`$/))) return <code key={i}>{m[1]}</code>
      return p
    })
  }
  const blocks: ReactNode[] = []
  let para: string[] = [], list: string[] = [], ordered = false, fence: string[] | null = null
  const flush = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join('\n'))}</p>)
    if (list.length) { const L = ordered ? 'ol' : 'ul'; blocks.push(<L key={blocks.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</L>) }
    para = []; list = []
  }
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      if (fence) { blocks.push(<pre key={blocks.length}>{fence.join('\n')}</pre>); fence = null } else { flush(); fence = [] }
      continue
    }
    if (fence) { fence.push(line); continue }
    const head = line.match(/^#{1,6}\s+(.*)$/)
    const item = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/)
    if (!line.trim()) flush()
    else if (head) { flush(); blocks.push(<p key={blocks.length} className="mk-h">{inline(head[1])}</p>) }
    else if (item) {
      const num = /\d/.test(item[1])
      if (para.length || (list.length && num !== ordered)) flush()
      ordered = num; list.push(item[2])
    } else if (list.length && /^\s/.test(line)) list[list.length - 1] += ' ' + line.trim()
    else { if (list.length) flush(); para.push(line) }
  }
  if (fence) blocks.push(<pre key={blocks.length}>{fence.join('\n')}</pre>)
  flush()
  return <div className="mk-text">{blocks}</div>
}

export function Search({ value, onChange, label, inputRef, onEnter }: { value: string; onChange: (v: string) => void; label: string; inputRef?: RefObject<HTMLInputElement | null>; onEnter?: () => void }) {
  return (
    <div className="mk-find">
      <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="6" cy="6" r="4.25" /><path d="M9.25 9.25L12.5 12.5" /></svg>
      <input ref={inputRef} type="search" value={value} placeholder={label} aria-label={label} onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape' && value) { e.preventDefault(); e.stopPropagation(); onChange('') }
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) onEnter?.()
        }} />
    </div>
  )
}

/** The modal the map bar portals into; Esc closes unless onEsc keeps it. "/" goes to the search. */
export function Shell({ className, onClose, onEsc, findRef, children }: { className: string; onClose: () => void; onEsc?: () => boolean; findRef?: RefObject<HTMLInputElement | null>; children: ReactNode }) {
  const dlg = useRef<HTMLDialogElement>(null)
  useDialog(dlg, d => d.focus())
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || (e.target as Element).closest?.('input, textarea')) return
      findRef?.current?.focus(); e.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [findRef])
  return (
    <dialog ref={dlg} tabIndex={-1} className={`hub mem mk ${className}`} aria-label="Memory"
      onCancel={e => { e.preventDefault(); if (!onEsc?.()) onClose() }}>
      {children}
    </dialog>
  )
}

export function Loading({ problem, empty }: { problem?: string; empty?: boolean }) {
  return <div className="mem-state" role="status">{empty
    ? <><h3>No memories yet</h3><p>Claude writes them under ~/.claude/projects as chats go. They show up here on their own.</p></>
    : problem ? <><h3>Could not load the graph</h3><p>{problem}</p></> : <><span className="hub-spin" aria-hidden /><p>Reading memory files</p></>}</div>
}

/** One note read in full: kind and place, warnings, body with [[links]], then its links as chips. Styled by memory-notebook.css. */
export function NoteReader({ g, node, home, flags, onOpen, innerRef, children }: {
  g: MemoryGraph; node: GraphNode; home: (n: GraphNode) => string; flags: Map<string, Flag[]>; onOpen: (id: string) => void; innerRef?: RefObject<HTMLElement | null>; children?: ReactNode
}) {
  const rel = useMemo(() => relations(g, node.id), [g, node])
  const own = useRef<HTMLElement>(null)
  const ref = innerRef ?? own
  // A new note starts at its title: the notebook scrolls the article, the map its panel.
  useEffect(() => { const el = ref.current; if (el) { el.scrollTop = 0; if (el.parentElement) el.parentElement.scrollTop = 0 } }, [node.id, ref])
  const typed = (t: string) => rel.typed.find(x => x.title === t)?.list
  const chips = (title: string, list?: GraphNode[]) => list?.length ? (
    <section className="nb-rel">
      <h4 className="mk-label">{title}<span>{list.length}</span></h4>
      <div>{list.map(n => <button key={n.id} type="button" className="mk-wl" data-sup={n.superseded ? '' : undefined} onClick={() => onOpen(n.id)}><Dot n={n} />{shortLabel(n)}</button>)}</div>
    </section>
  ) : null
  const plain = new Set(['Superseded by', 'Contradicts', 'Contradicted by'])
  return (
    <article ref={ref} tabIndex={-1} className="nb-read" aria-label={node.label}>
      {children}
      <p className="nb-kicker"><Dot n={node} />{node.kind === 'project' ? 'Project' : `${kindLabel(node)} in ${home(node)}`}</p>
      <h1>{shortLabel(node)}</h1>
      {node.description && <p className="nb-lead">{node.description}</p>}
      {typed('Superseded by')?.map(n => <p key={n.id} className="nb-note" data-tone="warn">Replaced by <button type="button" className="mk-wl" onClick={() => onOpen(n.id)}><Dot n={n} />{n.label}</button></p>)}
      {[...(typed('Contradicts') ?? []), ...(typed('Contradicted by') ?? [])].map(n => <p key={n.id} className="nb-note" data-tone="bad">Disagrees with <button type="button" className="mk-wl" onClick={() => onOpen(n.id)}><Dot n={n} />{n.label}</button></p>)}
      {node.missing?.length ? <p className="nb-note" data-tone="bad">Links to {[...new Set(node.missing)].map(m => <span key={m} className="mk-wl" data-broken="">{m}</span>)}, which no note is called.</p> : null}
      {flags.get(node.id)?.some(f => f.text === 'Unlinked') && <p className="nb-note" data-tone="warn">Nothing links here and it links nowhere.</p>}
      {node.text && node.text !== node.label && <div className="nb-body"><NoteText g={g} text={node.text} onOpen={onOpen} /></div>}
      <div className="nb-rels">
        {chips('Links to', rel.to)}
        {chips('Backlinks', rel.from)}
        {rel.typed.filter(t => !plain.has(t.title)).map(t => <div key={t.title}>{chips(t.title, t.list)}</div>)}
        {chips('In', rel.up)}
        {chips('Holds', rel.down)}
      </div>
    </article>
  )
}
