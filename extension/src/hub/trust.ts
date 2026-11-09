/**
 * Marks a chat's folder trusted in ~/.claude.json before Switchboard starts Claude there, so no
 * trust prompt holds a chat that nobody is watching. Never for the home folder or the root, nor outside a trusted window's workspace.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { writeJsonAtomic } from '../hook-entries'
import { readWindows } from './dev'
import { createLogger } from '../logger'

const log = createLogger('Trust')

/**
 * Who vouches for a folder: this window's folders while VS Code trusts its workspace, and others, the workspaces of
 * other live windows that say they are trusted (trustedWindowRoots). A folder outside all of them is never trusted.
 */
export type TrustGuard = { trusted: boolean; roots: string[]; others?: string[]; ask?: boolean }

/** The workspaces of live Switchboard windows whose discovery file says VS Code trusts them. */
export const trustedWindowRoots = (dir?: string) => readWindows(dir).filter(w => w.trusted === true).map(w => w.workspace)

const revParse = (dir: string, ...what: string[]) =>
  execFileSync('git', ['-C', dir, 'rev-parse', '--path-format=absolute', ...what], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')

/** A folder's repository, as its real git common dir (a worktree shares its main checkout's); none outside git or on a failure. */
function commonDir(dir: string): string | undefined {
  try { return fs.realpathSync(revParse(dir, '--git-common-dir')[0]) } catch { return undefined }
}

/**
 * The folder Claude keys trust on: a repo's root (a worktree's main checkout), else the folder itself.
 * git through execFile, no shell; any failure is the folder.
 */
function trustKey(dir: string): string {
  try {
    const [common, top] = revParse(dir, '--git-common-dir', '--show-toplevel')
    // A submodule's common dir is inside its parent's .git/modules: its own top level then.
    return fs.realpathSync(path.basename(common) === '.git' ? path.dirname(common) : top)
  } catch { return dir }
}

/** The real folder, when it is one of the roots or below one; symlinks resolved on both sides, so none leads out. */
function insideRoots(cwd: string, roots: string[]): string | undefined {
  const dir = fs.realpathSync(cwd)
  for (const r of roots) {
    let root: string
    try { root = fs.realpathSync(r) } catch { continue }
    const rel = path.relative(root, dir)
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return dir
  }
  return undefined
}

/**
 * A root vouches for the key when the key is inside it, or both are the same repository (same git common dir): a
 * window on a repo subfolder or a worktree vouches for the repo root. A nested repo or submodule has its own, so never.
 */
function vouched(key: string, roots: string[]): boolean {
  if (insideRoots(key, roots)) return true
  const mine = commonDir(key)
  return !!mine && roots.some(r => commonDir(r) === mine)
}

/**
 * Claude Code's own lock on the file (proper-lockfile: a <file>.lock folder, stale after 10s untouched), held for fn.
 * Waits up to about a second, then throws: the launch goes on and Claude asks itself.
 */
function locked(file: string, fn: () => void): void {
  const lock = `${file}.lock`
  for (let i = 0; ; i++) {
    try { fs.mkdirSync(lock); break } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      // Every pass counts, so a lock that cannot be cleared still gives up.
      if (i >= 40) throw new Error(`${lock} held`)
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10_000) { fs.rmdirSync(lock); continue } } catch { /* gone, or not ours to clear: wait */ }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    }
  }
  try { fn() } finally { try { fs.rmdirSync(lock) } catch { /* gone already */ } }
}

/**
 * Never throws: a launch goes on untrusted rather than not at all, and Claude asks itself. Writes only for a trusted
 * workspace and a folder it vouches for: a trusted folder runs its own .claude hooks with nobody watching. A file it cannot read is left alone.
 */
export function trustFolder(cwd: string, guard: TrustGuard, file = path.join(os.homedir(), '.claude.json'), home = os.homedir()): void {
  // With Ask before actions on, the trust prompt is one of the asks.
  if (guard.ask) return
  try {
    const dir = trustKey(fs.realpathSync(cwd))
    if (!vouched(dir, [...(guard.trusted ? guard.roots : []), ...guard.others ?? []])) return
    if (dir === fs.realpathSync(home) || dir === path.parse(dir).root) return
    const read = () => JSON.parse(fs.readFileSync(file, 'utf8')) as { projects?: Record<string, Record<string, unknown>> }
    if (read().projects?.[dir]?.hasTrustDialogAccepted === true) return
    // Every live chat rewrites this file: read again under Claude's lock, right before the write.
    locked(file, () => {
      const j = read()
      if (j.projects?.[dir]?.hasTrustDialogAccepted === true) return
      writeJsonAtomic(file, { ...j, projects: { ...j.projects, [dir]: { ...j.projects?.[dir], hasTrustDialogAccepted: true } } })
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Could not trust ${cwd}:`, err)
  }
}
