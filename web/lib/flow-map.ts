/**
 * The Flow map's data: the map extension/src/hub/flowmap.ts builds (same shapes), how to get it
 * (the panel's flowmap-get, else the app's /hub/flowmap proxy), the folded view the canvas draws, and the side card's words.
 */
import { vscodeBridge } from './vscode-bridge'
import { downReason } from './hub-remote'

export type FlowKind = 'folder' | 'file' | 'chat' | 'skill' | 'plugin' | 'mod' | 'role'
export type FlowNode = { id: string; kind: FlowKind; label: string; folder?: string; about?: string; first?: number; at?: number }
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

export const KIND_NAME: Record<FlowKind, string> = { folder: 'Folder', file: 'File', chat: 'Chat', skill: 'Skill', plugin: 'Plugin', mod: 'Mod', role: 'Role' }
const CODE = new Set<FlowKind>(['folder', 'file'])

const parentPath = (p: string) => { const k = p.lastIndexOf('/'); return k < 0 ? undefined : p.slice(0, k) }
const trees = new WeakMap<FlowMap, FlowMap>()
/** The map with every folder's parent set and missing ancestors added, so old data (cut at 3 levels, no parents) folds as a tree too. */
export function withTree(map: FlowMap): FlowMap {
  const done = trees.get(map)
  if (done) return done
  const nodes = map.nodes.map(n => (n.kind === 'folder' && !n.folder && n.id !== 'd:.' && parentPath(n.id.slice(2)) ? { ...n, folder: `d:${parentPath(n.id.slice(2))}` } : n))
  const have = new Set(nodes.map(n => n.id))
  for (const n of [...nodes]) {
    for (let p = n.kind === 'folder' ? n.folder?.slice(2) : undefined; p && !have.has(`d:${p}`); p = parentPath(p)) {
      have.add(`d:${p}`)
      const up = parentPath(p)
      nodes.push({ id: `d:${p}`, kind: 'folder', label: p, ...(up ? { folder: `d:${up}` } : {}) })
    }
  }
  const out = { ...map, nodes }
  trees.set(map, out).set(out, out)
  return out
}

/** Opens a folder one level, or folds it and everything under it. */
export function toggleOpen(open: ReadonlySet<string>, id: string): Set<string> {
  if (!open.has(id)) return new Set([...open, id])
  return new Set([...open].filter(x => x !== id && !x.startsWith(`${id}/`)))
}

/** files/subs: a folder's direct files and subfolders; open: they are drawn; chats: how many drawn chats used a tool. */
export type ViewNode = FlowNode & { files?: number; subs?: number; open?: boolean; hit?: boolean; chats?: number }
export type ViewEdge = { from: string; to: string; kind: FlowEdge['kind']; n: number }

/** What the canvas draws: a node shows when every folder above it is open, else its topmost shut folder stands in;
 * edges follow, merged. A search looks through every node, opens the folders its hits sit in, and keeps hits and their neighbours. */
export function foldView(raw: FlowMap, opened: ReadonlySet<string>, q = '', hide: ReadonlySet<FlowKind> = new Set()): { nodes: ViewNode[]; edges: ViewEdge[] } {
  const map = withTree(raw)
  const byId = new Map(map.nodes.map(n => [n.id, n]))
  const up = (id: string) => { const out: string[] = []; for (let p = byId.get(id)?.folder; p && byId.has(p); p = byId.get(p)!.folder) out.unshift(p); return out }
  const needle = q.trim().toLowerCase()
  const hits = new Set(needle ? map.nodes.filter(n => !hide.has(n.kind) && `${n.label} ${n.about ?? ''}`.toLowerCase().includes(needle)).map(n => n.id) : [])
  const open = new Set(opened)
  for (const h of hits) for (const a of up(h)) open.add(a)
  const files = new Map<string, number>(), subs = new Map<string, number>()
  for (const n of map.nodes) if (n.folder && (n.kind === 'file' || n.kind === 'folder')) { const m = n.kind === 'file' ? files : subs; m.set(n.folder, (m.get(n.folder) ?? 0) + 1) }
  const stand = (id: string): string | undefined => {
    if (!byId.has(id) || hide.has(byId.get(id)!.kind)) return undefined
    return up(id).find(a => !open.has(a)) ?? id
  }
  const merged = new Map<string, ViewEdge>()
  for (const e of map.edges) {
    const a = stand(e.from), b = stand(e.to)
    if (!a || !b || a === b) continue
    const k = `${a}\n${b}\n${e.kind}`
    const m = merged.get(k)
    if (m) m.n += e.n
    else merged.set(k, { from: a, to: b, kind: e.kind, n: e.n })
  }
  let nodes: ViewNode[] = map.nodes.filter(n => !hide.has(n.kind) && stand(n.id) === n.id)
    .map(n => (n.kind === 'folder' ? { ...n, files: files.get(n.id) ?? 0, subs: subs.get(n.id) ?? 0, open: open.has(n.id) } : { ...n }))
  nodes = nodes.filter(n => n.kind !== 'folder' || n.files || n.subs)
  let edges = [...merged.values()]
  if (needle) {
    const keep = new Set(hits)
    for (const e of edges) { if (hits.has(e.from)) keep.add(e.to); if (hits.has(e.to)) keep.add(e.from) }
    nodes = nodes.filter(n => keep.has(n.id)).map(n => ({ ...n, hit: hits.has(n.id) }))
  }
  const ids = new Set(nodes.map(n => n.id))
  edges = edges.filter(e => ids.has(e.from) && ids.has(e.to))
  const chats = new Map<string, number>()
  for (const e of edges) if (e.kind === 'used') chats.set(e.to, (chats.get(e.to) ?? 0) + 1)
  return { nodes: nodes.map(n => (chats.has(n.id) ? { ...n, chats: chats.get(n.id) } : n)), edges }
}

const laneOf = (k: FlowKind) => LANES.findIndex(l => l.kinds.includes(k))
/** Import lines inside one lane that rest hidden: past 40 they are a grey wall. Hover or a pick shows a box's own. */
export function quietEdges(nodes: ViewNode[], edges: ViewEdge[], most = 40): Set<ViewEdge> {
  const kind = new Map(nodes.map(n => [n.id, n.kind]))
  const same = edges.filter(e => e.kind === 'import' && laneOf(kind.get(e.from) ?? 'file') === laneOf(kind.get(e.to) ?? 'file'))
  return new Set(edges.filter(e => e.kind === 'import').length > most ? same : [])
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
/** A box's two lines. Skills lose their plugin prefix, which moves to the small line. */
export function boxText(n: ViewNode): { name: string; meta: string } {
  const tail = n.label.split('/').filter(Boolean).pop() ?? n.label
  if (n.kind === 'folder') {
    const parts = [n.subs ? plural(n.subs, 'folder') : '', n.files || !n.subs ? plural(n.files ?? 0, 'file') : '', n.open ? 'open' : ''].filter(Boolean)
    return { name: n.id === 'd:.' ? n.label : tail, meta: parts.join(', ') }
  }
  if (n.kind === 'file') {
    // its folder, so 23 route.ts boxes tell apart; long paths keep their deep end
    const dir = n.label.includes('/') ? n.label.slice(0, n.label.lastIndexOf('/')) : ''
    return { name: tail, meta: !dir ? KIND_NAME.file : dir.length > 30 ? `...${dir.slice(-27)}` : dir }
  }
  if (n.kind === 'chat') return { name: n.label, meta: when(n.at) }
  const k = n.kind === 'skill' ? n.label.indexOf(':') : -1
  const from = k > 0 ? n.label.slice(0, k) : ''
  const used = n.chats ? plural(n.chats, 'chat') : ''
  return { name: k > 0 ? n.label.slice(k + 1) : n.label, meta: [from, used].filter(Boolean).join(', ') || KIND_NAME[n.kind] }
}

/** Which project the map opens on: this window's, else the last one picked in the map (if still registered), else the chat's. */
export function startProject(cwds: string[], here?: string, saved?: string, chat?: string): string | undefined {
  return here ?? (saved && cwds.includes(saved) ? saved : undefined) ?? chat ?? cwds[0]
}

export const NODE_W = 216, NODE_H = 56
// chat names get a third line
export const boxH = (k: FlowKind) => (k === 'chat' ? 72 : NODE_H)
const GX = 16, GY = 10, LANE_GAP = 140
const LANES: { name: string; kinds: FlowKind[] }[] = [
  { name: 'Folders', kinds: ['folder', 'file'] },
  { name: 'Chats', kinds: ['chat'] },
  { name: 'Skills, plugins, mods and roles', kinds: ['skill', 'plugin', 'mod', 'role'] },
]
const TOOL_ORDER: FlowKind[] = ['skill', 'plugin', 'mod', 'role']
export type Lane = { name: string; x: number; count: number }
export type Layout = { at: Map<string, { x: number; y: number }>; lanes: Lane[]; width: number; height: number }

/** Lanes left to right (code, chats, tools), each wrapped into columns so the whole map comes out near `aspect` (width / height).
 * maxW: no wider than this, so a big map scrolls down at a readable zoom instead of running off the right edge. */
export function layoutView(nodes: ViewNode[], edges: ViewEdge[], aspect = 1.6, maxW = Infinity): Layout {
  const uses = new Map<string, number>()
  for (const e of edges) uses.set(e.to, (uses.get(e.to) ?? 0) + e.n)
  // Folders sit above their own files; chats newest first; tools by kind, then most used.
  const codeKey = (n: ViewNode) => (n.kind === 'folder' ? `${n.id.slice(2)}\u0000` : `${(n.folder ?? '').slice(2)}\u0000${n.label}`)
  const sorts: ((a: ViewNode, b: ViewNode) => number)[] = [
    (a, b) => { const x = codeKey(a), y = codeKey(b); return x < y ? -1 : x > y ? 1 : 0 },
    (a, b) => (b.at ?? 0) - (a.at ?? 0),
    (a, b) => TOOL_ORDER.indexOf(a.kind) - TOOL_ORDER.indexOf(b.kind) || (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0) || a.label.localeCompare(b.label),
  ]
  const lanes = LANES.map((l, i) => ({ name: l.name, of: nodes.filter(n => l.kinds.includes(n.kind)).sort(sorts[i]) })).filter(l => l.of.length)
  const most = Math.max(1, ...lanes.map(l => l.of.length))
  const pitch = (l: { of: ViewNode[] }) => Math.max(...l.of.map(n => boxH(n.kind))) + GY
  const size = (rows: number) => {
    const width = lanes.reduce((w, l) => w + Math.ceil(l.of.length / rows) * (NODE_W + GX) - GX, 0) + LANE_GAP * Math.max(0, lanes.length - 1)
    return { width: Math.max(width, NODE_W), height: Math.max(NODE_H + GY, ...lanes.map(l => Math.min(rows, l.of.length) * pitch(l))) - GY }
  }
  let rows = most, best = Infinity
  for (let r = 1; r <= most; r++) {
    const s = size(r), off = Math.abs(Math.log(s.width / s.height / aspect))
    if (off < best - 1e-9) { best = off; rows = r }
  }
  while (rows < most && size(rows).width > maxW) rows++
  const at = new Map<string, { x: number; y: number }>()
  const out: Lane[] = []
  let x = 0
  for (const l of lanes) {
    out.push({ name: l.name, x, count: l.of.filter(n => n.kind !== 'file').length })
    l.of.forEach((n, i) => at.set(n.id, { x: x + Math.floor(i / rows) * (NODE_W + GX), y: (i % rows) * pitch(l) }))
    x += Math.ceil(l.of.length / rows) * (NODE_W + GX) - GX + LANE_GAP
  }
  return { at, lanes: out, ...size(rows) }
}

/** Smallest zoom the map opens at: below it the 13px names drop under 11px. */
export const READ = 0.85
// Room the canvas keeps clear for the lane titles and zoom buttons, in screen px.
export const PAD = { top: 48, right: 72, bottom: 24, left: 32 }
/** How the map opens in a w by h canvas: the whole map when that stays readable, else READ zoom from the top left (the fit button still shows all). */
export function openView(lay: Pick<Layout, 'width' | 'height'>, w: number, h: number): 'fit' | { x: number; y: number; zoom: number } {
  const across = (w - PAD.left - PAD.right) / lay.width, z = Math.min(1, across, (h - PAD.top - PAD.bottom) / (lay.height + 40))
  // a narrow canvas can't hold the lanes at READ, so shrink to its width and scroll down
  const zoom = Math.min(READ, across)
  return z >= READ ? 'fit' : { x: PAD.left, y: PAD.top + 40 * zoom, zoom }
}

/** Which sides an edge leaves and enters by: toward the other node, or both on the right when they share a column. */
export function sidesOf(a?: { x: number }, b?: { x: number }): { from: 'l' | 'r'; to: 'l' | 'r' } {
  if (!a || !b || a.x === b.x) return { from: 'r', to: 'r' }
  return a.x < b.x ? { from: 'r', to: 'l' } : { from: 'l', to: 'r' }
}

/** Who lights up with whom: edge ends, plus an open folder and what it shows. */
export function neighbours(edges: ViewEdge[], nodes: ViewNode[] = []): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  const add = (a: string, b: string) => { let s = m.get(a); if (!s) m.set(a, (s = new Set())); s.add(b) }
  for (const e of edges) { add(e.from, e.to); add(e.to, e.from) }
  const drawn = new Set(nodes.map(n => n.id))
  for (const n of nodes) if ((n.kind === 'file' || n.kind === 'folder') && n.folder && drawn.has(n.folder)) { add(n.folder, n.id); add(n.id, n.folder) }
  return m
}

export type Card = { title: string; kind: string; about: string; uses: string[]; usedBy: string[]; history: { who: string; at?: number; with: string[] }[] }

const day = (ms?: number) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '')
export const when = day

/** The side card for one node, in plain words. */
export function cardOf(raw: FlowMap, id: string): Card | undefined {
  const map = withTree(raw)
  const n = map.nodes.find(x => x.id === id)
  if (!n) return undefined
  const byId = new Map(map.nodes.map(x => [x.id, x]))
  const label = (i: string) => byId.get(i)?.label ?? i
  const mine = (i: string) => i === id || byId.get(i)?.folder === id || (n.kind === 'folder' && id !== 'd:.' && i.slice(2).startsWith(`${id.slice(2)}/`))
  const outside = (i: string) => !mine(i)
  const uses = new Set<string>(), usedBy = new Set<string>()
  for (const e of map.edges) {
    if (e.kind === 'touched') continue
    if (mine(e.from) && outside(e.to)) uses.add(label(byId.get(e.to)?.folder && n.kind === 'folder' ? byId.get(e.to)!.folder! : e.to))
    if (mine(e.to) && outside(e.from)) usedBy.add(label(byId.get(e.from)?.folder && n.kind === 'folder' ? byId.get(e.from)!.folder! : e.from))
  }
  const tools = (chat: string) => map.edges.filter(e => e.from === chat && e.kind === 'used').map(e => label(e.to))
  const history: Card['history'] = []
  if (CODE.has(n.kind)) {
    const last = new Map<string, number>()
    for (const e of map.edges) if (e.kind === 'touched' && mine(e.to)) last.set(e.from, Math.max(last.get(e.from) ?? 0, e.at ?? 0))
    for (const [chat, at] of last) history.push({ who: label(chat), at: at || byId.get(chat)?.at, with: tools(chat) })
  } else if (n.kind === 'chat') {
    const files = map.edges.filter(e => e.from === id && e.kind === 'touched').map(e => label(e.to))
    history.push({ who: files.length ? `Changed ${files.length} file${files.length === 1 ? '' : 's'}: ${files.slice(0, 6).join(', ')}${files.length > 6 ? ', ...' : ''}` : 'Changed no files here', at: n.at, with: [] })
  } else {
    for (const e of map.edges) if (e.to === id && e.kind === 'used') history.push({ who: label(e.from), at: byId.get(e.from)?.at, with: [] })
  }
  history.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
  const about = n.about ?? (n.kind === 'chat' ? `A chat that ran in ${map.project}${n.first ? ` from ${day(n.first)}` : ''}${n.at ? ` to ${day(n.at)}` : ''}.`
    : n.kind === 'folder' ? 'A folder of code. No README or header comment says what it is for yet.'
    : n.kind === 'file' ? 'A code file. It has no header comment saying what it does.'
    : `A ${KIND_NAME[n.kind].toLowerCase()} the chats here called on.`)
  return { title: n.label, kind: KIND_NAME[n.kind], about, uses: [...uses], usedBy: [...usedBy], history }
}

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
    { id: 'chat:a', kind: 'chat', label: 'Today card v2', first: t - 86_400_000 * 2, at: t - 86_400_000 },
    { id: 'chat:b', kind: 'chat', label: 'Hub state cleanup', first: t - 3_600_000 * 5, at: t },
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
