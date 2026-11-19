'use client'

/**
 * Code view: the app as parts (top folders, split a level down when one dominates), the imports between them in flow order,
 * in flow order, and per part the chats, tools and memory notes behind it. Lazy-loaded by switchboard.tsx; read-only.
 * Under 600px it is a list.
 */
import { useDialog } from '@/hooks/use-dialog'
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { readStore, writeStore } from '@/lib/store'
import { BaseEdge, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type EdgeProps, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './flow-map.css'
import { KIND_NAME, colName, PART_H, PART_W, components, demoAppMap, layers, loadFlowMap, routeLinks, startProject, when, type FlowKind, type FlowMap, type FlowNode, type Part, type PartLink, type Parts } from '@/lib/flow-map'
import type { HubState } from '@/lib/hub-types'
import { limitText } from '@/lib/budget-ui'
import { chatRun, raiseLine, raisesFor, stageView } from '@/lib/stages-ui'
import { demoGraph, loadGraph, type GraphNode, type MemoryGraph } from '@/lib/memory-graph'

const NARROW = '(max-width: 600px)'
const SAVED = 'fm-project'
const FIT = { padding: { top: '56px', right: '72px', bottom: '24px', left: '32px' }, maxZoom: 1 } as const
const TOOL_KINDS: FlowKind[] = ['skill', 'plugin', 'mod', 'role']
const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

type Acts = { pick: (id?: string) => void; hover: (id?: string) => void }
const Act = createContext<Acts>({ pick: () => {}, hover: () => {} })

const meta = (p: Part) => [plural(p.files.length, 'file'), p.chats.length ? plural(p.chats.length, 'chat') : '', p.notes.length ? plural(p.notes.length, 'note') : ''].filter(Boolean).join(', ')

const Box = memo(function Box({ data }: NodeProps<Node<{ p: Part; entry: boolean }>>) {
  const { p, entry } = data
  const act = useContext(Act)
  return (
    <button type="button" className="fm-part" data-entry={entry || undefined} data-alone={p.alone || undefined} title={p.path}
      onClick={() => act.pick(p.id)} onFocus={() => act.hover(p.id)} onBlur={() => act.hover(undefined)}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Handle type="source" position={Position.Right} isConnectable={false} />
      <b>{entry && <i className="fm-entry" aria-label="Entry" />}{p.path === '.' ? p.name : p.path}</b>
      <small className="fm-about">{p.about ?? (p.path === '.' ? 'Files at the repo root' : 'No description yet')}</small>
      <small>{meta(p)}</small>
    </button>
  )
})
const Col = memo(function Col({ data }: NodeProps<Node<{ name: string }>>) { return <div className="fm-lane">{data.name}</div> })
const TYPES = { part: Box, col: Col }

/** A line along the routed points, so it goes round boxes instead of under them. */
function Routed({ data, markerEnd, style, label }: EdgeProps<Edge<{ pts: { x: number; y: number }[] }>>) {
  const pts = data?.pts ?? []
  const mid = Math.floor((pts.length - 1) / 2), a = pts[mid], b = pts[mid + 1] ?? a
  return <BaseEdge path={pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')} markerEnd={markerEnd} style={style} label={label} labelX={(a.x + b.x) / 2} labelY={(a.y + b.y) / 2} />
}
const EDGES = { routed: Routed }

function useMedia(q: string): boolean {
  const [v, setV] = useState(false)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setV(m.matches)
    on(); m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [q])
  return v
}

/** Lights one part, its links and the parts at their other ends, through a style tag so hover re-renders nothing. */
function focusCss(id: string | undefined, idx: Map<string, number>, links: PartLink[], picked?: string): string {
  const rules: string[] = []
  if (picked && idx.has(picked)) rules.push(`.fm-flow .n${idx.get(picked)} .fm-part{border-color:var(--hub-blue);background:var(--hub-elev)}`)
  if (!id || !idx.has(id)) return rules.join('')
  const i = idx.get(id)!
  const near = new Set([i])
  for (const l of links) { if (l.from === id) near.add(idx.get(l.to)!); if (l.to === id) near.add(idx.get(l.from)!) }
  rules.push(`${[...near].map(k => `.fm-flow[data-focus] .react-flow__node.n${k}`).join(',')}{opacity:1}`)
  rules.push(`.fm-flow[data-focus] .react-flow__edge:is(.s${i},.t${i}){opacity:1}`)
  rules.push(`.fm-flow[data-focus] .react-flow__edge.s${i} .react-flow__edge-path{stroke:var(--hub-blue)}`)
  rules.push(`.fm-flow[data-focus] .react-flow__edge.t${i} .react-flow__edge-path{stroke:var(--hub-green)}`)
  rules.push(`.fm-flow[data-focus] .react-flow__edge:is(.s${i},.t${i}) .react-flow__edge-textwrapper{display:inline}`)
  return rules.join('')
}

function Canvas({ parts, links, match, picked, onPick, still }: { parts: Part[]; links: PartLink[]; match?: Set<string>; picked?: string; onPick: (id?: string) => void; still: boolean }) {
  const wrap = useRef<HTMLDivElement>(null)
  const style = useRef<HTMLStyleElement>(null)
  const rf = useReactFlow()
  const idx = useMemo(() => new Map(parts.map((p, i) => [p.id, i])), [parts])
  const lay = useMemo(() => {
    const { at } = layers(parts, links)
    const xs = [...new Set(parts.map(p => p.depth))].sort((a, b) => a - b)
    const cols = xs.map((d, i) => ({ name: colName(i, parts.some(p => p.depth === d && p.alone)), x: i * (PART_W + 120) }))
    return { at, cols, paths: routeLinks(parts, links, at) }
  }, [parts, links])
  const hasIn = useMemo(() => new Set(links.map(l => l.to)), [links])

  const nodes = useMemo(() => {
    const out: Node[] = lay.cols.map((c, i) => ({ id: `col:${i}`, type: 'col', position: { x: c.x, y: -40 }, data: { name: c.name }, selectable: false, className: 'fm-lane-n' }))
    parts.forEach((p, i) => out.push({ id: p.id, type: 'part', position: lay.at.get(p.id) ?? { x: 0, y: 0 }, data: { p, entry: !p.alone && !hasIn.has(p.id) && links.length > 0 }, width: PART_W, height: PART_H, className: `n${i}${match && !match.has(p.id) ? ' fm-off' : ''}` }))
    return out
  }, [parts, lay, hasIn, links.length, match])
  const edges: Edge[] = useMemo(() => links.map(l => ({
    id: `${l.from}>${l.to}`, source: l.from, target: l.to, type: 'routed', data: { pts: lay.paths.get(`${l.from}>${l.to}`) ?? [] },
    className: `fm-edge s${idx.get(l.from)} t${idx.get(l.to)}${match && !match.has(l.from) && !match.has(l.to) ? ' fm-off' : ''}`, style: { strokeWidth: Math.min(4.5, 1.25 + Math.log2(l.n)) },
    markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10 }, label: plural(l.n, 'import'),
  })), [links, lay, idx, match])

  const hovered = useRef<string>(undefined)
  const pickedRef = useRef(picked)
  pickedRef.current = picked
  const paint = () => {
    const id = hovered.current ?? pickedRef.current
    if (style.current) style.current.textContent = focusCss(id, idx, links, pickedRef.current)
    if (id && idx.has(id)) wrap.current?.setAttribute('data-focus', ''); else wrap.current?.removeAttribute('data-focus')
  }
  useEffect(paint)
  const acts = useMemo<Acts>(() => ({ pick: onPick, hover: id => { hovered.current = id; paint() } }), [onPick, idx, links]) // eslint-disable-line react-hooks/exhaustive-deps
  // again when the details column opens or shuts, since the canvas width changes
  const open = !!picked
  useEffect(() => { const t = setTimeout(() => void rf.fitView({ ...FIT, duration: still ? 0 : 360 }), 40); return () => clearTimeout(t) }, [rf, lay, still, open])

  return (
    <Act.Provider value={acts}>
      <div ref={wrap} className="fm-flow">
        <style ref={style} />
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={TYPES} edgeTypes={EDGES} onPaneClick={() => onPick(undefined)}
          onNodeMouseEnter={(_, n) => { if (!n.id.startsWith('col:')) acts.hover(n.id) }} onNodeMouseLeave={() => acts.hover(undefined)}
          nodesDraggable={false} nodesConnectable={false} zoomOnDoubleClick={false} nodesFocusable={false} edgesFocusable={false} elementsSelectable={false} panOnScroll
          minZoom={0.1} maxZoom={2} attributionPosition="top-right">
          <Controls showInteractive={false} fitViewOptions={FIT} />
        </ReactFlow>
      </div>
    </Act.Provider>
  )
}

function Note({ n }: { n: GraphNode }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="fm-note-i">
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}><span>{n.label}</span>{n.description && <small>{n.description}</small>}</button>
      {open && <p>{n.text || n.description || 'No text.'}</p>}
    </li>
  )
}

type StageHub = Pick<HubState, 'stages' | 'controls' | 'escalations'>

function Panel({ p, all, hub, cwd, chatNodes, onPick, onClose }: { p: Part; all: Parts; hub?: StageHub; cwd?: string; chatNodes: FlowNode[]; onPick: (id: string) => void; onClose: () => void }) {
  // Chats split from one message name each other.
  const split = (id: string) => {
    const g = chatNodes.find(n => n.id === id)?.group
    const sibs = g ? chatNodes.filter(n => n.group === g && n.id !== id).map(n => n.label) : []
    return sibs.length ? `Split with ${sibs.join(', ')}` : ''
  }
  const limits = (id: string) => { const n = chatNodes.find(x => x.id === id); return n ? limitText(n) : '' }
  const name = (id: string) => all.parts.find(x => x.id === id)?.path ?? id
  const outs = all.links.filter(l => l.from === p.id).sort((a, b) => b.n - a.n)
  const ins = all.links.filter(l => l.to === p.id).sort((a, b) => b.n - a.n)
  const [more, setMore] = useState(false)
  const files = more ? p.files : p.files.slice(0, 10)
  const mine = new Set(p.notes.map(n => n.id))
  const rest = all.notes.filter(n => !mine.has(n.id))
  // Advanced mode: a chat's stage line, and the model a role was raised to in this project.
  const stage = (id: string) => { const r = hub && chatRun(hub, id.replace(/^chat:/, '')); return r ? stageView(r.run.stages).line : '' }
  const raised = hub ? raisesFor(hub, cwd) : {}
  return (
    <aside className="fm-card" aria-label={p.name}>
      <div className="fm-card-h">
        <div><small>{p.alone ? 'Part, no imports' : p.depth === 0 ? 'Entry part' : `Part, layer ${p.depth + 1}`}</small><h3>{p.path === '.' ? p.name : p.path}</h3></div>
        <button type="button" className="hub-btn icon" aria-label="Close details" onClick={onClose}>
          <svg aria-hidden width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8" /></svg>
        </button>
      </div>
      <p>{p.about ?? 'No README or header comment says what this part is for yet.'}</p>
      {(outs.length > 0 || ins.length > 0) && <div className="fm-io">
        {outs.length > 0 && <section><h4>Connects to</h4><ul>{outs.map(l => <li key={l.to}><button type="button" onClick={() => onPick(l.to)}>{name(l.to)}</button><b>{l.n}</b></li>)}</ul></section>}
        {ins.length > 0 && <section><h4>Used by</h4><ul>{ins.map(l => <li key={l.from}><button type="button" onClick={() => onPick(l.from)}>{name(l.from)}</button><b>{l.n}</b></li>)}</ul></section>}
      </div>}
      <h4>Files <b>{p.files.length}</b></h4>
      <ul className="fm-files">{files.map(f => <li key={f}>{p.path === '.' ? f : f.slice(p.path.length + 1)}</li>)}</ul>
      {p.files.length > 10 && <button type="button" className="hub-btn" onClick={() => setMore(m => !m)}>{more ? 'Show fewer' : `Show all ${p.files.length}`}</button>}
      <h4>Chats that changed it <b>{p.chats.length}</b></h4>
      {p.chats.length ? <ul className="fm-hist">{p.chats.map(c => <li key={c.id}><span>{c.label}</span>{c.at ? <time>{when(c.at)}</time> : null}<small>{plural(c.n, 'change')}</small>{stage(c.id) && <small>{stage(c.id)}</small>}{split(c.id) && <small className="fm-split">{split(c.id)}</small>}{limits(c.id) && <small className="fm-split">{limits(c.id)}</small>}</li>)}</ul>
        : <p className="fm-quiet">No chat here has changed it yet.</p>}
      {TOOL_KINDS.map(k => { const of = p.tools.filter(t => t.kind === k); return of.length ? <section key={k}><h4>{k === 'role' ? 'Roles' : `${KIND_NAME[k]}s`} used</h4><ul className="fm-chips">{of.map(t => { const up = k === 'role' ? raised[t.label] : undefined; return <li key={t.id} data-kind={k} title={up && raiseLine(up)}><i aria-hidden />{t.label}{up && ` · ${up.to}`}<b>{t.n}</b></li> })}</ul></section> : null })}
      <h4>Memory notes <b>{p.notes.length}</b></h4>
      {p.notes.length ? <ul className="fm-notes">{p.notes.map(n => <Note key={n.id} n={n} />)}</ul> : <p className="fm-quiet">No note names this part or its files.</p>}
      {rest.length > 0 && <><h4>About the project <b>{rest.length}</b></h4><ul className="fm-notes">{rest.map(n => <Note key={n.id} n={n} />)}</ul></>}
    </aside>
  )
}

/** here: this window's project; cwd: the picked chat's. Both follow the hub until a project is picked in the map. */
export function FlowMapView({ isDemo, cwds, here, cwd: chatCwd, hub, onClose }: { isDemo: boolean; cwds: string[]; here?: string; cwd?: string; hub?: StageHub; onClose: () => void }) {
  const [chosen, setChosen] = useState<string>()
  const [saved] = useState(() => readStore(SAVED) ?? undefined)
  const cwd = chosen ?? startProject(cwds, here, saved, chatCwd)
  const pickProject = (c: string) => { setChosen(c); writeStore(SAVED, c) }
  const [map, setMap] = useState<FlowMap>()
  const [mem, setMem] = useState<MemoryGraph>()
  const [problem, setProblem] = useState<string>()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string>()
  const narrow = useMedia(NARROW)
  const still = useMedia('(prefers-reduced-motion: reduce)')
  const dlg = useRef<HTMLDialogElement>(null)


  useEffect(() => {
    let stop = false
    setMap(undefined); setProblem(undefined); setPicked(undefined)
    if (isDemo) { setMap(demoAppMap()); setMem(demoGraph()); return }
    if (!cwd) { setProblem('No project yet: start a chat in one.'); return }
    void loadFlowMap(cwd).then(m => { if (stop) return; if (typeof m === 'string') setProblem(m); else setMap(m) })
    void loadGraph().then(g => { if (!stop && typeof g !== 'string') setMem(g) })
    return () => { stop = true }
  }, [isDemo, cwd])

  useDialog(dlg, d => d.focus())

  // demo notes hang off /w/switchboard, so the demo matches by project name
  const all = useMemo(() => (map ? components(map, mem, isDemo ? undefined : cwd) : undefined), [map, mem, cwd, isDemo])
  const shown = useMemo(() => {
    if (!all) return undefined
    const s = q.trim().toLowerCase()
    if (!s) return all
    const parts = all.parts.filter(p => p.path.toLowerCase().includes(s) || p.files.some(f => f.toLowerCase().includes(s)) || p.tools.some(t => t.label.toLowerCase().includes(s)))
    const ids = new Set(parts.map(p => p.id))
    return { ...all, parts, links: all.links.filter(l => ids.has(l.from) || ids.has(l.to)), match: ids }
  }, [all, q])
  const part = all?.parts.find(p => p.id === picked)
  const chats = map?.nodes.filter(n => n.kind === 'chat').length ?? 0

  return (
    <dialog ref={dlg} className="fm" aria-label="Code" tabIndex={-1} data-picked={part ? '' : undefined}
      onCancel={e => { e.preventDefault(); if (picked) setPicked(undefined); else onClose() }}
      onKeyDown={e => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        const t = e.target as HTMLElement
        if (t instanceof HTMLInputElement && t.type === 'search') { if (q) setQ(''); else { t.blur(); dlg.current?.focus() } return }
        if (picked) setPicked(undefined); else onClose()
      }}>
      <header className="fm-bar">
        <div className="fm-title">
          <h2>Code</h2>
          {cwds.length > 1 && !isDemo
            ? <select aria-label="Project" value={cwd} onChange={e => pickProject(e.target.value)}>{cwds.map(c => <option key={c} value={c}>{base(c)}</option>)}</select>
            : <p>{map?.project ?? (cwd ? base(cwd) : '')}</p>}
        </div>
        <label className="fm-find">
          <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM11 11l3.5 3.5" /></svg>
          <input type="search" placeholder="Find a part, file or skill" aria-label="Find" value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && shown?.parts[0]) setPicked(shown.parts[0].id) }} />
        </label>
      </header>

      <main className="fm-main">
        {problem ? <p className="fm-note">{problem}</p>
          : !shown ? <p className="fm-note">Reading the code and the chats...</p>
          : !shown.parts.length ? <p className="fm-note">{q ? `Nothing matches "${q}".` : 'No code files found.'}</p>
          : narrow ? <List all={shown} picked={picked} onPick={setPicked} />
          : <ReactFlowProvider><Canvas parts={all!.parts} links={all!.links} match={'match' in shown ? shown.match : undefined} picked={picked} onPick={setPicked} still={still} /></ReactFlowProvider>}
      </main>

      {all && <footer className="fm-under">
        <ul className="fm-key" aria-label="Key">
          <li><svg aria-hidden width="26" height="10"><path d="M1 5h20" /><path d="M19 1.5 24 5l-5 3.5z" className="head" /></svg>Imports, in the direction of the call; thicker is more</li>
          <li><svg aria-hidden width="26" height="10"><path d="M1 5h22" className="out" /></svg>Out of the hovered part</li>
          <li><svg aria-hidden width="26" height="10"><path d="M1 5h22" className="in" /></svg>Into it</li>
        </ul>
        <p className="fm-foot">{plural((shown ?? all).parts.length, 'part')}, {plural((shown ?? all).links.length, 'link')}, {plural(chats, 'chat')}{map?.cut ? ', stopped at 1500 files' : ''}. Click a part for its files, chats, tools and notes.</p>
      </footer>}

      {part && all && <Panel key={part.id} p={part} all={all} hub={hub} cwd={cwd} chatNodes={map?.nodes.filter(n => n.kind === 'chat') ?? []} onPick={setPicked} onClose={() => setPicked(undefined)} />}
    </dialog>
  )
}

function List({ all, picked, onPick }: { all: Parts; picked?: string; onPick: (id: string) => void }) {
  const depths = [...new Set(all.parts.map(p => p.depth))].sort((a, b) => a - b)
  return (
    <div className="fm-list">
      {depths.map((d, i) => {
        const of = all.parts.filter(p => p.depth === d)
        return (
          <section key={d}>
            <h4>{colName(i, of.some(p => p.alone))} <b>{of.length}</b></h4>
            <ul>{of.map(p => (
              <li key={p.id}>
                <button type="button" aria-pressed={p.id === picked} onClick={() => onPick(p.id)}>
                  <span><b>{p.path === '.' ? p.name : p.path}</b><small>{meta(p)}{all.links.some(l => l.from === p.id) ? `, uses ${all.links.filter(l => l.from === p.id).map(l => l.to.slice(2)).join(', ')}` : ''}</small></span>
                </button>
              </li>
            ))}</ul>
          </section>
        )
      })}
    </div>
  )
}
