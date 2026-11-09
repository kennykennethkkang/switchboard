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
export type Mode = 'code' | 'work' | 'both'

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

export const KIND_NAME: Record<FlowKind, string> = { folder: 'Folder', file: 'File', chat: 'Chat', skill: 'Skill', plugin: 'Plugin', mod: 'Mod', role: 'Helper role' }
const CODE = new Set<FlowKind>(['folder', 'file'])
const inMode = (k: FlowKind, mode: Mode) => mode === 'both' || (mode === 'code') === CODE.has(k)

/** files: how many files a folder holds; open: its files are drawn instead. */
export type ViewNode = FlowNode & { files?: number; open?: boolean; hit?: boolean }
export type ViewEdge = { from: string; to: string; kind: FlowEdge['kind']; n: number }

/** What the canvas draws: folders stand in for their files unless open; edges follow, merged; a search keeps hits and their neighbours. */
export function foldView(map: FlowMap, mode: Mode, open: ReadonlySet<string>, q = '', hide: ReadonlySet<FlowKind> = new Set()): { nodes: ViewNode[]; edges: ViewEdge[] } {
  const counts = new Map<string, number>()
  for (const n of map.nodes) if (n.kind === 'file' && n.folder) counts.set(n.folder, (counts.get(n.folder) ?? 0) + 1)
  const shown = (n: FlowNode) => inMode(n.kind, mode) && !hide.has(n.kind) && (n.kind === 'file' ? !!n.folder && open.has(n.folder) : true)
  const byId = new Map(map.nodes.map(n => [n.id, n]))
  const stand = (id: string): string | undefined => {
    const n = byId.get(id)
    if (!n || !inMode(n.kind, mode) || hide.has(n.kind)) return undefined
    return n.kind === 'file' && n.folder && !open.has(n.folder) ? n.folder : id
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
  let nodes: ViewNode[] = map.nodes.filter(shown).map(n => (n.kind === 'folder' ? { ...n, files: counts.get(n.id) ?? 0, open: open.has(n.id) } : { ...n }))
  // An open folder with its files showing only frames them; drop it when it has none.
  nodes = nodes.filter(n => n.kind !== 'folder' || n.files)
  let edges = [...merged.values()]
  const needle = q.trim().toLowerCase()
  if (needle) {
    const hits = new Set(nodes.filter(n => `${n.label} ${n.about ?? ''}`.toLowerCase().includes(needle)).map(n => n.id))
    const keep = new Set(hits)
    for (const e of edges) { if (hits.has(e.from)) keep.add(e.to); if (hits.has(e.to)) keep.add(e.from) }
    nodes = nodes.filter(n => keep.has(n.id)).map(n => ({ ...n, hit: hits.has(n.id) }))
  }
  const ids = new Set(nodes.map(n => n.id))
  edges = edges.filter(e => ids.has(e.from) && ids.has(e.to))
  return { nodes, edges }
}

export const NODE_W = 216, NODE_H = 48
const GX = 16, GY = 10, LANE_GAP = 140
const LANES: { name: string; kinds: FlowKind[] }[] = [
  { name: 'Code', kinds: ['folder', 'file'] },
  { name: 'Chats', kinds: ['chat'] },
  { name: 'Skills, plugins, mods and roles', kinds: ['skill', 'plugin', 'mod', 'role'] },
]
const TOOL_ORDER: FlowKind[] = ['skill', 'plugin', 'mod', 'role']
export type Lane = { name: string; x: number; count: number }
export type Layout = { at: Map<string, { x: number; y: number }>; lanes: Lane[]; width: number; height: number }

/** Lanes left to right (code, chats, tools), each wrapped into columns so the whole map comes out near `aspect` (width / height). */
export function layoutView(nodes: ViewNode[], edges: ViewEdge[], aspect = 1.6): Layout {
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
  const size = (rows: number) => {
    const width = lanes.reduce((w, l) => w + Math.ceil(l.of.length / rows) * (NODE_W + GX) - GX, 0) + LANE_GAP * Math.max(0, lanes.length - 1)
    return { width: Math.max(width, NODE_W), height: rows * (NODE_H + GY) - GY }
  }
  let rows = most, best = Infinity
  for (let r = 1; r <= most; r++) {
    const s = size(r), off = Math.abs(Math.log(s.width / s.height / aspect))
    if (off < best - 1e-9) { best = off; rows = r }
  }
  const at = new Map<string, { x: number; y: number }>()
  const out: Lane[] = []
  let x = 0
  for (const l of lanes) {
    out.push({ name: l.name, x, count: l.of.length })
    l.of.forEach((n, i) => at.set(n.id, { x: x + Math.floor(i / rows) * (NODE_W + GX), y: (i % rows) * (NODE_H + GY) }))
    x += Math.ceil(l.of.length / rows) * (NODE_W + GX) - GX + LANE_GAP
  }
  return { at, lanes: out, ...size(rows) }
}

/** Which sides an edge leaves and enters by: toward the other node, or both on the right when they share a column. */
export function sidesOf(a?: { x: number }, b?: { x: number }): { from: 'l' | 'r'; to: 'l' | 'r' } {
  if (!a || !b || a.x === b.x) return { from: 'r', to: 'r' }
  return a.x < b.x ? { from: 'r', to: 'l' } : { from: 'l', to: 'r' }
}

/** Each node's neighbours, for the focus highlight. */
export function neighbours(edges: ViewEdge[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  const add = (a: string, b: string) => { let s = m.get(a); if (!s) m.set(a, (s = new Set())); s.add(b) }
  for (const e of edges) { add(e.from, e.to); add(e.to, e.from) }
  return m
}

export type Card = { title: string; kind: string; about: string; uses: string[]; usedBy: string[]; history: { who: string; at?: number; with: string[] }[] }

const day = (ms?: number) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '')
export const when = day

/** The side card for one node, in plain words. */
export function cardOf(map: FlowMap, id: string): Card | undefined {
  const n = map.nodes.find(x => x.id === id)
  if (!n) return undefined
  const byId = new Map(map.nodes.map(x => [x.id, x]))
  const label = (i: string) => byId.get(i)?.label ?? i
  const mine = (i: string) => i === id || byId.get(i)?.folder === id
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
    { id: 'd:web/app', kind: 'folder', label: 'web/app', about: 'The pages people open.' },
    { id: 'd:web/lib', kind: 'folder', label: 'web/lib', about: 'Small helpers the pages share.' },
    { id: 'd:extension/src', kind: 'folder', label: 'extension/src', about: 'The VS Code side that watches chats.' },
    { id: 'f:web/app/page.tsx', kind: 'file', label: 'web/app/page.tsx', folder: 'd:web/app', about: 'The hub page.' },
    { id: 'f:web/lib/today.ts', kind: 'file', label: 'web/lib/today.ts', folder: 'd:web/lib', about: 'What happened today, in a few lines.' },
    { id: 'f:web/lib/todo.ts', kind: 'file', label: 'web/lib/todo.ts', folder: 'd:web/lib' },
    { id: 'f:extension/src/hub.ts', kind: 'file', label: 'extension/src/hub.ts', folder: 'd:extension/src', about: 'Keeps the state every view reads.' },
    { id: 'chat:a', kind: 'chat', label: 'Today card v2', first: t - 86_400_000 * 2, at: t - 86_400_000 },
    { id: 'chat:b', kind: 'chat', label: 'Hub state cleanup', first: t - 3_600_000 * 5, at: t },
    { id: 'skill:superpowers:test-driven-development', kind: 'skill', label: 'superpowers:test-driven-development' },
    { id: 'plugin:playwright', kind: 'plugin', label: 'playwright' },
    { id: 'mod:repo-rules', kind: 'mod', label: 'repo-rules' },
    { id: 'role:engineer', kind: 'role', label: 'engineer' },
  ]
  const edges: FlowEdge[] = [
    { from: 'f:web/app/page.tsx', to: 'f:web/lib/today.ts', kind: 'import', n: 1 },
    { from: 'f:web/app/page.tsx', to: 'f:web/lib/todo.ts', kind: 'import', n: 1 },
    { from: 'f:web/lib/today.ts', to: 'f:web/lib/todo.ts', kind: 'import', n: 1 },
    { from: 'chat:a', to: 'skill:superpowers:test-driven-development', kind: 'used', n: 3 },
    { from: 'chat:a', to: 'plugin:playwright', kind: 'used', n: 6 },
    { from: 'chat:a', to: 'role:engineer', kind: 'used', n: 2 },
    { from: 'chat:a', to: 'f:web/lib/today.ts', kind: 'touched', n: 1, at: t - 86_400_000 },
    { from: 'chat:b', to: 'mod:repo-rules', kind: 'used', n: 4 },
    { from: 'chat:b', to: 'role:engineer', kind: 'used', n: 1 },
    { from: 'chat:b', to: 'f:extension/src/hub.ts', kind: 'touched', n: 1, at: t },
  ]
  return { project: 'switchboard', nodes, edges, builtAt: t }
}
