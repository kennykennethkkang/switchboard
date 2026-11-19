/**
 * Option A of the Memory view: a flat map. One round cluster per project (plus Shared for the vault and anything
 * two projects hold), dots placed on a sunflower spiral in group order, clusters packed in rows.
 * No randomness and no simulation, so the same graph always lands in the same place.
 */
import { GROUPS, groupOf, type GraphNode, type MemoryGraph } from './memory-graph'

export type AtlasDot = { id: string; x: number; y: number; r: number; cluster: string }
export type AtlasCluster = { id: string; label: string; x: number; y: number; r: number; count: number }
export type Atlas = { dots: Map<string, AtlasDot>; clusters: AtlasCluster[]; w: number; h: number }

const GOLD = Math.PI * (3 - Math.sqrt(5))
const DOT: Record<GraphNode['kind'], number> = { project: 0, memory: 5, wiki: 5, raw: 4, rule: 6, chat: 4, todo: 3.5 }
const STEP = 15, PAD = 16, GAP = 40, TITLE = 26
export const SHARED = 'shared'

export function atlasLayout(g: MemoryGraph, aspect = 1.6): Atlas {
  const projects = g.nodes.filter(n => n.kind === 'project')
  const isProj = new Set(projects.map(p => p.id))
  const ups = new Map<string, Set<string>>()
  for (const e of g.edges) if (e.kind === 'in' && isProj.has(e.target)) ups.set(e.source, (ups.get(e.source) ?? new Set()).add(e.target))
  const buckets = new Map<string, GraphNode[]>([...projects.map(p => [p.id, []] as [string, GraphNode[]]), [SHARED, []]])
  for (const n of g.nodes) {
    if (n.kind === 'project') continue
    const u = ups.get(n.id)
    buckets.get(u?.size === 1 ? [...u][0] : SHARED)!.push(n)
  }
  const rank = new Map(GROUPS.map((gr, i) => [gr.id, i]))
  const label = new Map(projects.map(p => [p.id, p.label]))
  const sized = [...buckets].filter(([id, l]) => l.length || id !== SHARED).map(([id, list]) => {
    list.sort((a, b) => rank.get(groupOf(a))! - rank.get(groupOf(b))! || Number(!!a.superseded) - Number(!!b.superseded) || a.label.localeCompare(b.label))
    return { id, label: label.get(id) ?? 'Shared', list, r: Math.max(28, STEP * Math.sqrt(list.length + 0.5) + PAD) }
  })
  // Biggest first, Shared last so it sits at the end of the map; then shelf-pack to roughly the box's shape.
  sized.sort((a, b) => Number(a.id === SHARED) - Number(b.id === SHARED) || b.r - a.r || a.label.localeCompare(b.label))
  const area = sized.reduce((s, c) => s + (2 * c.r + GAP) * (2 * c.r + GAP + TITLE), 0)
  const rowW = Math.max(Math.sqrt(area * aspect), ...sized.map(c => 2 * c.r + GAP))
  const rows: (typeof sized)[] = [[]]
  let used = 0
  for (const c of sized) {
    const w = 2 * c.r + GAP
    if (used + w > rowW && rows[rows.length - 1].length) { rows.push([]); used = 0 }
    rows[rows.length - 1].push(c); used += w
  }
  const totals = rows.map(row => row.reduce((s, c) => s + 2 * c.r + GAP, 0) - GAP)
  const w = Math.max(...totals)
  const dots = new Map<string, AtlasDot>(), clusters: AtlasCluster[] = []
  let y = 0
  rows.forEach((row, ri) => {
    // Short rows sit centered under the widest.
    let x = (w - totals[ri]) / 2
    for (const c of row) {
      const cx = x + c.r, cy = y + TITLE + Math.max(...row.map(o => o.r))
      clusters.push({ id: c.id, label: c.label, x: cx, y: cy, r: c.r, count: c.list.length })
      c.list.forEach((n, i) => {
        const d = STEP * Math.sqrt(i + 0.5), a = i * GOLD
        dots.set(n.id, { id: n.id, x: cx + d * Math.cos(a), y: cy + d * Math.sin(a), r: DOT[n.kind], cluster: c.id })
      })
      x += 2 * c.r + GAP
    }
    y += 2 * Math.max(...row.map(c => c.r)) + TITLE + GAP
  })
  return { dots, clusters, w, h: Math.max(0, y - GAP) }
}
