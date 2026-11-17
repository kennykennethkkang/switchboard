/**
 * The Code view's data: the map extension/src/hub/flowmap.ts builds (same shapes), how to get it
 * (the panel's flowmap-get, else the app's /hub/flowmap proxy), the app's parts and how their links are drawn.
 */
import { vscodeBridge } from './vscode-bridge'
import { downReason } from './hub-remote'
import type { GraphNode, MemoryGraph } from './memory-graph'
import type { CheckBack, IndefiniteBudget } from './hub-types'

export type FlowKind = 'folder' | 'file' | 'chat' | 'skill' | 'plugin' | 'mod' | 'role'
/** group: a chat node's split id; chats started from one message share it (groupTies). budget, checkBack, costUsd, elapsedMs: a live chat's Run indefinitely limits (budget-ui limitText). */
export type FlowNode = { id: string; kind: FlowKind; label: string; folder?: string; about?: string; first?: number; at?: number; group?: string; budget?: IndefiniteBudget; checkBack?: CheckBack; costUsd?: number; elapsedMs?: number }
export type FlowEdge = { from: string; to: string; kind: 'import' | 'used' | 'touched'; n: number; at?: number }
export type FlowMap = { project: string; nodes: FlowNode[]; edges: FlowEdge[]; cut?: boolean; builtAt: number }

/** The registered project a folder belongs to: the deepest one holding it, so web/ folds into its repo. */
export const projectOf = (projects: string[], cwd?: string) => (cwd ? projects.filter(p => cwd === p || cwd.startsWith(`${p}/`)).sort((a, b) => b.length - a.length)[0] : undefined)

export async function loadFlowMap(cwd: string, f: typeof fetch = fetch): Promise<FlowMap | string> {
  if (vscodeBridge?.isVSCode) return vscodeBridge.flowMap(cwd)
  try {
    const r = await f(`/hub/flowmap?${new URLSearchParams({ cwd })}`, { headers: { 'X-Switchboard': '1' }, cache: 'no-store' })
    return r.ok ? ((await r.json()) as FlowMap) : downReason(r.status)
  } catch {
    return downReason(undefined)
  }
}

/** Chat nodes of one group, chained in map order, for a group edge. */
export function groupTies(map: FlowMap): { from: string; to: string; group: string }[] {
  const last = new Map<string, string>(), out: { from: string; to: string; group: string }[] = []
  for (const n of map.nodes) {
    if (n.kind !== 'chat' || !n.group) continue
    const prev = last.get(n.group)
    if (prev) out.push({ from: prev, to: n.id, group: n.group })
    last.set(n.group, n.id)
  }
  return out
}

export const KIND_NAME: Record<FlowKind, string> = { folder: 'Folder', file: 'File', chat: 'Chat', skill: 'Skill', plugin: 'Plugin', mod: 'Mod', role: 'Role' }

/** Which project the map opens on: this window's, else the last one picked in the map (if still registered), else the chat's. */
export function startProject(cwds: string[], here?: string, saved?: string, chat?: string): string | undefined {
  return here ?? (saved && cwds.includes(saved) ? saved : undefined) ?? chat ?? cwds[0]
}

const day = (ms?: number) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '')
export const when = day

export function demoFlowMap(): FlowMap {
  const t = Date.parse('2026-11-05T15:00:00Z')
  const nodes: FlowNode[] = [
    { id: 'd:web/components/switchboard', kind: 'folder', label: 'web/components/switchboard', about: 'The hub views people open.' },
    { id: 'd:web/lib', kind: 'folder', label: 'web/lib', about: 'Small helpers the pages share.' },
    { id: 'd:extension/src/hub', kind: 'folder', label: 'extension/src/hub', about: 'The editor side: watches chats and serves every view.' },
    { id: 'f:web/components/switchboard/switchboard.tsx', kind: 'file', label: 'web/components/switchboard/switchboard.tsx', folder: 'd:web/components/switchboard', about: 'The hub shell.' },
    { id: 'f:web/lib/today.ts', kind: 'file', label: 'web/lib/today.ts', folder: 'd:web/lib', about: 'What happened today, in a few lines.' },
    { id: 'f:web/lib/now.ts', kind: 'file', label: 'web/lib/now.ts', folder: 'd:web/lib', about: 'What needs you now.' },
    { id: 'f:web/lib/todo.ts', kind: 'file', label: 'web/lib/todo.ts', folder: 'd:web/lib' },
    { id: 'f:extension/src/hub/routes.ts', kind: 'file', label: 'extension/src/hub/routes.ts', folder: 'd:extension/src/hub', about: 'The /hub routes every view reads.' },
    { id: 'f:extension/src/hub/graph.ts', kind: 'file', label: 'extension/src/hub/graph.ts', folder: 'd:extension/src/hub', about: 'Builds the memory graph.' },
    { id: 'chat:a', kind: 'chat', label: 'Today card v2', first: t - 86_400_000 * 2, at: t - 86_400_000, group: 'g-demo', budget: { maxHours: 4, maxCostUsd: 5, gate: 'pnpm test' }, checkBack: { everyMin: 30, count: 3 } },
    { id: 'chat:b', kind: 'chat', label: 'Hub state cleanup', first: t - 3_600_000 * 5, at: t, group: 'g-demo' },
    { id: 'skill:superpowers:test-driven-development', kind: 'skill', label: 'superpowers:test-driven-development' },
    { id: 'plugin:playwright', kind: 'plugin', label: 'playwright' },
    { id: 'mod:repo-rules', kind: 'mod', label: 'repo-rules' },
    { id: 'role:engineer', kind: 'role', label: 'engineer' },
  ]
  const edges: FlowEdge[] = [
    { from: 'f:web/components/switchboard/switchboard.tsx', to: 'f:web/lib/today.ts', kind: 'import', n: 1 },
    { from: 'f:web/components/switchboard/switchboard.tsx', to: 'f:web/lib/todo.ts', kind: 'import', n: 1 },
    { from: 'f:web/lib/now.ts', to: 'f:web/lib/today.ts', kind: 'import', n: 1 },
    { from: 'f:extension/src/hub/routes.ts', to: 'f:extension/src/hub/graph.ts', kind: 'import', n: 1 },
    { from: 'chat:a', to: 'skill:superpowers:test-driven-development', kind: 'used', n: 3 },
    { from: 'chat:a', to: 'plugin:playwright', kind: 'used', n: 6 },
    { from: 'chat:a', to: 'role:engineer', kind: 'used', n: 2 },
    { from: 'chat:a', to: 'f:web/lib/today.ts', kind: 'touched', n: 1, at: t - 86_400_000 },
    { from: 'chat:b', to: 'mod:repo-rules', kind: 'used', n: 4 },
    { from: 'chat:b', to: 'role:engineer', kind: 'used', n: 1 },
    { from: 'chat:b', to: 'f:extension/src/hub/routes.ts', kind: 'touched', n: 1, at: t },
  ]
  return { project: 'switchboard', nodes, edges, builtAt: t }
}

/** One part of the app for the Code view: a top folder, or one level down when a top folder holds over a third of the files. */
export type Part = {
  id: string; path: string; name: string; about?: string; files: string[]
  chats: { id: string; label: string; at?: number; n: number }[]
  tools: { id: string; kind: FlowKind; label: string; n: number }[]
  notes: GraphNode[]
  /** columns from the entry: longest import chain reaching it; alone: no imports either way, parked after the rest */
  depth: number; alone?: boolean
}
export type PartLink = { from: string; to: string; n: number }
export type Parts = { parts: Part[]; links: PartLink[]; order: string[]; notes: GraphNode[] }

const NOTE_KINDS = new Set<GraphNode['kind']>(['memory', 'wiki', 'raw'])
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The app as parts: files, imports between parts (summed), chats that changed them, what those chats used, and memory notes
 * that name the part's path or one of its files. cwd picks the project's notes; without it the project's name does. */
export function components(map: FlowMap, mem?: MemoryGraph, cwd?: string): Parts {
  const files = map.nodes.filter(n => n.kind === 'file')
  const seg = (f: FlowNode) => f.label.split('/')
  const tops = new Map<string, FlowNode[]>()
  for (const f of files) { const s = seg(f); const k = s.length > 1 ? s[0] : '.'; tops.set(k, [...(tops.get(k) ?? []), f]) }
  const split = new Set([...tops].filter(([k, of]) => k !== '.' && of.length * 3 > files.length && new Set(of.map(f => seg(f).length > 2 ? seg(f)[1] : '')).size > 1).map(([k]) => k))
  const keyOf = (f: FlowNode) => { const s = seg(f); if (s.length < 2) return '.'; return split.has(s[0]) && s.length > 2 ? `${s[0]}/${s[1]}` : s[0] }
  const partOf = new Map(files.map(f => [f.id, `c:${keyOf(f)}`]))
  const byId = new Map(map.nodes.map(n => [n.id, n]))
  const parts = new Map<string, Part>()
  for (const f of files) {
    const id = partOf.get(f.id)!, path = id.slice(2)
    const p = parts.get(id) ?? { id, path, name: path === '.' ? map.project : path.split('/').pop()!, files: [], chats: [], tools: [], notes: [], depth: 0 }
    p.files.push(f.label)
    parts.set(id, p)
  }
  for (const p of parts.values()) {
    p.files.sort()
    p.about = byId.get(`d:${p.path}`)?.about ?? map.nodes.filter(n => n.kind === 'folder' && n.about && n.id.startsWith(`d:${p.path}/`)).sort((x, y) => x.id.length - y.id.length)[0]?.about ?? files.filter(f => partOf.get(f.id) === p.id && f.about).sort((a, b) => a.label.length - b.label.length)[0]?.about
  }
  const linkMap = new Map<string, PartLink>()
  const touched = new Map<string, Map<string, number>>()
  for (const e of map.edges) {
    const a = partOf.get(e.from), b = partOf.get(e.to)
    if (e.kind === 'import' && a && b && a !== b) { const k = `${a}\n${b}`; const l = linkMap.get(k); if (l) l.n += e.n; else linkMap.set(k, { from: a, to: b, n: e.n }) }
    if (e.kind === 'touched' && b) { const m = touched.get(b) ?? new Map(); m.set(e.from, (m.get(e.from) ?? 0) + e.n); touched.set(b, m) }
  }
  for (const p of parts.values()) {
    const by = touched.get(p.id) ?? new Map<string, number>()
    p.chats = [...by].map(([id, n]) => ({ id, label: byId.get(id)?.label ?? id, at: byId.get(id)?.at, n })).sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    const tools = new Map<string, number>()
    for (const e of map.edges) if (e.kind === 'used' && by.has(e.from)) tools.set(e.to, (tools.get(e.to) ?? 0) + 1)
    p.tools = [...tools].map(([id, n]) => ({ id, kind: byId.get(id)?.kind ?? 'skill', label: byId.get(id)?.label ?? id, n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
  }
  const links = [...linkMap.values()]

  // depth: DFS from the parts nothing imports, skipping edges back into the current chain, then longest path
  const outs = new Map<string, string[]>()
  for (const l of links) outs.set(l.from, [...(outs.get(l.from) ?? []), l.to])
  const hasIn = new Set(links.map(l => l.to))
  const all = [...parts.keys()].sort()
  const starts = [...all.filter(id => !hasIn.has(id)), ...all.filter(id => hasIn.has(id))]
  const state = new Map<string, 1 | 2>(), post: string[] = [], back = new Set<string>()
  const walk = (id: string) => {
    state.set(id, 1)
    for (const to of outs.get(id) ?? []) { if (state.get(to) === 1) back.add(`${id}\n${to}`); else if (!state.has(to)) walk(to) }
    state.set(id, 2); post.push(id)
  }
  for (const id of starts) if (!state.has(id)) walk(id)
  for (const id of post.reverse()) for (const to of outs.get(id) ?? []) if (!back.has(`${id}\n${to}`)) parts.get(to)!.depth = Math.max(parts.get(to)!.depth, parts.get(id)!.depth + 1)
  const linked = new Set(links.flatMap(l => [l.from, l.to]))
  const deepest = Math.max(0, ...[...parts.values()].filter(p => linked.has(p.id)).map(p => p.depth))
  for (const p of parts.values()) if (!linked.has(p.id) && parts.size > 1 && linked.size) { p.alone = true; p.depth = deepest + 1 }
  const order = [...parts.values()].sort((a, b) => a.depth - b.depth || b.files.length - a.files.length || a.path.localeCompare(b.path)).map(p => p.id)

  let notes: GraphNode[] = []
  if (mem) {
    const home = new Set(mem.nodes.filter(n => n.kind === 'project' && (cwd ? n.id === `project:${cwd}` : n.label === map.project)).map(n => n.id))
    const mine = new Set(mem.edges.filter(e => e.kind === 'in' && home.has(e.target)).map(e => e.source))
    notes = mem.nodes.filter(n => NOTE_KINDS.has(n.kind) && mine.has(n.id))
    for (const p of parts.values()) {
      // paths and file names, not bare folder names: "lib" or "src" would match half the notes
      const words = new Set<string>()
      if (p.path.includes('/')) words.add(p.path)
      for (const f of p.files) { const b = f.split('/').pop()!; words.add(b); const stem = b.replace(/\.[^.]+$/, ''); if (stem.length >= 6) words.add(stem) }
      const re = new RegExp(`(^|[^\\w./-])(${[...words].map(esc).join('|')})(?![\\w-])`, 'i')
      p.notes = notes.filter(n => re.test(`${n.label}\n${n.description ?? ''}\n${n.text ?? ''}`))
    }
  }
  return { parts: order.map(id => parts.get(id)!), links, order, notes }
}

export const PART_W = 232, PART_H = 88

/** Layout A: one column per flow depth, entry on the left, each column centred on the tallest. */
export function layers(parts: Part[], links: PartLink[] = []): { at: Map<string, { x: number; y: number }>; cols: number } {
  const cols = new Map<number, Part[]>()
  for (const p of parts) cols.set(p.depth, [...(cols.get(p.depth) ?? []), p])
  const keys = [...cols.keys()].sort((a, b) => a - b), tall = Math.max(1, ...[...cols.values()].map(c => c.length))
  const at = new Map<string, { x: number; y: number }>()
  keys.forEach((k, ci) => {
    // each column sorted by where its importers sit, so lines cross less
    const pull = (p: Part) => { const ys = links.filter(l => l.to === p.id && at.has(l.from)).map(l => at.get(l.from)!.y); return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : Infinity }
    const c = [...cols.get(k)!].sort((a, b) => pull(a) - pull(b))
    const top = ((tall - c.length) * (PART_H + 32)) / 2
    c.forEach((p, i) => at.set(p.id, { x: ci * (PART_W + 120), y: top + i * (PART_H + 32) }))
  })
  return { at, cols: keys.length }
}

/** The demo map with enough of an app around it for the Code view to show a flow. */
export function demoAppMap(): FlowMap {
  const m = demoFlowMap()
  const f = (label: string, about?: string): FlowNode => ({ id: `f:${label}`, kind: 'file', label, folder: `d:${label.slice(0, label.lastIndexOf('/'))}`, ...(about ? { about } : {}) })
  const imp = (a: string, b: string, n = 1): FlowEdge => ({ from: `f:${a}`, to: `f:${b}`, kind: 'import', n })
  m.nodes.push(
    f('web/app/page.tsx', 'The page the hub app serves.'), f('web/components/switchboard/flow-map.tsx', 'The Code view.'), f('web/lib/flow-map.ts'), f('web/lib/hub-remote.ts', 'Talks to the hub over HTTP.'),
    f('extension/src/extension.ts', 'Where VS Code starts the extension.'), f('extension/src/hub/hub-service.ts', 'Keeps the hub state.'), f('extension/src/hub/flowmap.ts', 'Builds the flow map.'),
    f('extension/test/graph.test.ts'), f('app/src/server.ts', 'Serves the hub outside VS Code.'),
  )
  m.edges.push(
    imp('web/app/page.tsx', 'web/components/switchboard/switchboard.tsx'), imp('web/components/switchboard/switchboard.tsx', 'web/components/switchboard/flow-map.tsx'),
    imp('web/components/switchboard/flow-map.tsx', 'web/lib/flow-map.ts'), imp('web/lib/flow-map.ts', 'web/lib/hub-remote.ts'), imp('web/lib/today.ts', 'web/lib/hub-remote.ts'),
    imp('extension/src/extension.ts', 'extension/src/hub/hub-service.ts'), imp('extension/src/hub/hub-service.ts', 'extension/src/hub/routes.ts', 2), imp('extension/src/hub/hub-service.ts', 'extension/src/hub/flowmap.ts'),
    imp('extension/test/graph.test.ts', 'extension/src/hub/graph.ts'), imp('app/src/server.ts', 'web/lib/hub-remote.ts'),
    { from: 'chat:b', to: 'f:extension/src/hub/hub-service.ts', kind: 'touched', n: 2, at: m.builtAt },
  )
  return m
}

type Pt = { x: number; y: number }
const GAP = 120
/** Right-angle lines for layout A. A line leaves its part's right side into the column gap, runs across at a height no box
 * in its way sits at (a row gap, or above or below everything), and drops into the target's left side from the gap before it.
 * Lines sharing a gap or a corridor are spread a few px apart. Key: `from>to`. */
export function routeLinks(parts: Part[], links: PartLink[], at: Map<string, Pt>): Map<string, Pt[]> {
  const boxes = parts.map(p => ({ id: p.id, ...at.get(p.id)! }))
  const top = Math.min(...boxes.map(b => b.y)), bottom = Math.max(...boxes.map(b => b.y + PART_H))
  const plan = links.map(l => {
    const a = at.get(l.from)!, b = at.get(l.to)!
    const y1 = a.y + PART_H / 2, y2 = b.y + PART_H / 2, g1 = a.x + PART_W + GAP / 2, g2 = b.x - GAP / 2
    if (g1 === g2) return { l, y1, y2, g1, g2, yc: undefined as number | undefined }
    const lo = Math.min(g1, g2), hi = Math.max(g1, g2)
    const block = boxes.filter(x => x.x < hi && x.x + PART_W > lo)
    const free = (y: number) => !block.some(x => y > x.y - 4 && y < x.y + PART_H + 4)
    const cands = [y1, y2, top - 24, bottom + 24, ...block.flatMap(x => [x.y - 16, x.y + PART_H + 16])].filter(free)
    const yc = cands.sort((p, q) => Math.abs(p - y1) + Math.abs(p - y2) - Math.abs(q - y1) - Math.abs(q - y2) || p - q)[0]
    return { l, y1, y2, g1, g2, yc }
  })
  // lane offsets: by gap x for the drops, by height for the corridors
  const spreadOut = (keyOf: (i: number) => number[], step: number, most: number) => {
    const groups = new Map<number, number[]>()
    plan.forEach((_, i) => { for (const k of new Set(keyOf(i))) groups.set(k, [...(groups.get(k) ?? []), i]) })
    const off = new Map<string, number>()
    for (const [k, ids] of groups) ids.forEach((i, j) => off.set(`${k}\n${i}`, Math.max(-most, Math.min(most, (j - (ids.length - 1) / 2) * step))))
    return (k: number, i: number) => off.get(`${k}\n${i}`) ?? 0
  }
  const gapOff = spreadOut(i => [plan[i].g1, plan[i].g2], 8, 48)
  const rowOff = spreadOut(i => (plan[i].yc === undefined ? [] : [plan[i].yc!]), 6, 12)
  const out = new Map<string, Pt[]>()
  plan.forEach(({ l, y1, y2, g1, g2, yc }, i) => {
    const a = at.get(l.from)!, b = at.get(l.to)!
    const x1 = a.x + PART_W, x2 = b.x, h1 = g1 + gapOff(g1, i), h2 = g2 + gapOff(g2, i)
    const pts = yc === undefined ? [{ x: x1, y: y1 }, { x: h1, y: y1 }, { x: h1, y: y2 }, { x: x2, y: y2 }]
      : [{ x: x1, y: y1 }, { x: h1, y: y1 }, { x: h1, y: yc + rowOff(yc, i) }, { x: h2, y: yc + rowOff(yc, i) }, { x: h2, y: y2 }, { x: x2, y: y2 }]
    out.set(`${l.from}>${l.to}`, pts.filter((p, k) => k === 0 || p.x !== pts[k - 1].x || p.y !== pts[k - 1].y))
  })
  return out
}
