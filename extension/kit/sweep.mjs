// SkillSpector sweep: scans a skill or plugin folder (--no-llm) and keeps one verdict per tool in ~/.claude/switchboard/sweep.json.
// Shared by setup-run.mjs and the extension (src/hub/sweep.ts). Never runs anything from the scanned folder.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

const RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }
const rank = s => RANK[s] ?? 0

export const sweepFile = (home = homedir()) => join(home, '.claude', 'switchboard', 'sweep.json')
export const skillspector = (home = homedir()) => { const b = join(home, '.local', 'bin', 'skillspector'); return existsSync(b) ? b : 'skillspector' }

/** clean, review (DO_NOT_INSTALL or any HIGH or CRITICAL issue: a static scan explains none) or unscanned, from a report. */
export function verdict(r) {
  if (!r || r.execution_successful === false || !r.risk_assessment) return { state: 'unscanned', reason: 'the scan did not finish' }
  const issues = Array.isArray(r.issues) ? r.issues : []
  const { score, severity, recommendation } = r.risk_assessment
  const bad = recommendation === 'DO_NOT_INSTALL' || issues.some(i => rank(i.severity) >= RANK.HIGH)
  const top = [...issues].sort((a, b) => rank(b.severity) - rank(a.severity)).slice(0, 5)
    .map(i => ({ id: String(i.id ?? ''), severity: String(i.severity ?? ''), file: i.location?.file, line: i.location?.start_line ?? undefined, finding: String(i.finding ?? '').slice(0, 200) }))
  return { state: bad ? 'review' : 'clean', score, severity, recommendation, issues: issues.length, top }
}

const runFile = (cmd, args) => new Promise(resolve => execFile(cmd, args, { timeout: 600_000, maxBuffer: 16 << 20, windowsHide: true }, (error, _out, stderr) => resolve({ error, stderr: String(stderr ?? '') })))

/** Runs skillspector on dir. It exits 1 after a finished scan with findings, so the report decides, not the exit code. */
export async function scan(dir, { bin = skillspector(), run = runFile } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'sb-sweep-'))
  try {
    const out = join(tmp, 'report.json')
    const r = await run(bin, ['scan', dir, '--no-llm', '--format', 'json', '-o', out])
    if (r.error?.code === 'ENOENT') return { state: 'unscanned', reason: 'skillspector is not installed' }
    try { return verdict(JSON.parse(readFileSync(out, 'utf8'))) } catch {
      const why = r.stderr.trim().split('\n').filter(Boolean).at(-1) || r.error?.message || 'no report'
      return { state: 'unscanned', reason: `the scan failed (${why.slice(0, 200)})` }
    }
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

/** Every file's path and bytes, and each link's target, so a copy hashes the same as its source and a changed link does not; .git is left out. */
export function digest(dir) {
  const h = createHash('sha256')
  const walk = rel => {
    for (const n of readdirSync(join(dir, rel)).sort()) {
      // .in_use holds claude's per-session lock files; they change with every chat
      if (n === '.git' || n === '.in_use') continue
      const r = rel ? `${rel}/${n}` : n, st = lstatSync(join(dir, r))
      if (st.isSymbolicLink()) h.update(`${r}\0link\0${readlinkSync(join(dir, r))}\0`)
      else if (st.isDirectory()) walk(r)
      else if (st.isFile()) h.update(`${r}\0`).update(readFileSync(join(dir, r))).update('\0')
    }
  }
  walk('')
  return h.digest('hex')
}

/** The first symlink in dir (or dir itself, as '.'), relative; .git is left out. Incoming tools with one are refused. */
export function symlinkIn(dir) {
  if (lstatSync(dir).isSymbolicLink()) return '.'
  for (const n of readdirSync(dir).sort()) {
    if (n === '.git') continue
    const p = join(dir, n), st = lstatSync(p)
    if (st.isSymbolicLink()) return n
    if (st.isDirectory()) { const deep = symlinkIn(p); if (deep) return `${n}/${deep}` }
  }
  return undefined
}

/** Incoming from outside the kit: a tool that could not be scanned is held like a flagged one. */
const failClosed = v => (v.state === 'unscanned' ? { ...v, state: 'review', reason: `could not be scanned: ${v.reason}` } : v)

export function readSweep(home = homedir()) {
  try { const j = JSON.parse(readFileSync(sweepFile(home), 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {} } catch { return {} }
}

function save(home, name, rec) {
  const all = readSweep(home)
  all[name] = rec
  const f = sweepFile(home), t = `${f}.${process.pid}.tmp`
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(t, `${JSON.stringify(all, null, 2)}\n`)
  renameSync(t, f)
  return rec
}

/** The one gate: a tool held at intake (hold: true) stays off until approved for exactly these files. current: the digest now, else the scanned one. */
export const needsApproval = (rec, current = rec?.digest) => !!rec?.hold && (!rec.approvedAt || rec.approvedDigest !== current)
/** Needs approval for the files it was scanned with. */
export const held = rec => needsApproval(rec)

// What a rescan never touches: the hold, the approval and the review.
const kept = prev => Object.fromEntries(['hold', 'approvedAt', 'approvedDigest', 'reviewed'].filter(k => prev?.[k] !== undefined).map(k => [k, prev[k]]))

/** Scans one tool unless its files match the last scan. A hold and an approval carry over; the approval only counts for its digest. force: scan anyway. */
export async function sweepOne(name, kind, dir, { home = homedir(), scan: s = scan, force = false } = {}) {
  const prev = readSweep(home)[name], d = digest(dir)
  if (prev?.digest === d && !force && prev.state !== 'unscanned') return prev
  const v = await s(dir)
  return save(home, name, { kind, path: dir, digest: d, scannedAt: Date.now(), ...v, ...kept(prev) })
}

/** Kenneth's override for the files with digest d (default: the scanned ones). path: where the tool is now, when it moved. */
export function approve(name, { home = homedir(), path, digest: d } = {}) {
  const prev = readSweep(home)[name]
  return prev ? save(home, name, { ...prev, ...(path ? { path } : {}), approvedAt: Date.now(), approvedDigest: d ?? prev.digest }) : undefined
}

/** Records a human triage verdict for the current files. Display only: a hold still needs approve. */
export function markReviewed(home, name, verdict, why) {
  if (!['APPROVE', 'CAUTION', 'REJECT'].includes(verdict)) throw new Error(`bad verdict ${verdict}`)
  const prev = readSweep(home)[name]
  return prev ? save(home, name, { ...prev, reviewed: { verdict, why: String(why), at: Date.now(), digest: prev.digest } }) : undefined
}

/** Scans a fetched skill folder, then copies it into ~/.claude/skills, or into skills-archive (off) when it needs review.
 * hold false (a kit skill from setup.json): swept and badged, always copied in on. */
export async function intakeSkill(src, name, { home = homedir(), scan: s = scan, hold = true } = {}) {
  const link = symlinkIn(src)
  if (link) throw new Error(`${name} holds a symlink (${link}), refused`)
  const v = hold ? failClosed(await s(src)) : await s(src)
  const prev = readSweep(home)[name], d = digest(src)
  const rec = { kind: 'skill', digest: d, scannedAt: Date.now(), ...v, ...kept(prev), ...(hold && v.state === 'review' ? { hold: true } : {}) }
  const to = join(home, '.claude', needsApproval(rec) ? 'skills-archive' : 'skills', name)
  mkdirSync(dirname(to), { recursive: true })
  cpSync(src, to, { recursive: true, filter: f => basename(f) !== '.git' })
  return save(home, name, { ...rec, path: to })
}

/** A plugin's install folder from installed_plugins.json, user scope first. */
export function pluginDir(id, home = homedir()) {
  try {
    const e = JSON.parse(readFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8')).plugins?.[id] ?? []
    return (e.find(x => x.scope === 'user') ?? e[0])?.installPath
  } catch { return undefined }
}

/** Right after `claude plugin install`: off while it is scanned, back on only when it passes. set(id, on) runs claude plugin enable or disable.
 * hold false (a kit plugin from setup.json): swept and badged only, never turned off. */
export async function intakePlugin(id, { home = homedir(), scan: s = scan, set, hold = true }) {
  const dir = pluginDir(id, home)
  if (!dir || !existsSync(dir)) return undefined
  // set answers false when claude failed; a plugin that would not turn off is recorded so the panel says so.
  const off = hold ? (await set(id, false)) !== false : true
  let rec = await sweepOne(id, 'plugin', dir, { home, scan: hold ? async d => failClosed(await s(d)) : s, force: true })
  if (hold && rec.state === 'review' && !rec.hold) rec = save(home, id, { ...rec, hold: true })
  if (!off) rec = save(home, id, { ...rec, offFailed: true })
  if (hold && off && !held(rec)) await set(id, true)
  return rec
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO = /^[A-Za-z0-9._-]{1,100}$/

/** owner/repo from "owner/repo" or an https://github.com/owner/repo link; anything else is undefined. */
export function repoOf(input) {
  if (typeof input !== 'string') return undefined
  const m = /^(?:https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?|([^/]+)\/([^/]+))$/.exec(input.trim())
  const owner = m?.[1] ?? m?.[3], repo = m?.[2] ?? m?.[4]
  return owner && repo && OWNER.test(owner) && REPO.test(repo) && repo !== '.' && repo !== '..' ? `${owner}/${repo}` : undefined
}
