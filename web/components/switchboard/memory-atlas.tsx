'use client'

/** Memory option A: the flat map from lib/memory-atlas, drawn in SVG with hub tokens. Pan, wheel or pinch zoom; nothing moves on its own. */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { atlasLayout } from '@/lib/memory-atlas'
import { groupOf, neighbors, type GraphEdge, type Group, type MemoryGraph } from '@/lib/memory-graph'

export const TONE: Record<Group, string> = {
  user: 'var(--hub-violet)', feedback: 'var(--hub-green)', 'project-memory': 'var(--hub-blue)', reference: 'var(--hub-teal)', wiki: 'var(--hub-w-lime)',
  raw: 'var(--hub-ash)', project: 'var(--hub-ink)', chat: 'var(--hub-w-amber)', todo: 'var(--hub-yellow)', rule: 'var(--hub-w-rose)',
}
const EDGE: Partial<Record<GraphEdge['kind'], string>> = {
  link: 'var(--hub-violet)', related: 'var(--hub-violet)', contradicts: 'var(--hub-red)', supersedes: 'var(--hub-yellow)', 'depends-on': 'var(--hub-blue)', 'part-of': 'var(--hub-blue)', from: 'var(--hub-mute)', todo: 'var(--hub-mute)',
}
export type Zoomer = { zoom: (k: number) => void; fit: () => void }
type View = { x: number; y: number; k: number }
const LABEL = 12
// Labels for everything once dots sit this far apart on screen; below it only the focus is named.
const ALL_AT = 1
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export function MemoryAtlas({ graph, off, picked, only, onPick, zoomer, label }: {
  label: string; graph: MemoryGraph; off: Set<Group>; picked?: string; only?: Set<string>; onPick: (id?: string) => void; zoomer: MutableRefObject<Zoomer | undefined>
}) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  const viewRef = useRef(view)
  viewRef.current = view
  // Which names show is read from this, set once motion stops, so labels never blink mid-zoom.
  const [labelK, setLabelK] = useState(1)
  const rest = useRef(0)
  const settle = (k: number) => { clearTimeout(rest.current); rest.current = window.setTimeout(() => setLabelK(k), 140) }
  const raf = useRef(0)
  const glide = (to: View) => {
    cancelAnimationFrame(raf.current)
    if (reduced()) { setView(to); setLabelK(to.k); return }
    const from = viewRef.current, t0 = performance.now()
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 280), e = 1 - (1 - p) ** 4
      setView({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e })
      if (p < 1) raf.current = requestAnimationFrame(step); else setLabelK(to.k)
    }
    raf.current = requestAnimationFrame(step)
  }
  useEffect(() => () => { cancelAnimationFrame(raf.current); clearTimeout(rest.current) }, [])
  const [hover, setHover] = useState<string>()
  const [drag, setDrag] = useState(false)
  // Wide or tall only, so a resize does not reshuffle the map.
  const wide = size.w >= size.h
  const atlas = useMemo(() => atlasLayout(graph, wide ? 1.6 : 0.6), [graph, wide])
  const byId = useMemo(() => new Map(graph.nodes.map(n => [n.id, n])), [graph])
  const shown = (id: string) => { const n = byId.get(id); return !!n && !off.has(groupOf(n)) }

  const fitView = (w = size.w, h = size.h): View => {
    const pad = w < 500 ? 24 : 56, k = Math.min(2.6, (w - 2 * pad) / Math.max(1, atlas.w), (h - 2 * pad) / Math.max(1, atlas.h))
    return { k, x: (w - atlas.w * k) / 2, y: (h - atlas.h * k) / 2 }
  }
  const touched = useRef(false)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => { if (size.w && !touched.current && !picked) { cancelAnimationFrame(raf.current); const v = fitView(); setView(v); setLabelK(v.k) } }, [atlas, size.w, size.h])

  const zoomAt = (f: number, px = size.w / 2, py = size.h / 2, glideIt = false) => {
    touched.current = true; cancelAnimationFrame(raf.current)
    const v = viewRef.current, k = Math.min(6, Math.max(0.2, v.k * f)), to = { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k }
    if (glideIt) glide(to); else { setView(to); viewRef.current = to; settle(k) }
  }
  zoomer.current = { zoom: k => zoomAt(1 / k, undefined, undefined, true), fit: () => { touched.current = false; glide(fitView()) } }

  // A pick slides into the middle, zooming in if it is too small to read.
  useEffect(() => {
    const d = picked ? atlas.dots.get(picked) : undefined, c = picked ? atlas.clusters.find(c => c.id === picked) : undefined
    const p = d ?? c
    if (!p || !size.w) return
    touched.current = true
    const k = Math.max(viewRef.current.k, c ? Math.min(2.4, (Math.min(size.w, size.h) * 0.7) / (2 * c.r)) : ALL_AT)
    glide({ k, x: size.w / 2 - p.x * k, y: size.h / 2 - p.y * k })
  }, [picked, atlas, size.w, size.h])

  // Wheel zoom on the cursor; React's onWheel is passive and cannot stop the page scroll.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const wheel = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), e.clientX - r.left, e.clientY - r.top) }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [size.w, size.h])

  // One finger or the mouse pans, two pinch. A press that barely moves is a click.
  const pts = useRef(new Map<number, { x: number; y: number }>())
  const moved = useRef(0)
  // pointer capture retargets pointerup to the box, so the pressed dot is read on down
  const pressed = useRef<string | undefined>(undefined)
  const down = (e: React.PointerEvent) => {
    pressed.current = (e.target as Element).closest('[data-id]')?.getAttribute('data-id') ?? undefined
    e.currentTarget.setPointerCapture(e.pointerId); pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved.current = 0
  }
  const move = (e: React.PointerEvent) => {
    const p = pts.current.get(e.pointerId)
    if (!p) return
    const before = [...pts.current.values()].map(q => ({ ...q }))
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const after = [...pts.current.values()]
    moved.current += Math.hypot(e.clientX - p.x, e.clientY - p.y)
    if (moved.current < 4) return
    touched.current = true; setDrag(true)
    if (after.length === 2) {
      const r = box.current!.getBoundingClientRect(), mid = { x: (after[0].x + after[1].x) / 2 - r.left, y: (after[0].y + after[1].y) / 2 - r.top }
      const f = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y) / (Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y) || 1)
      zoomAt(f, mid.x, mid.y)
    } else { cancelAnimationFrame(raf.current); setView(v => ({ ...v, x: v.x + e.clientX - p.x, y: v.y + e.clientY - p.y })) }
  }
  const up = (e: React.PointerEvent) => {
    pts.current.delete(e.pointerId)
    if (!pts.current.size) setDrag(false)
    if (moved.current >= 4) return
    const id = pressed.current
    onPick(id === picked ? undefined : id)
  }

  // Focus: the hover, else the pick, with their neighbors; a health filter lights its notes instead.
  const focus = hover ?? picked
  const lit = useMemo(() => focus ? new Set([focus, ...neighbors(graph, focus).map(n => n.id)]) : only, [focus, graph, only])
  const edges = useMemo(() => graph.edges.filter(e => EDGE[e.kind] && atlas.dots.has(e.source) && atlas.dots.has(e.target)), [graph, atlas])

  // Dots grow slower than the map, so a close zoom spreads them out instead of blowing them up.
  const rs = (r: number, k = view.k) => r / Math.sqrt(Math.max(1, k))
  // Names: the focus and its neighbors, or all of them when zoomed in. Overlaps drop greedily once per change, never per frame.
  const names = useMemo(() => {
    const k = labelK, want = [...atlas.dots.values()].filter(d => shown(d.id) && (k >= ALL_AT || lit?.has(d.id)))
    want.sort((a, b) => Number(b.id === focus) - Number(a.id === focus) || Number(!!lit?.has(b.id)) - Number(!!lit?.has(a.id)))
    const kept: number[][] = [], out: { d: (typeof want)[number]; t: string }[] = []
    for (const d of want) {
      const t = byId.get(d.id)!.label, w = Math.min(t.length, 32) * 6.4 + 4
      const sx = d.x * k + rs(d.r, k) * k + 6, sy = d.y * k - 8
      const b = [sx, sy, sx + w, sy + 16]
      if (d.id !== focus && kept.some(o => b[0] < o[2] && o[0] < b[2] && b[1] < o[3] && o[1] < b[3])) continue
      kept.push(b); out.push({ d, t: t.length > 32 ? `${t.slice(0, 31)}…` : t })
    }
    return out
  }, [atlas, labelK, lit, focus, off, byId])

  const dim = (id: string) => (lit && !lit.has(id) ? 0.14 : 1)
  return (
    <div ref={box} className="mem-atlas" role="img" aria-label={label} data-drag={drag ? '' : undefined} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => setHover(undefined)}>
      <svg width="100%" height="100%" aria-hidden>
        <defs>
          <pattern id="mem-grid" width={24} height={24} patternUnits="userSpaceOnUse" patternTransform={`translate(${view.x % 24} ${view.y % 24})`}>
            <circle cx={1} cy={1} r={1} fill="var(--hub-hair)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#mem-grid)" />
        <g className="mem-atlas-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          {atlas.clusters.map(c => (
            <g key={c.id} data-id={c.id === 'shared' ? undefined : c.id} className="mem-cluster" data-on={picked === c.id ? '' : undefined} style={{ opacity: lit && !lit.has(c.id) && ![...lit].some(id => atlas.dots.get(id)?.cluster === c.id) ? 0.35 : 1 }}>
              <circle cx={c.x} cy={c.y} r={c.r} />
            </g>
          ))}
          <g fill="none">
            {edges.map((e, i) => {
              const a = atlas.dots.get(e.source)!, b = atlas.dots.get(e.target)!
              if (!shown(a.id) || !shown(b.id)) return null
              const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y
              const on = !lit || (lit.has(a.id) && lit.has(b.id) && (!focus || a.id === focus || b.id === focus))
              return <path key={i} d={`M${a.x},${a.y} Q${mx - dy * 0.18},${my + dx * 0.18} ${b.x},${b.y}`} stroke={EDGE[e.kind]} strokeWidth={on && lit ? 1.6 : 1} strokeDasharray={e.kind === 'contradicts' ? '4 3' : undefined}
                vectorEffect="non-scaling-stroke" style={{ opacity: on ? (lit ? 0.9 : 0.4) : 0.05 }} />
            })}
          </g>
          {[...atlas.dots.values()].filter(d => shown(d.id)).map(d => {
            const n = byId.get(d.id)!, c = TONE[groupOf(n)]
            return (
              <g key={d.id} data-id={d.id} className="mem-dot" data-on={d.id === picked ? '' : undefined} data-kind={n.kind} style={{ opacity: dim(d.id) }}
                onPointerEnter={e => { if (e.pointerType === 'mouse') setHover(d.id) }} onPointerLeave={() => setHover(h => (h === d.id ? undefined : h))}>
                <circle cx={d.x} cy={d.y} r={Math.max(10, d.r + 6) / Math.min(1, view.k)} fill="transparent" />
                {d.id === picked && <circle cx={d.x} cy={d.y} r={rs(d.r) + 4 / Math.sqrt(Math.max(1, view.k))} fill="none" stroke={c} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
                <circle cx={d.x} cy={d.y} r={rs(d.r)} fill={n.superseded ? 'var(--hub-canvas)' : c} stroke={c} strokeWidth={n.superseded ? 1.5 : 0} vectorEffect="non-scaling-stroke" />
              </g>
            )
          })}
        </g>
        {/* Text outside the scaled group so it stays 12px at any zoom. */}
        <g className="mem-atlas-text" style={{ transform: `translate(${view.x}px, ${view.y}px)` }}>
          {atlas.clusters.map(c => (
            <text key={c.id} data-id={c.id === 'shared' ? undefined : c.id} x={c.x * view.k} y={(c.y - c.r) * view.k - 10} textAnchor="middle" className="mem-cluster-name">
              {c.label}<tspan dx={6}>{c.count}</tspan>
            </text>
          ))}
          {names.map(({ d, t }) => (
            <text key={d.id} x={d.x * view.k + rs(d.r) * view.k + 6} y={d.y * view.k} dominantBaseline="central" fontSize={LABEL} className="mem-name" data-on={d.id === focus ? '' : undefined} style={{ opacity: dim(d.id) }}>{t}</text>
          ))}
        </g>
      </svg>
    </div>
  )
}
