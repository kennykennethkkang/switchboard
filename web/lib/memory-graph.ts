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
export type GraphHealth = { dangling: string[]; orphans: string[]; duplicates: string[]; contradictions: [string, string][]; superseded: string[]; invalid: string[]; stale: string[] }
export type MemoryGraph = { nodes: GraphNode[]; edges: GraphEdge[]; health: GraphHealth }

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

const aka = (n: GraphNode, s: string) => !!n.aliases?.some(a => a.toLowerCase().includes(s))

/** Up to 8 visible nodes whose label or an alias holds q, labels starting with it first. */
export function findNodes(nodes: GraphNode[], q: string, off: Set<string>): GraphNode[] {
  const s = q.trim().toLowerCase()
  if (!s) return []
  return nodes.filter(n => !off.has(groupOf(n)) && (n.label.toLowerCase().includes(s) || aka(n, s)))
    .sort((a, b) => Number(!a.label.toLowerCase().startsWith(s)) - Number(!b.label.toLowerCase().startsWith(s)) || a.label.length - b.label.length)
    .slice(0, 8)
}

export function neighbors(g: MemoryGraph, id: string): GraphNode[] {
  const ids = new Set(g.edges.flatMap(e => (e.source === id ? [e.target] : e.target === id ? [e.source] : [])))
  ids.delete(id)
  return g.nodes.filter(n => ids.has(n.id))
}

/** Every visible node matching q by label, alias or description, for the list view. */
export function listNodes(nodes: GraphNode[], q: string, off: Set<string>): GraphNode[] {
  const s = q.trim().toLowerCase()
  return nodes.filter(n => !off.has(groupOf(n)) && (!s || n.label.toLowerCase().includes(s) || aka(n, s) || !!n.description?.toLowerCase().includes(s)))
}

/** The list view's health line: each nonzero count, singular or plural. */
export function healthLine(h: GraphHealth): string {
  const rows: [unknown[], string, string][] = [
    [h.dangling, 'note with broken links', 'notes with broken links'], [h.orphans, 'unlinked note', 'unlinked notes'], [h.duplicates, 'shared name', 'shared names'],
    [h.contradictions, 'contradiction', 'contradictions'], [h.superseded, 'superseded note', 'superseded notes'], [h.invalid, 'invalid note', 'invalid notes'], [h.stale, 'stale note', 'stale notes'],
  ]
  return rows.filter(([l]) => l.length).map(([l, one, many]) => `${l.length} ${l.length === 1 ? one : many}`).join(', ')
}

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
    { id: 'm:recall', kind: 'memory', type: 'project', label: 'hub-recall', aliases: ['recall-tool'], origin: 'b', modified: '2026-11-01T10:00:00Z', description: 'Chats search memory before researching', text: 'hub_recall walks the graph from the best notes.' },
    { id: 'm:askall', kind: 'memory', type: 'project', label: 'ask-for-everything', superseded: true, description: 'Every lookup was a paid hub_ask', text: 'Asked the brain for every lookup.' },
    { id: 'm:nograph', kind: 'memory', type: 'feedback', label: 'no-graph-view', description: 'Memory as a flat list only', text: 'A graph view is noise; list the notes.' },
  ]
  const e = (source: string, target: string, kind: GraphEdge['kind'] = 'in'): GraphEdge => ({ source, target, kind })
  return {
    nodes,
    edges: [
      e('m:logo', 'project:/w/Armasu'), e('m:tokens', 'project:/w/Armasu'), e('m:style', 'project:/w/Armasu'), e('m:who', 'project:/w/Armasu'),
      e('m:vision', 'project:/w/agent-flow'), e('m:logo', 'm:tokens', 'link'), e('m:vision', 'm:style', 'link'),
      e('chat:a', 'project:/w/Armasu'), e('chat:b', 'project:/w/agent-flow'), e('todo:1', 'project:/w/Armasu'), e('todo:1', 'chat:a', 'todo'), e('rule:global', 'project:/w/Armasu'), e('rule:global', 'project:/w/agent-flow'),
      e('wiki:switchboard-design.md', 'm:vision', 'link'), e('wiki:switchboard-design.md', 'raw:raycast-notes.md', 'link'),
      e('m:recall', 'project:/w/agent-flow'), e('m:askall', 'project:/w/agent-flow'), e('m:nograph', 'project:/w/agent-flow'),
      e('m:recall', 'm:askall', 'supersedes'), e('m:recall', 'wiki:switchboard-design.md', 'depends-on'), e('m:recall', 'm:vision', 'part-of'),
      e('m:nograph', 'm:recall', 'contradicts'), e('m:recall', 'm:style', 'related'), e('m:recall', 'chat:b', 'from'),
    ],
    health: { dangling: ['m:vision'], orphans: ['m:who'], duplicates: [], contradictions: [['m:nograph', 'm:recall']], superseded: ['m:askall'], invalid: [], stale: [] },
  }
}
