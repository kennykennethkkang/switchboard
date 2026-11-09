import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// Opt-in check: BLA hardens a throwaway copy of the build, never the real one, and nothing ships.
export const BLA = 'bla-agents@3.1.0'
const BUILD_DIRS = ['dist', '.next', 'out', 'build']
const HARDEN_MS = 5 * 60_000, TEST_MS = 10 * 60_000

export type Run = (cmd: string, args: string[], o: { cwd: string; env?: NodeJS.ProcessEnv; timeout: number }) => Promise<{ ok: boolean; out: string }>

const execRun: Run = (cmd, args, o) => new Promise(resolve =>
  execFile(cmd, args, { ...o, windowsHide: true, maxBuffer: 4 << 20 }, (err, stdout, stderr) =>
    resolve({ ok: !err, out: `${stdout}${stderr}`.trim() || (err?.message ?? '') })))

export const blaArgs = (dir: string) => ['--yes', BLA, 'harden', dir]

const readPkg = (root: string): { scripts?: Record<string, string> } => {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) } catch { return {} }
}

const inside = (root: string, rel: string) => {
  const p = path.resolve(root, rel)
  return p.startsWith(path.resolve(root) + path.sep) && fs.existsSync(p) && fs.statSync(p).isDirectory()
}

/** The build output, relative to root: an outDir flag in the build script, else the first usual name that exists. */
export function buildDir(root: string): string | undefined {
  const script = readPkg(root).scripts?.build ?? ''
  const flag = /(?:--outDir|--out-dir|--outdir|-o)[ =]([^\s&|;]+)/.exec(script)?.[1]
  if (flag && inside(root, flag)) return path.normalize(flag)
  return BUILD_DIRS.find(d => inside(root, d))
}

function tally(dir: string): { files: number; bytes: number } {
  let files = 0, bytes = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue
    files++
    bytes += fs.statSync(path.join(e.parentPath, e.name)).size
  }
  return { files, bytes }
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`
const tail = (s: string) => s.split('\n').slice(-3).join(' ').slice(0, 300)

export async function tryHarden(root: string, o: { enabled: boolean; run?: Run }): Promise<{ ok: boolean; text: string }> {
  if (!o.enabled) return { ok: false, text: 'Harden build check is off in settings' }
  const run = o.run ?? execRun
  const rel = buildDir(root)
  if (!rel) return { ok: false, text: 'No build output found (dist, .next, out or build). Build first.' }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-harden-'))
  const copy = path.join(tmp, path.basename(rel))
  try {
    fs.cpSync(path.join(root, rel), copy, { recursive: true })
    const before = tally(copy)
    // cwd is the temp dir, so any output root BLA makes lands there too.
    const h = await run('npx', blaArgs(copy), { cwd: tmp, timeout: HARDEN_MS })
    if (!h.ok) return { ok: false, text: `BLA failed on the copy of ${rel}: ${tail(h.out)}` }
    const after = tally(tmp)
    const diff = `${rel}: ${before.files} → ${after.files} files, ${kb(before.bytes)} → ${kb(after.bytes)}`
    if (!readPkg(root).scripts?.test) return { ok: true, text: `${diff}; no test script, so not run` }
    const t = await run('npm', ['run', 'test'], { cwd: root, env: { ...process.env, HARDENED_BUILD_DIR: copy }, timeout: TEST_MS })
    return t.ok ? { ok: true, text: `${diff}; tests passed against the hardened copy` } : { ok: false, text: `${diff}; tests failed against the hardened copy: ${tail(t.out)}` }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
