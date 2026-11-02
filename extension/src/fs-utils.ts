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
  try { fs.mkdirSync(path.dirname(lock), { recursive: true }); fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }) } catch {
    try { if (Date.now() - fs.statSync(lock).mtimeMs < staleMs) return undefined; fs.writeFileSync(lock, String(process.pid)) } catch { return undefined }
  }
  return () => fs.rmSync(lock, { force: true })
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
