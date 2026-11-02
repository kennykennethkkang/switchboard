/**
 * The Memory view's data: the graph extension/src/hub/graph.ts builds (same shapes), how to get it
 * (the panel's graph-get, else the app's /hub/graph proxy), groups and colors, and a sample for the demo.
 */
import { vscodeBridge } from './vscode-bridge'
import { downReason } from './hub-remote'

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'
export type GraphNode = { id: string; kind: 'memory' | 'wiki' | 'raw' | 'project' | 'chat' | 'todo' | 'rule'; label: string; type?: MemoryType; description?: string; text?: string; missing?: string[] }
export type GraphEdge = { source: string; target: string; kind: 'link' | 'in' | 'todo' }
export type MemoryGraph = { nodes: GraphNode[]; edges: GraphEdge[] }

export type Group = 'user' | 'feedback' | 'project-memory' | 'reference' | 'wiki' | 'raw' | 'project' | 'chat' | 'todo' | 'rule'
/** Fixed colors: the view is always dark. */
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
  { id: 'rule', label: 'Rules', color: '#ff7ab3', set: 'Workspace' },
]
export const groupOf = (n: GraphNode): Group => n.kind === 'memory' ? (n.type === 'project' ? 'project-memory' : n.type ?? 'reference') : n.kind
export const colorOf = (n: GraphNode) => GROUPS.find(g => g.id === groupOf(n))!.color

/** Up to 8 visible nodes whose label holds q, those starting with it first. */
export function findNodes(nodes: GraphNode[], q: string, off: Set<string>): GraphNode[] {
  const s = q.trim().toLowerCase()
  if (!s) return []
  return nodes.filter(n => !off.has(groupOf(n)) && n.label.toLowerCase().includes(s))
    .sort((a, b) => Number(!a.label.toLowerCase().startsWith(s)) - Number(!b.label.toLowerCase().startsWith(s)) || a.label.length - b.label.length)
    .slice(0, 8)
}

export function neighbors(g: MemoryGraph, id: string): GraphNode[] {
  const ids = new Set(g.edges.flatMap(e => (e.source === id ? [e.target] : e.target === id ? [e.source] : [])))
  ids.delete(id)
  return g.nodes.filter(n => ids.has(n.id))
}

/** Every visible node matching q by label or description, for the list view. */
export function listNodes(nodes: GraphNode[], q: string, off: Set<string>): GraphNode[] {
  const s = q.trim().toLowerCase()
  return nodes.filter(n => !off.has(groupOf(n)) && (!s || n.label.toLowerCase().includes(s) || !!n.description?.toLowerCase().includes(s)))
}

/** A node's edges split by meaning: notes it links to, notes linking to it, what it sits in, what sits in it. */
export function relations(g: MemoryGraph, id: string) {
  const pick = (ids: string[]) => g.nodes.filter(n => n.id !== id && ids.includes(n.id))
  const link = g.edges.filter(e => e.kind === 'link'), rest = g.edges.filter(e => e.kind !== 'link')
  return {
    to: pick(link.filter(e => e.source === id).map(e => e.target)),
    from: pick(link.filter(e => e.target === id).map(e => e.source)),
    up: pick(rest.filter(e => e.source === id).map(e => e.target)),
    down: pick(rest.filter(e => e.target === id).map(e => e.source)),
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

export function demoGraph(): MemoryGraph {
  const nodes: GraphNode[] = [
    { id: 'project:/w/Armasu', kind: 'project', label: 'Armasu' },
    { id: 'project:/w/agent-flow', kind: 'project', label: 'agent-flow' },
    { id: 'm:logo', kind: 'memory', type: 'project', label: 'armasu-logo', description: 'Dawn logo with the curved horizon', text: 'Picked Dawn with the curved horizon. Colors live in [[armasu-colour-tokens]].' },
    { id: 'm:tokens', kind: 'memory', type: 'reference', label: 'armasu-colour-tokens', description: 'Where the color tokens are', text: 'Tokens in app/globals.css; never hard-code a hex.' },
    { id: 'm:style', kind: 'memory', type: 'feedback', label: 'no-em-dashes', description: 'No em dashes anywhere', text: 'Kenneth reads diffs by hand. No em dashes, terse comments.' },
    { id: 'm:who', kind: 'memory', type: 'user', label: 'kenneth', description: 'Who Kenneth is', text: 'Builds Armasu and Switchboard; reviews on a phone.' },
    { id: 'm:vision', kind: 'memory', type: 'project', label: 'switchboard-vision', description: 'The bar for Switchboard', text: 'Simple, one-click chat, roles, no auto-commit. See [[no-em-dashes]].', missing: ['old-roadmap'] },
    { id: 'chat:a', kind: 'chat', label: 'Armasu v3' },
    { id: 'chat:b', kind: 'chat', label: 'agent-flow v7' },
    { id: 'todo:1', kind: 'todo', label: 'Ship the logo files', text: 'Ship the logo files' },
    { id: 'rule:global', kind: 'rule', label: '~/.claude/CLAUDE.md', text: '# Working style\n\nYou are the lead of this chat.' },
    { id: 'wiki:switchboard-design.md', kind: 'wiki', label: 'switchboard-design', description: 'How the hub page is laid out', text: 'Dark canvas from [[raycast-notes]]. Keeps to [[switchboard-vision]].' },
    { id: 'raw:raycast-notes.md', kind: 'raw', label: 'raycast-notes', text: 'Clipped notes on the Raycast site: near-black canvas, hairline borders, one white button.' },
  ]
  const e = (source: string, target: string, kind: GraphEdge['kind'] = 'in'): GraphEdge => ({ source, target, kind })
  return {
    nodes,
    edges: [
      e('m:logo', 'project:/w/Armasu'), e('m:tokens', 'project:/w/Armasu'), e('m:style', 'project:/w/Armasu'), e('m:who', 'project:/w/Armasu'),
      e('m:vision', 'project:/w/agent-flow'), e('m:logo', 'm:tokens', 'link'), e('m:vision', 'm:style', 'link'),
      e('chat:a', 'project:/w/Armasu'), e('chat:b', 'project:/w/agent-flow'), e('todo:1', 'project:/w/Armasu'), e('todo:1', 'chat:a', 'todo'), e('rule:global', 'project:/w/Armasu'), e('rule:global', 'project:/w/agent-flow'),
      e('wiki:switchboard-design.md', 'm:vision', 'link'), e('wiki:switchboard-design.md', 'raw:raycast-notes.md', 'link'),
    ],
  }
}
