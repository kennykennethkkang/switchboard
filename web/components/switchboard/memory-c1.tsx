'use client'

/** Memory map: each project a glowing cluster of its notes, one arc per pair of projects that link. A pick glides to the
 * note and dims the rest. The render loop runs only on input or a glide. Notebook is the second tab. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph'
import { AdditiveBlending, BufferGeometry, CanvasTexture, Float32BufferAttribute, Fog, Group as Obj, LinearFilter, Object3D, Points, PointsMaterial, Sprite, SpriteMaterial, type PerspectiveCamera, type WebGLRenderer } from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { GROUPS, bareProjects, dolly, framePose, groupOf, neighbors, type GraphEdge, type GraphNode, type P3 } from '@/lib/memory-graph'
import { vscodeBridge } from '@/lib/vscode-bridge'
import { MemoryNotebook } from './memory-notebook'
import { Loading, NoteReader, Search, Shell, TONE, flagsOf, homes, isNote, matches, shortLabel, toneOf, useGraph, type ViewProps } from './memory-kit'
import './memory-notebook.css'
import './memory-maps.css'
import './memory-c1.css'

type Pt = GraphNode & { x?: number; y?: number; z?: number; vx?: number; vy?: number; vz?: number; fx?: number; fy?: number; fz?: number }
type L = { source: unknown; target: unknown; kind: GraphEdge['kind'] }
type Rgb = [number, number, number]
// Relation hues; the stage is always dark, so fixed values.
const TINT: Partial<Record<GraphEdge['kind'], Rgb>> = { link: [0.7, 0.58, 1], related: [0.7, 0.58, 1], contradicts: [1, 0.38, 0.38], supersedes: [1, 0.77, 0.2], 'depends-on': [0.34, 0.76, 1], 'part-of': [0.34, 0.76, 1] }
// Group colors for WebGL, which cannot read var().
const HEX = new Map(GROUPS.map(g => [g.id, g.color]))
const HALO = ['#8b78ff', '#3fa9ff', '#2fd0c0', '#ff7ab3', '#ffb44a', '#59d499', '#c58bff', '#ff8a5c']
const PLACE_HUE: Record<string, string> = { 'Vault wiki': '#9be564', Shared: '#8e96bd' }
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
const end = (v: unknown) => (typeof v === 'object' && v ? (v as Pt).id : (v as string))
// Layouts by graph, so reopening the map skips the simulation.
const LAYOUT = new Map<string, Map<string, P3>>()
// The intro orbit stops for good once someone takes the camera.
let orbitDone = false

// Quadratic curve a to b through control c.
const bez = (a: P3, c: P3, b: P3, t: number): P3 => bezTo({ x: 0, y: 0, z: 0 }, a, c, b, t)
// Same, written into o; per-frame callers pass a scratch point.
const bezTo = (o: P3, a: P3, c: P3, b: P3, t: number): P3 => {
  const u = 1 - t
  o.x = u * u * a.x + 2 * u * t * c.x + t * t * b.x; o.y = u * u * a.y + 2 * u * t * c.y + t * t * b.y; o.z = u * u * a.z + 2 * u * t * c.z + t * t * b.z
  return o
}
const tmp: P3 = { x: 0, y: 0, z: 0 }
// Control point off the midpoint, square to the line, k of its length to one side.
const bendOf = (a: P3, b: P3, k: number, side = 1): P3 => {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy, b.z - a.z) || 1
  let px = -dy, py = dx, pl = Math.hypot(px, py)
  if (pl < len * 0.05) { px = 0; py = 1; pl = 1 }
  const s = (side * k * len) / pl
  return { x: (a.x + b.x) / 2 + px * s, y: (a.y + b.y) / 2 + py * s, z: (a.z + b.z) / 2 }
}
const curve = (a: P3, c: P3, b: P3, n: number) => {
  const out: number[] = []
  let p = a
  for (let i = 1; i <= n; i++) { const q = bez(a, c, b, i / n); out.push(p.x, p.y, p.z, q.x, q.y, q.z); p = q }
  return out
}
// Two short strokes pointing at the curve's target end.
const arrow = (a: P3, c: P3, b: P3) => {
  const t = 0.8, p = bez(a, c, b, t)
  const d = { x: 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x), y: 2 * (1 - t) * (c.y - a.y) + 2 * t * (b.y - c.y), z: 2 * (1 - t) * (c.z - a.z) + 2 * t * (b.z - c.z) }
  const dl = Math.hypot(d.x, d.y, d.z) || 1, m = { x: c.x - (a.x + b.x) / 2, y: c.y - (a.y + b.y) / 2, z: c.z - (a.z + b.z) / 2 }, ml = Math.hypot(m.x, m.y, m.z) || 1
  const L = Math.min(6, (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1) * 0.08)
  const wing = (s: number) => [p.x - (d.x / dl) * L + (m.x / ml) * L * 0.6 * s, p.y - (d.y / dl) * L + (m.y / ml) * L * 0.6 * s, p.z - (d.z / dl) * L + (m.z / ml) * L * 0.6 * s, p.x, p.y, p.z]
  return [...wing(1), ...wing(-1)]
}

function glow(stops: [number, string][]) {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const x = c.getContext('2d')!, g = x.createRadialGradient(64, 64, 0, 64, 64, 64)
  for (const [at, col] of stops) g.addColorStop(at, col)
  x.fillStyle = g; x.fillRect(0, 0, 128, 128)
  return new CanvasTexture(c)
}

// The "!" badge on notes that need a look, a fixed size on screen so it shows at any zoom.
function bangTex() {
  const c = document.createElement('canvas'), x = c.getContext('2d')!
  c.width = c.height = 64
  x.fillStyle = '#e0525c'; x.strokeStyle = '#05060d'; x.lineWidth = 6
  x.beginPath(); x.arc(32, 32, 27, 0, Math.PI * 2); x.fill(); x.stroke()
  x.fillStyle = '#fff'; x.font = '800 38px ui-sans-serif, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'
  x.fillText('!', 32, 34)
  return new CanvasTexture(c)
}

// A screen-sized name: notes get a dark glass chip under the dot, places a glowing title above their halo.
function nameTag(text: string, big: boolean, hue = '#9aa4ff', sub = ''): Sprite {
  const t = text.length > 34 ? `${text.slice(0, 33)}…` : text
  const c = document.createElement('canvas'), x = c.getContext('2d')!
  const font = big ? '600 30px "Hanken Grotesk", ui-sans-serif, system-ui, sans-serif' : '500 24px "Hanken Grotesk", ui-sans-serif, system-ui, sans-serif'
  x.font = font
  const pad = big ? 22 : 13, subFont = '500 21px "Hanken Grotesk", ui-sans-serif, system-ui, sans-serif'
  const tw = x.measureText(t).width
  x.font = subFont
  c.width = Math.ceil(Math.max(tw, sub ? x.measureText(sub).width : 0)) + pad * 2; c.height = big ? (sub ? 86 : 56) : 40
  x.font = font; x.textBaseline = 'middle'
  if (big) {
    x.shadowColor = `${hue}59`; x.shadowBlur = 10
    const y = sub ? 28 : c.height / 2
    x.fillStyle = '#c3c8d8'; x.fillText(t, pad, y)
    x.shadowColor = 'rgba(0,0,0,0.8)'; x.shadowBlur = 4; x.fillText(t, pad, y)
    if (sub) { x.font = subFont; x.fillStyle = '#8a91aa'; x.fillText(sub, pad, 64) }
  } else {
    x.fillStyle = 'rgba(8,10,20,0.8)'; x.strokeStyle = 'rgba(255,255,255,0.1)'; x.lineWidth = 2
    x.beginPath(); x.roundRect(1, 1, c.width - 2, c.height - 2, 9); x.fill(); x.stroke()
    x.fillStyle = '#c4c8d6'; x.fillText(t, pad, c.height / 2 + 1)
  }
  const map = new CanvasTexture(c)
  map.generateMipmaps = false; map.minFilter = LinearFilter
  const s = new Sprite(new SpriteMaterial({ map, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true }))
  s.center.set(0.5, big ? 0 : 1)
  s.renderOrder = 10
  s.userData = { aspect: c.width / c.height, px: big ? (sub ? 37 : 24) : 20, up: big }
  return s
}

// Taps hit only what is drawn (see memory.tsx): hidden sprites skip, a dot keeps only its disc.
function hitShown(s: Sprite, disc = 0) {
  s.raycast = function (rc, hits) {
    for (let o: Object3D | null = this; o; o = o.parent) if (!o.visible) return
    const n = hits.length
    Sprite.prototype.raycast.call(this, rc, hits)
    const uv = hits[n]?.uv
    if (disc && uv && Math.hypot(uv.x - 0.5, uv.y - 0.5) > disc) hits.length = n
  }
}
const noHit = (o: Object3D) => { o.raycast = () => {} }

type Api = { wake: (ms?: number) => void; restyle: (lit: Set<string> | undefined, picked: string | undefined, hover: string | undefined, issues: boolean) => void; retag: () => void }

export function MemoryC1(p: ViewProps) {
  const [tab, setTab] = useState<'map' | 'book'>('map')
  const sw = (
    <div className="mm-switch" role="group" aria-label="View">
      {(['map', 'book'] as const).map(t => <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>{t === 'map' ? 'Map' : 'Notebook'}</button>)}
    </div>
  )
  return tab === 'book' ? <MemoryNotebook {...p} top={sw} /> : <Space {...p} top={sw} />
}

function Space({ isDemo, onClose, top }: ViewProps & { top: ReactNode }) {
  const { graph, problem } = useGraph(isDemo)
  const box = useRef<HTMLDivElement>(null), findRef = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const [issues, setIssues] = useState(false)
  const [picked, setPicked] = useState<string>()
  const [hover, setHover] = useState<string>()
  const [boxH, setBoxH] = useState(0)
  const fg = useRef<ForceGraph3DInstance>(undefined)
  const api = useRef<Api>(undefined)
  const objs = useRef(new Map<string, Obj>()), dots = useRef(new Map<string, Sprite>()), tags = useRef(new Map<string, Sprite>())
  const want = useRef<{ id: string; must: boolean }[]>([])
  const fitRef = useRef<(ms?: number) => void>(undefined)
  // Once someone takes the camera, settling and resizes stop refitting.
  const touched = useRef(false)

  const d = useMemo(() => {
    if (!graph) return
    const { home, order } = homes(graph)
    const nodes = graph.nodes.filter(n => isNote(n) || n.kind === 'project'), ids = new Set(nodes.map(n => n.id))
    const edges = graph.edges.filter(e => (TINT[e.kind] || e.kind === 'in') && e.source !== e.target && ids.has(e.source) && ids.has(e.target))
    const deg = new Map<string, number>()
    for (const e of edges) if (TINT[e.kind]) for (const id of [e.source, e.target]) deg.set(id, (deg.get(id) ?? 0) + 1)
    const flags = flagsOf(graph)
    const notes = nodes.filter(isNote)
    const bad = new Set([...flags].filter(([id, l]) => ids.has(id) && l.some(f => f.bad)).map(([id]) => id))
    // Places: each project, the vault wiki and Shared, laid out as a sunflower with the biggest in the middle.
    const place = new Map(nodes.map(n => [n.id, n.kind === 'project' ? n.label : home(n)]))
    const count = new Map<string, number>()
    for (const k of place.values()) count.set(k, (count.get(k) ?? 0) + 1)
    const keys = order.filter(k => count.has(k)).sort((a, b) => count.get(b)! - count.get(a)!)
    const spread = (k: string) => 26 + 12 * Math.sqrt(count.get(k)!)
    const step = (2 * Math.max(...keys.map(spread)) + 70) / 1.7
    const anchor = new Map(keys.map((k, i) => {
      const r = keys.length < 2 ? 0 : step * Math.sqrt(i + 0.3), a = i * Math.PI * (3 - Math.sqrt(5))
      return [k, { x: r * Math.cos(a), y: r * Math.sin(a), z: ((i % 3) - 1) * 40 }] as const
    }))
    const hue = new Map(keys.map((k, i) => [k, PLACE_HUE[k] ?? HALO[i % HALO.length]]))
    const sig = `${nodes.map(n => n.id).join('|')}#${edges.map(e => e.source + e.kind + e.target).join('|')}`
    const sub = { ...graph, nodes, edges }
    return { home, nodes, notes, edges, deg, flags, bad, sub, place, anchor, hue, sig, byId: new Map(nodes.map(n => [n.id, n])), flagged: new Set([...flags.keys()].filter(id => ids.has(id))) }
  }, [graph])

  // One scene per graph; picks and toggles only restyle it.
  useEffect(() => {
    const el = box.current
    if (!d || !el) return
    const still = reduced()
    const small = matchMedia('(pointer: coarse)').matches || el.clientWidth <= 760
    const maxTags = small ? 8 : 15
    // Portrait screens get a taller layout.
    const tall = el.clientWidth < el.clientHeight
    const anchor = new Map([...d.anchor].map(([k, a]) => [k, { ...a, y: a.y * (tall ? 1.5 : 0.8) }]))
    const dotTex = glow([[0, 'rgba(255,255,255,1)'], [0.13, 'rgba(255,255,255,0.95)'], [0.19, 'rgba(255,255,255,0.3)'], [0.3, 'rgba(255,255,255,0.07)'], [0.5, 'rgba(255,255,255,0)']])
    const haloTex = glow([[0, 'rgba(255,255,255,0.3)'], [0.35, 'rgba(255,255,255,0.1)'], [0.7, 'rgba(255,255,255,0.025)'], [1, 'rgba(255,255,255,0)']])
    const ringTex = glow([[0, 'rgba(255,255,255,0)'], [0.4, 'rgba(255,255,255,0)'], [0.46, 'rgba(255,255,255,0.55)'], [0.5, 'rgba(255,255,255,0)']])
    const bang = bangTex()
    const sizeOf = (n: GraphNode) => n.kind === 'project' ? 16 : 12 + Math.min(16, Math.sqrt(d.deg.get(n.id) ?? 0) * 5)
    const g = new ForceGraph3D(el, { controlType: 'orbit', rendererConfig: { antialias: !small, alpha: true, powerPreference: 'high-performance' } })
      .backgroundColor('rgba(0,0,0,0)')
      .showNavInfo(false)
      .nodeId('id').linkSource('source').linkTarget('target')
      .nodeThreeObject((n: object) => {
        const node = n as Pt, size = sizeOf(node)
        const color = node.kind === 'project' ? d.hue.get(node.label)! : HEX.get(groupOf(node))!
        const s = new Sprite(new SpriteMaterial({ map: dotTex, color, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: node.superseded ? 0.3 : 0.85 }))
        hitShown(s, 0.26)
        s.scale.setScalar(size)
        s.userData = { size, faded: !!node.superseded }
        dots.current.set(node.id, s)
        const o = new Obj()
        o.add(s)
        if (d.bad.has(node.id)) {
          const b = new Sprite(new SpriteMaterial({ map: bang, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true }))
          b.center.set(-0.1, -0.1); b.renderOrder = 9; noHit(b)
          o.add(b); s.userData.bang = b
        }
        objs.current.set(node.id, o)
        return o
      })
      .linkVisibility(false)
      .onNodeHover((n: object | null) => { setHover(n ? (n as Pt).id : undefined); el.style.cursor = n ? 'pointer' : '' })
      .enableNodeDrag(false)
      .onNodeClick((n: object) => fly((n as Pt).id))
      .onBackgroundClick((ev: MouseEvent) => {
        // A place name opens its project.
        const r = el.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top
        const hit = placeBoxes.find(({ b }) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3])
        const pid = hit && d.nodes.find(n => n.kind === 'project' && n.label === hit.k)?.id
        if (pid) fly(pid); else setPicked(undefined)
      })
    const gl = g.renderer() as WebGLRenderer
    gl.setPixelRatio(Math.min(small ? 1.5 : 2, devicePixelRatio || 1))
    g.width(el.clientWidth).height(el.clientHeight)
    const cam = g.camera() as PerspectiveCamera
    cam.far = 40000; cam.updateProjectionMatrix()
    const scene = g.scene()
    const fog = new Fog('#05060d', 400, 1600)
    ;(scene as unknown as { fog: Fog }).fog = fog

    // Layout: each note pulled to its place's anchor, links inside a place short, links across long and weak.
    const sig = d.sig + (tall ? '|tall' : ''), cached = LAYOUT.get(sig)
    let pulled: Pt[] = []
    const pull = Object.assign((alpha: number) => {
      for (const n of pulled) {
        const a = anchor.get(d.place.get(n.id)!)
        if (!a || n.x === undefined) continue
        n.vx! += (a.x - n.x) * 0.1 * alpha; n.vy! += (a.y - n.y!) * 0.1 * alpha; n.vz! += (a.z - n.z!) * 0.1 * alpha
      }
    }, { initialize: (ns: Pt[]) => { pulled = ns } })
    const same = (l: L) => d.place.get(end(l.source)) === d.place.get(end(l.target))
    g.d3Force('cluster', pull as never)
    g.d3Force('center', null)
    ;(g.d3Force('link') as unknown as { distance(f: (l: L) => number): { strength(f: (l: L) => number): unknown } })
      .distance(l => (same(l) ? 30 : 160)).strength(l => (same(l) ? (l.kind === 'in' ? 0.5 : 0.3) : 0.015))
    ;(g.d3Force('charge') as unknown as { strength(n: number): { distanceMax(n: number): unknown } }).strength(-40).distanceMax(140)
    g.warmupTicks(cached ? 0 : 140).cooldownTicks(0)

    // Stars on a far shell, fewer on phones; fog skips them.
    const N = small ? 400 : 1000, pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 2500 + Math.random() * 3500, s = Math.sqrt(1 - u * u)
      pos.set([r * s * Math.cos(a), r * u, r * s * Math.sin(a)], i * 3)
    }
    const starGeo = new BufferGeometry()
    starGeo.setAttribute('position', new Float32BufferAttribute(pos, 3))
    const starMat = new PointsMaterial({ color: '#aeb8dc', size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.3, fog: false, depthWrite: false })
    const stars = new Points(starGeo, starMat)
    noHit(stars); scene.add(stars)

    // Opaque so the joints of a curve do not double up. Colors are linear, so dark values come out brighter on screen.
    // Links, thin and tinted by relation. At rest: short links inside places (not in a scene)
    // plus one arc per pair of places in three widths. The hovered or picked note's own links curve on top.
    const lineMat = (w: number) => new LineMaterial({ vertexColors: true, linewidth: w, worldUnits: false })
    const ARC_W = [1, 1.6, 2.4], SEG = 6 // segments per short link
    const mats = [lineMat(1.1), lineMat(1.6), ...ARC_W.map(lineMat)]
    const restGeo = new LineSegmentsGeometry(), hotGeo = new LineSegmentsGeometry(), arcGeos = ARC_W.map(() => new LineSegmentsGeometry())
    const lines = [new LineSegments2(restGeo, mats[0]), new LineSegments2(hotGeo, mats[1]), ...arcGeos.map((x, i) => new LineSegments2(x, mats[2 + i]))]
    for (const l of lines) { noHit(l); l.visible = false; l.renderOrder = -1; scene.add(l) }
    const flowGeo = new BufferGeometry()
    const flowMat = new PointsMaterial({ map: dotTex, size: 6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false })
    const flow = new Points(flowGeo, flowMat)
    noHit(flow); flow.visible = false; scene.add(flow)
    type Edge = { a: Pt; b: Pt; c: Rgb; far: boolean; kind: GraphEdge['kind'] }
    let drawn: Edge[] = [], rest: Edge[] = [], hot: (Edge & { ctl: P3 })[] = []
    const arcs: { pts: P3[]; tag: Sprite }[] = []

    const controls = g.controls() as unknown as { enableDamping: boolean; autoRotate: boolean; autoRotateSpeed: number; target: P3 }
    controls.enableDamping = !still
    controls.autoRotateSpeed = 0.3
    controls.autoRotate = !still && !orbitDone && !small && matchMedia('(pointer: fine)').matches
    const endOrbit = setTimeout(() => { controls.autoRotate = false }, 30000)
    touched.current = false

    // A project with chats but no notes would be an empty halo; it stays out of the map and the fit.
    const bare = bareProjects(d.nodes, d.place), keep = (e: GraphEdge) => !bare.has(e.source) && !bare.has(e.target)
    const nodes = d.nodes.filter(n => !bare.has(n.id)).map(n => {
      const c = cached?.get(n.id), a = n.kind === 'project' ? anchor.get(n.label) : undefined
      return { ...n, ...c, ...(a && { x: a.x, y: a.y, z: a.z, fx: a.x, fy: a.y, fz: a.z }) } as Pt
    })
    g.graphData({ nodes, links: d.edges.filter(keep).map(e => ({ ...e })) })
    fg.current = g
    const byId = new Map(nodes.map(p => [p.id, p]))

    // Render loop on demand: the library's loop runs only while the camera moves, a glide or flow plays, or a pointer is down.
    let awake = true, quiet = 0, last = [0, 0, 0, 0, 0, 0], until = performance.now() + 800, raf = 0, down = false, dirty = true, shown = true
    const wake = (ms = 120) => {
      until = Math.max(until, performance.now() + ms)
      if (!awake && shown) { awake = true; quiet = 0; g.resumeAnimation(); raf = requestAnimationFrame(tick) }
    }
    const tick = (t: number) => {
      const c = cam.position, tg = controls.target
      // Damping creeps for seconds; under a 1/2000 of the view distance counts as still.
      const now = [c.x, c.y, c.z, tg.x, tg.y, tg.z], dist = Math.hypot(c.x - tg.x, c.y - tg.y, c.z - tg.z)
      const moved = now.some((v, i) => Math.abs(v - last[i]) > dist / 2000)
      if (moved) { last = now; fog.near = dist * 0.9; fog.far = dist * 3.2 }
      if ((moved || dirty) && layoutTags()) quiet = 0
      dirty = false
      if (flow.visible && !still) moveFlow(t)
      if (moved || down || t < until || controls.autoRotate) quiet = 0
      else if (++quiet > 6) { awake = false; g.pauseAnimation(); return }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    // Touch drags draw every other frame, 30 fps, to spare phone GPUs; controls still update each frame.
    if (matchMedia('(pointer: coarse)').matches) {
      const draw = gl.render.bind(gl)
      let lastR = 0
      gl.render = (s, c) => {
        const t = performance.now()
        if (down && t - lastR < 30) return
        lastR = t; draw(s, c)
      }
    }

    const fit =(ms = still ? 0 : 700) => {
      const pts = [...nodes.filter(p => p.x !== undefined).map(p => ({ x: p.x!, y: p.y ?? 0, z: p.z ?? 0 })), ...places.map(pl => pl.at), ...rims]
      const aspect = el.clientWidth && el.clientHeight ? el.clientWidth / el.clientHeight : cam.aspect
      const pose = framePose(pts, cam.position, cam.fov, aspect, aspect < 1 ? 0.76 : 0.84)
      if (!pose) return
      g.cameraPosition(pose.pos, pose.at, ms)
      wake(ms + 150)
    }
    fitRef.current = fit

    // Halos round each place, with its name above; built once the layout is in, along with the link batch.
    const places: { id: string; s: Sprite; at: P3 }[] = [], extras: Sprite[] = [], rims: P3[] = []
    let built = false
    const build = () => {
      if (built || !nodes.every(p => p.x !== undefined)) return
      built = true
      LAYOUT.set(sig, new Map(nodes.map(p => [p.id, { x: p.x!, y: p.y!, z: p.z! }])))
      const members = new Map<string, Pt[]>(), radius = new Map<string, number>()
      for (const p of nodes) { const k = d.place.get(p.id)!; members.set(k, [...(members.get(k) ?? []), p]) }
      for (const [k, list] of members) {
        const a = anchor.get(k)!, hue = d.hue.get(k)!
        // 90th percentile, so one stray note does not blow the halo up and float the name off it.
        const ds = list.map(p => Math.hypot(p.x! - a.x, p.y! - a.y, p.z! - a.z)).sort((x, y) => x - y)
        const far = Math.max(40, ds[Math.floor(0.9 * (ds.length - 1))] ?? 0)
        radius.set(k, far)
        // The glow reaches 1.3x; fit keeps all of it on screen.
        rims.push({ x: a.x, y: a.y - far * 1.3, z: a.z }, { x: a.x - far * 1.3, y: a.y, z: a.z }, { x: a.x + far * 1.3, y: a.y, z: a.z })
        const h = new Sprite(new SpriteMaterial({ map: haloTex, color: hue, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.22 }))
        h.position.set(a.x, a.y, a.z); h.scale.setScalar(far * 2.6); h.renderOrder = -2; noHit(h)
        const r = new Sprite(new SpriteMaterial({ map: ringTex, color: hue, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.14 }))
        // The ring texture peaks at 0.23 of its width, so 4.8x puts it at 1.1x, just round the notes.
        r.position.copy(h.position); r.scale.setScalar(far * 4.8); r.renderOrder = -2; noHit(r)
        const tag = nameTag(k, true, hue)
        tag.position.set(a.x, a.y + far * 1.15, a.z); noHit(tag)
        scene.add(h, r, tag); extras.push(h, r, tag)
        places.push({ id: `h:${k}`, s: tag, at: { x: tag.position.x, y: tag.position.y, z: tag.position.z } })
      }
      drawn = d.edges.filter(e => TINT[e.kind] && keep(e)).map(e => ({ a: byId.get(e.source)!, b: byId.get(e.target)!, c: TINT[e.kind]!, far: d.place.get(e.source) !== d.place.get(e.target), kind: e.kind }))
      const near = drawn.filter(e => !e.far)
      // Short links inside a place stay; the long ones bundle into arcs.
      rest = near.filter(e => Math.hypot(e.a.x! - e.b.x!, e.a.y! - e.b.y!, e.a.z! - e.b.z!) < radius.get(d.place.get(e.a.id)!)! * 0.8)
      if (rest.length) {
        restGeo.setPositions(rest.flatMap(({ a, b }) => curve(a as P3, bendOf(a as P3, b as P3, 0.08), b as P3, SEG)))
        lines[0].visible = true
      }
      {
        // One arc per pair of places, from halo edge to halo edge, bowed outward; width by how many links it stands for.
        const pairs = new Map<string, number>()
        for (const e of drawn) if (e.far) {
          const k = [d.place.get(e.a.id)!, d.place.get(e.b.id)!].sort().join('\n')
          pairs.set(k, (pairs.get(k) ?? 0) + 1)
        }
        const most = Math.max(1, ...pairs.values()), segs: number[][] = ARC_W.map(() => [])
        for (const [k, n] of pairs) {
          const [pa, pb] = k.split('\n') as [string, string], A = anchor.get(pa)!, B = anchor.get(pb)!
          const len = Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z) || 1
          const edge = (P: P3, Q: P3, r: number) => { const f = Math.min(0.4, (r * 0.6) / len); return { x: P.x + (Q.x - P.x) * f, y: P.y + (Q.y - P.y) * f, z: P.z + (Q.z - P.z) * f } }
          const s = edge(A, B, radius.get(pa)!), e = edge(B, A, radius.get(pb)!), mid = { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 }
          let c = bendOf(s, e, 0.18)
          if ((c.x - mid.x) * mid.x + (c.y - mid.y) * mid.y < 0) c = bendOf(s, e, 0.18, -1)
          c.z += len * 0.08
          segs[n / most > 0.66 ? 2 : n / most > 0.33 ? 1 : 0]!.push(...curve(s, c, e, 16))
          const tag = nameTag(`${n} link${n > 1 ? 's' : ''}`, false), m = bez(s, c, e, 0.5)
          tag.position.set(m.x, m.y, m.z); tag.visible = false; noHit(tag); scene.add(tag)
          arcs.push({ pts: Array.from({ length: 9 }, (_, i) => bez(s, c, e, i / 8)), tag })
        }
        segs.forEach((sg, i) => {
          if (!sg.length) return
          arcGeos[i]!.setPositions(sg)
          arcGeos[i]!.setColors(sg.map((_, j) => [0.045, 0.05, 0.085][j % 3]!))
          lines[2 + i]!.visible = true
        })
      }
      sizeScreen()
      api.current?.restyle(curLit, curPicked, curHover, curIssues)
      if (!touched.current) fit(cached ? 0 : undefined)
    }
    g.onEngineStop(build)
    const late = setTimeout(build, 60)
    fit(0)

    // Screen-sized bits follow the canvas size.
    const sizeScreen = () => {
      const w = el.clientWidth, h = el.clientHeight
      if (!h) return
      for (const m of mats) m.resolution.set(w, h)
      const unit = (2 * Math.tan((cam.fov * Math.PI) / 360)) / h
      // Badges stay small until hovered, picked or asked for with Needs a look.
      for (const s of dots.current.values()) { const b = s.userData.bang as Sprite | undefined; b?.scale.setScalar(unit * (b.userData.big ? 14 : small ? 10 : 11)) }
      for (const s of [...places.map(pl => pl.s), ...arcs.map(a => a.tag)]) s.scale.set(unit * s.userData.px * s.userData.aspect, unit * s.userData.px, 1)
    }

    // Names whose screen boxes clash drop: place names first, then the hovered and picked note.
    let was = new Set<string>()
    let placeBoxes: { k: string; b: number[] }[] = []
    // Name spots as sprite centers: above the head, higher, higher still, then off to either side.
    const SLOTS = [[0.5, 0], [0.5, -1], [0.5, -2], [0, 0], [1, 0]] as const
    const layoutTags = () => {
      if (!built) return false
      const kept: number[][] = [], now = new Set<string>()
      const box = (x: number, y: number, s: Sprite) => {
        const px = s.userData.px as number, tw = px * s.userData.aspect
        return s.userData.up ? [x - tw / 2 - 4, y - px - 10, x + tw / 2 + 4, y] : [x - tw / 2 - 6, y, x + tw / 2 + 6, y + px + 12]
      }
      const clash = (b: number[]) => kept.some(o => b[0] < o[2] && o[0] < b[2] && b[1] < o[3] && o[1] < b[3])
      let changed = false
      // A clashing place name slides up or sideways, kept on the canvas; it drops only when no spot is free.
      const W = el.clientWidth
      placeBoxes = []
      for (const pl of places) {
        const c = g.graph2ScreenCoords(pl.at.x, pl.at.y, pl.at.z), px = pl.s.userData.px as number, tw = px * pl.s.userData.aspect
        let on = false
        for (const [cx, cy] of SLOTS) {
          const x0 = Math.min(Math.max(c.x - cx * tw, 4), W - tw - 4), bottom = c.y + cy * px
          const b = [x0 - 4, bottom - px - 10, x0 + tw + 4, bottom]
          if (b[1]! < 0 || clash(b)) continue
          const ncx = (c.x - x0) / tw
          if (pl.s.center.x !== ncx || pl.s.center.y !== cy) { pl.s.center.set(ncx, cy); changed = true }
          kept.push(b); placeBoxes.push({ k: pl.id.slice(2), b }); on = true
          break
        }
        if (pl.s.visible !== on) { pl.s.visible = on; changed = true }
      }
      const order = [...want.current].sort((a, b) => Number(b.must) - Number(a.must) || Number(was.has(b.id)) - Number(was.has(a.id)))
      for (const { id, must } of order) {
        const tg = tags.current.get(id), n = byId.get(id)
        if (!tg || !n || n.x === undefined) continue
        const c = g.graph2ScreenCoords(n.x, n.y ?? 0, n.z ?? 0), b = box(c.x, c.y, tg)
        const on = (must || !clash(b)) && now.size < maxTags
        if (tg.visible !== on) { tg.visible = on; changed = true }
        if (on) { kept.push(b); now.add(id) }
      }
      was = now
      return changed
    }

    // Dots flow along picked links, source to target.
    const moveFlow = (t: number) => {
      const arr = flowGeo.getAttribute('position') as Float32BufferAttribute
      hot.forEach(({ a, b, ctl }, j) => {
        for (let k = 0; k < 3; k++) {
          const p = bezTo(tmp, a as P3, ctl, b as P3, (t / 1600 + k / 3) % 1)
          arr.setXYZ(j * 3 + k, p.x, p.y, p.z)
        }
      })
      arr.needsUpdate = true
    }

    let curLit: Set<string> | undefined, curPicked: string | undefined, curHover: string | undefined, curIssues = false
    const restyle = (lit: Set<string> | undefined, pick: string | undefined, hov: string | undefined, issues: boolean) => {
      curLit = lit; curPicked = pick; curHover = hov; curIssues = issues
      for (const [id, s] of dots.current) {
        const k = (!lit || lit.has(id) ? 0.85 : 0.11) * (s.userData.faded ? 0.35 : 1)
        s.material.opacity = k
        s.scale.setScalar(s.userData.size * (id === pick ? 1.6 : 1))
        const b = s.userData.bang as Sprite | undefined
        if (b) { b.userData.big = issues || id === hov || id === pick; b.material.opacity = (!lit || lit.has(id) ? 1 : 0.3) * (b.userData.big ? 1 : 0.5) }
      }
      for (const [i, x] of extras.entries()) x.material.opacity = i % 3 === 2 ? (lit ? 0.5 : 1) : (i % 3 ? 0.14 : 0.22) * (lit ? 0.4 : 1)
      if (!built) return
      sizeScreen()
      if (rest.length) restGeo.setColors(rest.flatMap(e => {
        const k = !lit ? 0.07 : !pick && lit.has(e.a.id) && lit.has(e.b.id) ? 0.2 : 0.02
        const c = e.c.map(v => v * k)
        return Array.from({ length: SEG * 2 }, () => c).flat()
      }))
      // Opaque lines dimmed to near black would streak over the glows, so a pick hides the rest batch.
      lines[0].visible = rest.length > 0 && !pick
      for (let i = 0; i < ARC_W.length; i++) mats[2 + i]!.color.setScalar(lit ? 0.15 : 1)
      if (lit) for (const a of arcs) a.tag.visible = false
      // The hovered and picked notes' own links, curved and fanned out so they do not stack.
      const focus = [pick, hov].filter(Boolean)
      hot = drawn.filter(e => focus.includes(e.a.id) || focus.includes(e.b.id)).map((e, i) => ({ ...e, ctl: bendOf(e.a as P3, e.b as P3, Math.min(0.3, 0.12 + 0.05 * (i >> 1)), i % 2 ? 1 : -1) }))
      lines[1].visible = hot.length > 0
      flow.visible = !!pick && hot.length > 0 && !still
      if (hot.length) {
        const pos: number[] = [], col: number[] = []
        for (const e of hot) {
          const seg = [...curve(e.a as P3, e.ctl, e.b as P3, 14), ...(e.kind === 'supersedes' || e.kind === 'contradicts' ? arrow(e.a as P3, e.ctl, e.b as P3) : [])]
          pos.push(...seg)
          const v = e.c.map(x => x * 0.75)
          for (let j = 0; j < seg.length / 3; j++) col.push(...v)
        }
        hotGeo.setPositions(pos)
        hotGeo.setColors(col)
        flowGeo.setAttribute('position', new Float32BufferAttribute(new Float32Array(hot.length * 9), 3))
        flowGeo.setAttribute('color', new Float32BufferAttribute(hot.flatMap(({ c }) => [...c, ...c, ...c].map(x => x * 0.8)), 3))
      }
      dirty = true
      // Flow plays a while after a pick, then the loop rests.
      wake(flow.visible ? 6000 : 120)
    }
    api.current = { wake, restyle, retag: () => { dirty = true; wake() } }

    const take = () => {
      touched.current = true; orbitDone = true; controls.autoRotate = false
      clearTimeout(endOrbit)
    }
    const onDown = () => { take(); down = true; wake(400) }
    const onUp = () => { if (down) { down = false; wake(300) } }
    // A mouse near a place-to-place arc shows how many links it stands for.
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      wake(150)
      { const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top
        if (!curHover) el.style.cursor = placeBoxes.some(({ k, b }) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && d.nodes.some(n => n.kind === 'project' && n.label === k)) ? 'pointer' : '' }
      if (!arcs.length || curLit || down) return
      const r = el.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top
      let best: Sprite | undefined, bd = 14
      for (const a of arcs) for (const p of a.pts) {
        const c = g.graph2ScreenCoords(p.x, p.y, p.z), dd = Math.hypot(c.x - mx, c.y - my)
        if (dd < bd) { bd = dd; best = a.tag }
      }
      for (const a of arcs) a.tag.visible = a.tag === best
    }
    const onWheel = () => { take(); wake(400) }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)

    const ro = new ResizeObserver(() => {
      if (!el.clientWidth) return
      g.width(el.clientWidth).height(el.clientHeight); setBoxH(el.clientHeight)
      sizeScreen()
      if (!touched.current) fit(0)
      dirty = true; wake(100)
    })
    ro.observe(el)
    const offShown = vscodeBridge?.onShown(() => {
      shown = !!vscodeBridge!.shown
      if (shown) wake(200)
      else { awake = false; cancelAnimationFrame(raf); g.pauseAnimation() }
    })
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(late); clearTimeout(endOrbit); ro.disconnect(); offShown?.()
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove); el.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp)
      gl.forceContextLoss()
      for (const s of [...dots.current.values(), ...tags.current.values(), ...extras, ...arcs.map(a => a.tag)]) { if (![dotTex, haloTex, ringTex].includes(s.material.map as CanvasTexture)) s.material.map?.dispose(); s.material.dispose() }
      for (const s of dots.current.values()) (s.userData.bang as Sprite | undefined)?.material.dispose()
      for (const t of [dotTex, haloTex, ringTex, bang]) t.dispose()
      for (const m of [...mats, starMat, flowMat]) m.dispose()
      for (const x of [starGeo, restGeo, hotGeo, flowGeo, ...arcGeos]) x.dispose()
      g._destructor(); fg.current = undefined; fitRef.current = undefined; api.current = undefined
      dots.current.clear(); objs.current.clear(); tags.current.clear(); el.replaceChildren()
    }
  }, [d])
  // OrbitControls unhook their document keydown via the canvas's root node, which is no longer document once React
  // detaches the canvas; a layout cleanup runs while it is still attached.
  useLayoutEffect(() => () => (fg.current?.controls() as { dispose(): void } | undefined)?.dispose(), [d])

  const hits = useMemo(() => (d && q.trim() ? d.notes.filter(n => matches(n, q)).slice(0, 8) : []), [d, q])
  // Lit: the pick and its neighbors, else the notes that need a look. Everything else sinks.
  const lit = useMemo(() => {
    if (!d) return
    if (picked) return new Set([picked, ...neighbors(d.sub, picked).map(n => n.id)])
    if (issues) return d.flagged
  }, [d, picked, issues])

  useEffect(() => { api.current?.restyle(lit, picked, hover, issues) }, [lit, picked, hover, issues, d])

  // Names: the hovered and picked note and its neighbors, or the notes with problems. At rest only the places are named.
  useEffect(() => {
    const g = fg.current, el = box.current
    if (!g || !d || !el?.clientHeight) return
    const near = picked ? neighbors(d.sub, picked).filter(n => n.kind !== 'project').map(n => n.id) : []
    const list = [hover, picked, ...near, ...(picked || !issues ? [] : [...d.bad])].filter((id): id is string => !!id && d.byId.get(id)?.kind !== 'project')
    const show = [...new Set(list)]
    want.current = show.map(id => ({ id, must: id === hover || id === picked }))
    const fov = (g.camera() as PerspectiveCamera).fov, unit = (2 * Math.tan((fov * Math.PI) / 360)) / el.clientHeight
    for (const [id, t] of tags.current) if (!show.includes(id)) t.visible = false
    for (const id of show) {
      const o = objs.current.get(id), n = d.byId.get(id), dot = dots.current.get(id)
      if (!o || !n || !dot) continue
      let t = tags.current.get(id)
      if (!t) { t = nameTag(shortLabel(n), false); hitShown(t); t.visible = false; tags.current.set(id, t); o.add(t) }
      const hh = unit * t.userData.px
      t.scale.set(hh * t.userData.aspect, hh, 1)
      t.position.y = -dot.userData.size * 0.22
    }
    api.current?.retag()
  }, [picked, hover, issues, d, boxH])

  // Glide from where the camera is, so the turn stays small; the note lands in the part the panel leaves free.
  const fly = (id: string) => {
    setPicked(id); setQ('')
    touched.current = true
    const g = fg.current, el = box.current, n = (g?.graphData().nodes as Pt[] | undefined)?.find(p => p.id === id)
    if (!g || !el || !n || n.x === undefined) return
    const cam = g.camera() as PerspectiveCamera, at = { x: n.x, y: n.y ?? 0, z: n.z ?? 0 }
    const v = { x: cam.position.x - at.x, y: cam.position.y - at.y, z: cam.position.z - at.z }, r = Math.hypot(v.x, v.y, v.z) || 1, hr = Math.hypot(v.x, v.z) || 1
    const w = el.clientWidth || 700, h = el.clientHeight || 700, phone = w <= 760
    const dist = phone ? 260 : 190 * Math.min(1, Math.max(0.55, Math.min(w, h) / 700)), t = Math.tan((cam.fov * Math.PI) / 360)
    const side = phone ? 0 : (200 / h) * 2 * dist * t, lift = phone ? -0.5 * dist * t : 0
    const aim = { x: at.x + (v.z / hr) * side, y: at.y + lift, z: at.z - (v.x / hr) * side }
    const ms = reduced() ? 0 : 1100
    g.cameraPosition({ x: aim.x + (v.x / r) * dist, y: aim.y + (v.y / r) * dist, z: aim.z + (v.z / r) * dist }, aim, ms)
    api.current?.wake(ms + 200)
  }
  const zoom = (k: number) => {
    const g = fg.current
    if (!g) return
    touched.current = true
    const c = g.controls() as { target: P3 }
    const ms = reduced() ? 0 : 240
    g.cameraPosition(dolly(g.camera().position, c.target, k), c.target, ms)
    api.current?.wake(ms + 200)
  }
  const fitAll = () => { setPicked(undefined); touched.current = false; fitRef.current?.() }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as Element).closest?.('input, textarea')) return
      if (e.key === '+' || e.key === '=') zoom(0.8)
      else if (e.key === '-') zoom(1.25)
      else if (e.key === '0') fitAll()
      else return
      e.preventDefault()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  })

  const node = picked ? d?.byId.get(picked) : undefined
  const groups = useMemo(() => (d ? GROUPS.filter(gr => d.notes.some(n => groupOf(n) === gr.id)) : []), [d])

  return (
    <Shell className="mm c1" onClose={onClose} findRef={findRef} onEsc={() => { if (picked) { setPicked(undefined); return true } return false }}>
      <header className="mm-bar">
        <h2>Memory</h2>
        {d && <span className="mm-count">{d.notes.length} notes</span>}
        {top}
        <i className="mm-break" aria-hidden />
        <div className="mm-find">
          <Search value={q} onChange={setQ} label="Find a note" inputRef={findRef} onEnter={() => hits[0] && fly(hits[0].id)} />
          {hits.length > 0 && <ul className="mm-hits" aria-label="Matches">
            {hits.map(n => <li key={n.id}><button type="button" onClick={() => fly(n.id)}><i className="mk-dot" style={{ background: toneOf(n) }} aria-hidden /><span>{shortLabel(n)}</span><small>{d!.home(n)}</small></button></li>)}
          </ul>}
        </div>
        <button type="button" className="mm-issues" aria-pressed={issues} onClick={() => { setIssues(x => !x); setPicked(undefined) }}>Needs a look<b>{d?.flagged.size ?? 0}</b></button>
        <button type="button" className="mm-x" aria-label="Close memory" onClick={onClose}>
          <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8" /></svg>
        </button>
      </header>
      <div className="mm-stage c1-space">
        <div ref={box} className="c1-canvas" hidden={!d} role="img"
          aria-label={d ? `3D map of ${d.notes.length} notes in ${d.anchor.size} places. Search or the Notebook tab opens a note; plus and minus zoom, 0 fits.` : 'Loading the memory map'} />
        {!d || !graph ? <Loading problem={problem} /> : !d.notes.length ? <Loading empty /> : <>
          <div className="mm-zoom" role="group" aria-label="Zoom">
            <button type="button" aria-label="Zoom in" onClick={() => zoom(0.8)}>+</button>
            <button type="button" aria-label="Zoom out" onClick={() => zoom(1.25)}>{'−'}</button>
            <button type="button" aria-label="Fit the map" onClick={fitAll}><svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1.5 5V1.5H5M9 1.5h3.5V5M12.5 9v3.5H9M5 12.5H1.5V9" /></svg></button>
          </div>
          <details className="mm-legend">
            <summary>Legend</summary>
            <p className="c1-key-h">Notes</p>
            <ul>
              {groups.map(gr => <li key={gr.id}><i className="mk-dot" style={{ background: TONE[gr.id] }} aria-hidden />{gr.label}</li>)}
              <li><i className="mk-dot c1-faded" aria-hidden />Superseded</li>
              <li><i className="c1-bang" aria-hidden>!</i>Needs a look</li>
            </ul>
            <p className="c1-key-h">Projects and links</p>
            <ul className="c1-keys">
              <li><i className="c1-glow" aria-hidden />A project and its notes</li>
              <li><svg className="mm-ln" width="16" height="8" aria-hidden><path d="M1 7Q8 0 15 7" fill="none" stroke="#7b80a8" strokeWidth="2.5" /></svg>Between projects, thicker is more</li>
              <li><svg className="mm-ln" width="16" height="4" aria-hidden><line x1="0" y1="2" x2="16" y2="2" stroke="#b394ff" strokeWidth="2" /></svg>Links to</li>
              <li><svg className="mm-ln" width="16" height="4" aria-hidden><line x1="0" y1="2" x2="16" y2="2" stroke="#57c1ff" strokeWidth="2" /></svg>Depends on, part of</li>
              <li><svg className="mm-ln" width="16" height="4" aria-hidden><line x1="0" y1="2" x2="16" y2="2" stroke="#ffc533" strokeWidth="2" /></svg>Replaced by</li>
              <li><svg className="mm-ln" width="16" height="4" aria-hidden><line x1="0" y1="2" x2="16" y2="2" stroke="#ff6161" strokeWidth="2" /></svg>Disagrees</li>
            </ul>
            <p>Drag to turn, scroll or pinch to zoom. Click a project name to open it.</p>
          </details>
          {node && (
            <aside className="mm-panel" aria-label="Note">
              <NoteReader g={graph} node={node} home={d.home} flags={d.flags} onOpen={fly}>
                <button type="button" className="mm-close" aria-label="Close note" onClick={() => setPicked(undefined)}>
                  <svg aria-hidden width="12" height="12" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8" /></svg>
                </button>
              </NoteReader>
            </aside>
          )}
        </>}
      </div>
    </Shell>
  )
}
