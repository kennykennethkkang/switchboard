/**
 * Flow map: how a project is built. Code is folders and files linked by their imports (a regex scan, capped);
 * work is the chats that ran in the project and the skills, plugins, mods, roles and files each one used.
 * Built on demand (the panel's flowmap-get, GET /hub/flowmap), cached per project until HEAD or the git index
 * changes, or the newest transcript moves into a new 5-minute window.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as readline from 'readline'
import { redact } from './brain'
import type { CheckBack, ChatRow, HubState, IndefiniteBudget } from './types'

export type FlowKind = 'folder' | 'file' | 'chat' | 'skill' | 'plugin' | 'mod' | 'role'
/** folder: a file's folder id. about: its header comment or the folder's README line. first/at: a chat's first and last message. group: a chat's split group. budget, checkBack, costUsd, elapsedMs: a live chat's Run indefinitely limits and spend (withLimits). */
export type FlowNode = { id: string; kind: FlowKind; label: string; folder?: string; about?: string; first?: number; at?: number; group?: string; budget?: IndefiniteBudget; checkBack?: CheckBack; costUsd?: number; elapsedMs?: number }
/** n: how many imports or uses. at: when a chat last touched that file. */
export type FlowEdge = { from: string; to: string; kind: 'import' | 'used' | 'touched'; n: number; at?: number }
/** cut: the scan stopped at FILE_MAX files. */
export type FlowMap = { project: string; nodes: FlowNode[]; edges: FlowEdge[]; cut?: boolean; builtAt: number }

const FILE_MAX = 1500
const DIR_MAX = 3000
const CHATS_MAX = 40
const SIZE_MAX = 512 * 1024
const ABOUT_MAX = 220
const TTL = 5 * 60_000
const CODE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.py'])
const SKIP = new Set(['node_modules', 'dist', 'out', 'build', 'coverage', 'vendor', '__pycache__', 'venv', 'target', 'site-packages'])
// dot folders (.next, .claude, .superpowers, .playwright-mcp) skip on their own; these are agent prototypes
const SKIP_PATHS = new Set(['docs/superpowers'])
const JS_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']
/** The kit's mods, per kit/setup.json: beside dist/ in the VSIX, two up from src/hub in tests. */
export const KIT_MODS: string[] = (() => {
  for (const f of [path.join(__dirname, '..', 'kit', 'setup.json'), path.join(__dirname, '..', '..', 'kit', 'setup.json')]) {
    try { const m = (JSON.parse(fs.readFileSync(f, 'utf8')) as { mods?: unknown }).mods; if (Array.isArray(m)) return m.filter((x): x is string => typeof x === 'string') } catch { /* next */ }
  }
  return []
})()
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const posix = (p: string) => p.split(path.sep).join('/')
/** Folder id for a file: its full folder path, '.' at the root. */
export const folderOf = (rel: string) => path.posix.dirname(rel)
/** A folder's parent folder, undefined at the top. */
const parentOf = (d: string) => { const p = path.posix.dirname(d); return d === '.' || p === '.' ? undefined : p }
const LABEL_MAX = 60
// skill loads, slash commands, system reminders
const NOT_A_NAME = ['Base directory for this skill', '<', 'Caveat:']
/** A chat name from a prompt or title: first words on one line, undefined for skill loads and meta text. */
export function chatName(text: string): string | undefined {
  const t = text.trim()
  if (!t || NOT_A_NAME.some(p => t.startsWith(p))) return undefined
  return redact(handoffName(t) ?? t.replace(/\s+/g, ' ')).slice(0, LABEL_MAX)
}

/** The import specifiers in one file's source. */
export function parseImports(src: string, ext: string): string[] {
  const out: string[] = []
  const all = (re: RegExp) => { for (const m of src.matchAll(re)) out.push(m[1]) }
  if (ext === '.py') {
    all(/^[ \t]*from[ \t]+(\.+[\w.]*|[\w.]+)[ \t]+import\b/gm)
    all(/^[ \t]*import[ \t]+([\w.]+)/gm)
  } else {
    all(/\b(?:import|export)\s+(?:type\s+)?[\w*{}\s,$]*?\s*from\s*['"]([^'"\n]+)['"]/g)
    all(/^\s*import\s*['"]([^'"\n]+)['"]/gm)
    all(/\b(?:require|import)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g)
  }
  return [...new Set(out)]
}

/** The project file a specifier points at, or undefined for a package or a miss. roots: folders with a package.json or tsconfig, for @/ and ~/. */
export function resolveImport(spec: string, from: string, files: Set<string>, roots: string[]): string | undefined {
  const hit = (base: string, exts: string[], index: string[]) => {
    const b = path.posix.normalize(base)
    if (b.startsWith('..')) return undefined
    for (const c of [b, ...exts.map(e => b + e), ...index.map(i => `${b}/${i}`)]) if (files.has(c)) return c
  }
  if (from.endsWith('.py')) {
    const dots = /^\.+/.exec(spec)?.[0].length ?? 0
    const rest = spec.slice(dots).replace(/\./g, '/')
    let base = rest
    if (dots) { base = path.posix.dirname(from); for (let i = 1; i < dots; i++) base = path.posix.dirname(base); base = rest ? path.posix.join(base, rest) : base }
    return hit(base, ['.py'], ['__init__.py'])
  }
  const index = JS_EXT.map(e => `index${e}`)
  let base: string
  if (spec.startsWith('.')) base = path.posix.join(path.posix.dirname(from), spec)
  else if (spec.startsWith('@/') || spec.startsWith('~/')) {
    const root = roots.filter(r => r === '.' || from.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0]
    if (root === undefined) return undefined
    base = path.posix.join(root, spec.slice(2))
  } else return undefined
  return hit(base, JS_EXT, index) ?? hit(base.replace(/\.(m|c)?js$/, ''), JS_EXT, index)
}

/** A file's header in one plain sentence: its first block comment, run of // or # lines, or Python docstring. */
export function headerOf(src: string): string | undefined {
  const s = src.slice(0, 4000).replace(/^#!.*\n/, '').replace(/^\s*['"]use (client|server|strict)['"];?\s*/, '')
  const m = /^\s*\/\*\*?([\s\S]*?)\*\//.exec(s) ?? /^\s*((?:\/\/.*\n?)+)/.exec(s) ?? /^\s*(?:[rRuU]?"""|''')([\s\S]*?)(?:"""|''')/.exec(s) ?? /^\s*((?:#.*\n?)+)/.exec(s)
  return m ? sentence(m[1].replace(/^\s*(\*|\/\/+|#+)\s?/gm, '')) : undefined
}

/** A README's first prose line. */
export function readmeLine(md: string): string | undefined {
  const para = md.replace(/<!--[\s\S]*?-->/g, '').split(/\n\s*\n/).map(p => p.trim()).find(p => p && !/^[#<!\[`|>-]/.test(p) && !/^={3,}|^-{3,}/.test(p))
  return para ? sentence(para) : undefined
}

function sentence(text: string): string | undefined {
  const t = redact(text).replace(/@\w+.*$/gm, '').replace(/\s+/g, ' ').trim()
  if (!t) return undefined
  const end = t.search(/[.!?](\s|$)/)
  const one = end > 20 ? t.slice(0, end + 1) : t
  return one.length > ABOUT_MAX ? `${one.slice(0, ABOUT_MAX - 3)}...` : one
}

type Code = { files: Map<string, string | undefined>; folders: Map<string, string | undefined>; imports: Map<string, number>; cut: boolean }

/** Walks root for code files (skipping dot folders, builds and packages), reads each once, links the imports that land in the project. */
export async function scanCode(root: string, cap = FILE_MAX, dirCap = DIR_MAX): Promise<Code> {
  const found: string[] = [], roots: string[] = [], readmes = new Map<string, string>()
  let cut = false, dirs = 0
  const walk = async (rel: string): Promise<void> => {
    if (++dirs > dirCap) { cut = true; return }
    const ents = await fs.promises.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => [] as fs.Dirent[])
    ents.sort((a, b) => a.name.localeCompare(b.name))
    const sub: string[] = []
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) { if (!e.name.startsWith('.') && !SKIP.has(e.name) && !SKIP_PATHS.has(r)) sub.push(r); continue }
      if (!e.isFile()) continue
      if (e.name === 'package.json' || e.name === 'tsconfig.json') { if (!roots.includes(rel || '.')) roots.push(rel || '.') }
      else if (/^readme\.md$/i.test(e.name)) readmes.set(rel || '.', r)
      else if (CODE.has(path.extname(e.name)) && !/\.d\.[mc]?ts$/.test(e.name)) { if (found.length >= cap) { cut = true; continue } found.push(r) }
    }
    for (const s of sub) { if (found.length >= cap || dirs >= dirCap) { cut = true; return } await walk(s) }
  }
  await walk('')
  const set = new Set(found)
  const files = new Map<string, string | undefined>(), imports = new Map<string, number>()
  for (const f of found) {
    const full = path.join(root, f)
    const st = await fs.promises.stat(full).catch(() => undefined)
    const src = st && st.size <= SIZE_MAX ? await fs.promises.readFile(full, 'utf8').catch(() => '') : ''
    files.set(f, headerOf(src))
    for (const spec of parseImports(src, path.extname(f))) {
      const to = resolveImport(spec, f, set, roots)
      if (to && to !== f) imports.set(`${f}\n${to}`, (imports.get(`${f}\n${to}`) ?? 0) + 1)
    }
  }
  const folders = new Map<string, string | undefined>()
  const ancestors = new Set<string>()
  for (const f of found) for (let d: string | undefined = folderOf(f); d && !ancestors.has(d); d = parentOf(d)) ancestors.add(d)
  for (const d of ancestors) {
    const md = readmes.get(d)
    const line = md ? readmeLine(await fs.promises.readFile(path.join(root, md), 'utf8').catch(() => '')) : undefined
    const idx = [...files.keys()].find(x => path.posix.dirname(x) === d && /^(index\.[mc]?[jt]sx?|__init__\.py)$/.test(path.posix.basename(x)))
    folders.set(d, line ?? (idx ? files.get(idx) : undefined))
  }
  return { files, folders, imports, cut }
}

/** What one chat did: tallies by name, files by path relative to cwd (with the last time each was written). */
export type ChatWork = { sessionId: string; label?: string; title?: string; custom?: boolean; first?: number; last?: number; skills: Map<string, number>; plugins: Map<string, number>; mods: Map<string, number>; roles: Map<string, number>; files: Map<string, number> }
export const newWork = (sessionId: string): ChatWork => ({ sessionId, skills: new Map(), plugins: new Map(), mods: new Map(), roles: new Map(), files: new Map() })
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

/** The MCP server in a tool name, as people call it: mcp__plugin_playwright_playwright__x is playwright. */
export function serverOf(tool: string): string | undefined {
  const s = /^mcp__(.+?)__/.exec(tool)?.[1]
  if (!s) return undefined
  if (s.startsWith('plugin_')) return s.slice(7).split('_')[0]
  return s.replace(/^claude_ai_/, '')
}

/** A handoff chat's name from its `Continue from <note>.md` prompt: the note's `# Handoff vN · title` line, else the note's file name. */
export function handoffName(text: string): string | undefined {
  const file = /^Continue from (.+?\.md)\b/.exec(text.trim())?.[1]
  if (!file) return undefined
  let head = ''
  try { head = fs.readFileSync(file, 'utf8').split('\n', 1)[0] } catch { /* note gone */ }
  const m = /^# Handoff v(\d+) · (.+)/.exec(head)
  return m ? `${m[2].trim()} v${m[1]}` : path.basename(file, '.md').replace(/^\d{4}-\d{2}-\d{2}-\d{4}-/, '')
}

/** Folds one transcript line into w. Cheap lines (no tool use, hook or first prompt) skip JSON.parse. root: what file paths are relative to, when the chat ran in a subfolder. */
export function addLine(w: ChatWork, line: string, cwd: string, mods = KIT_MODS, root = cwd): void {
  const wantsLabel = !w.label && line.includes('"type":"user"')
  const isTitle = line.includes('"type":"ai-title"') || line.includes('"type":"custom-title"')
  if (!wantsLabel && !isTitle && !line.includes('"tool_use"') && !line.includes('"attachment"')) return
  let o: { type?: string; timestamp?: string; isMeta?: boolean; aiTitle?: unknown; customTitle?: unknown; message?: { content?: unknown }; attachment?: { type?: string; command?: unknown } }
  try { o = JSON.parse(line) } catch { return }
  // a rename beats Claude's own title, which beats the first prompt
  if (o.type === 'custom-title' && typeof o.customTitle === 'string') { w.title = chatName(o.customTitle) ?? w.title; w.custom = true; return }
  if (o.type === 'ai-title' && typeof o.aiTitle === 'string') { if (!w.custom) w.title = chatName(o.aiTitle) ?? w.title; return }
  const t = o.timestamp ? Date.parse(o.timestamp) : NaN
  if (Number.isFinite(t)) { w.first = Math.min(w.first ?? t, t); w.last = Math.max(w.last ?? t, t) }
  if (o.type === 'user' && !w.label && o.isMeta !== true) {
    const c = o.message?.content
    const text = typeof c === 'string' ? c : Array.isArray(c) ? (c.find(b => b?.type === 'text')?.text ?? '') : ''
    if (typeof text === 'string') w.label = chatName(text)
  }
  const cmd = o.attachment?.type?.startsWith('hook') && typeof o.attachment.command === 'string' ? o.attachment.command : ''
  if (cmd) for (const m of mods) if (cmd.includes(`/${m}/`)) bump(w.mods, m)
  if (o.type !== 'assistant' || !Array.isArray(o.message?.content)) return
  for (const b of o.message.content as Array<{ type?: string; name?: string; input?: Record<string, unknown> }>) {
    if (b?.type !== 'tool_use' || typeof b.name !== 'string') continue
    const input = b.input ?? {}
    if (b.name === 'Skill' && typeof input.skill === 'string') {
      bump(w.skills, input.skill)
      if (input.skill.includes(':')) bump(w.plugins, input.skill.split(':')[0])
    } else if ((b.name === 'Agent' || b.name === 'Task') && typeof input.subagent_type === 'string') bump(w.roles, input.subagent_type)
    else if (EDITS.has(b.name)) {
      const p = input.file_path ?? input.notebook_path
      if (typeof p !== 'string') continue
      const rel = posix(path.relative(root, path.resolve(cwd, p)))
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) w.files.set(rel, Number.isFinite(t) ? Math.max(w.files.get(rel) ?? 0, t) : (w.files.get(rel) ?? 0))
    } else {
      const s = serverOf(b.name)
      if (s) bump(mods.includes(s) ? w.mods : w.plugins, s)
    }
  }
}

async function readInto(w: ChatWork, file: string, cwd: string, root: string): Promise<void> {
  const lines = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })
  try { for await (const l of lines) addLine(w, l, cwd, KIT_MODS, root) } catch { /* gone mid-read: keep what was read */ }
}

/** Claude Code's folder for a project's transcripts. */
export const slugOf = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-')

/** The newest chats in cwd and its subfolders subs, each with its subagents' work folded in (their role counted too). */
export async function readWork(cwd: string, home = os.homedir(), max = CHATS_MAX, subs: string[] = []): Promise<ChatWork[]> {
  const all = (await Promise.all([cwd, ...subs].map(async at => {
    const dir = path.join(home, '.claude', 'projects', slugOf(at))
    const names = (await fs.promises.readdir(dir).catch(() => [] as string[])).filter(n => n.endsWith('.jsonl'))
    return Promise.all(names.map(async n => ({ at, dir, n, m: (await fs.promises.stat(path.join(dir, n)).catch(() => undefined))?.mtimeMs ?? 0 })))
  }))).flat()
  const out: ChatWork[] = []
  for (const { at, dir, n } of all.sort((a, b) => b.m - a.m).slice(0, max)) {
    const w = newWork(n.slice(0, -6))
    await readInto(w, path.join(dir, n), at, cwd)
    const agents = path.join(dir, w.sessionId, 'subagents')
    for (const s of (await fs.promises.readdir(agents).catch(() => [] as string[])).filter(x => x.endsWith('.jsonl'))) {
      const { label, title, custom } = w
      await readInto(w, path.join(agents, s), at, cwd)
      Object.assign(w, { label, title, custom })
      try { const meta = JSON.parse(await fs.promises.readFile(path.join(agents, s.replace(/\.jsonl$/, '.meta.json')), 'utf8')) as { agentType?: unknown }; if (typeof meta.agentType === 'string' && !w.roles.has(meta.agentType)) w.roles.set(meta.agentType, 1) } catch { /* no meta */ }
    }
    out.push(w)
  }
  return out
}

/** Code and work as one node and edge list. labels: chat names the hub already knows, by session id. */
export function assemble(project: string, code: Code, work: ChatWork[], labels: Record<string, string> = {}): FlowMap {
  const nodes: FlowNode[] = [], edges: FlowEdge[] = []
  for (const [id, about] of code.folders) { const up = parentOf(id); nodes.push({ id: `d:${id}`, kind: 'folder', label: id === '.' ? project : id, ...(up ? { folder: `d:${up}` } : {}), ...(about ? { about } : {}) }) }
  for (const [f, about] of code.files) nodes.push({ id: `f:${f}`, kind: 'file', label: f, folder: `d:${folderOf(f)}`, ...(about ? { about } : {}) })
  for (const [k, n] of code.imports) { const [a, b] = k.split('\n'); edges.push({ from: `f:${a}`, to: `f:${b}`, kind: 'import', n }) }
  const tools = new Map<string, FlowNode>()
  for (const w of work) {
    const id = `chat:${w.sessionId}`
    nodes.push({ id, kind: 'chat', label: labels[w.sessionId] || w.title || w.label || w.sessionId.slice(0, 8), ...(w.first ? { first: w.first } : {}), ...(w.last ? { at: w.last } : {}) })
    const use = (kind: FlowKind, m: Map<string, number>) => {
      for (const [name, n] of m) {
        const to = `${kind}:${name}`
        if (!tools.has(to)) tools.set(to, { id: to, kind, label: name })
        edges.push({ from: id, to, kind: 'used', n })
      }
    }
    use('skill', w.skills); use('plugin', w.plugins); use('mod', w.mods); use('role', w.roles)
    for (const [f, at] of w.files) if (code.files.has(f)) edges.push({ from: id, to: `f:${f}`, kind: 'touched', n: 1, ...(at ? { at } : {}) })
  }
  nodes.push(...tools.values())
  return { project, nodes, edges, ...(code.cut ? { cut: true } : {}), builtAt: Date.now() }
}

const CACHE_MAX = 10
const cache = new Map<string, { key: string; at: number; map: Promise<FlowMap> }>()

async function keyOf(cwd: string, subs: string[], home: string): Promise<string> {
  const head = await fs.promises.readFile(path.join(cwd, '.git', 'HEAD'), 'utf8').catch(() => '')
  const index = (await fs.promises.stat(path.join(cwd, '.git', 'index')).catch(() => undefined))?.mtimeMs ?? 0
  let newest = 0
  for (const at of [cwd, ...subs]) {
    const dir = path.join(home, '.claude', 'projects', slugOf(at))
    const names = (await fs.promises.readdir(dir).catch(() => [] as string[])).filter(n => n.endsWith('.jsonl'))
    for (const n of names) newest = Math.max(newest, (await fs.promises.stat(path.join(dir, n)).catch(() => undefined))?.mtimeMs ?? 0)
  }
  // a running chat writes every few seconds; bucket by TTL so reopening the map stays a cache hit
  return `${head.trim()}|${index}|${Math.floor(newest / TTL)}|${subs.length}`
}

/** The map for cwd, from cache while nothing it reads has changed. cwd must be one of roots or inside one, after symlinks; anything else throws. Transcripts are found by cwd as given, the way Claude Code names their folder, plus those of chats folders inside cwd. */
export async function buildFlowMap(cwd: string, labels: Record<string, string> = {}, roots: string[] = [], home = os.homedir(), chats: string[] = [], groups: Record<string, string> = {}): Promise<FlowMap> {
  if (!path.isAbsolute(cwd)) throw new Error('not a project folder')
  const real = await fs.promises.realpath(cwd).catch(() => undefined)
  if (!real || !(await fs.promises.stat(real).catch(() => undefined))?.isDirectory()) throw new Error('not a project folder')
  const known = await Promise.all(roots.filter(r => path.isAbsolute(r)).map(r => fs.promises.realpath(r).catch(() => undefined)))
  if (!known.some(r => r && r !== path.parse(r).root && (real === r || real.startsWith(r + path.sep)))) throw new Error('not a known project folder')
  const subs = [...new Set([...roots, ...chats])].filter(r => path.isAbsolute(r) && r.startsWith(cwd.replace(/\/+$/, '') + path.sep))
  const key = await keyOf(cwd, subs, home)
  const hit = cache.get(real)
  if (hit && hit.key === key && Date.now() - hit.at < TTL) { cache.delete(real); cache.set(real, hit); return hit.map.then(m => withGroups(m, groups)) }
  const map = Promise.all([scanCode(real), readWork(cwd, home, CHATS_MAX, subs)]).then(([code, work]) => assemble(path.basename(real), code, work, labels))
  cache.delete(real)
  cache.set(real, { key, at: Date.now(), map })
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
  map.catch(() => cache.delete(real))
  return map.then(m => withGroups(m, groups))
}

/** After the cache, like withGroups: a live chat's limits and spend, copied from its hub row. Same object when no node has any. */
export function withLimits(map: FlowMap, chats: ChatRow[]): FlowMap {
  const by = new Map(chats.filter(c => c.budget || c.checkBack || c.costUsd !== undefined || c.elapsedMs !== undefined).map(c => [`chat:${c.sessionId}`, c]))
  if (!map.nodes.some(n => by.has(n.id))) return map
  return { ...map, nodes: map.nodes.map(n => { const c = by.get(n.id); return c ? { ...n, ...(c.budget ? { budget: c.budget } : {}), ...(c.checkBack ? { checkBack: c.checkBack } : {}), ...(c.costUsd !== undefined ? { costUsd: c.costUsd } : {}), ...(c.elapsedMs !== undefined ? { elapsedMs: c.elapsedMs } : {}) } : n }) }
}

// After the cache: a group is set when a chat starts, long before the map's key moves.
export function withGroups(map: FlowMap, groups: Record<string, string>): FlowMap {
  const of = (n: FlowNode) => (n.kind === 'chat' ? groups[n.id.slice(5)] : undefined)
  // Same object when nothing is grouped, so a cache hit stays the same map.
  return map.nodes.some(of) ? { ...map, nodes: map.nodes.map(n => { const g = of(n); return g ? { ...n, group: g } : n }) } : map
}

/** Chat names the hub already shows, by session id: live chats over archived ones. */
export const flowLabels = (s: HubState): Record<string, string> => Object.fromEntries([...(s.archive ?? []), ...s.chats].flatMap(c => { const n = c.name && chatName(c.name); return n ? [[c.sessionId, n]] : [] }))

/** Folders a map may be built for: registered projects only, so a chat that ran in ~ cannot map the home folder. A folder holding other projects (~/Documents/GitHub) is left out unless it is a git repo itself. */
export const flowRoots = (s: HubState): string[] => {
  const all = s.projects.map(p => p.path)
  return all.filter(r => fs.existsSync(path.join(r, '.git')) || !all.some(o => o.startsWith(r.replace(/\/+$/, '') + '/')))
}

/** Live and archived chats' folders, only for finding a project's subfolder chats. */
export const flowChatDirs = (s: HubState): string[] => [...new Set([...s.chats.map(c => c.cwd), ...(s.archive ?? []).map(a => a.cwd)])]
