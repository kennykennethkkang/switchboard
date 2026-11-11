'use client'

/**
 * Memory: Claude's memory files, projects, chats, to-do items and CLAUDE.md files as one 3D graph.
 * Lazy-loaded by switchboard.tsx (the Next build splits it out; the app bundle inlines it). Read-only: the panel gets the graph
 * from the extension, the app from its own /hub/graph proxy.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph'
import { AdditiveBlending, CanvasTexture, Group as Obj, LinearFilter, Sprite, SpriteMaterial, type PerspectiveCamera, type WebGLRenderer } from 'three'
import { GROUPS, colorOf, demoGraph, dolly, findNodes, framePose, graphCounts, groupOf, healthParts, listNodes, loadGraph, neighbors, projectOf, relations, type GraphEdge, type GraphNode, type Group, type MemoryGraph } from '@/lib/memory-graph'
import { vscodeBridge } from '@/lib/vscode-bridge'

type Pt = GraphNode & { x?: number; y?: number; z?: number }
const SIZE: Record<GraphNode['kind'], number> = { project: 22, memory: 11, wiki: 11, raw: 8, rule: 13, chat: 8, todo: 7 }
const SETS = ['Memory', 'Vault', 'Workspace'] as const
const labelOf = (n: GraphNode) => GROUPS.find(g => g.id === groupOf(n))!.label
// Label height on screen, in CSS pixels, whatever the zoom.
const LABEL_PX = 22
// A name tag as a sprite: drawn at 2x on a canvas, screen-sized (no size attenuation), always on top.
function nameTag(text: string): Sprite {
  const t = text.length > 36 ? `${text.slice(0, 35)}\u2026` : text
  const c = document.createElement('canvas'), x = c.getContext('2d')!
  const font = '500 26px "Hanken Grotesk", ui-sans-serif, system-ui, sans-serif'
  x.font = font
  c.width = Math.ceil(x.measureText(t).width) + 28; c.height = 44
  x.font = font
  x.fillStyle = 'rgba(13,13,13,0.85)'; x.strokeStyle = '#242728'; x.lineWidth = 2
  x.beginPath(); x.roundRect(1, 1, c.width - 2, c.height - 2, 10); x.fill(); x.stroke()
  x.fillStyle = '#f4f4f6'; x.textBaseline = 'middle'; x.fillText(t, 14, c.height / 2 + 1)
  // No mipmaps: they blur small text.
  const map = new CanvasTexture(c)
  map.generateMipmaps = false; map.minFilter = LinearFilter
  const s = new Sprite(new SpriteMaterial({ map, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true }))
  s.center.set(0.5, 1)
  s.renderOrder = 10
  s.userData.aspect = c.width / c.height
  return s
}
// Edge tints by predicate: link and related purple, contradicts red, supersedes amber, depends-on and part-of blue.
const TINT: Partial<Record<GraphEdge['kind'], string>> = { link: '169,139,255', related: '169,139,255', contradicts: '255,97,97', supersedes: '255,197,51', 'depends-on': '87,193,255', 'part-of': '87,193,255' }
// on: touches the pick, or nothing is picked.
const edgeColor = (kind: GraphEdge['kind'], on: boolean, picked: boolean) => {
  const t = TINT[kind]
  if (t) return `rgba(${t},${!picked ? 0.55 : on ? 0.7 : 0.12})`
  if (kind === 'from') return `rgba(255,255,255,${on && picked ? 0.18 : 0.05})`
  return on ? (picked ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.14)') : 'rgba(255,255,255,0.04)'
}
// A superseded note stays on the map, faded.
const FADED = 0.35
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function MemoryView({ isDemo, onClose }: { isDemo: boolean; onClose: () => void }) {
  const [graph, setGraph] = useState<MemoryGraph>()
  const [problem, setProblem] = useState<string>()
  const [off, setOff] = useState<Set<Group>>(new Set())
  const [picked, setPicked] = useState<string>()
  const [q, setQ] = useState('')
  const [view, setView] = useState<'graph' | 'list'>('graph')
  const [hover, setHover] = useState<string>()
  // Canvas height; tags are sized from it, so they redo when it changes (the phone details sheet shrinks it).
  const [boxH, setBoxH] = useState(0)
  // A health count clicked: the list shows just those notes.
  const [only, setOnly] = useState<{ text: string; ids: Set<string> }>()
  const sprites = useRef(new Map<string, Sprite>())
  const objs = useRef(new Map<string, Obj>())
  const tags = useRef(new Map<string, Sprite>())
  // Tags wanted, first wins a clash; must: hovered or picked, drawn even over another.
  const want = useRef<{ id: string; must: boolean }[]>([])
  const box = useRef<HTMLDivElement>(null)
  const findRef = useRef<HTMLInputElement>(null)
  const dlg = useRef<HTMLDialogElement>(null)
  const fg = useRef<ForceGraph3DInstance>(undefined)
  const fitRef = useRef<(ms?: number) => void>(undefined)
  const offRef = useRef(off)
  const touched = useRef(false)
  const pickRef = useRef(picked)
  pickRef.current = picked

  useEffect(() => {
    let stop = false
    if (isDemo) { setGraph(demoGraph()); return }
    void loadGraph().then(g => { if (stop) return; if (typeof g === 'string') setProblem(g); else setGraph(g) })
    return () => { stop = true }
  }, [isDemo])

  // What opened the view (the Memory button), read before showModal moves focus; it gets focus back on close,
  // since by cleanup time the dialog is already out of the page and focus has fallen to body.
  const [was] = useState(() => (typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null))
  useEffect(() => {
    const d = dlg.current
    // The dialog, not the search: + - 0 work at once, / goes to the search.
    if (d && !d.open) { d.showModal(); d.focus() }
    return () => { d?.close(); was?.focus?.() }
  }, [was])

  // One instance per graph; filters and picks only restyle it.
  useEffect(() => {
    const el = box.current
    if (!graph || !el) return
    const still = reduced()
    // One soft dot texture for every node; additive blending makes overlaps glow.
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const x = c.getContext('2d')!
    const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.18, 'rgba(255,255,255,0.85)'); grad.addColorStop(0.45, 'rgba(255,255,255,0.22)'); grad.addColorStop(1, 'rgba(255,255,255,0)')
    x.fillStyle = grad; x.fillRect(0, 0, 64, 64)
    const tex = new CanvasTexture(c)
    // A small graph gets bigger dots, so ten nodes are not ten specks once framed.
    const grow = Math.min(2.5, Math.max(1, Math.sqrt(80 / Math.max(1, graph.nodes.length))))
    const g = new ForceGraph3D(el, { controlType: 'orbit' })
      .backgroundColor('#07080a')
      .showNavInfo(false)
      .width(el.clientWidth).height(el.clientHeight)
      .nodeId('id').linkSource('source').linkTarget('target')
      .nodeThreeObject((n: object) => {
        const node = n as Pt
        const s = new Sprite(new SpriteMaterial({ map: tex, color: colorOf(node), blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: node.superseded ? FADED : 1 }))
        s.userData.faded = !!node.superseded
        s.scale.setScalar(SIZE[node.kind] * grow)
        s.userData.size = SIZE[node.kind] * grow
        sprites.current.set(node.id, s)
        // The dot plus room for a name tag, added only once it is shown.
        const o = new Obj()
        o.add(s)
        objs.current.set(node.id, o)
        return o
      })
      .onNodeHover((n: object | null) => { setHover(n ? (n as Pt).id : undefined); el.style.cursor = n ? 'pointer' : '' })
      .linkColor((l: object) => edgeColor((l as GraphEdge).kind, true, false))
      .linkWidth((l: object) => (TINT[(l as GraphEdge).kind] ? 0.6 : 0))
      .linkOpacity(1)
      .enableNodeDrag(false)
      .onNodeClick((n: object) => setPicked((n as Pt).id))
      .onBackgroundClick(() => setPicked(undefined))
    // Lay most of it out before the first frame so it can be framed at once; reduced motion then holds still.
    g.warmupTicks(still ? 200 : 120)
    if (still) g.cooldownTicks(0)
    else g.cooldownTime(3000)
    // Frame the shown nodes at about 80% of the view. Settling refits only until someone takes the camera.
    const fit = (ms = still ? 0 : 600) => {
      const pts = (g.graphData().nodes as Pt[]).filter(p => p.x !== undefined && !offRef.current.has(groupOf(p))).map(p => ({ x: p.x!, y: p.y ?? 0, z: p.z ?? 0 }))
      const cam = g.camera() as PerspectiveCamera
      // Aspect from the box: cam.aspect lags a resize until the next frame.
      const aspect = el.clientWidth && el.clientHeight ? el.clientWidth / el.clientHeight : cam.aspect
      const pose = framePose(pts, cam.position, cam.fov, aspect, aspect < 1 ? 0.7 : 0.8) // auto-rotate swings the wide side round on tall screens
      if (pose) g.cameraPosition(pose.pos, pose.at, ms)
    }
    fitRef.current = fit
    const settled = () => { if (!touched.current) fit() }
    g.onEngineStop(settled)
    // onEngineStop does not always fire after cooldownTime; refit once it should be done anyway.
    const late = setTimeout(settled, still ? 50 : 3300)
    const controls = g.controls() as { autoRotate?: boolean; autoRotateSpeed?: number; enableDamping?: boolean }
    controls.autoRotate = !still
    controls.autoRotateSpeed = 0.35
    controls.enableDamping = !still
    // Stop the slow turn once someone takes the camera.
    const take = () => { controls.autoRotate = false; touched.current = true }
    el.addEventListener('pointerdown', take)
    el.addEventListener('wheel', take, { passive: true })
    g.graphData({ nodes: graph.nodes.map(n => ({ ...n })), links: graph.edges.map(e => ({ ...e })) })
    fg.current = g
    fit(0)
    // Hidden (list view) reads 0x0; skip it.
    const ro = new ResizeObserver(() => { if (!el.clientWidth) return; g.width(el.clientWidth).height(el.clientHeight); setBoxH(el.clientHeight); if (!pickRef.current && !touched.current) fit(0) })
    ro.observe(el)
    // A hidden VS Code view keeps running; stop drawing there.
    // Each frame, drop a tag whose screen box hits one already kept.
    const byId = new Map((g.graphData().nodes as Pt[]).map(p => [p.id, p]))
    let raf = 0
    const declutter = () => {
      raf = requestAnimationFrame(declutter)
      if (!el.clientWidth) return
      const kept: number[][] = []
      for (const { id, must } of want.current) {
        const t = tags.current.get(id), p = byId.get(id)
        if (!t || !p || p.x === undefined || offRef.current.has(groupOf(p))) continue
        const c = g.graph2ScreenCoords(p.x, p.y ?? 0, p.z ?? 0), w = LABEL_PX * t.userData.aspect
        const b = [c.x - w / 2, c.y, c.x + w / 2, c.y + LABEL_PX + 8]
        t.visible = must || !kept.some(o => b[0] < o[2] && o[0] < b[2] && b[1] < o[3] && o[1] < b[3])
        if (t.visible) kept.push(b)
      }
    }
    raf = requestAnimationFrame(declutter)
    const offShown = vscodeBridge?.onShown(() => (vscodeBridge!.shown ? g.resumeAnimation() : g.pauseAnimation()))
    return () => {
      cancelAnimationFrame(raf); clearTimeout(late); ro.disconnect(); el.removeEventListener('pointerdown', take); el.removeEventListener('wheel', take); offShown?.(); fitRef.current = undefined; touched.current = false
      // Chrome keeps only about 16 WebGL contexts and _destructor does not free its own; give it back now.
      const gl = g.renderer() as WebGLRenderer
      gl.forceContextLoss()
      for (const s of [...sprites.current.values(), ...tags.current.values()]) { s.material.map?.dispose(); s.material.dispose() }
      tex.dispose()
      g._destructor(); fg.current = undefined; sprites.current.clear(); objs.current.clear(); tags.current.clear(); el.replaceChildren()
    }
  }, [graph])

  useEffect(() => {
    const g = fg.current
    if (!g) return
    const shown = (n: Pt) => !off.has(groupOf(n))
    g.nodeVisibility((n: object) => shown(n as Pt))
      .linkVisibility((l: object) => { const { source, target } = l as { source: Pt; target: Pt }; return shown(source) && shown(target) })
    offRef.current = off
    fitRef.current?.()
  }, [off, graph])

  // A pick lights it and its neighbors; the rest fades back.
  useEffect(() => {
    const g = fg.current
    if (!g || !graph) return
    const lit = picked ? new Set([picked, ...neighbors(graph, picked).map(n => n.id)]) : undefined
    for (const [id, s] of sprites.current) {
      s.material.opacity = (!lit || lit.has(id) ? 1 : 0.15) * (s.userData.faded ? FADED : 1)
      s.scale.setScalar(s.userData.size * (id === picked ? 1.6 : 1))
    }
    const end = (v: unknown) => (typeof v === 'object' && v ? (v as Pt).id : v as string)
    g.linkColor((l: object) => {
      const { kind, source, target } = l as { kind: GraphEdge['kind']; source: unknown; target: unknown }
      return edgeColor(kind, !picked || end(source) === picked || end(target) === picked, !!picked)
    })
  }, [picked, graph])

  // Names on the canvas for projects and CLAUDE.md files always, the hovered node, the pick, and its neighbors when there are few enough to read.
  useEffect(() => {
    const g = fg.current, el = box.current
    if (!g || !graph || !el?.clientHeight) return
    const near = picked ? neighbors(graph, picked) : []
    const always = graph.nodes.filter(n => n.kind === 'project' || n.kind === 'rule').map(n => n.id)
    const show = new Set([hover, picked, ...(near.length <= 12 ? near.map(n => n.id) : []), ...always].filter(Boolean) as string[])
    want.current = [...show].map(id => ({ id, must: id === hover || id === picked }))
    const fov = (g.camera() as PerspectiveCamera).fov
    const h = (LABEL_PX / el.clientHeight) * 2 * Math.tan((fov * Math.PI) / 360)
    for (const [id, t] of tags.current) t.visible = show.has(id)
    for (const id of show) {
      const o = objs.current.get(id), n = graph.nodes.find(x => x.id === id), dot = sprites.current.get(id)
      if (!o || !n || !dot) continue
      let t = tags.current.get(id)
      if (!t) { t = nameTag(n.kind === 'rule' ? n.label.replace(/^.*\/([^/]+\/CLAUDE\.md)$/, '$1') : n.label); tags.current.set(id, t); o.add(t) }
      t.visible = true
      t.scale.set(h * t.userData.aspect, h, 1)
      // Hang it just under the dot's bright core.
      t.position.y = -dot.userData.size * 0.22
    }
  }, [picked, hover, graph, view, boxH])

  // The list replaces the canvas; stop drawing while it is hidden. Coming back flies to what the list picked.
  useEffect(() => {
    const g = fg.current
    if (!g) return
    if (view === 'list') g.pauseAnimation()
    else { g.resumeAnimation(); if (picked) fly(picked) }
  }, [view, graph])

  const node = graph?.nodes.find(n => n.id === picked)
  const rel = useMemo(() => {
    if (!graph || !picked) return undefined
    const r = relations(graph, picked), shown = (l: GraphNode[]) => l.filter(n => !off.has(groupOf(n)))
    return { to: shown(r.to), from: shown(r.from), up: shown(r.up), down: shown(r.down), typed: r.typed.map(t => ({ ...t, list: shown(t.list) })) }
  }, [graph, picked, off])
  const hits = useMemo(() => (graph && view === 'graph' ? findNodes(graph.nodes, q, off) : []), [graph, q, off, view])
  const proj = useMemo(() => (graph ? projectOf(graph) : new Map<string, string>()), [graph])
  const rows = useMemo(() => (graph ? listNodes(graph.nodes, q, off, proj).filter(n => !only || only.ids.has(n.id)) : []), [graph, q, off, proj, only])
  const sum = graph && graphCounts(graph)
  const counts = useMemo(() => new Map(GROUPS.map(gr => [gr.id, graph?.nodes.filter(n => groupOf(n) === gr.id).length ?? 0])), [graph])
  const toggle = (id: Group) => {
    // Hiding the pick's kind drops the pick too.
    if (!off.has(id) && node && groupOf(node) === id) setPicked(undefined)
    setOff(o => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  // These buttons unmount once clicked; hand focus to the search instead of body.
  const showAll = (clear = false) => { if (clear) { setQ(''); setOnly(undefined) } setOff(new Set()); findRef.current?.focus() }

  // Fly from where the camera already is, so the turn stays small.
  const fly = (id: string) => {
    setPicked(id)
    const g = fg.current, n = (g?.graphData().nodes as Pt[] | undefined)?.find(p => p.id === id)
    if (!g || !n || n.x === undefined || view === 'list') return
    const controls = g.controls() as { autoRotate?: boolean }
    controls.autoRotate = false
    touched.current = true
    const at = { x: n.x, y: n.y ?? 0, z: n.z ?? 0 }, cam = g.camera().position
    const v = { x: cam.x - at.x, y: cam.y - at.y, z: cam.z - at.z }, r = Math.hypot(v.x, v.y, v.z) || 1
    // Nearer on a small canvas, so neighbors and their names spread out on a phone.
    const el = box.current, d = 200 * Math.min(1, Math.max(0.45, Math.min(el?.clientWidth ?? 700, el?.clientHeight ?? 700) / 700))
    g.cameraPosition({ x: at.x + (v.x / r) * d, y: at.y + (v.y / r) * d, z: at.z + (v.z / r) * d }, at, reduced() ? 0 : 900)
  }

  // / to search; in the graph + / = zoom in, - out, 0 refit. Not while typing. On document: after a canvas click focus sits on body.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const g = fg.current
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as Element).closest?.('input, textarea')) return
      if (e.key === '/') { findRef.current?.focus(); e.preventDefault(); return }
      if (!g || view !== 'graph') return
      const k = ({ '+': 0.8, '=': 0.8, '-': 1.25, _: 1.25 } as Record<string, number>)[e.key]
      if (e.key === '0') fitRef.current?.()
      else if (k) {
        const c = g.controls() as { target: { x: number; y: number; z: number }; autoRotate?: boolean }
        c.autoRotate = false; touched.current = true
        g.cameraPosition(dolly(g.camera().position, c.target, k), c.target, reduced() ? 0 : 200)
      } else return
      e.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [view])

  // The hits list unmounts under the click; focus the dialog, not Close, so the zoom keys work on what was found.
  const found = (id: string) => { fly(id); if (view === 'graph') { setQ(''); dlg.current?.focus() } }
  const sup = (n: GraphNode) => n.superseded ? <em className="mem-sup">superseded</em> : null
  const dot = (n: GraphNode) => <i style={{ background: colorOf(n) }} aria-hidden />
  const linkList = (title: string, list: GraphNode[] | undefined) => list?.length ? (
    <section>
      <h4>{title}<span>{list.length}</span></h4>
      <ul className="mem-near">{list.map(n => <li key={n.id}><button type="button" data-sup={n.superseded ? '' : undefined} onClick={() => fly(n.id)}>{dot(n)}<span>{n.label}</span>{sup(n)}<small>{proj.get(n.id) ?? labelOf(n)}</small></button></li>)}</ul>
    </section>
  ) : null
  const health = graph?.health ? healthParts(graph.health, graph.nodes) : []
  const sets = SETS.map(set => ({ set, groups: GROUPS.filter(gr => gr.set === set && counts.get(gr.id)) })).filter(x => x.groups.length)

  return (
    <dialog ref={dlg} tabIndex={-1} className="hub hub-dark mem" data-view={view} data-picked={node ? '' : undefined} aria-label="Memory"
      onCancel={e => { e.preventDefault(); if (picked) setPicked(undefined); else onClose() }}>
      <div className="mem-rail">
        <header className="mem-head">
          <h2>Memory</h2>
          <p>{sum ? `${sum.notes} notes, ${sum.links} links` : 'Loading'}</p>
        </header>
        <div className="mem-tools">
          <div className="mem-find">
            <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="6" cy="6" r="4.25" /><path d="M9.25 9.25L12.5 12.5" /></svg>
            <input ref={findRef} type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={view === 'list' ? 'Filter the list' : 'Search'} aria-label={view === 'list' ? 'Filter the list' : 'Find in the graph'}
              onKeyDown={e => {
                // Esc clears the search, then leaves it; the view stays open
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (q) setQ(''); else { e.currentTarget.blur(); dlg.current?.focus() } return }
                const first = view === 'list' ? rows[0] : hits[0]; if (e.key === 'Enter' && !e.nativeEvent.isComposing && first) found(first.id)
              }} />
            {hits.length > 0 && <ul className="mem-hits" aria-label="Matches">
              {hits.map(h => <li key={h.id}><button type="button" data-sup={h.superseded ? '' : undefined} onClick={() => found(h.id)}>{dot(h)}<span>{h.label}</span>{sup(h)}<small>{proj.get(h.id) ?? labelOf(h)}</small></button></li>)}
            </ul>}
          </div>
          <div className="mem-view" role="group" aria-label="View">
            <button type="button" aria-pressed={view === 'graph'} onClick={() => setView('graph')}>Graph</button>
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
          </div>
        </div>
        {sets.length > 0 && <div className="mem-filters">
          {sets.map(({ set, groups }) => (
            <section key={set}>
              <h3 id={`mem-set-${set}`}>{set}</h3>
              <div role="group" aria-labelledby={`mem-set-${set}`}>
                {groups.map(gr => (
                  <button key={gr.id} type="button" aria-pressed={!off.has(gr.id)} onClick={() => toggle(gr.id)}>
                    <i style={{ background: gr.color }} aria-hidden /><span>{gr.label}</span><b>{counts.get(gr.id)}</b>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {off.size > 0 && <button type="button" className="mem-all" onClick={() => showAll()}>Show all</button>}
        </div>}
      </div>
      <div className="mem-stage">
        <div ref={box} className="mem-canvas" hidden={view === 'list'} role="img" aria-label={sum ? `Graph of ${sum.notes} notes and ${sum.links} links, grouped round their projects. Use search or the list to open one. Plus and minus zoom, 0 fits.` : 'Loading the memory graph'} />
        {view === 'list' && graph && graph.nodes.length > 0 && (
          <div className="mem-list">
            {health.length > 0 && <p className="mem-health">Health: {health.map((h, i) => <Fragment key={h.text}>{i > 0 && ', '}
              <button type="button" aria-pressed={only?.text === h.text} onClick={() => setOnly(only?.text === h.text ? undefined : { text: h.text, ids: new Set(h.ids) })}>{h.text}</button></Fragment>)}
              {only && <> <button type="button" className="mem-clear" onClick={() => setOnly(undefined)}>Show all</button></>}</p>}
            {GROUPS.map(gr => ({ gr, items: rows.filter(n => groupOf(n) === gr.id) })).filter(x => x.items.length).map(({ gr, items }) => (
              <section key={gr.id}>
                <h3><i style={{ background: gr.color }} aria-hidden />{gr.label}<span>{items.length}</span></h3>
                <ul>{items.map(n => (
                  <li key={n.id}><button type="button" data-sup={n.superseded ? '' : undefined} aria-pressed={n.id === picked} onClick={() => setPicked(n.id === picked ? undefined : n.id)}>
                    <span>{n.label}{sup(n)}</span>{(proj.get(n.id) || n.description) && <small>{[proj.get(n.id), n.description].filter(Boolean).join(': ')}</small>}
                  </button></li>
                ))}</ul>
              </section>
            ))}
            {!rows.length && <div className="mem-state"><h3>Nothing matches</h3><p>{q ? `No item has "${q.trim()}" in its name or description.` : only ? `No shown item is in "${only.text}".` : 'Every kind is hidden.'}</p>
              <button type="button" className="hub-btn" onClick={() => showAll(true)}>Clear filters</button></div>}
          </div>
        )}
        {!graph && <div className="mem-state" role="status">{problem
          ? <><h3>Could not load the graph</h3><p>{problem}</p></>
          : <><span className="hub-spin" aria-hidden /><p>Reading memory files</p></>}</div>}
        {graph && !graph.nodes.length && <div className="mem-state" role="status"><h3>No memories yet</h3><p>Claude writes them under ~/.claude/projects as chats go. They show up here on their own.</p></div>}
      </div>
      {node && (
        <aside className="mem-side" aria-label={node.label}>
          <div className="mem-side-h">
            <div>
              <h3>{node.label}</h3>
              <p>{dot(node)}{labelOf(node)}{proj.get(node.id) && <> in {proj.get(node.id)}</>}{sup(node)}</p>
            </div>
            <button type="button" className="hub-btn icon" aria-label="Close details" onClick={() => setPicked(undefined)}>
              <svg aria-hidden width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8" /></svg>
            </button>
          </div>
          {node.description && <p className="mem-desc">{node.description}</p>}
          {node.text && node.text !== node.label && <pre className="mem-text">{node.text}</pre>}
          {node.missing?.length ? (
            <section>
              <h4>Broken links<span>{new Set(node.missing).size}</span></h4>
              <p className="mem-missing">{[...new Set(node.missing)].map(m => <code key={m}>{m}</code>)}</p>
            </section>
          ) : null}
          {linkList('Links to', rel?.to)}
          {linkList('Linked from', rel?.from)}
          {rel?.typed.map(t => <Fragment key={t.title}>{linkList(t.title, t.list)}</Fragment>)}
          {linkList('Belongs to', rel?.up)}
          {linkList('Contains', rel?.down)}
        </aside>
      )}
    </dialog>
  )
}
