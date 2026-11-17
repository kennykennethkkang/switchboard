import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

/** Read up to `length` bytes at `offset`; shorter if the file is shorter. */
export function readFileBytes(filePath: string, offset: number, length: number): Buffer {
  const fd = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    return buffer.subarray(0, fs.readSync(fd, buffer, 0, length, offset))
  } finally {
    fs.closeSync(fd)
  }
}

/** Decode only up to the last newline. `used` is that byte count, so a
 *  half-written line (and any split multi-byte char) waits for the next read. */
export function completeLines(buf: Buffer): { lines: string[]; used: number } {
  const used = buf.lastIndexOf(0x0a) + 1
  return { lines: buf.toString('utf-8', 0, used).split(/\r?\n/).filter(Boolean), used }
}

/**
 * Read complete lines appended to a file since `lastSize` bytes.
 * newSize stops after the last newline, so a partial line is read again whole
 * next time. Null when no complete line is new. Truncation resets to 0.
 */
export function readNewFileLines(
  filePath: string,
  lastSize: number,
): { lines: string[]; newSize: number } | null {
  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch { return null /* expected if file was removed */ }

  if (stat.size < lastSize) {
    // File was truncated
    return { lines: [], newSize: 0 }
  }
  if (stat.size <= lastSize) {
    return null
  }

  const { lines, used } = completeLines(readFileBytes(filePath, lastSize, stat.size - lastSize))
  if (used === 0) return null
  return { lines, newSize: lastSize + used }
}

/** c:\ and C:\ as one spelling, so a path used as a key does not split by who reported it. */
export const upperDrive = (p: string) => p.replace(/^[a-z]:/, d => d.toUpperCase())

/** Case-fold a path string for comparison on Windows, where the filesystem is
 *  case-insensitive and tools disagree on drive-letter case (VS Code reports
 *  `c:\...`, Claude Code and most shells report `C:\...`). Identity elsewhere. */
export function foldPathCase(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p
}

/** A lock file every window sees; the release, or undefined while another holder's is younger than staleMs (a crashed one's is taken over). */
export function tryLock(lock: string, staleMs = 60_000): (() => void) | undefined {
  // pid plus a nonce: two locks in one process are still told apart on release.
  const me = `${process.pid}:${randomUUID()}`
  const take = () => { try { fs.writeFileSync(lock, me, { flag: 'wx' }); return true } catch { return false } }
  const stale = (f: string, ms: number) => { try { return Date.now() - fs.statSync(f).mtimeMs >= ms } catch { return false } }
  try { fs.mkdirSync(path.dirname(lock), { recursive: true }) } catch { return undefined }
  if (!take()) {
    if (!stale(lock, staleMs)) return undefined
    // Takeover goes through a wx gate so only one contender clears the stale file and re-creates it.
    // ponytail: a gate left by a crash mid-takeover is cleared after 10 s.
    const gate = `${lock}.takeover`
    if (stale(gate, 10_000)) {
      // Rename, not rm: only one contender moves the old gate. A moved gate that turns out fresh was a live one; put it back.
      const aside = `${gate}.${me.replace(':', '-')}`
      try { fs.renameSync(gate, aside); if (stale(aside, 10_000)) fs.rmSync(aside); else fs.renameSync(aside, gate) } catch { /* another contender moved it */ }
    }
    try { fs.writeFileSync(gate, me, { flag: 'wx' }) } catch { return undefined }
    try {
      if (!stale(lock, staleMs) && fs.existsSync(lock)) return undefined
      fs.rmSync(lock, { force: true })
      if (!take()) return undefined
    } finally { fs.rmSync(gate, { force: true }) }
  }
  return () => { try { if (fs.readFileSync(lock, 'utf8') === me) fs.rmSync(lock) } catch { /* gone already */ } }
}

const nap = new Int32Array(new SharedArrayBuffer(4))

/** A short read-modify-write under lock, waiting up to waitMs for another window's.
 * Past that it runs unlocked, so a stuck holder never blocks the write; a lost update is the ceiling. */
export function withLock<T>(lock: string, fn: () => T, waitMs = 100): T {
  const until = Date.now() + waitMs
  // Holds last milliseconds, so a 2 s old lock is a crashed window's; the wait blocks the host, keep it short.
  let release = tryLock(lock, 2_000)
  while (!release && Date.now() < until) { Atomics.wait(nap, 0, 0, 10); release = tryLock(lock, 2_000) }
  try { return fn() } finally { release?.() }
}

/** Parsed JSON from file, or fallback when it is missing or broken. */
export function readJsonOr(file: string, fallback?: unknown): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

/** Write JSON via temp file + rename so a crash mid-write can't truncate the file. */
export function writeJsonAtomic(target: string, value: unknown): void {
  // Write through a symlink (dotfiles) and keep the mode, or rename replaces both; a new file is owner-only
  let filePath = target
  let mode = 0o600
  try { filePath = fs.realpathSync(target); mode = fs.statSync(filePath).mode & 0o777 } catch { /* new file */ }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2) + '\n', { mode })
  fs.chmodSync(tmpPath, mode)
  fs.renameSync(tmpPath, filePath)
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object'
}
