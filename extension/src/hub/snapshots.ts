import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { Snapshot } from './types'

// Same store and manifest as kit/skills/aar/scripts/snapshot.mjs; keep the two in step.
const root = () => path.join(os.homedir(), '.claude', 'switchboard', 'snapshots')
const rel = (p: string) => p.replace(/^[A-Za-z]:/, m => m[0]).replace(/^[\\/]+/, '')
const dirOf = (id: string) => {
  if (!/^[\w.-]+$/.test(id) || id.startsWith('.')) throw new Error(`bad snapshot id ${id}`)
  return path.join(root(), id)
}

/** Copies the files that exist into a new snapshot; missing ones are left out of paths. */
export function saveSnapshot(label: string, files: string[], chat?: string, skipped: string[] = [], reason?: string): Snapshot {
  const at = Date.now()
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'snap'
  fs.mkdirSync(root(), { recursive: true })
  let id = `${at}-${slug}`
  for (let n = 2; ; n++) {
    try { fs.mkdirSync(path.join(root(), id)); break } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; id = `${at}-${slug}-${n}` }
  }
  const paths: string[] = []
  for (const f of files.map(x => path.resolve(x))) {
    if (!fs.statSync(f, { throwIfNoEntry: false })?.isFile()) continue
    const to = path.join(root(), id, 'files', rel(f))
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(f, to)
    paths.push(f)
  }
  const why = reason?.replace(/\s+/g, ' ').trim().slice(0, 500)
  const snap: Snapshot = { id, label, at, paths, ...(chat ? { chat } : {}), ...(skipped.length ? { skipped } : {}), ...(why ? { reason: why } : {}) }
  fs.mkdirSync(path.join(root(), id), { recursive: true })
  fs.writeFileSync(path.join(root(), id, 'manifest.json'), JSON.stringify({ ...snap, chat: chat ?? null }, null, 1))
  return snap
}

/** Every snapshot under ~/.claude/switchboard/snapshots, newest first. */
export function listSnapshots(): Snapshot[] {
  let ids: string[] = []
  try { ids = fs.readdirSync(root()) } catch { return [] }
  const out: Snapshot[] = []
  for (const id of ids) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(root(), id, 'manifest.json'), 'utf8'))
      if (typeof m.id === 'string' && typeof m.at === 'number' && Array.isArray(m.paths)) out.push({ id: m.id, label: String(m.label), at: m.at, paths: m.paths, ...(m.chat ? { chat: m.chat } : {}), ...(Array.isArray(m.skipped) && m.skipped.length ? { skipped: m.skipped.map(String) } : {}), ...(typeof m.reason === 'string' && m.reason ? { reason: m.reason } : {}) })
    } catch { /* not a snapshot */ }
  }
  return out.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))
}

// A path counts only when it resolves under the home folder, through symlinks too.
function underHome(p: string): boolean {
  try {
    const home = fs.realpathSync(os.homedir())
    let d = path.resolve(p)
    while (!fs.existsSync(d)) d = path.dirname(d)
    const r = fs.realpathSync(d)
    return r === home || r.startsWith(home + path.sep)
  } catch { return false }
}

/** Puts a snapshot's files back, after saving the current ones as a "before undo" snapshot; returns that one. Paths outside home are skipped and listed in `skipped`. */
export function restoreSnapshot(id: string): Snapshot & { skipped: string[] } {
  const snap = listSnapshots().find(s => s.id === id)
  if (!snap) throw new Error(`no snapshot ${id}`)
  const ok = snap.paths.filter(underHome)
  const skipped = snap.paths.filter(p => !ok.includes(p)).map(p => `${p} (outside home)`)
  const before = saveSnapshot(`before undo ${snap.label}`, ok, snap.chat, skipped)
  for (const p of ok) {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.copyFileSync(path.join(dirOf(id), 'files', rel(p)), p)
  }
  return { ...before, skipped }
}
