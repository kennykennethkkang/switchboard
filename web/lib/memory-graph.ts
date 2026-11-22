/**
 * The Memory view's data: the graph extension/src/hub/graph.ts builds (same shapes), how to get it
 * (the panel's graph-get, else the app's /hub/graph proxy), groups and colors, and a sample for the demo.
 */
import { vscodeBridge } from './vscode-bridge'
import { downReason } from './hub-remote'

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'
export type Pred = 'supersedes' | 'depends-on' | 'part-of' | 'contradicts' | 'related'
export type GraphNode = { id: string; kind: 'memory' | 'wiki' | 'raw' | 'project' | 'chat' | 'todo' | 'rule'; label: string; type?: MemoryType; description?: string; text?: string; missing?: string[]; aliases?: string[]; modified?: string; origin?: string; superseded?: boolean }
export type GraphEdge = { source: string; target: string; kind: 'link' | 'in' | 'todo' | 'from' | Pred }
/** Lint: duplicates are names or aliases two notes claim, contradictions id pairs, the rest node ids.
 * invalid: a memory note with no description or no valid type; stale: a project note not modified in 90 days. */
export type GraphHealth = { dangling: string[]; orphans: string[]; duplicates: string[]; contradictions: [string, string][]; superseded: string[]; invalid: string[]; stale: string[]; loops: string[][] }
export type MemoryGraph = { nodes: GraphNode[]; edges: GraphEdge[]; health: GraphHealth }

export type Group = 'user' | 'feedback' | 'project-memory' | 'reference' | 'wiki' | 'raw' | 'project' | 'chat' | 'todo' | 'rule'
/** Dark-theme colors per group; the view itself paints with hub tokens (TONE in memory-kit.tsx). */
export const GROUPS: { id: Group; label: string; color: string; set: 'Memory' | 'Vault' | 'Workspace' }[] = [
  { id: 'user', label: 'About you', color: '#a98bff', set: 'Memory' },
  { id: 'feedback', label: 'Feedback', color: '#59d499', set: 'Memory' },
  { id: 'project-memory', label: 'Project notes', color: '#57c1ff', set: 'Memory' },
  { id: 'reference', label: 'Reference', color: '#45c8d6', set: 'Memory' },
  { id: 'wiki', label: 'Wiki', color: '#9be564', set: 'Vault' },
  { id: 'raw', label: 'Sources', color: '#b8a58a', set: 'Vault' },
  { id: 'project', label: 'Projects', color: '#f4f4f6', set: 'Workspace' },
  { id: 'chat', label: 'Chats', color: '#f2994a', set: 'Workspace' },
  { id: 'todo', label: 'To-do', color: '#ffc533', set: 'Workspace' },
  { id: 'rule', label: 'CLAUDE.md files', color: '#ff7ab3', set: 'Workspace' },
]
export const groupOf = (n: GraphNode): Group => n.kind === 'memory' ? (n.type === 'project' ? 'project-memory' : n.type ?? 'reference') : n.kind


export type P3 = { x: number; y: number; z: number }
/** Camera spot that fits pts in `fill` of a view with this vertical fov (degrees) and aspect, level, from the side cam is on.
 * Centred on what lands on screen, not the box: perspective makes near points bigger, so the box centre sits off. */
export function framePose(pts: P3[], cam: P3, fov: number, aspect: number, fill = 0.8): { at: P3; pos: P3 } | undefined {
  if (!pts.length) return undefined
  const mid = (k: keyof P3) => { const v = pts.map(p => p[k]); return (Math.min(...v) + Math.max(...v)) / 2 }
  const o = { x: mid('x'), y: mid('y'), z: mid('z') }
  const h = Math.hypot(cam.x - o.x, cam.z - o.z) || 1
  const f = { x: (cam.x - o.x) / h, z: (cam.z - o.z) / h }
  const t = Math.tan((fov * Math.PI) / 360)
  // near: toward the camera; side: screen right, (f.z, -f.x) on the ground.
  const r = pts.map(p => ({ near: (p.x - o.x) * f.x + (p.z - o.z) * f.z, side: (p.x - o.x) * f.z - (p.z - o.z) * f.x, y: p.y - o.y }))
  const deep = Math.max(...r.map(p => p.near))
  // Both by bisection: the screen centre falls as the offset grows, the spread as the camera backs off.
  const bisect = (lo: number, hi: number, up: (v: number) => boolean) => { for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (up(m)) lo = m; else hi = m } return (lo + hi) / 2 }
  const fit = (d: number, k: 'side' | 'y') => {
    const at = (c: number) => { const v = r.map(p => (p[k] - c) / (d - p.near)); return [Math.min(...v), Math.max(...v)] }
    const c = bisect(Math.min(...r.map(p => p[k])), Math.max(...r.map(p => p[k])), c => { const [lo, hi] = at(c); return lo + hi > 0 })
    const [lo, hi] = at(c)
    return { c, e: (hi - lo) / 2 / (k === 'side' ? t * aspect : t) }
  }
  const spread = (d: number) => Math.max(fit(d, 'side').e, fit(d, 'y').e)
  let hi = Math.max(60, deep + 1)
  while (spread(hi) > fill) hi *= 2
  const d = Math.max(60, bisect(deep + 1e-6, hi, d => spread(d) > fill))
  const sc = fit(d, 'side').c, yc = fit(d, 'y').c
  const at = { x: o.x + f.z * sc, y: o.y + yc, z: o.z - f.x * sc }
  return { at, pos: { x: at.x + f.x * d, y: at.y, z: at.z + f.z * d } }
}

/** cam moved along its line to at, k times as far. */
export const dolly = (cam: P3, at: P3, k: number): P3 => ({ x: at.x + (cam.x - at.x) * k, y: at.y + (cam.y - at.y) * k, z: at.z + (cam.z - at.z) * k })

/** How long ago t was, short: "just now", "5m ago", "2h ago", "3d ago", "6w ago". */
export function ago(t: number, now = Date.now()): string {
  const m = Math.max(0, (now - t) / 6e4)
  return m < 1 ? 'just now' : m < 60 ? `${Math.floor(m)}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : m < 20160 ? `${Math.floor(m / 1440)}d ago` : `${Math.floor(m / 10080)}w ago`
}

const aka = (n: GraphNode, s: string) => !!n.aliases?.some(a => a.toLowerCase().includes(s))

/** Up to 8 visible nodes whose label or an alias holds q, labels starting with it first. */
export function findNodes(nodes: GraphNode[], q: string, off: Set<string>): GraphNode[] {
  const s = q.trim().toLowerCase()
  if (!s) return []
  return nodes.filter(n => !off.has(groupOf(n)) && (n.label.toLowerCase().includes(s) || aka(n, s)))
    .sort((a, b) => Number(!!a.superseded) - Number(!!b.superseded) || Number(!a.label.toLowerCase().startsWith(s)) - Number(!b.label.toLowerCase().startsWith(s)) || a.label.length - b.label.length)
    .slice(0, 8)
}

export function neighbors(g: MemoryGraph, id: string): GraphNode[] {
  const ids = new Set(g.edges.flatMap(e => (e.source === id ? [e.target] : e.target === id ? [e.source] : [])))
  ids.delete(id)
  return g.nodes.filter(n => ids.has(n.id))
}

/** Every visible node matching q by label, alias or description, for the list view: by project, superseded last. */
export function listNodes(nodes: GraphNode[], q: string, off: Set<string>, proj = new Map<string, string>()): GraphNode[] {
  const s = q.trim().toLowerCase()
  const by = (n: GraphNode) => proj.get(n.id)
  return nodes.filter(n => !off.has(groupOf(n)) && (!s || n.label.toLowerCase().includes(s) || aka(n, s) || !!n.description?.toLowerCase().includes(s)))
    .sort((a, b) => Number(!!a.superseded) - Number(!!b.superseded) || Number(!by(a)) - Number(!by(b)) || (by(a) ?? '').localeCompare(by(b) ?? ''))
}

/** Node id to the name of the one project its `in` edges lead to; none for the vault or a file every project shares. */
export function projectOf(g: MemoryGraph): Map<string, string> {
  const names = new Map(g.nodes.filter(n => n.kind === 'project').map(n => [n.id, n.label]))
  const ups = new Map<string, string[]>()
  for (const e of g.edges) if (e.kind === 'in' && names.has(e.target)) ups.set(e.source, [...(ups.get(e.source) ?? []), e.target])
  return new Map([...ups].filter(([, l]) => l.length === 1).map(([id, l]) => [id, names.get(l[0])!]))
}

const NOTE = new Set<GraphNode['kind']>(['memory', 'wiki', 'raw'])
/** Notes, and the links and typed relations between them; in, from and todo only say where a thing sits. */
export const graphCounts = (g: MemoryGraph) => ({ notes: g.nodes.filter(n => NOTE.has(n.kind)).length, links: g.edges.filter(e => !['in', 'from', 'todo'].includes(e.kind)).length })

/** The list view's health line as parts: each nonzero count, singular or plural, and the nodes it counts. */
export function healthParts(h: GraphHealth, nodes: GraphNode[]): { text: string; ids: string[] }[] {
  const dup = new Set(h.duplicates)
  const named = nodes.filter(n => dup.has(n.label.toLowerCase()) || !!n.aliases?.some(a => dup.has(a.toLowerCase()))).map(n => n.id)
  const rows: [unknown[], string[], string, string][] = [
    [h.dangling, h.dangling, 'note with broken links', 'notes with broken links'], [h.orphans, h.orphans, 'unlinked note', 'unlinked notes'], [h.duplicates, named, 'shared name', 'shared names'],
    [h.contradictions, [...new Set(h.contradictions.flat())], 'contradiction', 'contradictions'], [h.superseded, h.superseded, 'superseded note', 'superseded notes'],
    [h.loops, h.loops.flat(), 'supersede loop', 'supersede loops'], [h.invalid, h.invalid, 'invalid note', 'invalid notes'], [h.stale, h.stale, 'stale note', 'stale notes'],
  ]
  return rows.filter(([l]) => l.length).map(([l, ids, one, many]) => ({ text: `${l.length} ${l.length === 1 ? one : many}`, ids }))
}

export const healthLine = (h: GraphHealth) => healthParts(h, []).map(p => p.text).join(', ')

/** Section titles for a typed edge, read from its source and from its target. */
const TYPED: [GraphEdge['kind'], string, string][] = [
  ['supersedes', 'Supersedes', 'Superseded by'], ['depends-on', 'Depends on', 'Needed by'], ['part-of', 'Part of', 'Has parts'],
  ['contradicts', 'Contradicts', 'Contradicted by'], ['related', 'Related', 'Related from'], ['from', 'From chat', 'Wrote'],
]

/** A node's edges split by meaning: notes it links to, notes linking to it, what it sits in, what sits in it,
 * and each typed relation under its own title. */
export function relations(g: MemoryGraph, id: string) {
  const pick = (ids: string[]) => g.nodes.filter(n => n.id !== id && ids.includes(n.id))
  const link = g.edges.filter(e => e.kind === 'link'), rest = g.edges.filter(e => e.kind === 'in' || e.kind === 'todo')
  return {
    to: pick(link.filter(e => e.source === id).map(e => e.target)),
    from: pick(link.filter(e => e.target === id).map(e => e.source)),
    up: pick(rest.filter(e => e.source === id).map(e => e.target)),
    down: pick(rest.filter(e => e.target === id).map(e => e.source)),
    typed: TYPED.flatMap(([k, out, back]) => {
      const es = g.edges.filter(e => e.kind === k)
      return [{ title: out, list: pick(es.filter(e => e.source === id).map(e => e.target)) }, { title: back, list: pick(es.filter(e => e.target === id).map(e => e.source)) }]
    }).filter(t => t.list.length),
  }
}

/** The graph, or why not. It never leaves this Mac: the panel asks the extension, the app its own proxy. */
export async function loadGraph(f: typeof fetch = fetch): Promise<MemoryGraph | string> {
  if (vscodeBridge?.isVSCode) return vscodeBridge.graph()
  try {
    const r = await f('/hub/graph', { headers: { 'X-Switchboard': '1' }, cache: 'no-store' })
    return r.ok ? ((await r.json()) as MemoryGraph) : downReason(r.status)
  } catch {
    return downReason(undefined)
  }
}

export function demoGraph(big = false): MemoryGraph {
  const g = baseDemo()
  return big ? padDemo(g) : g
}

function baseDemo(): MemoryGraph {
  const nodes: GraphNode[] = [
    { id: 'project:/w/Armasu', kind: 'project', label: 'Armasu' },
    { id: 'project:/w/switchboard', kind: 'project', label: 'switchboard' },
    { id: 'm:logo', kind: 'memory', type: 'project', label: 'armasu-logo', description: 'Dawn logo with the curved horizon', text: 'Picked Dawn with the curved horizon. Colors live in [[armasu-colour-tokens]].' },
    { id: 'm:tokens', kind: 'memory', type: 'reference', label: 'armasu-colour-tokens', description: 'Where the color tokens are', text: 'Tokens in app/globals.css; never hard-code a hex.' },
    { id: 'm:style', kind: 'memory', type: 'feedback', label: 'no-em-dashes', description: 'No em dashes anywhere', text: 'Kenneth reads diffs by hand. No em dashes, terse comments.' },
    { id: 'm:who', kind: 'memory', type: 'user', label: 'kenneth', description: 'Who Kenneth is', text: 'Builds Armasu and Switchboard; reviews on a phone.' },
    { id: 'm:vision', kind: 'memory', type: 'project', label: 'switchboard-vision', description: 'The bar for Switchboard', text: 'Simple, one-click chat, roles, no auto-commit. See [[no-em-dashes]].', missing: ['old-roadmap'] },
    { id: 'chat:a', kind: 'chat', label: 'Armasu v3' },
    { id: 'chat:b', kind: 'chat', label: 'switchboard v7' },
    { id: 'todo:1', kind: 'todo', label: 'Ship the logo files', text: 'Ship the logo files' },
    { id: 'rule:global', kind: 'rule', label: '~/.claude/CLAUDE.md', text: '# Working style\n\nYou are the lead of this chat.' },
    { id: 'wiki:switchboard-design.md', kind: 'wiki', label: 'switchboard-design', description: 'How the hub page is laid out', text: 'Dark canvas from [[raycast-notes]]. Keeps to [[switchboard-vision]].' },
    { id: 'raw:raycast-notes.md', kind: 'raw', label: 'raycast-notes', text: 'Clipped notes on the Raycast site: near-black canvas, hairline borders, one white button.' },
    { id: 'm:recall', kind: 'memory', type: 'project', label: 'hub-recall', aliases: ['recall-tool'], origin: 'b', modified: '2026-11-01T10:00:00Z', description: 'Chats search memory before researching', text: 'hub_recall walks the graph from the best notes.' },
    { id: 'm:askall', kind: 'memory', type: 'project', label: 'ask-for-everything', superseded: true, description: 'Every lookup was a paid hub_ask', text: 'Asked the brain for every lookup.' },
    { id: 'm:nograph', kind: 'memory', type: 'feedback', label: 'no-graph-view', description: 'Memory as a flat list only', text: 'A graph view is noise; list the notes.' },
  ]
  const e = (source: string, target: string, kind: GraphEdge['kind'] = 'in'): GraphEdge => ({ source, target, kind })
  return {
    nodes,
    edges: [
      e('m:logo', 'project:/w/Armasu'), e('m:tokens', 'project:/w/Armasu'), e('m:style', 'project:/w/Armasu'), e('m:who', 'project:/w/Armasu'),
      e('m:vision', 'project:/w/switchboard'), e('m:logo', 'm:tokens', 'link'), e('m:vision', 'm:style', 'link'),
      e('chat:a', 'project:/w/Armasu'), e('chat:b', 'project:/w/switchboard'), e('todo:1', 'project:/w/Armasu'), e('todo:1', 'chat:a', 'todo'), e('rule:global', 'project:/w/Armasu'), e('rule:global', 'project:/w/switchboard'),
      e('wiki:switchboard-design.md', 'm:vision', 'link'), e('wiki:switchboard-design.md', 'raw:raycast-notes.md', 'link'),
      e('m:recall', 'project:/w/switchboard'), e('m:askall', 'project:/w/switchboard'), e('m:nograph', 'project:/w/switchboard'),
      e('m:recall', 'm:askall', 'supersedes'), e('m:recall', 'wiki:switchboard-design.md', 'depends-on'), e('m:recall', 'm:vision', 'part-of'),
      e('m:nograph', 'm:recall', 'contradicts'), e('m:recall', 'm:style', 'related'), e('m:recall', 'chat:b', 'from'),
    ],
    health: { dangling: ['m:vision'], orphans: ['m:who'], duplicates: [], contradictions: [['m:nograph', 'm:recall']], superseded: ['m:askall'], invalid: [], stale: [], loops: [] },
  }
}

// Demo only: about 120 extra notes over 5 projects so map layouts can be judged at a real size (?big=1).
function padDemo(g: MemoryGraph): MemoryGraph {
  const projects = ['Armasu', 'switchboard', 'claude-mods', 'source-check', 'vault']
  const topics = ['tokens', 'release', 'hooks', 'tests', 'layout', 'routing', 'memory', 'phone', 'auth', 'copy', 'crowd', 'stages', 'picker', 'todo', 'gates', 'graph', 'search', 'cache', 'deploy', 'design', 'usage', 'codex', 'review', 'screens']
  const types = ['feedback', 'project', 'reference', 'user'] as const
  // Days since each project was last touched; its notes spread up to 20 days older, a few of the first two from today.
  const fresh = [0, 0.2, 3, 18, 40], now = Date.now(), at = (days: number) => new Date(now - days * 864e5).toISOString()
  const nodes = g.nodes.map((n, i) => (NOTE.has(n.kind) && !n.modified ? { ...n, modified: at(1 + i * 2.5) } : n)), edges = [...g.edges]
  const health = { ...g.health, dangling: [...g.health.dangling], orphans: [...g.health.orphans], contradictions: [...g.health.contradictions], superseded: [...g.health.superseded], stale: [...g.health.stale] }
  for (const p of projects) if (!nodes.some(n => n.id === `project:/w/${p}`)) nodes.push({ id: `project:/w/${p}`, kind: 'project', label: p })
  const ids: string[] = []
  for (let i = 0; i < 120; i++) {
    const p = projects[i % projects.length]!, t = topics[(i * 7) % topics.length]!
    const id = `m:x${i}`, label = `${p.toLowerCase().slice(0, 6)}-${t}-${i}`
    const wiki = i % 9 === 0, pi = i % projects.length
    const modified = at(i < 10 && pi < 2 ? (i * 1.7 + 0.5) / 24 : i < 5 ? fresh[pi]! : fresh[pi]! + (((i * 13) % 23) / 23) * 20)
    nodes.push(wiki
      ? { id: `wiki:${label}.md`, kind: 'wiki', label, modified, description: `How ${t} works in ${p}`, text: `Notes on ${t} for ${p}.` }
      : { id, kind: 'memory', type: types[i % types.length], label, modified, description: `${t} rule for ${p}`, text: `Keep ${t} simple in ${p}. See [[${p.toLowerCase().slice(0, 6)}-${topics[(i * 7 + 7) % topics.length]}-${(i + 5) % 120}]].` })
    const nid = wiki ? `wiki:${label}.md` : id
    ids.push(nid)
    edges.push({ source: nid, target: `project:/w/${p}`, kind: 'in' })
  }
  ids.forEach((id, i) => {
    edges.push({ source: id, target: ids[(i + 5) % ids.length]!, kind: 'link' })
    if (i % 4 === 0) edges.push({ source: id, target: ids[(i + 17) % ids.length]!, kind: 'related' })
    if (i % 11 === 0) edges.push({ source: id, target: ids[(i + 1) % ids.length]!, kind: 'depends-on' })
    if (i % 23 === 0) { edges.push({ source: id, target: ids[(i + 2) % ids.length]!, kind: 'supersedes' }); health.superseded.push(ids[(i + 2) % ids.length]!) }
    if (i % 31 === 0) { edges.push({ source: id, target: ids[(i + 40) % ids.length]!, kind: 'contradicts' }); health.contradictions.push([id, ids[(i + 40) % ids.length]!]) }
    if (i % 29 === 7) health.stale.push(id)
  })
  return { nodes, edges, health }
}

/** Projects with no notes in their place (chat folders only): the map leaves them out. */
export function bareProjects(nodes: { id: string; kind: string; label: string }[], place: Map<string, string>) {
  const full = new Set(nodes.filter(n => n.kind !== 'project').map(n => place.get(n.id)))
  return new Set(nodes.filter(n => n.kind === 'project' && !full.has(n.label)).map(n => n.id))
}
