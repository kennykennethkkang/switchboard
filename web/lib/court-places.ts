/** The Court's ring places beyond the AIs: what each lists, from hub state or the memory graph. Pure, so it is tested.
 * Keys and links show as names and ok or missing only, never a value. */
import type { HubState } from './hub-types'
import type { GraphNode, MemoryGraph } from './memory-graph'
import { ago } from '../components/switchboard/look'

/** id: what an action in the panel targets. ok: false paints it as a problem. */
export type Item = { id?: string; name: string; note?: string; ok?: boolean }

const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p

export function memoryTally(g: MemoryGraph) {
  const n = (k: GraphNode['kind']) => g.nodes.filter(x => x.kind === k).length
  const recent = g.nodes.filter(x => (x.kind === 'memory' || x.kind === 'wiki') && !x.superseded)
    .map((x, i) => ({ x, i, t: x.modified ? Date.parse(x.modified) : 0 }))
    .sort((a, b) => b.t - a.t || a.i - b.i).slice(0, 6).map(r => r.x)
  return {
    counts: { memory: n('memory'), wiki: n('wiki'), raw: n('raw'), rule: n('rule') },
    issues: { contradictions: g.health.contradictions.length, stale: g.health.stale.length, dangling: g.health.dangling.length },
    recent,
  }
}

const TOOL_ORDER = ['mod', 'plugin', 'skill'] as const
export const armoryList = (h: Pick<HubState, 'installed' | 'connections'>): Item[] => [
  ...TOOL_ORDER.flatMap(k => h.installed.filter(i => i.kind === k && i.enabled).map(i => ({ name: i.name, note: k, ok: !i.held }))),
  ...h.connections.filter(c => c.kind === 'mcp').map(c => ({ name: c.name, note: c.detail ? `mcp, ${c.detail}` : 'mcp', ok: c.status === 'on' })),
]

export const gardenList = (h: Pick<HubState, 'installed'>, busy: Set<string>): Item[] =>
  h.installed.filter(i => i.kind === 'role' && i.enabled && !busy.has(i.name)).map(i => ({ name: i.name, note: 'idle' }))

export const todoList = (h: Pick<HubState, 'todos'>): Item[] =>
  Object.entries(h.todos ?? {}).flatMap(([path, l]) => l.todo.map(t => ({ id: `${path}\n${t.id}`, name: t.text, note: t.why === 'you' ? `${base(path)}, needs you` : base(path) })))

export function towerList(h: Pick<HubState, 'rc' | 'rcServers' | 'webUrl' | 'tailscale'>): Item[] {
  const l: Item[] = [{ id: 'rc', name: 'Remote Control at startup', ok: h.rc.atStartup }]
  for (const r of h.rcServers) l.push({ id: `rc:${r.folder}`, name: `Remote Control: ${r.name}`, ok: r.on })
  l.push({ name: 'Phone app', note: h.webUrl ? 'serving' : 'off', ok: !!h.webUrl })
  if (h.tailscale !== undefined) l.push({ name: 'Tailscale', note: h.tailscale ? 'up' : 'down', ok: h.tailscale })
  return l
}

const pct = (x: number) => `${Math.round(x * 100)}%`
export const studyList = (h: Pick<HubState, 'learn' | 'learnReady'>): Item[] => [
  ...(h.learnReady ?? []).map(r => ({ id: r.id, name: r.target, note: `${pct(r.before)} to ${pct(r.after)}, waiting` })),
  ...(h.learn ? [{ name: h.learn.what, note: `last ${h.learn.kind === 'aar' ? 'aar' : 'self-improve'}, ${new Date(h.learn.at).toLocaleDateString()}`, ok: true }] : []),
]

export const keyList = (h: Pick<HubState, 'signIns' | 'aws'>): Item[] => [
  // An unset key or a never-used profile is neutral (ok undefined), not a failure; previous-* profiles are expired backups of a switched login.
  ...(h.signIns.keys ?? []).map(k => ({ id: k.saved ? k.name : undefined, name: k.name, note: !k.saved ? 'not set' : k.checked ? (k.checked.ok ? 'ok' : 'failed test') : 'saved', ok: k.saved ? k.checked?.ok !== false : undefined })),
  ...h.aws.filter(p => !p.name.startsWith('previous-')).map(p => ({ name: p.label && p.label !== p.name ? `AWS ${p.label} (${p.name})` : `AWS ${p.name}`, note: p.status, ok: p.status === 'never' ? undefined : p.status === 'signed-in' })),
]

export const mapList = (h: Pick<HubState, 'projects'>): Item[] => h.projects.map(p => ({ name: p.name || base(p.path), note: p.kind }))

// The file name only, whatever the extension sent; the chat label without its session id.
const fileName = (p: string) => p.split(/[/\\]/).pop() || p
const chatName = (c: string) => c.replace(/\s*\([0-9a-f]{8}\)$/, '') || c
export const uploadList = (h: Pick<HubState, 'uploads'>, now = Date.now()): Item[] =>
  Object.values(h.uploads ?? {}).flatMap(u => u.last).sort((a, b) => b.at - a.at)
    .map(r => { const a = ago(r.at, now); return { name: fileName(r.name), note: `${chatName(r.chat)} · ${a === 'now' ? 'just now' : `${a} ago`}`, ok: true } })

export function uploadSummary(h: Pick<HubState, 'uploads'>): string | undefined {
  const n = Object.values(h.uploads ?? {}).reduce((s, u) => s + u.count, 0)
  return n ? `${n} upload${n === 1 ? '' : 's'}` : undefined
}

/** A refresh that fails keeps the last good graph; error says why it is stale. */
export type GraphHold = { graph?: MemoryGraph; error?: string }
export const keepGraph = (was: GraphHold | undefined, next: MemoryGraph | string): GraphHold =>
  typeof next === 'string' ? { graph: was?.graph, error: next } : { graph: next }

/** Demo only: a Learn run and a proposal for the study hall when the demo hub has none; gone: ids already approved or discarded. */
export function withDemoLearn<H extends Pick<HubState, 'learn' | 'learnReady'>>(h: H, gone: string[], now = Date.now()): H {
  if (h.learn || h.learnReady?.length) return h
  const ready = [{ id: 'demo-learn', target: 'kit/agents/qa.md', before: 0.6, after: 0.8, diff: '' }].filter(r => !gone.includes(r.id))
  return { ...h, learn: { at: now - 3_600_000, kind: 'aar', what: 'aar on switchboard chat 1a2b3c4d' }, learnReady: ready }
}
