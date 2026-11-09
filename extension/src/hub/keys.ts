/**
 * API keys for the gemini and Jev skills, the Perplexity MCP and project .env setup (Zep). The key lives in the macOS Keychain (service switchboard,
 * account = the env var name), elsewhere in a 0600 file under ~/.claude/switchboard/keys/.
 * keys.json next to it holds only the last four and the last test, which is all the UI ever gets.
 */
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { writeJsonAtomic } from '../hook-entries'
import type { ApiKey, ApiKeyName } from './types'

export const KEY_NAMES: ApiKeyName[] = ['GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'PERPLEXITY_API_KEY', 'ZEP_API_KEY']
const SB = path.join(os.homedir(), '.claude', 'switchboard')
export const KEYS_META = path.join(SB, 'keys.json')
const SERVICE = 'switchboard'
// Every provider's keys are letters, digits, '.', - and _; anything else is a paste gone wrong.
// security keeps only the first 128 chars from stdin.
const SHAPE = /^[A-Za-z0-9._-]{16,128}$/
// Zep keys are JWT-like and run past 128.
const LONG_SHAPE = /^[A-Za-z0-9._-]{16,512}$/

export type Run = (cmd: string, args: string[], input?: string) => { code: number; out: string }
const spawn: Run = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { input, encoding: 'utf8', timeout: 10_000 })
  return { code: r.status ?? 1, out: r.stdout ?? '' }
}

export type KeyStore = { get(n: ApiKeyName): string | undefined; set(n: ApiKeyName, v: string): void; remove(n: ApiKeyName): void }

export function keyStore(o: { platform?: NodeJS.Platform; run?: Run; dir?: string } = {}): KeyStore {
  if ((o.platform ?? process.platform) === 'darwin') {
    const run = o.run ?? spawn
    const who = (n: string) => ['-s', SERVICE, '-a', n]
    return {
      get: n => {
        const r = run('security', ['find-generic-password', ...who(n), '-w'])
        return r.code === 0 && r.out.trim() ? r.out.trim() : undefined
      },
      // -w last with no value: security asks for it twice on stdin, so it never shows in ps.
      // Past 128 chars that prompt truncates, so long keys go as a security -i command line, still on stdin.
      set: (n, v) => {
        const r = v.length > 128
          ? run('security', ['-i'], `add-generic-password -U ${who(n).join(' ')} -w "${v}"\n`)
          : run('security', ['add-generic-password', '-U', ...who(n), '-w'], `${v}\n${v}\n`)
        if (r.code !== 0) throw new Error('the Keychain did not save it')
      },
      remove: n => { run('security', ['delete-generic-password', ...who(n)]) },
    }
  }
  const dir = o.dir ?? path.join(SB, 'keys')
  const file = (n: string) => path.join(dir, n)
  return {
    get: n => { try { return fs.readFileSync(file(n), 'utf8').trim() || undefined } catch { return undefined } },
    set: (n, v) => {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
      fs.chmodSync(dir, 0o700)
      fs.writeFileSync(file(n), v, { mode: 0o600 })
      fs.chmodSync(file(n), 0o600)
    },
    remove: n => fs.rmSync(file(n), { force: true }),
  }
}

export const isKeyName = (n: unknown): n is ApiKeyName => KEY_NAMES.includes(n as ApiKeyName)

export function keyProblem(name: string, value: string): string | undefined {
  if (!isKeyName(name)) return 'no such key'
  const long = name === 'ZEP_API_KEY'
  if (!(long ? LONG_SHAPE : SHAPE).test(value)) return `that does not look like an API key (16 to ${long ? 512 : 128} characters: letters, digits, '.', '-' or '_')`
  return undefined
}

export const redact = (text: string, secrets: Array<string | undefined>) =>
  secrets.reduce<string>((t, s) => (s ? t.split(s).join('***') : t), text)

type Meta = Partial<Record<ApiKeyName, { last4: string; checked?: ApiKey['checked'] }>>
const readMeta = (file: string): Meta => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Meta } catch { return {} } }
const writeMeta = (file: string, m: Meta) => { fs.mkdirSync(path.dirname(file), { recursive: true }); writeJsonAtomic(file, m) }

export const keyStatus = (file = KEYS_META): ApiKey[] => {
  const m = readMeta(file)
  return KEY_NAMES.map(name => {
    const row = m[name]
    return row ? { name, saved: true, last4: row.last4, ...(row.checked ? { checked: row.checked } : {}) } : { name, saved: false }
  })
}

/** Why it was refused, or undefined once stored. */
export function saveKey(store: KeyStore, name: ApiKeyName, value: string, file = KEYS_META): string | undefined {
  const v = value.trim()
  const problem = keyProblem(name, v)
  if (problem) return problem
  try { store.set(name, v) } catch (err) { return redact(`could not save ${name}: ${(err as Error).message}`, [v]) }
  writeMeta(file, { ...readMeta(file), [name]: { last4: v.slice(-4) } })
  return undefined
}

export function removeKey(store: KeyStore, name: ApiKeyName, file = KEYS_META): void {
  store.remove(name)
  const { [name]: _gone, ...rest } = readMeta(file)
  writeMeta(file, rest)
}

export function keyTest(name: ApiKeyName, checked: NonNullable<ApiKey['checked']>, file = KEYS_META): void {
  const m = readMeta(file), row = m[name]
  if (row) writeMeta(file, { ...m, [name]: { ...row, checked } })
}

/** Keys the store holds that the env lacks, for a child process; env first. */
export function keyEnv(store: KeyStore, env: NodeJS.ProcessEnv = {}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const n of KEY_NAMES) {
    if (env[n]?.trim()) continue
    const v = store.get(n)
    if (v) out[n] = v
  }
  return out
}

/** The store and keys.json agree again: a key added or removed by hand outside Switchboard. */
export function reconcileKeys(store: KeyStore, file = KEYS_META): void {
  const m = readMeta(file)
  let changed = false
  for (const n of KEY_NAMES) {
    const v = store.get(n)
    if (v && m[n]?.last4 !== v.slice(-4)) { m[n] = { last4: v.slice(-4) }; changed = true }
    if (!v && m[n]) { delete m[n]; changed = true }
  }
  if (changed) writeMeta(file, m)
}

/** One cheap authenticated read. reason is cut short and never holds the key. */
export async function testKey(name: ApiKeyName, key: string, get: typeof fetch = fetch, now = Date.now()): Promise<NonNullable<ApiKey['checked']>> {
  const [url, headers]: [string, Record<string, string>] = name === 'GEMINI_API_KEY'
    ? ['https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { 'x-goog-api-key': key }]
    : name === 'ZEP_API_KEY' ? ['https://api.getzep.com/api/v2/projects/info', { Authorization: `Api-Key ${key}` }]
    : [name === 'PERPLEXITY_API_KEY' ? 'https://api.perplexity.ai/v1/models' : 'https://openrouter.ai/api/v1/key', { Authorization: `Bearer ${key}` }]
  try {
    const r = await get(url, { headers, signal: AbortSignal.timeout(10_000) })
    if (r.ok) return { ok: true, at: now }
    let msg = ''
    try { const j = await r.json() as { error?: { message?: unknown } }; if (typeof j.error?.message === 'string') msg = j.error.message } catch { /* not JSON */ }
    return { ok: false, at: now, reason: redact(`HTTP ${r.status}${msg ? `: ${msg}` : ''}`, [key]).slice(0, 120) }
  } catch (err) {
    return { ok: false, at: now, reason: redact((err as Error).message, [key]).slice(0, 120) }
  }
}
