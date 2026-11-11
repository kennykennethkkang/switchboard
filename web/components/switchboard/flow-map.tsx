'use client'

/**
 * Flow map: how one project is built. Its folders and the imports between them, and the chats that worked on it
 * with the skills, plugins, mods and roles they used. Lazy-loaded by switchboard.tsx; read-only. Under 600px it is a list.
 */
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './flow-map.css'
import { KIND_NAME, NODE_H, NODE_W, PAD, boxH, READ, boxText, cardOf, openView, demoFlowMap, foldView, layoutView, loadFlowMap, neighbours, quietEdges, sidesOf, startProject, toggleOpen, when, withTree, type FlowKind, type FlowMap, type ViewEdge, type ViewNode } from '@/lib/flow-map'

const NARROW = '(max-width: 600px)'
const SAVED = 'fm-project'
// Room for the lane titles and the zoom buttons.
const FIT = { padding: { top: `${PAD.top}px`, right: `${PAD.right}px`, bottom: `${PAD.bottom}px`, left: `${PAD.left}px` }, maxZoom: 1 } as const
const ORDER: FlowKind[] = ['folder', 'file', 'chat', 'skill', 'plugin', 'mod', 'role']
const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p

// Clicks and hovers go through here so node data never changes with them.
type Acts = { pick: (id?: string) => void; toggle: (id: string) => void; hover: (id?: string) => void }
const Act = createContext<Acts>({ pick: () => {}, toggle: () => {}, hover: () => {} })

type Data = { n: ViewNode; d: number }
const Box = memo(function Box({ data }: NodeProps<Node<Data>>) {
  const { n, d } = data
  const act = useContext(Act)
  const { name, meta } = boxText(n)
  return (
    <button type="button" className="fm-node" data-kind={n.kind} data-hit={n.hit || undefined} title={n.label} style={{ animationDelay: `${d}ms` }}
      onClick={() => act.pick(n.id)} onDoubleClick={() => { if (n.kind === 'folder') act.toggle(n.id) }}
      onFocus={() => act.hover(n.id)} onBlur={() => act.hover(undefined)}>
      <Handle type="target" id="tl" position={Position.Left} isConnectable={false} />
      <Handle type="source" id="sl" position={Position.Left} isConnectable={false} />
      <i aria-hidden />
      <span><b>{name}</b><small>{meta}</small></span>
      <Handle type="target" id="tr" position={Position.Right} isConnectable={false} />
      <Handle type="source" id="sr" position={Position.Right} isConnectable={false} />
    </button>
  )
})
const Lane = memo(function Lane({ data }: NodeProps<Node<{ name: string; count: number; total?: number }>>) {
  return <div className="fm-lane">{data.name}<b>{data.count}{data.total && data.total > data.count ? ` of ${data.total}` : ''}</b></div>
})
const TYPES = { box: Box, lane: Lane }

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

/** Focus CSS for one node and its neighbours: written into a style tag, so hovering re-renders nothing. */
function focusCss(id: string | undefined, idx: Map<string, number>, near: Map<string, Set<string>>, picked?: string): string {
  const rules: string[] = []
  if (picked !== undefined && idx.has(picked)) rules.push(`.fm-flow .n${idx.get(picked)} .fm-node{border-color:var(--hub-blue);background:var(--hub-elev)}`)
  if (id === undefined || !idx.has(id)) return rules.join('')
  const i = idx.get(id)!
  const on = [i, ...[...(near.get(id) ?? [])].map(x => idx.get(x)).filter((x): x is number => x !== undefined)]
  rules.push(`${on.map(k => `.fm-flow[data-focus] .react-flow__node.n${k}`).join(',')}{opacity:1}`)
  rules.push(`.fm-flow[data-focus] .react-flow__edge:is(.s${i},.t${i}){opacity:1}`)
  rules.push(`.fm-flow[data-focus] .react-flow__edge:is(.s${i},.t${i}) .react-flow__edge-path{stroke-width:2;stroke-opacity:1}`)
  rules.push(`.fm-flow[data-focus] .react-flow__edge:is(.s${i},.t${i}) .react-flow__edge-textwrapper{display:inline}`)
  rules.push(`.fm-flow[data-focus] .react-flow__edge.used:is(.s${i},.t${i}) .react-flow__edge-path{animation:fm-march 900ms linear infinite}`)
  return rules.join('')
}

type Reveal = { id: string; at: number }
function Canvas({ nodes, edges, picked, onPick, onToggle, still, fitKey, reveal, folders }: { nodes: ViewNode[]; edges: ViewEdge[]; picked?: string; onPick: (id?: string) => void; onToggle: (id: string) => void; still: boolean; fitKey: string; reveal?: Reveal; folders: number }) {
  const wrap = useRef<HTMLDivElement>(null)
  const style = useRef<HTMLStyleElement>(null)
  const [aspect] = useState(() => (typeof window === 'undefined' ? 1.6 : Math.max(0.6, Math.min(2.4, window.innerWidth / Math.max(1, window.innerHeight - 64)))))
  const [maxW] = useState(() => (typeof window === 'undefined' ? Infinity : (window.innerWidth - PAD.left - PAD.right) / READ))
  const lay = useMemo(() => layoutView(nodes, edges, aspect, maxW), [nodes, edges, aspect, maxW])
  const idx = useMemo(() => new Map(nodes.map((n, i) => [n.id, i])), [nodes])
  const near = useMemo(() => neighbours(edges, nodes), [edges, nodes])
  const quiet = useMemo(() => quietEdges(nodes, edges), [nodes, edges])
  const rf = useReactFlow()

  const flowNodes = useMemo(() => {
    const lane = (x: number) => Math.max(0, lay.lanes.findLastIndex(l => l.x <= x))
    const out: Node[] = lay.lanes.map((l, i) => ({ id: `lane:${i}`, type: 'lane', position: { x: l.x, y: -40 }, data: { name: l.name, count: l.count, ...(l.name === 'Folders' ? { total: folders } : {}) }, selectable: false, focusable: false, className: 'fm-lane-n' }))
    nodes.forEach((n, i) => {
      const p = lay.at.get(n.id) ?? { x: 0, y: 0 }
      // Entry stagger: by lane, then down the column, capped so a big map is in within ~0.5 s.
      const d = lane(p.x) * 70 + Math.min(Math.round(p.y / (NODE_H + 10)), 16) * 14
      out.push({ id: n.id, type: 'box', position: p, data: { n, d }, width: NODE_W, height: boxH(n.kind), className: `n${i}`, focusable: false })
    })
    return out
  }, [nodes, lay, folders])
  const flowEdges: Edge[] = useMemo(() => edges.map(e => {
    const s = sidesOf(lay.at.get(e.from), lay.at.get(e.to))
    // Same column: a bezier between two right handles collapses into the node border, so bracket out to the side.
    const bend = s.from === s.to ? { type: 'smoothstep', pathOptions: { offset: 22, borderRadius: 10 } } : {}
    return { id: `${e.from}>${e.to}>${e.kind}`, source: e.from, target: e.to, sourceHandle: `s${s.from}`, targetHandle: `t${s.to}`, ...bend, className: `fm-edge ${e.kind}${quiet.has(e) ? ' quiet' : ''} s${idx.get(e.from)} t${idx.get(e.to)}`, markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 }, ...(e.n > 1 ? { label: String(e.n) } : {}) }
  }), [edges, lay, idx, quiet])

  const hovered = useRef<string>(undefined)
  const pickedRef = useRef(picked)
  pickedRef.current = picked
  const paint = () => {
    const id = hovered.current ?? pickedRef.current
    if (style.current) style.current.textContent = focusCss(id, idx, near, pickedRef.current)
    if (id !== undefined && idx.has(id)) wrap.current?.setAttribute('data-focus', '')
    else wrap.current?.removeAttribute('data-focus')
  }
  useEffect(paint)
  const acts = useMemo<Acts>(() => ({ pick: onPick, toggle: onToggle, hover: id => { hovered.current = id; paint() } }), [onPick, onToggle, idx, near]) // eslint-disable-line react-hooks/exhaustive-deps

  // Entry animation only while the map first draws; nodes mounted later by panning just appear.
  useEffect(() => {
    const w = wrap.current
    if (!w || still) return
    w.setAttribute('data-enter', '')
    const t = setTimeout(() => w.removeAttribute('data-enter'), 1100)
    return () => clearTimeout(t)
  }, [lay, still])
  // Fit on first draw and when the search changes; opening or folding a folder keeps the view where it is.
  const fitted = useRef<string>(undefined)
  useEffect(() => {
    if (fitted.current === fitKey) return
    const t = setTimeout(() => {
      fitted.current = fitKey
      const w = wrap.current, v = w && openView(lay, w.clientWidth, w.clientHeight), duration = still ? 0 : 420
      if (!v || v === 'fit') void rf.fitView({ ...FIT, duration })
      else void rf.setViewport(v, { duration })
    }, 20)
    return () => clearTimeout(t)
  }, [lay, rf, still, fitKey])
  // Pan a box on screen when it is off it: a just opened folder (and room for what it shows), a search pick, or a pick the docked card now covers.
  const show = (id: string, below: number) => {
    const p = lay.at.get(id), w = wrap.current
    if (!p || !w) return
    const { x, y, zoom } = rf.getViewport(), sx = p.x * zoom + x, sy = p.y * zoom + y
    if (sx >= 0 && sy >= PAD.top && sx + NODE_W * zoom <= w.clientWidth && sy + NODE_H * below * zoom <= w.clientHeight) return
    // move only as far as it takes, 24px clear of the edge
    const m = 24, bw = NODE_W * zoom, bh = NODE_H * below * zoom
    const dx = sx < m ? m - sx : sx + bw > w.clientWidth - m ? w.clientWidth - m - bw - sx : 0
    const dy = sy < PAD.top ? PAD.top - sy : sy + bh > w.clientHeight - m ? Math.max(PAD.top - sy, w.clientHeight - m - bh - sy) : 0
    void rf.setViewport({ x: x + dx, y: y + dy, zoom }, { duration: still ? 0 : 320 })
  }
  useEffect(() => { if (reveal) show(reveal.id, 3) }, [reveal, lay]) // eslint-disable-line react-hooks/exhaustive-deps
  // after the grid gives the card its column, so the canvas width is the new one
  useEffect(() => {
    if (!picked) return
    const t = setTimeout(() => show(picked, 1), 40)
    return () => clearTimeout(t)
  }, [picked]) // eslint-disable-line react-hooks/exhaustive-deps
  // + / = zoom in, - out, 0 fits; not while typing in the search box or the project picker.
  useEffect(() => {
    const d = wrap.current?.closest('dialog')
    if (!d) return
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest?.('input, select')) return
      if (e.key === '+' || e.key === '=') void rf.zoomIn() // no animation: a second press would cut the first short
      else if (e.key === '-') void rf.zoomOut()
      else if (e.key === '0') void rf.fitView({ ...FIT, duration: still ? 0 : 420 })
      else return
      e.preventDefault()
    }
    d.addEventListener('keydown', key)
    return () => d.removeEventListener('keydown', key)
  }, [rf, still])

  return (
    <Act.Provider value={acts}>
      <div ref={wrap} className="fm-flow" data-dense={edges.length > 120 || undefined}>
        <style ref={style} />
        <ReactFlow nodes={flowNodes} edges={flowEdges} nodeTypes={TYPES} onPaneClick={() => onPick(undefined)}
          onNodeMouseEnter={(_, n) => { if (!n.id.startsWith('lane:')) acts.hover(n.id) }} onNodeMouseLeave={() => acts.hover(undefined)}
          nodesDraggable={false} nodesConnectable={false} zoomOnDoubleClick={false} nodesFocusable={false} edgesFocusable={false} elementsSelectable={false} onlyRenderVisibleElements panOnScroll
          minZoom={0.04} maxZoom={2} attributionPosition="top-right">
          <Controls showInteractive={false} fitViewOptions={FIT} />
        </ReactFlow>
      </div>
    </Act.Provider>
  )
}

/** here: this window's project; cwd: the picked chat's. Both follow the hub until a project is picked in the map. */
export function FlowMapView({ isDemo, cwds, here, cwd: chatCwd, onClose }: { isDemo: boolean; cwds: string[]; here?: string; cwd?: string; onClose: () => void }) {
  const [chosen, setChosen] = useState<string>()
  const [saved] = useState(() => { try { return localStorage.getItem(SAVED) ?? undefined } catch { return undefined } })
  const cwd = chosen ?? startProject(cwds, here, saved, chatCwd)
  const pickProject = (c: string) => { setChosen(c); try { localStorage.setItem(SAVED, c) } catch { /* private window */ } }
  const [raw, setMap] = useState<FlowMap>()
  const map = useMemo(() => raw && withTree(raw), [raw])
  const [reveal, setReveal] = useState<Reveal>()
  const [problem, setProblem] = useState<string>()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [picked, setPicked] = useState<string>()
  const [hide, setHide] = useState<Set<FlowKind>>(new Set())
  const narrow = useMedia(NARROW)
  const still = useMedia('(prefers-reduced-motion: reduce)')
  const dlg = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    let stop = false
    setMap(undefined); setProblem(undefined); setPicked(undefined); setOpen(new Set())
    if (isDemo) { setMap(demoFlowMap()); return }
    if (!cwd) { setProblem('No project yet: start a chat in one.'); return }
    void loadFlowMap(cwd).then(m => { if (stop) return; if (typeof m === 'string') setProblem(m); else setMap(m) })
    return () => { stop = true }
  }, [isDemo, cwd])

  const [was] = useState(() => (typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null))
  useEffect(() => {
    const d = dlg.current
    if (d && !d.open) { d.showModal(); d.focus() } // the dialog, not the search box, so + - 0 work at once
    return () => { d?.close(); was?.focus?.() }
  }, [was])

  const view = useMemo(() => (map ? foldView(map, open, q, hide) : { nodes: [], edges: [] }), [map, open, q, hide])
  const card = map && picked ? cardOf(map, picked) : undefined
  const toggle = useCallback((id: string) => { setOpen(s => toggleOpen(s, id)); setReveal({ id, at: Date.now() }) }, [])
  const flip = (k: FlowKind) => setHide(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const kinds = useMemo(() => { const c = new Map<FlowKind, number>(); for (const n of map?.nodes ?? []) if (n.kind !== 'file') c.set(n.kind, (c.get(n.kind) ?? 0) + 1); return ORDER.filter(k => c.has(k)).map(k => [k, c.get(k)!] as const) }, [map])
  const chats = map?.nodes.filter(n => n.kind === 'chat').length ?? 0
  const folders = map?.nodes.filter(n => n.kind === 'folder').length ?? 0

  return (
    <dialog ref={dlg} className="fm" aria-label="Flow map" tabIndex={-1} data-picked={card ? '' : undefined}
      // Esc on keydown: Chrome only lets a dialog cancel be stopped once per user activation. Card first, then the view.
      onCancel={e => { e.preventDefault(); if (picked) setPicked(undefined); else onClose() }}
      onKeyDown={e => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        // in the search box Esc clears it, then leaves it; the map stays open
        const t = e.target as HTMLElement
        if (t instanceof HTMLInputElement && t.type === 'search') { if (q) setQ(''); else { t.blur(); dlg.current?.focus() } return }
        if (picked) setPicked(undefined); else onClose()
      }}>
      <header className="fm-bar">
        <div className="fm-title">
          <h2>Flow map</h2>
          {cwds.length > 1 && !isDemo
            ? <select aria-label="Project" value={cwd} onChange={e => pickProject(e.target.value)}>{cwds.map(c => <option key={c} value={c}>{base(c)}</option>)}</select>
            : <p>{map?.project ?? (cwd ? base(cwd) : '')}</p>}
        </div>
        <label className="fm-find">
          <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM11 11l3.5 3.5" /></svg>
          <input type="search" placeholder="Find a folder, chat or skill" aria-label="Find" value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { const hit = view.nodes.find(n => n.hit); if (hit) { setPicked(hit.id); setReveal({ id: hit.id, at: Date.now() }) } } }} />
        </label>
      </header>

      <main className="fm-main">
        {problem ? <p className="fm-note">{problem}</p>
          : !map ? <p className="fm-note">Reading the code and the chats...</p>
          : !view.nodes.length ? <p className="fm-note">{q ? `Nothing matches "${q}".` : hide.size ? 'Everything is hidden. Turn a kind back on below.' : 'No code files or chats found.'}</p>
          : narrow ? <List nodes={view.nodes} picked={picked} onPick={setPicked} onToggle={toggle} />
          : <ReactFlowProvider><Canvas nodes={view.nodes} edges={view.edges} picked={picked} onPick={setPicked} onToggle={toggle} still={still} fitKey={`${cwd}\n${q.trim()}`} reveal={reveal} folders={folders} /></ReactFlowProvider>}
      </main>

      {map && <footer className="fm-under">
        {kinds.length > 0 && <div className="fm-legend">
          <ul aria-label="Show or hide">{kinds.map(([k, c]) => <li key={k}><button type="button" data-kind={k} aria-pressed={!hide.has(k)} onClick={() => flip(k)}><i aria-hidden />{k === 'role' ? 'Roles' : `${KIND_NAME[k]}s`}<b>{c}</b></button></li>)}</ul>
          <ul aria-label="Lines" className="fm-key">
            <li><svg aria-hidden width="22" height="8"><path d="M1 4h20" className="import" /></svg>Imports</li>
            <li><svg aria-hidden width="22" height="8"><path d="M1 4h20" className="touched" /></svg>Changed by</li>
            <li><svg aria-hidden width="22" height="8"><path d="M1 4h20" className="used" /></svg>Used</li>
          </ul>
        </div>}
        <p className="fm-foot">{folders} folder{folders === 1 ? '' : 's'}, {chats} chat{chats === 1 ? '' : 's'}{map.cut ? ', stopped at 1500 files' : ''}. Hover or click a box to trace its lines, click for details, double-click a folder to open it.</p>
      </footer>}

      {card && picked && (
        <aside className="fm-card" aria-label={card.title}>
          <div className="fm-card-h">
            <div><small>{card.kind}</small><h3>{card.title}</h3></div>
            <button type="button" className="hub-btn icon" aria-label="Close card" onClick={() => setPicked(undefined)}>
              <svg aria-hidden width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8" /></svg>
            </button>
          </div>
          <p>{card.about}</p>
          {picked.startsWith('d:') && <button type="button" className="hub-btn" onClick={() => toggle(picked)}>{open.has(picked) ? 'Fold it' : 'Open it'}</button>}
          {card.uses.length > 0 && <><h4>{picked.startsWith('chat:') ? 'It used' : 'It uses'}</h4><ul>{card.uses.map(u => <li key={u}>{u}</li>)}</ul></>}
          {card.usedBy.length > 0 && <><h4>Used by</h4><ul>{card.usedBy.map(u => <li key={u}>{u}</li>)}</ul></>}
          {card.history.length > 0 && <><h4>{picked.startsWith('chat:') ? 'What it changed' : picked.startsWith('d:') || picked.startsWith('f:') ? 'Built or changed by' : 'Chats that used it'}</h4>
            <ul className="fm-hist">{card.history.map((h, i) => <li key={i}><span>{h.who}</span>{h.at ? <time>{when(h.at)}</time> : null}{h.with.length > 0 && <small>with {h.with.slice(0, 5).join(', ')}{h.with.length > 5 ? ', ...' : ''}</small>}</li>)}</ul></>}
          {card.history.length === 0 && !picked.startsWith('chat:') && <p className="fm-quiet">No chat here has changed it yet.</p>}
        </aside>
      )}
    </dialog>
  )
}

function List({ nodes, picked, onPick, onToggle }: { nodes: ViewNode[]; picked?: string; onPick: (id: string) => void; onToggle: (id: string) => void }) {
  return (
    <div className="fm-list">
      {ORDER.map(k => {
        const of = nodes.filter(n => n.kind === k)
        if (!of.length) return null
        return (
          <section key={k}>
            <h4>{KIND_NAME[k]}s <b>{of.length}</b></h4>
            <ul>{of.map(n => (
              <li key={n.id}>
                <button type="button" data-kind={n.kind} aria-pressed={n.id === picked} onClick={() => onPick(n.id)}><i aria-hidden /><span>{n.label}</span>{n.kind === 'folder' && <small>{(n.files ?? 0) + (n.subs ?? 0)}</small>}</button>
                {n.kind === 'folder' && <button type="button" className="fm-open" aria-label={n.open ? `Fold ${n.label}` : `Open ${n.label}`} onClick={() => onToggle(n.id)}>{n.open ? 'Fold' : 'Open'}</button>}
              </li>
            ))}</ul>
          </section>
        )
      })}
    </div>
  )
}
