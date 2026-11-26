import { execFile } from 'child_process'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { tryLock } from '../fs-utils'

type Options = {
  ttlMs: number
  timeoutMs: number
  directory?: string
  fresh?: boolean
  /** Return what a failed run printed (never stored), as local.ts run does. */
  partial?: boolean
  run?: (file: string, args: string[], timeoutMs: number) => Promise<string>
}

type Entry = { at: number; value: string }
const memory = new Map<string, Entry>()
const inflight = new Map<string, Promise<string>>()
const plainRun = (file: string, args: string[], timeoutMs: number) => new Promise<string>((resolve, reject) => {
  execFile(file, args, { timeout: timeoutMs, maxBuffer: 16 << 20, windowsHide: true }, (error, stdout) => {
    if (error) reject(Object.assign(error, { printed: String(stdout) }))
    else resolve(String(stdout))
  })
})
const printed = (err: unknown, o: Options) => (o.partial && (err as { printed?: string })?.printed) || ''
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const cacheParts = (file: string, args: string[], directory?: string) => {
  const hash = crypto.createHash('sha256').update(JSON.stringify([file, args])).digest('hex')
  const root = path.join(directory ?? path.join(os.homedir(), '.claude', 'switchboard'), 'shared')
  return { hash, root, key: `${root}/${hash}.json`, name: `${hash}.json` }
}

export function invalidateSharedRun(file: string, args: string[], directory?: string): void {
  const parts = cacheParts(file, args, directory)
  memory.delete(parts.key)
  inflight.delete(parts.key)
  try { fs.rmSync(path.join(parts.root, parts.name), { force: true }) } catch { /* cache is optional */ }
  try {
    fs.mkdirSync(parts.root, { recursive: true, mode: 0o700 })
    fs.chmodSync(parts.root, 0o700)
    fs.writeFileSync(path.join(parts.root, `${parts.hash}.invalidated`), String(Date.now()), { mode: 0o600 })
  } catch { /* cache is optional */ }
}

function invalidatedAt(directory: string, name: string): number | undefined {
  const marker = path.join(directory, name.replace(/\.json$/, '.invalidated'))
  try {
    const at = Number(fs.readFileSync(marker, 'utf8'))
    return Number.isFinite(at) ? at : fs.statSync(marker).mtimeMs
  } catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : Infinity }
}

function readEntry(directory: string, name: string): Entry | undefined {
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    fs.chmodSync(directory, 0o700)
    const entry = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')) as Entry
    const marker = invalidatedAt(directory, name)
    return Number.isFinite(entry.at) && (!marker || marker <= entry.at) && typeof entry.value === 'string' && entry.value ? entry : undefined
  } catch { return undefined }
}

function read(directory: string, name: string, ttlMs: number): Entry | undefined {
  const entry = readEntry(directory, name)
  const age = entry ? Date.now() - entry.at : -1
  return entry && age >= 0 && age < ttlMs ? entry : undefined
}

function write(directory: string, name: string, entry: Entry): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fs.chmodSync(directory, 0o700)
  const file = path.join(directory, name)
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(temp, JSON.stringify(entry), { mode: 0o600 })
    fs.renameSync(temp, file)
    fs.chmodSync(file, 0o600)
  } finally { try { fs.rmSync(temp, { force: true }) } catch { /* best effort */ } }
}

export function sharedRun(file: string, args: string[], options: Options): Promise<string> {
  const runner = options.run ?? plainRun
  const { hash, root: directory, key, name } = cacheParts(file, args, options.directory)
  if (process.platform === 'win32') return Promise.resolve().then(() => runner(file, args, options.timeoutMs)).catch(err => printed(err, options))
  if (options.fresh) {
    const startedAt = Date.now()
    return Promise.resolve().then(() => runner(file, args, options.timeoutMs)).then(value => {
      if (value && (invalidatedAt(directory, name) ?? -Infinity) <= startedAt) {
        const entry = { at: startedAt, value }
        try { write(directory, name, entry); memory.set(key, entry) } catch { /* cache is optional */ }
      }
      return value
    }).catch(err => printed(err, options))
  }
  const cached = memory.get(key)
  if (cached && Date.now() - cached.at >= 0 && Date.now() - cached.at < options.ttlMs) {
    if ((invalidatedAt(directory, name) ?? -Infinity) <= cached.at) return Promise.resolve(cached.value)
    memory.delete(key)
  }
  const active = inflight.get(key)
  if (active) return active

  const task = (async () => {
    try {
      const fromDisk = read(directory, name, options.ttlMs)
      if (fromDisk) { memory.set(key, fromDisk); return fromDisk.value }
      let release: (() => void) | undefined
      try { release = tryLock(path.join(directory, `${hash}.lock`), Math.max(options.timeoutMs, 1000)) } catch { /* run without cache */ }
      if (!release) {
        const until = Date.now() + 1500
        while (Date.now() < until) {
          await wait(50)
          const waiting = read(directory, name, options.ttlMs)
          if (waiting) { memory.set(key, waiting); return waiting.value }
        }
        return await runner(file, args, options.timeoutMs)
      }
      try {
        const raced = read(directory, name, options.ttlMs)
        if (raced) { memory.set(key, raced); return raced.value }
        const startedAt = Date.now()
        const value = await runner(file, args, options.timeoutMs)
        if (!value) return value
        const entry = { at: startedAt, value }
        const latest = readEntry(directory, name)
        if ((invalidatedAt(directory, name) ?? -Infinity) <= startedAt && !(latest && latest.at > startedAt) && !((memory.get(key)?.at ?? -Infinity) > startedAt)) {
          try { write(directory, name, entry); memory.set(key, entry) } catch { /* cache is optional */ }
        }
        return value
      } finally { release() }
    } catch (err) { return printed(err, options) }
  })()
  inflight.set(key, task)
  return task.finally(() => { if (inflight.get(key) === task) inflight.delete(key) })
}
