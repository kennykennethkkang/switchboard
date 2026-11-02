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
export type GraphNode = { id: string; kind: 'memory' | 'wiki' | 'raw' | 'project' | 'chat' | 'todo' | 'rule'; label: string; type?: MemoryType; description?: string; text?: string; missing?: string[] }
export type GraphEdge = { source: string; target: string; kind: 'link' | 'in' | 'todo' }
export type MemoryGraph = { nodes: GraphNode[]; edges: GraphEdge[] }
export type MemoryFile = { dir: string; file: string; text: string }
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
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
/** The folder name Claude Code gives a project under ~/.claude/projects. */
export const slugOf = (p: string) => p.replace(/[^A-Za-z0-9]/g, '-')
// Redact first: a cut through a key leaves a prefix too short to match.
const cut = (s: string) => { const r = redact(s); return r.length > TEXT_MAX ? `${r.slice(0, TEXT_MAX)}\n...` : r }
const short = (s: string, n: number) => redact(s).slice(0, n)

/** Frontmatter is only the few flat keys memory files use, plus metadata.type. */
export function parseMemory(file: string, text: string) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  const head = m?.[1] ?? ''
  const key = (k: string) => new RegExp(`^\\s*${k}:\\s*(.+)$`, 'm').exec(head)?.[1].trim().replace(/^["']|["']$/g, '')
  const body = (m ? text.slice(m[0].length) : text).trim()
  const type = key('type') as MemoryType | undefined
  const links = [...new Set([...body.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map(x => x[1].trim()))]
  return { name: key('name') || file.replace(/\.md$/, ''), description: key('description'), type: type && TYPES.includes(type) ? type : 'reference' as MemoryType, body, links }
}

export function buildGraph(state: HubState, memories: MemoryFile[], rules: RuleFile[], vault: VaultFile[] = []): MemoryGraph {
  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  const add = (n: GraphNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n); return n.id }
  const archive = [...state.archive].sort((a, b) => b.archivedAt - a.archivedAt).slice(0, ARCHIVE_MAX)
  const known = [...new Set([...state.projects.map(p => norm(p.path)), ...Object.keys(state.todos ?? {}).map(norm)])]
  const named = new Map(state.projects.map(p => [norm(p.path), p.name]))
  // A chat in a subfolder belongs to the deepest known project holding it, else to its own folder.
  const projectFor = (cwd: string) => {
    const c = norm(cwd)
    const p = known.filter(k => c === k || c.startsWith(`${k}/`)).sort((a, b) => b.length - a.length)[0] ?? c
    return add({ id: `project:${p}`, kind: 'project', label: named.get(p) ?? path.basename(p) ?? p })
  }

  const bySlug = new Map(known.map(k => [slugOf(k), k]))
  const byName = new Map<string, string>()
  const inDir = new Map<string, string>()
  const parsed = memories.map(f => {
    const m = parseMemory(f.file, f.text)
    // A secret name redacts to the same [removed] for every note; '#' + a file hash keeps them apart and can't clash with a real name.
    const id = `memory:${f.dir}/${redact(m.name) === m.name ? m.name : `#${createHash('sha1').update(f.file).digest('hex').slice(0, 8)}`}`
    if (!byName.has(m.name)) byName.set(m.name, id)
    if (!inDir.has(`${f.dir}/${m.name}`)) inDir.set(`${f.dir}/${m.name}`, id)
    return { f, m, id }
  })
  for (const { f, m, id } of parsed) {
    add({ id, kind: 'memory', label: redact(m.name), type: m.type, description: m.description && short(m.description, DESC_MAX), text: cut(m.body) })
    const home = bySlug.get(f.dir)
    const pid = home ? projectFor(home) : add({ id: `project:dir:${f.dir}`, kind: 'project', label: decodeProjectDir(f.dir) })
    edges.push({ source: id, target: pid, kind: 'in' })
  }
  // Ids from the path, so notes.md in two subfolders stay two notes; links still go by name.
  const inVault = new Map<string, string>()
  const notes = vault.map(f => {
    const m = parseMemory(path.basename(f.file), f.text)
    const id = `${f.kind}:${redact(norm(f.file).replace(/\.md$/, ''))}`
    if (!inVault.has(m.name)) inVault.set(m.name, id)
    if (!byName.has(m.name)) byName.set(m.name, id)
    add({ id, kind: f.kind, label: redact(m.name), description: m.description && short(m.description, DESC_MAX), text: cut(m.body) })
    return { f: undefined, m, id }
  })
  for (const { f, m, id } of [...parsed, ...notes]) {
    const missing: string[] = []
    for (const l of m.links) {
      // Same folder first (the vault for a vault note), then anywhere.
      const to = f ? inDir.get(`${f.dir}/${l}`) ?? byName.get(l) : inVault.get(l) ?? byName.get(l)
      if (to && to !== id) edges.push({ source: id, target: to, kind: 'link' })
      else if (!to) missing.push(redact(l))
    }
    if (missing.length) nodes.get(id)!.missing = missing
  }

  for (const c of [...state.chats, ...archive]) {
    const id = `chat:${c.sessionId}`
    if (nodes.has(id)) continue
    add({ id, kind: 'chat', label: c.name ? redact(c.name) : c.sessionId.slice(0, 8), text: 'note' in c && c.note ? cut(c.note) : undefined })
    edges.push({ source: id, target: projectFor(c.cwd), kind: 'in' })
  }
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
  return { nodes: [...nodes.values()], edges }
}

/** A regular file under 1 MB, else undefined. follow: a symlink counts as what it points at (a project's CLAUDE.md may be one).
 * Checked before opening, so a FIFO or a device is never opened. */
async function readText(f: string, follow = false): Promise<string | undefined> {
  const st = await (follow ? fs.promises.stat(f) : fs.promises.lstat(f)).catch(() => undefined)
  if (!st?.isFile() || st.size > FILE_MAX) return undefined
  return fs.promises.readFile(f, 'utf8').catch(() => undefined)
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

/** Every ~/.claude/projects/<slug>/memory/*.md but MEMORY.md (an index), ~/.claude/CLAUDE.md, each project's CLAUDE.md,
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
      const text = await readText(path.join(mem, file))
      if (text !== undefined) memories.push({ dir, file, text })
    }
  }
  const rules: RuleFile[] = []
  for (const p of [path.join(home, '.claude', 'CLAUDE.md'), ...state.projects.map(x => path.join(x.path, 'CLAUDE.md'))]) {
    const text = await readText(p, true)
    if (text !== undefined) rules.push({ path: p, text, label: p.startsWith(home) ? `~${p.slice(home.length)}` : p })
  }
  const vault: VaultFile[] = []
  for (const kind of ['wiki', 'raw'] as const) {
    const dir = path.join(home, 'Documents', 'vault', kind)
    for (const file of await vaultNotes(dir)) {
      const text = await readText(path.join(dir, file))
      if (text !== undefined) vault.push({ kind, file, text })
    }
  }
  return buildGraph(state, memories, rules, vault)
}
