'use client'

/**
 * Code view: the app as parts (top folders, split a level down when one dominates), the imports between them in flow order,
 * in flow order, and per part the chats, tools and memory notes behind it. Lazy-loaded by switchboard.tsx; read-only.
 * Under 600px it is a list.
 */
import { useDialog } from '@/hooks/use-dialog'
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { readStore, writeStore } from '@/lib/store'
import { BaseEdge, Controls, EdgeText, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type EdgeProps, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './flow-map.css'
import { KIND_NAME, colName, PART_H, PART_W, components, demoAppMap, layers, loadFlowMap, routeLinks, startProject, when, type FlowKind, type FlowMap, type FlowNode, type Part, type PartLink, type Parts } from '@/lib/flow-map'
import type { HubState } from '@/lib/hub-types'
import { limitText } from '@/lib/budget-ui'
import { chatRun, raiseLine, raisesFor, stageView } from '@/lib/stages-ui'
import { demoGraph, loadGraph, type MemoryGraph } from '@/lib/memory-graph'
import { PageStats, Seg } from './page-kit'
import { ago, heats, type Heat } from './fm-data'
import { Layers, Legend, Note, Rank, partName, plural } from './fm-bits'

const NARROW = '(max-width: 600px)'
const SAVED = 'fm-project'
const TOOL_KINDS: FlowKind[] = ['skill', 'plugin', 'mod', 'role']
const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p

type Acts = { pick: (id?: string) => void; hover: (id?: string) => void }
type BoxData = { p: Part; entry: boolean; heat?: Heat; max: number }
const Act = createContext<Acts>({ pick: () => {}, hover: () => {} })

// notes drop out when the heat text needs the room: the box line is one row wide
const meta = (p: Part, short = false) => [plural(p.files.length, 'file'), p.chats.length ? plural(p.chats.length, 'chat') : '', p.notes.length && !short ? plural(p.notes.length, 'note') : ''].filter(Boolean).join(', ')

const Box = memo(function Box({ data }: NodeProps<Node<BoxData>>) {
  const { p, entry, heat, max } = data
  const act = useContext(Act)
  return (
    <button type="button" className="fm-part" data-entry={entry || undefined} data-hot={heat?.hot || undefined} data-alone={p.alone || undefined} title={p.path}
      onClick={() => act.pick(p.id)} onFocus={() => act.hover(p.id)} onBlur={() => act.hover(undefined)}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Handle type="source" position={Position.Right} isConnectable={false} />
      <b>{entry && <i className="fm-entry" aria-label="Entry" />}{partName(p)}</b>
      <small className="fm-about" data-files={p.about ? undefined : ''}>{p.about ?? p.files.map(base).join(', ')}</small>
      <small>{meta(p, !!heat?.n)}{heat?.n ? `, ${heat.hot ? `Hot ${heat.n}` : plural(heat.n, 'change')}` : ''}{heat?.last ? `, ${ago(heat.last)}` : ''}</small>
      {heat?.hot && <i className="fm-hot" aria-hidden />}
      {!!heat?.n && <i className="fm-heat" style={{ width: `${Math.max(8, (heat.n / max) * 100)}%` }} />}
    </button>
  )
})
const Col = memo(function Col({ data }: NodeProps<Node<{ name: string }>>) { return <div className="fm-lane">{data.name}</div> })
const TYPES = { part: Box, col: Col }

/** A line along the routed points, so it goes round boxes instead of under them; corners rounded. */
function Routed({ data, markerEnd, style, label }: EdgeProps<Edge<{ pts: { x: number; y: number }[] }>>) {
  const pts = data?.pts ?? []
  const path = pts.map((p, i) => {
    const s = pts[i - 1], n = pts[i + 1]
    if (!s || !n) return `${i ? 'L' : 'M'}${p.x},${p.y}`
    const r = Math.min(10, Math.hypot(p.x - s.x, p.y - s.y) / 2, Math.hypot(n.x - p.x, n.y - p.y) / 2)
    return `L${p.x - Math.sign(p.x - s.x) * r},${p.y - Math.sign(p.y - s.y) * r} Q${p.x},${p.y} ${p.x + Math.sign(n.x - p.x) * r},${p.y + Math.sign(n.y - p.y) * r}`
  }).join(' ')
  // the count sits at the far end from the hovered part, by the box it touches: mid-route, links sharing a corridor stacked them
  const s = pts[0], t = pts[pts.length - 1], half = String(label).length * 3.5 + 4
  return <>
    <BaseEdge path={path} markerEnd={markerEnd} style={style} />
    {s && <EdgeText className="fm-lab-s" x={s.x + 8 + half} y={s.y} label={label} labelBgPadding={[4, 2]} labelBgBorderRadius={4} />}
    {t && <EdgeText className="fm-lab-t" x={t.x - 14 - half} y={t.y} label={label} labelBgPadding={[4, 2]} labelBgBorderRadius={4} />}
  </>
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
  rules.push(`.fm-flow[data-focus] .react-flow__edge.s${i} .fm-lab-t,.fm-flow[data-focus] .react-flow__edge.t${i} .fm-lab-s{display:inline}`)
  return rules.join('')
}

function Canvas({ parts, links, match, picked, onPick, still, heat, max }: { parts: Part[]; links: PartLink[]; match?: Set<string>; picked?: string; onPick: (id?: string) => void; still: boolean; heat: Map<string, Heat>; max: number }) {
  const wrap = useRef<HTMLDivElement>(null)
  const style = useRef<HTMLStyleElement>(null)
  const rf = useReactFlow()
  const idx = useMemo(() => new Map(parts.map((p, i) => [p.id, i])), [parts])
  const lay = useMemo(() => {
    const { at } = layers(parts, links)
    const xs = [...new Set(parts.map(p => p.depth))].sort((a, b) => a - b)
    const cols = links.length ? xs.map((d, i) => ({ name: colName(i, parts.some(p => p.depth === d && p.alone)), x: i * (PART_W + 120) })) : [{ name: colName(0, true), x: 0 }]
    return { at, cols, paths: routeLinks(parts, links, at) }
  }, [parts, links])
  const hasIn = useMemo(() => new Set(links.map(l => l.to)), [links])

  const nodes = useMemo(() => {
    const out: Node[] = lay.cols.map((c, i) => ({ id: `col:${i}`, type: 'col', position: { x: c.x, y: -40 }, data: { name: c.name }, selectable: false, className: 'fm-lane-n' }))
    parts.forEach((p, i) => out.push({ id: p.id, type: 'part', position: lay.at.get(p.id) ?? { x: 0, y: 0 }, data: { p, entry: !p.alone && !hasIn.has(p.id) && links.length > 0, heat: heat.get(p.id), max }, width: PART_W, height: PART_H, className: `n${i}${match && !match.has(p.id) ? ' fm-off' : ''}` }))
    return out
  }, [parts, lay, hasIn, links.length, match, heat, max])
  const edges: Edge[] = useMemo(() => {
    const depth = new Map(parts.map(p => [p.id, p.depth]))
    return links.map(l => ({
      id: `${l.from}>${l.to}`, source: l.from, target: l.to, type: 'routed', data: { pts: lay.paths.get(`${l.from}>${l.to}`) ?? [] },
      className: `fm-edge s${idx.get(l.from)} t${idx.get(l.to)}${depth.get(l.to)! <= depth.get(l.from)! ? ' fm-back' : ''}${match && !match.has(l.from) && !match.has(l.to) ? ' fm-off' : ''}`,
      style: { strokeWidth: Math.min(3, 1 + Math.log2(l.n) / 3) },
      // fixed size: in strokeWidth units the thick links got arrowheads three times the size
      markerEnd: { type: MarkerType.ArrowClosed, width: 11, height: 11, markerUnits: 'userSpaceOnUse' }, label: String(l.n),
    }))
  }, [parts, links, lay, idx, match])

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
  // fit to the drawn boxes, top aligned: fitView centred a short graph and left a fifth of the canvas empty above the lanes
  const fit = (ms: number) => {
    const el = wrap.current
    if (!el || !el.clientWidth) return
    const xs = [...lay.at.values()]
    const w = Math.max(...xs.map(a => a.x)) + PART_W, top = -40, h = Math.max(...xs.map(a => a.y)) + PART_H + 24 - top
    const padL = 24, padR = 64, padT = 12, padB = 12
    const z = Math.max(0.1, Math.min(1, (el.clientWidth - padL - padR) / w, (el.clientHeight - padT - padB) / h))
    void rf.setViewport({ x: padL + (el.clientWidth - padL - padR - w * z) / 2, y: padT - top * z, zoom: z }, { duration: ms })
  }
  const fitRef = useRef(fit)
  fitRef.current = fit
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    let t: ReturnType<typeof setTimeout>
    const go = () => { clearTimeout(t); t = setTimeout(() => fitRef.current(0), 40) }
    go()
    const ro = new ResizeObserver(go)
    ro.observe(el)
    return () => { clearTimeout(t); ro.disconnect() }
  }, [lay])

  return (
    <Act.Provider value={acts}>
      <div ref={wrap} className="fm-flow">
        <style ref={style} />
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={TYPES} edgeTypes={EDGES} onPaneClick={() => onPick(undefined)}
          onNodeMouseEnter={(_, n) => { if (!n.id.startsWith('col:')) acts.hover(n.id) }} onNodeMouseLeave={() => acts.hover(undefined)}
          nodesDraggable={false} nodesConnectable={false} zoomOnDoubleClick={false} nodesFocusable={false} edgesFocusable={false} elementsSelectable={false} panOnScroll
          minZoom={0.1} maxZoom={2} attributionPosition="top-right">
          <Controls showInteractive={false} onFitView={() => fit(still ? 0 : 300)} />
        </ReactFlow>
      </div>
    </Act.Provider>
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
        {outs.length > 0 && <section><h4>Uses</h4><ul>{outs.map(l => <li key={l.to}><button type="button" onClick={() => onPick(l.to)}>{name(l.to)}</button><b>{l.n}</b></li>)}</ul></section>}
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
  // opens on the ranked list; the graph is the other tab
  const [mode, setMode] = useState<'list' | 'graph'>('list')
  const heat = useMemo(() => heats(all?.parts ?? []), [all])
  const touching = useMemo(() => new Set(all?.parts.flatMap(p => p.chats.map(c => c.id))).size, [all])
  const graph = !narrow && mode === 'graph'
  const back = !!all && all.links.some(l => all.parts.find(p => p.id === l.to)!.depth <= all.parts.find(p => p.id === l.from)!.depth)

  return (
    <dialog ref={dlg} className="fm" aria-label="Code" tabIndex={-1} data-side={part ? '' : undefined} data-picked={part ? '' : undefined}
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

      {all && <div className="fm-top">
        <PageStats label="Project numbers" items={[
          { label: 'Parts', value: all.parts.length },
          { label: 'Files', value: all.parts.reduce((n, p) => n + p.files.length, 0), hint: map?.cut ? 'stopped at 1500' : undefined },
          { label: 'Links', value: all.links.length },
          { label: 'Chats', value: touching, hint: `of ${chats}` },
          { label: 'Hot', value: heat.hot, tone: heat.hot ? 'yellow' : undefined, hint: 'changed lately' },
          { label: 'Notes', value: all.notes.length },
        ]} />
        <Seg label="Show" value={mode} onChange={setMode} options={[['list', 'List'], ['graph', narrow ? 'Layers' : 'Graph']]} />
      </div>}

      <main className="fm-main">
        {problem ? <p className="fm-note">{problem}</p>
          : !shown ? <p className="fm-note">Reading the code and the chats...</p>
          : !shown.parts.length ? <p className="fm-note">{q ? `Nothing matches "${q}".` : 'No code files found.'}</p>
          : graph ? <>
            <Legend back={back} />
            <div className="fm-cv"><ReactFlowProvider><Canvas parts={all!.parts} links={all!.links} match={'match' in shown ? shown.match : undefined} picked={picked} onPick={setPicked} still={still} heat={heat.by} max={heat.max} /></ReactFlowProvider></div>
          </>
          : narrow && mode === 'graph' ? <Layers all={shown} heat={heat.by} picked={picked} onPick={setPicked} />
          : <Rank all={shown} heat={heat.by} max={heat.max} picked={picked} onPick={setPicked} />}
      </main>

      {part && all && <Panel key={part.id} p={part} all={all} hub={hub} cwd={cwd} chatNodes={map?.nodes.filter(n => n.kind === 'chat') ?? []} onPick={setPicked} onClose={() => setPicked(undefined)} />}
    </dialog>
  )
}
