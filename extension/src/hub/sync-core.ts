/** Sync of memory, the vault and prefs through a private repo: pure planning plus the 3-way run. No vscode here. */
import { execFile } from 'child_process'
import { createHash } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { promisify } from 'util'

const run = promisify(execFile)
const MAX_BYTES = 5 * 1024 * 1024
const sha = (b: Buffer | string) => createHash('sha1').update(b).digest('hex')

/** github.com/owner/repo, lowercased, from an https or ssh remote; the folder name when there is none. */
export function projectKey(remote: string | undefined, folder: string): string {
  const m = remote?.trim().match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)[/:](.+?)(?:\.git)?\/?$/i)
  const key = m ? `${m[1]}/${m[2]}` : path.basename(folder)
  return key.toLowerCase().replace(/[^a-z0-9._/-]/g, '_').split('/').filter(p => p && p !== '..' && p !== '.').join('/')
}

const SECRET = /(^|\/)(\.env[^/]*|[^/]*\.(pem|key|p12|secret)|id_[^/]*|\.npmrc|\.netrc|keys\.json|logins\.json|vapid\.json|push\.json|aws-identity\.json|aws-sessions\.json|credentials[^/]*\.json|credentials)$/i
/** Notes (.md) are never skipped for their name. */
export const isSecret = (rel: string) => !/\.md$/i.test(rel) && SECRET.test(rel)

export type Act = 'none' | 'push' | 'pull' | 'removeLocal' | 'removeRepo' | 'merge' | 'remoteWins'
/** Hashes of the base (last synced), local and repo copy; undefined is absent. md: union-merge, else the repo copy wins. */
export function decide(base: string | undefined, l: string | undefined, r: string | undefined, md: boolean): Act {
  if (l === r) return 'none'
  const both: Act = md ? 'merge' : 'remoteWins'
  // No base: first sight of the file, nothing is deleted.
  if (base === undefined) return l === undefined ? 'pull' : r === undefined ? 'push' : both
  if (l === base) return r === undefined ? 'removeLocal' : 'pull'
  if (r === base) return l === undefined ? 'removeRepo' : 'push'
  // Both moved: a delete loses to an edit.
  return l === undefined ? 'pull' : r === undefined ? 'push' : both
}

export type KeyedKind = 'top' | 'company'
/** Rewrites absolute-path keys of a prefs json; names with no entry in map stay. */
export function rekey(kind: KeyedKind, text: string, map: (k: string) => string): string {
  try {
    const j = JSON.parse(text)
    // Two names that map to one key: the first takes it, the rest stay as they are.
    const swap = (o: Record<string, unknown>) => {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(o)) {
        const n = map(k)
        out[n !== k && (n in out || Object.prototype.hasOwnProperty.call(o, n)) ? k : n] = v
      }
      return out
    }
    const out = kind === 'top' ? swap(j) : { ...j, ...(j.advancedMode && typeof j.advancedMode === 'object' ? { advancedMode: swap(j.advancedMode) } : {}) }
    return JSON.stringify(out, null, 2) + '\n'
  } catch { return text }
}

export type Local = { abs: string; root: string; keyed?: KeyedKind }
export type Mapping = { list(): Map<string, Local>; resolve(rel: string): Local | undefined; toKey(p: string): string; toPath(k: string): string; /** key -> memory dir */ dirs: Record<string, string> }
export type MapInput = { projects: { path: string; remote?: string }[]; claudeProjects: string; vault: string; sbDir: string; jev?: string }

const PLAIN = ['groups.json', 'ask-mode.json', 'smart-learned.json']
const KEYED: Record<string, KeyedKind> = { 'colors.json': 'top', 'todo-sync.json': 'top', 'company.json': 'company' }
const slugOf = (p: string) => p.replace(/[^a-zA-Z0-9]/g, '-')

function walk(dir: string, base = dir): string[] {
  let out: string[] = []
  let ents: fs.Dirent[]
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue
    const f = path.join(dir, e.name)
    if (e.isDirectory()) out = out.concat(walk(f, base))
    else if (e.isFile() && fs.statSync(f).size <= MAX_BYTES) out.push(path.relative(base, f).split(path.sep).join('/'))
  }
  return out
}

export function buildMapping(o: MapInput): Mapping {
  const onDisk = (() => { try { return fs.readdirSync(o.claudeProjects) } catch { return [] as string[] } })()
  const memory = new Map<string, string>() // key -> memory dir
  const pathKey = new Map<string, string>()
  // The main checkout (its .git is a folder) owns a shared key, else the shortest path; so the owner does not depend on list order.
  const isMain = (p: string) => { try { return fs.statSync(path.join(p, '.git')).isDirectory() } catch { return false } }
  const ordered = [...o.projects].sort((a, b) => Number(isMain(b.path)) - Number(isMain(a.path)) || a.path.length - b.path.length || (a.path < b.path ? -1 : 1))
  for (const p of ordered) {
    const key = projectKey(p.remote, p.path)
    pathKey.set(p.path, key)
    if (memory.has(key)) continue
    const slug = slugOf(p.path)
    memory.set(key, path.join(o.claudeProjects, onDisk.find(d => d.toLowerCase() === slug.toLowerCase()) ?? slug, 'memory'))
  }
  // Folders no project names: keyed by the folder's own name.
  const known = new Set([...memory.values()].map(d => d.toLowerCase()))
  for (const d of onDisk) {
    const mem = path.join(o.claudeProjects, d, 'memory')
    if (!known.has(mem.toLowerCase()) && walk(mem).length) memory.set(projectKey(undefined, d), mem)
  }
  // The owner is the first path of a key in the sorted list; other paths of the key keep their absolute name both ways.
  const owner = new Map<string, string>()
  for (const p of ordered) { const k = pathKey.get(p.path)!; if (!owner.has(k)) owner.set(k, p.path) }
  const safe = (r: string) => !/^([a-zA-Z]:|[\\/])/.test(r) && !r.split(/[\\/]/).some(s => s === '..' || s === '' || /^[a-zA-Z]:/.test(s)) && !isSecret(r)
  const resolve = (rel: string): Local | undefined => {
    if (!safe(rel)) return undefined
    if (rel.startsWith('vault/')) return { abs: path.join(o.vault, rel.slice(6)), root: o.vault }
    // Jev presets name private projects, so they travel here instead of the public kit
    if (rel.startsWith('jev/')) return o.jev ? { abs: path.join(o.jev, rel.slice(4)), root: o.jev } : undefined
    if (rel.startsWith('prefs/')) {
      const n = rel.slice(6)
      if (PLAIN.includes(n) || n.startsWith('research/')) return { abs: path.join(o.sbDir, n), root: o.sbDir }
      return KEYED[n] ? { abs: path.join(o.sbDir, n), root: o.sbDir, keyed: KEYED[n] } : undefined
    }
    if (rel.startsWith('memory/')) {
      const key = [...memory.keys()].filter(k => rel.startsWith(`memory/${k}/`)).sort((a, b) => b.length - a.length)[0]
      return key ? { abs: path.join(memory.get(key)!, rel.slice(8 + key.length)), root: memory.get(key)! } : undefined
    }
  }
  const list = () => {
    const m = new Map<string, Local>()
    const add = (rel: string) => { const l = resolve(rel); if (l) m.set(rel, l) }
    for (const [key, dir] of memory) walk(dir).forEach(f => add(`memory/${key}/${f}`))
    walk(o.vault).forEach(f => add(`vault/${f}`))
    if (o.jev) walk(o.jev).forEach(f => add(`jev/${f}`))
    walk(path.join(o.sbDir, 'research')).forEach(f => add(`prefs/research/${f}`))
    for (const n of [...PLAIN, ...Object.keys(KEYED)]) if (fs.existsSync(path.join(o.sbDir, n))) add(`prefs/${n}`)
    for (const rel of [...m.keys()]) { try { if (fs.lstatSync(m.get(rel)!.abs).isSymbolicLink()) m.delete(rel) } catch { m.delete(rel) } }
    return m
  }
  return { list, resolve, toKey: p => { const k = pathKey.get(p); return k !== undefined && owner.get(k) === p ? k : p }, toPath: k => owner.get(k) ?? k, dirs: Object.fromEntries(memory) }
}

export type SyncState = { lastCommit?: string; last?: number; files: Record<string, string>; remote?: string; dirs?: Record<string, string> }
/** The token for git's http.extraHeader through env, so it never shows in a process list. */
export const authEnv = (token: string) => ({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}` })
export type SyncOpts = { repoDir: string; remote: string; authEnv?: Record<string, string>; map: Mapping; stateFile: string; backupDir: string; host: string; now?: () => Date }
export type SyncResult = { pushed: number; pulled: number; merged: number; removed: number; committed: boolean }

const readState = (f: string): SyncState => { try { return { files: {}, ...JSON.parse(fs.readFileSync(f, 'utf8')) } } catch { return { files: {} } } }
const read = (f: string) => { try { return fs.readFileSync(f) } catch { return undefined } }

function wipe(dir: string) { for (const n of fs.readdirSync(dir)) if (n !== '.git') fs.rmSync(path.join(dir, n), { recursive: true, force: true }) }

export async function runSync(o: SyncOpts, retry = true): Promise<SyncResult> {
  const git = async (args: string[], net = false) => (await run('git', args, { cwd: o.repoDir, maxBuffer: 64 << 20, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(net ? o.authEnv : {}) } })).stdout
  fs.mkdirSync(o.repoDir, { recursive: true })
  if (!fs.existsSync(path.join(o.repoDir, '.git'))) await git(['init', '-q', '-b', 'main'])
  // An empty hooks dir: Switchboard's chat guard never lands in or blocks this repo.
  const hooks = path.join(o.repoDir, '.git', 'no-hooks')
  fs.mkdirSync(hooks, { recursive: true })
  for (const [k, v] of [['core.hooksPath', hooks], ['user.name', 'Switchboard'], ['user.email', 'switchboard@localhost'], ['commit.gpgsign', 'false'], ['remote.origin.url', o.remote]]) await git(['config', k, v])
  const remoteHas = (await git(['ls-remote', '--heads', 'origin', 'main'], true)).trim() !== ''
  if (remoteHas) { await git(['fetch', '-q', 'origin', '+main:refs/remotes/origin/main'], true); await git(['reset', '-q', '--hard', 'origin/main']); await git(['clean', '-qfd']) }
  else { wipe(o.repoDir); await git(['update-ref', '-d', 'HEAD']).catch(() => '') }

  const state = readState(o.stateFile)
  // A new or empty remote is a first sync: no base, so nothing is deleted.
  if (!remoteHas || state.remote !== o.remote) { state.files = {}; state.lastCommit = undefined }
  // The last synced commit must be in the remote's history; a repo recreated at the same url is a first sync.
  if (remoteHas && state.lastCommit && !(await git(['merge-base', '--is-ancestor', state.lastCommit, 'origin/main']).then(() => true, () => false))) { state.files = {}; state.lastCommit = undefined }
  const dirs = o.map.dirs
  const dirMoved = (rel: string) => {
    const k = Object.keys(dirs).filter(k => rel.startsWith(`memory/${k}/`)).sort((a, b) => b.length - a.length)[0]
    return k !== undefined && state.dirs?.[k] !== undefined && state.dirs[k] !== dirs[k]
  }
  const repoFiles = new Map<string, string>() // rel -> repo hash
  for (const f of walkAll(o.repoDir)) repoFiles.set(f, sha(fs.readFileSync(path.join(o.repoDir, f))))
  const local = o.map.list()
  const day = (o.now?.() ?? new Date()).toISOString().slice(0, 10)
  const backup = (abs: string, rel: string) => {
    const to = path.join(o.backupDir, day, rel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(abs, to)
  }
  const res: SyncResult = { pushed: 0, pulled: 0, merged: 0, removed: 0, committed: false }
  const baseText = async (rel: string) => state.lastCommit ? await git(['show', `${state.lastCommit}:${rel}`]).catch(() => '') : ''

  // Nothing is read or written through a symlink, in the file or any folder between it and its root.
  const clear = (l: Local) => {
    for (let p = l.abs; p !== l.root && !path.relative(l.root, p).startsWith('..') && path.dirname(p) !== p; p = path.dirname(p)) {
      try { if (fs.lstatSync(p).isSymbolicLink()) return false } catch { /* not there yet */ }
    }
    return true
  }
  for (const rel of new Set([...repoFiles.keys(), ...local.keys()])) {
    const loc = local.get(rel) ?? o.map.resolve(rel)
    if (!loc || !clear(loc)) continue
    const rp = path.join(o.repoDir, rel)
    const raw = read(loc.abs)
    const lBuf = raw && (loc.keyed ? Buffer.from(rekey(loc.keyed, raw.toString('utf8'), o.map.toKey)) : raw)
    const rBuf = read(rp)
    const md = rel.endsWith('.md')
    const moved = dirMoved(rel)
    const act = decide(moved ? undefined : state.files[rel], lBuf && sha(lBuf), rBuf && sha(rBuf), md)
    const toRepo = (t: Buffer) => { fs.mkdirSync(path.dirname(rp), { recursive: true }); fs.writeFileSync(rp, t) }
    const toLocal = (t: Buffer) => { fs.mkdirSync(path.dirname(loc.abs), { recursive: true }); fs.writeFileSync(loc.abs, loc.keyed ? rekey(loc.keyed, t.toString('utf8'), o.map.toPath) : t) }
    if (act === 'push') { toRepo(lBuf!); res.pushed++ }
    else if (act === 'pull') { if (raw && loc.keyed) backup(loc.abs, rel); toLocal(rBuf!); res.pulled++ }
    else if (act === 'removeLocal') { backup(loc.abs, rel); fs.rmSync(loc.abs); res.removed++ }
    else if (act === 'removeRepo') { fs.rmSync(rp); res.removed++ }
    else if (act === 'remoteWins') { backup(loc.abs, rel); toLocal(rBuf!); res.merged++ }
    else if (act === 'merge') {
      // shortcut: with no base the union keeps both copies whole, so shared lines can double; upgrade if it shows up.
      const tmp = fs.mkdtempSync(path.join(o.repoDir, '.git', 'merge-'))
      fs.writeFileSync(path.join(tmp, 'l'), lBuf!); fs.writeFileSync(path.join(tmp, 'b'), moved ? '' : await baseText(rel)); fs.writeFileSync(path.join(tmp, 'r'), rBuf!)
      // merge-file exits with the conflict count; --union resolves them all
      const out = await run('git', ['merge-file', '--union', '-p', path.join(tmp, 'l'), path.join(tmp, 'b'), path.join(tmp, 'r')]).then(r => r.stdout, (e: { stdout?: string }) => e.stdout ?? '')
      fs.rmSync(tmp, { recursive: true, force: true })
      backup(loc.abs, rel); toRepo(Buffer.from(out)); toLocal(Buffer.from(out)); res.merged++
    }
  }

  await git(['add', '-A'])
  const dirty = (await git(['status', '--porcelain'])).trim() !== ''
  if (dirty) { await git(['commit', '-q', '--no-verify', '-m', `sync from ${o.host}`]); res.committed = true }
  const head = (await git(['rev-parse', 'HEAD']).catch(() => '')).trim()
  if (head && (dirty || !remoteHas)) {
    try { await git(['push', '-q', '--no-verify', 'origin', 'HEAD:main'], true) } catch (err) {
      if (retry) return runSync(o, false)
      throw err
    }
  }
  const files: Record<string, string> = {}
  for (const f of walkAll(o.repoDir)) files[f] = sha(fs.readFileSync(path.join(o.repoDir, f)))
  fs.mkdirSync(path.dirname(o.stateFile), { recursive: true })
  fs.writeFileSync(o.stateFile, JSON.stringify({ ...state, lastCommit: head || undefined, last: Date.now(), files, remote: o.remote, dirs }, null, 2))
  return res
}

function walkAll(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.name === '.git' ? [] : e.isDirectory() ? walkAll(path.join(dir, e.name)).map(f => `${e.name}/${f}`) : [e.name])
}
