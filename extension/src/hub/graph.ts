/**
 * The memory graph for the Memory view: Claude memory files, vault notes (~/Documents/vault), projects, chats, to-do items and CLAUDE.md files,
 * and what links them. Text goes through redact; it stays on this Mac (GET /hub/graph and the panel's graph-get).
 */
import { createHash } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { redact } from './brain'
import { decodeProjectDir } from './local'
import type { HubState } from './types'

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'
export type Pred = 'supersedes' | 'depends-on' | 'part-of' | 'contradicts' | 'related'
export type GraphNode = { id: string; kind: 'memory' | 'wiki' | 'raw' | 'project' | 'chat' | 'todo' | 'rule'; label: string; type?: MemoryType; description?: string; text?: string; missing?: string[]; aliases?: string[]; modified?: string; origin?: string; superseded?: boolean }
export type GraphEdge = { source: string; target: string; kind: 'link' | 'in' | 'todo' | 'from' | Pred }
/** Lint: duplicates are names or aliases two notes claim, contradictions id pairs, the rest node ids.
 * invalid: a memory note with no description or no valid type; stale: a project note not modified in 90 days;
 * loops: groups of live notes whose supersedes edges run in a circle. */
export type GraphHealth = { dangling: string[]; orphans: string[]; duplicates: string[]; contradictions: [string, string][]; superseded: string[]; invalid: string[]; stale: string[]; loops: string[][] }
export type MemoryGraph = { nodes: GraphNode[]; edges: GraphEdge[]; health: GraphHealth }
/** mtime: when modified is not in the frontmatter, stale goes by it. archived: from memory/archive/, a superseded note kept as history. */
export type MemoryFile = { dir: string; file: string; text: string; mtime?: number; archived?: boolean }
/** A vault note: wiki/ topic page or raw/ source, file relative to that folder. */
export type VaultFile = { kind: 'wiki' | 'raw'; file: string; text: string }
/** label: the path as shown, ~ for the home folder. */
export type RuleFile = { path: string; text: string; label?: string }

const TEXT_MAX = 6000
const DESC_MAX = 300
// Memory notes are a few KB; anything bigger is not one, and reading it would stall the route.
const FILE_MAX = 1024 * 1024
const ARCHIVE_MAX = 150
// Raw clippings can pile up: the first 500 notes per vault folder, by path.
const VAULT_MAX = 500
const TYPES: MemoryType[] = ['user', 'feedback', 'project', 'reference']
export const PREDS: Pred[] = ['supersedes', 'depends-on', 'part-of', 'contradicts', 'related']
// What a note knows about another; in, todo and from only say where it sits.
const KNOWS = new Set<GraphEdge['kind']>(['link', ...PREDS])
const RECALL_MAX = 1500
const STALE_MS = 90 * 86_400_000
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
/** The folder name Claude Code gives a project under ~/.claude/projects. */
export const slugOf = (p: string) => p.replace(/[^A-Za-z0-9]/g, '-')
// Redact first: a cut through a key leaves a prefix too short to match.
const cut = (s: string) => { const r = redact(s); return r.length > TEXT_MAX ? `${r.slice(0, TEXT_MAX)}\n...` : r }
const short = (s: string, n: number) => redact(s).slice(0, n)

type Key = { indent: number; value: string; block: boolean; lines: string[] }

/** Top-level keys and metadata's direct children, first one wins. A key's indented lines are its `- item` list or its
 * block scalar (| or >) text, never keys of their own; anything nested deeper under another key is skipped. */
function frontmatter(head: string): Map<string, Key> {
  const keys = new Map<string, Key>()
  let open: Key | undefined
  let meta: number | undefined, inMeta = false
  for (const line of head.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    const indent = line.length - line.trimStart().length
    // YAML lets a list sit flush under its key, so a - line at the key's own indent is an item too.
    const item = open && !open.value && !open.block && indent >= open.indent && /^-(\s|$)/.test(t)
    if (open && (indent > open.indent || item)) { if (open.block || item) open.lines.push(open.block ? t : t.slice(1)); continue }
    open = undefined
    if (indent === 0) inMeta = false
    else if (!inMeta || indent !== (meta ??= indent)) continue
    const kv = /^([\w-]+):(.*)$/.exec(t)
    if (!kv) continue
    const v = kv[2].trim()
    if (indent === 0 && kv[1] === 'metadata' && !v) { inMeta = true; meta = undefined; continue }
    open = { indent, value: v, block: /^[|>][+-]?\d*$/.test(v), lines: [] }
    if (!keys.has(kv[1])) keys.set(kv[1], open)
  }
  return keys
}

/** Frontmatter is only the few flat keys memory files use, at the top or under metadata.
 * A list is `a, b`, `[a, b]` or indented `- a` lines under the key; items may be [[slug|alias]]. */
export function parseMemory(file: string, text: string) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  const fm = frontmatter(m?.[1] ?? '')
  const key = (k: string) => {
    const e = fm.get(k), v = (e?.block ? e.lines.join(' ') : e?.value)?.trim()
    const dq = v && /^"(.*)"$/.exec(v)
    return (dq ? dq[1].replace(/\\(["\\])/g, '$1') : v?.replace(/^["']|["']$/g, '')) || undefined
  }
  const body = (m ? text.slice(m[0].length) : text).trim()
  const type = key('type') as MemoryType | undefined
  // Code shows link syntax, it does not link: fences and `spans` out; [[:space:]] is a regex class.
  const prose = body.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1/gm, '').replace(/`[^`\n]*`/g, '')
  const links = [...new Set([...prose.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map(x => x[1].trim()).filter(l => l && !l.startsWith(':')))]
  const list = (k: string) => {
    const e = fm.get(k)
    const items = !e || e.block ? [] : e.value ? e.value.split(',') : e.lines
    return items.map(x => x.replace(/^[\s["']+|[\s\]"']+$/g, '').replace(/[|#].*$/, '').trim()).filter(Boolean)
  }
  const rel = Object.fromEntries(PREDS.map(p => [p, list(p)])) as Record<Pred, string[]>
  return { name: key('name') || file.replace(/\.md$/, ''), description: key('description'), type: type && TYPES.includes(type) ? type : 'reference' as MemoryType, typed: !!type && TYPES.includes(type), body, links, aliases: list('aliases'), rel, origin: key('originSessionId'), modified: key('modified') }
}

const knownOf = (state: HubState) => [...new Set([...state.projects.map(p => norm(p.path)), ...Object.keys(state.todos ?? {}).map(norm)])]
// A chat in a subfolder belongs to the deepest known project holding it, else to its own folder.
const homeIn = (known: string[], cwd: string) => { const c = norm(cwd); return known.filter(k => c === k || c.startsWith(`${k}/`)).sort((a, b) => b.length - a.length)[0] ?? c }
/** The project node a chat in cwd sits under, by the rule buildGraph uses. */
export const projectId = (state: HubState, cwd: string) => `project:${homeIn(knownOf(state), cwd)}`

export function buildGraph(state: HubState, memories: MemoryFile[], rules: RuleFile[], vault: VaultFile[] = [], now = Date.now()): MemoryGraph {
  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  const add = (n: GraphNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n); return n.id }
  const known = knownOf(state)
  // Old chats outside every registered project (bench runs, temp dirs, the GitHub folder) would each add a stray project.
  const archive = state.archive.filter(c => known.includes(homeIn(known, c.cwd))).sort((a, b) => b.archivedAt - a.archivedAt).slice(0, ARCHIVE_MAX)
  const named = new Map(state.projects.map(p => [norm(p.path), p.name]))
  const projectFor = (cwd: string) => {
    const p = homeIn(known, cwd)
    return add({ id: `project:${p}`, kind: 'project', label: named.get(p) ?? path.basename(p) ?? p })
  }

  const bySlug = new Map(known.map(k => [slugOf(k), k]))
  // Lowercased: links resolve by name, then alias, ignoring case. claims finds names two notes use.
  const byName = new Map<string, string>()
  const byAlias = new Map<string, string>()
  // Keyed folder (or vault), newline, name: the same name in two projects is no clash.
  const claims = new Map<string, Set<string>>()
  const claim = (m: ReturnType<typeof parseMemory>, id: string, scope: string) => {
    for (const a of m.aliases) if (!byAlias.has(a.toLowerCase())) byAlias.set(a.toLowerCase(), id)
    for (const k of new Set([m.name, ...m.aliases].map(x => `${scope}\n${x.toLowerCase()}`))) claims.set(k, (claims.get(k) ?? new Set()).add(id))
  }
  const inDir = new Map<string, string>()
  const parsed = [...memories.filter(f => !f.archived), ...memories.filter(f => f.archived)].map(f => {
    const m = parseMemory(f.file, f.text)
    // A secret name redacts to the same [removed] for every note; '#' + a file hash keeps them apart and can't clash with a real name.
    const id = `memory:${f.dir}/${f.archived ? 'archive/' : ''}${redact(m.name) === m.name ? m.name : `#${createHash('sha1').update(f.file).digest('hex').slice(0, 8)}`}`
    const low = m.name.toLowerCase()
    if (!byName.has(low)) byName.set(low, id)
    if (!inDir.has(`${f.dir}/${low}`)) inDir.set(`${f.dir}/${low}`, id)
    if (!f.archived) claim(m, id, f.dir)
    return { f, m, id }
  })
  const fields = (m: ReturnType<typeof parseMemory>) => ({
    description: m.description && short(m.description, DESC_MAX), text: cut(m.body),
    ...(m.aliases.length && { aliases: m.aliases.map(redact) }), ...(m.modified && { modified: short(m.modified, 40) }), ...(m.origin && { origin: short(m.origin, 80) }),
  })
  for (const { f, m, id } of parsed) {
    add({ id, kind: 'memory', label: redact(m.name), type: m.type, ...fields(m) })
    const home = bySlug.get(f.dir)
    const pid = home ? projectFor(home) : add({ id: `project:dir:${f.dir}`, kind: 'project', label: decodeProjectDir(f.dir) })
    edges.push({ source: id, target: pid, kind: 'in' })
  }
  // Ids from the path, so notes.md in two subfolders stay two notes; links still go by name.
  const inVault = new Map<string, string>()
  const notes = vault.map(f => {
    const m = parseMemory(path.basename(f.file), f.text)
    const id = `${f.kind}:${redact(norm(f.file).replace(/\.md$/, ''))}`
    const low = m.name.toLowerCase()
    if (!inVault.has(low)) inVault.set(low, id)
    if (!byName.has(low)) byName.set(low, id)
    claim(m, id, 'vault')
    add({ id, kind: f.kind, label: redact(m.name), ...fields(m) })
    return { f: undefined, m, id }
  })
  const all = [...parsed, ...notes]
  for (const { f, m, id } of all) {
    const missing: string[] = []
    const typed = new Set<string>()
    const link = (l: string, kind: GraphEdge['kind']) => {
      const k = l.toLowerCase()
      // Same folder first (the vault for a vault note), then anywhere, then an alias.
      const to = (f ? inDir.get(`${f.dir}/${k}`) : inVault.get(k)) ?? byName.get(k) ?? byAlias.get(k)
      // A plain [[link]] to a note it already names in a typed relation adds nothing.
      if (to && to !== id && !(kind === 'link' && typed.has(to))) { edges.push({ source: id, target: to, kind }); typed.add(to) }
      else if (!to) missing.push(redact(l))
    }
    // An archived note is history: what it superseded or contradicted no longer says anything about live notes.
    for (const p of PREDS) if (!(f?.archived && (p === 'supersedes' || p === 'contradicts'))) for (const l of m.rel[p]) link(l, p)
    for (const l of m.links) link(l, 'link')
    if (missing.length) nodes.get(id)!.missing = [...new Set(missing)]
  }
  const archived = new Set(parsed.filter(p => p.f.archived).map(p => p.id))
  for (const e of edges) if (e.kind === 'supersedes') nodes.get(e.target)!.superseded = true
  for (const a of archived) nodes.get(a)!.superseded = true

  for (const c of [...state.chats, ...archive]) {
    const id = `chat:${c.sessionId}`
    if (nodes.has(id)) continue
    add({ id, kind: 'chat', label: c.name ? redact(c.name) : c.sessionId.slice(0, 8), text: 'note' in c && c.note ? cut(c.note) : undefined })
    edges.push({ source: id, target: projectFor(c.cwd), kind: 'in' })
  }
  for (const { m, id } of parsed) if (m.origin && nodes.has(`chat:${m.origin}`)) edges.push({ source: id, target: `chat:${m.origin}`, kind: 'from' })
  for (const [folder, list] of Object.entries(state.todos ?? {})) {
    for (const t of list.todo) {
      const id = add({ id: `todo:${t.id}`, kind: 'todo', label: short(t.text, 80), text: redact(t.text) })
      edges.push({ source: id, target: projectFor(folder), kind: 'in' })
      for (const s of new Set([t.chat, t.from])) if (s && nodes.has(`chat:${s}`)) edges.push({ source: id, target: `chat:${s}`, kind: 'todo' })
    }
  }
  for (const r of rules) {
    const dir = norm(path.dirname(r.path))
    const id = add({ id: `rule:${norm(r.path)}`, kind: 'rule', label: r.label ?? r.path, text: cut(r.text) })
    if (known.includes(dir)) edges.push({ source: id, target: projectFor(dir), kind: 'in' })
    // ~/.claude/CLAUDE.md holds for every project; this also keeps the projects from drifting apart.
    else for (const n of [...nodes.values()]) if (n.kind === 'project') edges.push({ source: id, target: n.id, kind: 'in' })
  }
  const live = parsed.filter(p => !p.f.archived)
  const invalid = live.filter(({ m }) => !m.description || !m.typed).map(p => p.id)
  const stale = live.filter(({ f, m }) => m.type === 'project' && now - (m.modified ? Date.parse(m.modified) : f.mtime ?? NaN) > STALE_MS).map(p => p.id)
  const once = [...new Map(edges.map(e => [`${e.source}\n${e.kind}\n${e.target}`, e])).values()]
  return { nodes: [...nodes.values()], edges: once, health: { ...lint(nodes, once, claims, archived), invalid, stale } }
}

/** Groups of notes that supersede each other in a circle, ids sorted, groups by first id. */
function loops(edges: GraphEdge[], archived: Set<string>): string[][] {
  const next = new Map<string, string[]>()
  for (const e of edges) if (e.kind === 'supersedes' && !archived.has(e.source) && !archived.has(e.target)) next.set(e.source, [...(next.get(e.source) ?? []), e.target])
  const reach = (from: string) => { const seen = new Set<string>(); const todo = [...(next.get(from) ?? [])]; for (let x; (x = todo.pop()) !== undefined;) if (!seen.has(x)) { seen.add(x); todo.push(...(next.get(x) ?? [])) } return seen }
  const r = new Map([...next.keys()].map(k => [k, reach(k)]))
  const done = new Set<string>(), out: string[][] = []
  for (const [k, rs] of r) if (rs.has(k) && !done.has(k)) { const g = [...rs].filter(x => r.get(x)?.has(k)).sort(); g.forEach(x => done.add(x)); out.push(g) }
  return out.sort((a, b) => a[0].localeCompare(b[0]))
}

function lint(nodes: Map<string, GraphNode>, edges: GraphEdge[], claims: Map<string, Set<string>>, archived: Set<string>): Omit<GraphHealth, 'invalid' | 'stale'> {
  const linked = new Set(edges.filter(e => KNOWS.has(e.kind)).flatMap(e => [e.source, e.target]))
  // A pair once, whichever side says it.
  const pairs = new Map<string, [string, string]>()
  for (const e of edges) if (e.kind === 'contradicts') { const p = [e.source, e.target].sort() as [string, string]; pairs.set(p.join('\n'), p) }
  // Archived notes are history: never a health problem.
  const ns = [...nodes.values()].filter(n => !archived.has(n.id))
  return {
    dangling: ns.filter(n => n.missing).map(n => n.id),
    orphans: ns.filter(n => (n.kind === 'memory' || n.kind === 'wiki') && !linked.has(n.id)).map(n => n.id),
    duplicates: [...claims].filter(([, ids]) => ids.size > 1).map(([k]) => redact(k.slice(k.indexOf('\n') + 1))),
    contradictions: [...pairs.values()],
    superseded: ns.filter(n => n.superseded).map(n => n.id),
    loops: loops(edges, archived),
  }
}

/** What memory knows about query, for a chat's hub_recall: the best 3 notes by name, alias or description, then what links to
 * them within hops, superseded notes left out unless asked for by name. near: the chat's project id, first on a tied score.
 * Plain text, redacted, about 1500 characters. */
export function recall(graph: MemoryGraph, query: string, hops = 2, near?: string): string {
  const low = (x: string) => x.normalize('NFC').toLowerCase()
  const q = low(query.trim())
  const terms = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  // Plain substring scoring, no stemming; fine for a few hundred notes.
  const score = (n: GraphNode) => terms.reduce((s, t) => s + (low(n.label).includes(t) ? 3 : 0)
    + (n.aliases?.some(a => low(a).includes(t)) ? 2 : 0) + (n.description && low(n.description).includes(t) ? 1 : 0), 0)
    + (low(n.label) === q ? 5 : 0)
  const home = new Set(near ? graph.edges.filter(e => e.kind === 'in' && e.target === near).map(e => e.source) : [])
  // A superseded note only when asked for by name or alias.
  const named = (n: GraphNode) => low(n.label) === q || !!n.aliases?.some(a => low(a) === q)
  const seeds = graph.nodes.filter(n => (n.kind === 'memory' || n.kind === 'wiki' || n.kind === 'raw') && (!n.superseded || named(n)))
    .map(n => ({ n, s: score(n) })).filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || Number(!home.has(a.n.id)) - Number(!home.has(b.n.id)) || a.n.label.length - b.n.label.length)
    .slice(0, 3).map(x => x.n)
  if (!seeds.length) return redact(`Nothing in memory matches "${query.trim().slice(0, 100)}".`)
  const seen = new Set(seeds.map(n => n.id))
  const ok = (id: string) => seen.has(id) || !byId.get(id)?.superseded
  const tag = (id: string) => { const n = byId.get(id)!; return `(${n.label}${n.superseded ? ', superseded' : ''})` }
  // Line to the hop it was found at: nearer ones go first, so the cap cuts the far end.
  const lines = new Map<string, number>()
  const line = (l: string, d: number) => { if (!lines.has(l)) lines.set(l, d) }
  for (const s of seeds) for (const e of graph.edges) if (e.kind === 'in' && e.source === s.id && e.target.startsWith('project:')) line(`${tag(e.source)} --[in]--> ${tag(e.target)}`, 0)
  let front = seeds.map(n => n.id)
  for (let d = 0; d < hops && front.length; d++) {
    const next: string[] = []
    for (const e of graph.edges) {
      if (!KNOWS.has(e.kind) || !(front.includes(e.source) || front.includes(e.target))) continue
      const other = front.includes(e.source) ? e.target : e.source
      if (!ok(other) || !ok(e.source) || !ok(e.target)) continue
      line(`${tag(e.source)} --[${e.kind}]--> ${tag(e.target)}`, d + 1)
      if (!seen.has(other)) { seen.add(other); next.push(other) }
    }
    front = next
  }
  const head = seeds.map(n => {
    const body = (n.text ?? '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 3).join(' ').slice(0, 240)
    return `${n.label}${n.superseded ? ' (superseded)' : ''}: ${n.description ?? labelKind(n)}${body ? `\n  ${body}` : ''}`
  }).join('\n')
  let out = redact(head).slice(0, RECALL_MAX)
  const rel = [...lines].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([l]) => redact(l))
  if (rel.length && out.length + 2 < RECALL_MAX) out += '\n'
  for (const l of rel) { if (out.length + l.length + 1 > RECALL_MAX) break; out += `\n${l}` }
  return out
}

// /hub/recall's graph: one read per 30 s per reader, shared by calls that land together. Memory only, never saved.
// TTL over mtimes: an edit in place leaves its folder's mtime alone, so mtimes would mean a stat per file.
const RECALL_TTL = 30_000
let kept: { at: number; read: (s: HubState) => Promise<MemoryGraph>; graph: Promise<MemoryGraph> } | undefined
export function recentGraph(state: HubState, read: (s: HubState) => Promise<MemoryGraph> = readGraph, now = Date.now()): Promise<MemoryGraph> {
  if (kept && kept.read === read && now >= kept.at && now - kept.at < RECALL_TTL) return kept.graph
  const mine = { at: now, read, graph: read(state) }
  // A failed read is not kept.
  mine.graph.catch(() => { if (kept === mine) kept = undefined })
  kept = mine
  return mine.graph
}

const labelKind = (n: GraphNode) => (n.kind === 'memory' ? `${n.type ?? 'reference'} memory` : `${n.kind} note`)

/** A regular file under 1 MB, else undefined. follow: a symlink counts as what it points at (a project's CLAUDE.md may be one).
 * Checked before opening, so a FIFO or a device is never opened. */
async function readText(f: string, follow = false): Promise<{ text: string; mtime: number } | undefined> {
  const st = await (follow ? fs.promises.stat(f) : fs.promises.lstat(f)).catch(() => undefined)
  if (!st?.isFile() || st.size > FILE_MAX) return undefined
  const text = await fs.promises.readFile(f, 'utf8').catch(() => undefined)
  return text === undefined ? undefined : { text, mtime: st.mtimeMs }
}

/** Up to VAULT_MAX .md paths under dir, relative to it. Symlinked folders are never followed (no escapes, no loops),
 * and a folder that can't be read is skipped on its own. */
async function vaultNotes(dir: string, rel = '', out: string[] = []): Promise<string[]> {
  const ents = await fs.promises.readdir(path.join(dir, rel), { withFileTypes: true }).catch(() => [])
  for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= VAULT_MAX) break
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) await vaultNotes(dir, r, out)
    // index.md and log.md are the wiki's catalog and history, not topics.
    else if (e.isFile() && r.endsWith('.md') && r !== 'index.md' && r !== 'log.md') out.push(r)
  }
  return out
}

/** Every ~/.claude/projects/<slug>/memory/*.md but MEMORY.md (an index) and memory/archive/*.md, ~/.claude/CLAUDE.md, each project's CLAUDE.md,
 * and ~/Documents/vault/{wiki,raw}/**.md (no vault, no notes).
 * A memory note must be a plain file; a symlinked memory folder must still lead inside ~/.claude/projects. */
export async function readGraph(state: HubState, home = os.homedir()): Promise<MemoryGraph> {
  const root = path.join(home, '.claude', 'projects')
  const realRoot = await fs.promises.realpath(root).catch(() => root)
  const memories: MemoryFile[] = []
  for (const dir of await fs.promises.readdir(root).catch(() => [] as string[])) {
    const mem = await fs.promises.realpath(path.join(root, dir, 'memory')).catch(() => undefined)
    if (!mem || !mem.startsWith(realRoot + path.sep)) continue
    for (const file of await fs.promises.readdir(mem).catch(() => [] as string[])) {
      if (!file.endsWith('.md') || file === 'MEMORY.md') continue
      const got = await readText(path.join(mem, file))
      if (got) memories.push({ dir, file, ...got })
    }
    const arch = await fs.promises.realpath(path.join(mem, 'archive')).catch(() => undefined)
    for (const file of arch?.startsWith(mem + path.sep) ? await fs.promises.readdir(arch).catch(() => [] as string[]) : []) {
      const got = file.endsWith('.md') ? await readText(path.join(arch!, file)) : undefined
      if (got) memories.push({ dir, file, ...got, archived: true })
    }
  }
  const rules: RuleFile[] = []
  for (const p of [path.join(home, '.claude', 'CLAUDE.md'), ...state.projects.map(x => path.join(x.path, 'CLAUDE.md'))]) {
    const text = (await readText(p, true))?.text
    if (text !== undefined) rules.push({ path: p, text, label: p.startsWith(home) ? `~${p.slice(home.length)}` : p })
  }
  const vault: VaultFile[] = []
  for (const kind of ['wiki', 'raw'] as const) {
    const dir = path.join(home, 'Documents', 'vault', kind)
    for (const file of await vaultNotes(dir)) {
      const text = (await readText(path.join(dir, file)))?.text
      if (text !== undefined) vault.push({ kind, file, text })
    }
  }
  return buildGraph(state, memories, rules, vault)
}
