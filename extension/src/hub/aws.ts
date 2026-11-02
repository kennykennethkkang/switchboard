/**
 * AWS sign-ins: profiles from ~/.aws/config, their status, display labels and which Chrome
 * profile opens their sign-in. The parsers and rewrites are pure (tested); ~/.aws/credentials is never read or written.
 */
import { execFile } from 'child_process'
import { createHash } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { writeJsonAtomic } from '../hook-entries'
import { redact } from './brain'
import type { AwsProfile, AwsStatus, ChromeProfile } from './types'

const HOME = os.homedir()
export const AWS_CONFIG = path.join(HOME, '.aws', 'config')
const SB = path.join(HOME, '.claude', 'switchboard')
const LABELS = path.join(SB, 'aws-labels.json')
const PREFS = path.join(SB, 'aws-prefs.json')
const SESSIONS = path.join(SB, 'aws-sessions.json')
export const OPEN_CHROME = path.join(SB, 'aws-open-chrome.sh')
/** Chrome's Local State, which lists its profiles. */
export function chromeState(platform: NodeJS.Platform = process.platform, home = HOME, env: NodeJS.ProcessEnv = process.env): string {
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Google', 'Chrome', 'User Data', 'Local State')
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Local State')
  return path.join(home, '.config', 'google-chrome', 'Local State')
}

export const validProfileName = (s: string) => /^[A-Za-z0-9._@+-]{1,64}$/.test(s)
export const validRegion = (s: string) => /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/.test(s)

export type Section = { name: string; isDefault: boolean; values: Record<string, string> }
type Block = { header: string; start: number; end: number }

const HEADER = /^\s*\[([^\]]+)\]\s*$/
const nameOf = (header: string) => (header === 'default' ? 'default' : /^profile\s+(.+)$/.exec(header)?.[1].trim())

function blocks(lines: string[]): Block[] {
  const out: Block[] = []
  lines.forEach((l, i) => {
    const m = HEADER.exec(l)
    if (!m) return
    if (out.length) out[out.length - 1].end = i
    out.push({ header: m[1].trim(), start: i, end: lines.length })
  })
  return out
}

/** The key = value lines of a block. Trailing blanks and comments are dropped: a comment right above a header belongs to that next section. */
const body = (lines: string[], b: Block) => {
  const rows = lines.slice(b.start + 1, b.end)
  while (rows.length && /^\s*([#;].*)?$/.test(rows[rows.length - 1])) rows.pop()
  return rows
}

const valuesOf = (rows: string[]) => Object.fromEntries(rows.flatMap(r => {
  const m = /^\s*([\w.-]+)\s*=\s*(.*?)\s*$/.exec(r)
  return m ? [[m[1], m[2]]] : []
}))

/** Profiles in file order; sso-session and services blocks are not profiles. */
export function parseAwsConfig(text: string): Section[] {
  const lines = text.split(/\r?\n/)
  return blocks(lines).flatMap(b => {
    const name = nameOf(b.header)
    return name ? [{ name, isDefault: name === 'default', values: valuesOf(body(lines, b)) }] : []
  })
}

/** The 12-digit account a profile signs in to, from its config alone. */
export function accountOf(v: Record<string, string>): string | undefined {
  const arn = /^arn:aws[\w-]*:(?:iam|sts)::(\d{12}):/
  return arn.exec(v.login_session ?? '')?.[1] ?? (/^\d{12}$/.test(v.sso_account_id ?? '') ? v.sso_account_id : undefined) ?? arn.exec(v.role_arn ?? '')?.[1]
}

const stamp = (now: number) => new Date(now).toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')

const CRED_KEYS = new Set(['aws_access_key_id', 'credential_process', 'sso_session', 'sso_start_url', 'login_session', 'web_identity_token_file'])

/**
 * The config with [default] holding `name`'s settings. The old default is kept as
 * [profile previous-default-<time>] whenever it had settings that differ from the new ones. undefined: no such profile.
 */
export function makeDefault(text: string, name: string, now = Date.now()): string | undefined {
  if (name === 'default') return undefined
  const lines = text.split(/\r?\n/)
  const all = blocks(lines)
  const target = all.find(b => nameOf(b.header) === name && name !== 'default')
  if (!target) return undefined
  const fresh = body(lines, target)
  const old = all.find(b => b.header === 'default')
  const oldRows = old ? body(lines, old) : []
  const same = JSON.stringify(Object.entries(valuesOf(oldRows)).sort()) === JSON.stringify(Object.entries(valuesOf(fresh)).sort())
  const kept = `previous-default-${stamp(now)}`
  const backup = oldRows.some(r => r.trim()) && !same ? ['', `[profile ${kept}]`, ...oldRows] : []
  // When the old [default] held its credentials in config, every profile sourcing from it follows them to the backup.
  // Keys in the credentials file stay under [default], so source_profile = default stays as is.
  const moved = Object.keys(valuesOf(oldRows)).some(k => CRED_KEYS.has(k)) && backup.length > 0
  const def = ['[default]', ...fresh, '']
  const joined = old ? [...lines.slice(0, old.start), ...def, ...lines.slice(old.end)] : [...def, ...lines]
  const out = moved ? joined.map(r => (/^\s*source_profile\s*=\s*default\s*$/.test(r) ? `source_profile = ${kept}` : r)) : joined
  while (out.length && !out[out.length - 1].trim()) out.pop()
  return [...out, ...backup, ''].join('\n')
}

/** The config with a new [profile name] in region; undefined when the name or region is bad or taken. */
export function addProfile(text: string, name: string, region: string): string | undefined {
  if (!validProfileName(name) || name === 'default' || !validRegion(region)) return undefined
  if (parseAwsConfig(text).some(s => s.name === name)) return undefined
  return `${text.replace(/\s*$/, '')}${text.trim() ? '\n\n' : ''}[profile ${name}]\nregion = ${region}\n`
}

/**
 * The config without [profile name] and the comment right above it, or why not: [default] stays, as does the
 * last named profile [default] copies (Make default) and any profile another one names as source_profile.
 */
export function removeProfile(text: string, name: string): { text: string } | { problem: string } {
  if (name === 'default') return { problem: 'the default profile cannot be deleted' }
  const lines = text.split(/\r?\n/)
  const all = blocks(lines)
  const target = all.find(b => nameOf(b.header) === name)
  if (!target) return { problem: `no AWS profile named ${name}` }
  const def = all.find(b => b.header === 'default')
  const vals = (b: Block) => JSON.stringify(Object.entries(valuesOf(body(lines, b))).sort())
  // Many profiles can match [default] (backups, one login shared); only the last named copy is kept, a backup never.
  const copies = def && body(lines, def).some(r => r.trim()) ? all.filter(b => b !== def && vals(b) === vals(def)) : []
  if (copies.includes(target) && !isStale(name) && !copies.some(b => b !== target && !isStale(nameOf(b.header) ?? ''))) return { problem: `${name} is the current default; make another profile the default first` }
  const user = parseAwsConfig(text).find(s => s.values.source_profile === name)
  if (user) return { problem: `${user.name} signs in through ${name} (source_profile)` }
  let start = target.start
  while (start > 0 && /^\s*[#;]/.test(lines[start - 1])) start--
  let end = target.start + 1 + body(lines, target).length
  while (end < target.end && !lines[end].trim()) end++
  const out = [...lines.slice(0, start), ...lines.slice(end)]
  while (out.length && !out[out.length - 1].trim()) out.pop()
  return { text: [...out, ''].join('\n') }
}

const SIGNS_IN = ['login_session', 'sso_session', 'sso_start_url', 'role_arn', 'credential_process', 'web_identity_token_file']

/** Signed in when STS answered; expired when it did not but the profile has a way to sign in; else never. */
export function awsStatus(ok: boolean, stderr: string, values: Record<string, string>): AwsStatus {
  if (ok) return 'signed-in'
  if (/Unable to locate credentials|could not be found|NoCredentialProviders/i.test(stderr)) return 'never'
  return SIGNS_IN.some(k => values[k]) ? 'expired' : 'never'
}

/** STS said the sign-in is gone; a timeout, network or other error says nothing either way. */
export const signedOut = (stderr: string) => /expired|reauthenticat|refresh failed|invalid_grant|Unable to locate credentials|could not be found|NoCredentialProviders/i.test(stderr)

/** Chrome's profiles (folder, name, signed-in email) from its Local State file. */
export function chromeProfiles(localState: string): ChromeProfile[] {
  try {
    const cache = JSON.parse(localState)?.profile?.info_cache ?? {}
    return Object.entries(cache as Record<string, { name?: unknown; user_name?: unknown }>).flatMap(([dir, p]) =>
      p && typeof p === 'object' && typeof p.name === 'string'
        ? [{ dir, name: p.name, ...(typeof p.user_name === 'string' && p.user_name ? { email: p.user_name } : {}) }] : [])
  } catch { return [] }
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
/** The profile picked for the deepest project folder holding `cwd`. */
export function profileFor(projects: Record<string, string>, cwd: string): string | undefined {
  const c = norm(cwd)
  const hit = Object.keys(projects).filter(k => c === norm(k) || c.startsWith(`${norm(k)}/`)).sort((a, b) => b.length - a.length)[0]
  return hit ? projects[hit] : undefined
}

/**
 * Where a sign-in opens: its own Chrome pick, else the project's, else '' (Chrome's last used profile).
 * A pick Chrome no longer lists is skipped and named in gone; with Chrome's list unreadable none is.
 */
export function chromeChoice(own: string | undefined, project: string | undefined, known: string[]): { dir: string; gone: string[] } {
  const gone: string[] = []
  for (const d of [own, project]) {
    if (!d || !known.length) continue
    if (known.includes(d)) return { dir: d, gone }
    gone.push(d)
  }
  return { dir: '', gone }
}

/** A row's note or error map with key set to text (none clears it); undefined when nothing changed. */
export function rowText(map: Record<string, string> | undefined, key: string, text?: string): Record<string, string> | undefined {
  const { [key]: was, ...rest } = map ?? {}
  if (was === text) return undefined
  return text ? { ...rest, [key]: text } : rest
}

/** The last lines of a failed aws login, for its row: no colors, keys, tokens or URL queries. */
export function loginError(out: string): string {
  const lines = out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(-5)
  return redact(lines.join('\n')).replace(/(https?:\/\/[^\s?#]+)[?#]\S*/g, '$1').slice(-600)
}

// aws login refreshes credentials every 15 min for up to 12 h, then it has to run again.
export const AWS_SESSION_MS = 12 * 60 * 60 * 1000
export const HEADS_UP_MS = 30 * 60 * 1000
/** Per profile: when its session started, which session's heads-up went out, and when a check first saw it signed out. Only times. */
export type AwsSessions = Record<string, { at: number; warned?: number; out?: number }>
/** A login cache file's stat times; its contents hold tokens and are never read. */
export type CacheTimes = { birth: number; mtime: number }

/** The CLI's cache file for a login_session: sha256 of the session name (botocore generate_login_cache_key). */
export const loginCacheFile = (session: string, dir = process.env.AWS_LOGIN_CACHE_DIRECTORY || path.join(HOME, '.aws', 'login', 'cache')) =>
  path.join(dir, `${createHash('sha256').update(session).digest('hex')}.json`)

/** Cache file times per profile with a login_session. */
export function cacheTimes(sections: Section[]): Record<string, CacheTimes> {
  return Object.fromEntries(sections.flatMap(sec => {
    if (!sec.values.login_session) return []
    try { const st = fs.statSync(loginCacheFile(sec.values.login_session)); return [[sec.name, { birth: st.birthtimeMs, mtime: st.mtimeMs }]] } catch { return [] }
  }))
}

/**
 * Sessions after a status check. The CLI rewrites its cache file in place on every 15 min refresh, so a newer
 * mtime alone is not a new session. A new one is: a file made after the session began (logout, then login), or a
 * write after a check said signed out. One first seen signed in started when its file was made. A live one
 * stays through a check that could not tell.
 */
export function trackSessions(s: AwsSessions, rows: { name: string; status: AwsStatus; unsure?: boolean }[], now: number, cache: Record<string, CacheTimes> = {}): AwsSessions {
  return Object.fromEntries(rows.flatMap(r => {
    const had = s[r.name], c = cache[r.name]
    const live = had && now < had.at + AWS_SESSION_MS
    // Only a check that said signed out marks out; one that could not tell changes nothing.
    if (r.status !== 'signed-in') return live ? [[r.name, r.unsure ? had : { ...had, out: had.out ?? now }]] : []
    if (live && c && c.birth > had.at) return [[r.name, { at: Math.min(c.birth, now) }]]
    if (live && c && had.out !== undefined && c.mtime > had.out) return [[r.name, { at: Math.min(c.mtime, now) }]]
    if (live) { const { out: _o, ...keep } = had; return [[r.name, keep]] }
    // First seen: the file was made at its sign-in (refreshes rewrite it in place). A birth over 12 h back means a
    // later login rewrote it, so its last write is the latest start; so is mtime when the disk keeps no birth time.
    const born = c && c.birth > 0 && c.birth >= now - AWS_SESSION_MS ? c.birth : c?.mtime
    return [[r.name, { at: born !== undefined ? Math.min(born, now) : now }]]
  }))
}

/** Profiles whose session ends within HEADS_UP_MS and has not had its heads-up. */
export const dueHeadsUps = (s: AwsSessions, now: number) =>
  Object.entries(s).filter(([, v]) => v.warned !== v.at && now >= v.at + AWS_SESSION_MS - HEADS_UP_MS && now < v.at + AWS_SESSION_MS).map(([k]) => k)

// ─── Files ───────────────────────────────────────────────────────────────────

const readJson = (file: string): Record<string, unknown> => {
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {} } catch { return {} }
}
const strings = (v: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).filter(([, x]) => typeof x === 'string')) as Record<string, string>

/** chrome: per AWS profile; projects: AWS profile per folder; browsers: Chrome folder per project folder ('' system browser). */
export type AwsPrefs = { chrome: Record<string, string>; projects: Record<string, string>; browsers: Record<string, string> }
export const readLabels = () => strings(readJson(LABELS))
export const writeLabels = (labels: Record<string, string>) => { fs.mkdirSync(SB, { recursive: true }); writeJsonAtomic(LABELS, labels) }
export const readPrefs = (): AwsPrefs => { const j = readJson(PREFS); return { chrome: strings(j.chrome), projects: strings(j.projects), browsers: strings(j.browsers) } }
export const writePrefs = (p: AwsPrefs) => { fs.mkdirSync(SB, { recursive: true }); writeJsonAtomic(PREFS, p) }
export const readChrome = (): ChromeProfile[] => { try { return chromeProfiles(fs.readFileSync(chromeState(), 'utf8')) } catch { return [] } }
export const readSessions = (): AwsSessions => {
  const j = readJson(SESSIONS)
  return Object.fromEntries(Object.entries(j).flatMap(([k, v]) => {
    const o = v as { at?: unknown; warned?: unknown; out?: unknown }
    return o && typeof o.at === 'number' ? [[k, { at: o.at, ...(typeof o.warned === 'number' ? { warned: o.warned } : {}), ...(typeof o.out === 'number' ? { out: o.out } : {}) }]] : []
  }))
}
export const writeSessions = (s: AwsSessions) => { fs.mkdirSync(SB, { recursive: true }); writeJsonAtomic(SESSIONS, s) }
export const readAwsConfig = () => { try { return fs.readFileSync(AWS_CONFIG, 'utf8') } catch { return '' } }

/** Writes the config through a temp file and a rename, keeping its mode (0600 for a new one). */
export function writeAwsConfig(text: string, file = AWS_CONFIG): void {
  let mode = 0o600
  try { mode = fs.statSync(file).mode & 0o777 } catch { fs.mkdirSync(path.dirname(file), { recursive: true }) }
  const tmp = `${file}.switchboard-${process.pid}.tmp`
  fs.writeFileSync(tmp, text, { mode })
  fs.renameSync(tmp, file)
}

/** Adds [profile name] once the Chrome profile its sign-in opens in checks out ('' = system browser). Answers why not. */
export function addAwsProfile(name: string, region: string, chrome: string | undefined, chromes: string[], file = AWS_CONFIG): string | undefined {
  if (chrome && !chromes.includes(chrome)) return 'That Chrome profile is not in Chrome\'s list'
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch { /* no config yet */ }
  const next = addProfile(text, name, region)
  if (!next) return 'give a new profile name (letters, digits, . _ @ + -, up to 64) and a region like us-west-1'
  writeAwsConfig(next, file)
  return undefined
}

/** Backups Make default leaves behind, for the UI to fold away. */
export const isStale = (name: string) => /^previous-default-\d/.test(name)

/** Deletes [profile name] after copying the config to config.backup-<time> beside it. Answers why it could not. */
export function deleteAwsProfile(name: string, file = AWS_CONFIG, now = Date.now()): string | undefined {
  if (!validProfileName(name)) return 'Not a profile name'
  const text = fs.readFileSync(file, 'utf8')
  const r = removeProfile(text, name)
  if ('problem' in r) return r.problem
  fs.writeFileSync(`${file}.backup-${stamp(now)}`, text, { mode: 0o600, flag: 'wx' })
  writeAwsConfig(r.text, file)
  return undefined
}

/**
 * The BROWSER script Python's webbrowser runs so `aws login` opens in one Chrome profile; the folder comes from the env.
 * None on Windows: webbrowser would run a .cmd through cmd.exe, which splits the sign-in URL at its &s.
 */
export function openChromeScript(platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform === 'win32') return undefined
  const [plain, own] = platform === 'darwin' ? ['/usr/bin/open -a "Google Chrome"', '/usr/bin/open -na "Google Chrome" --args'] : ['google-chrome', 'google-chrome']
  return `#!/bin/sh\nif [ -z "$SWITCHBOARD_CHROME_DIR" ]; then exec ${plain} "$1"; fi\nexec ${own} --profile-directory="$SWITCHBOARD_CHROME_DIR" "$1"\n`
}

/** A terminal's env for the opener script: dir '' or none opens Chrome's last used profile. No script (Windows): nothing. */
export const browserEnv = (dir: string | undefined, script: string): Record<string, string> =>
  script ? { BROWSER: script, SWITCHBOARD_CHROME_DIR: dir ?? '' } : {}

/** Writes openChromeScript and answers its path; '' on Windows, which BROWSER reads as the system browser. */
export function writeOpenChrome(): string {
  const script = openChromeScript()
  if (!script) return ''
  fs.mkdirSync(SB, { recursive: true })
  fs.writeFileSync(OPEN_CHROME, script, { mode: 0o700 })
  fs.chmodSync(OPEN_CHROME, 0o700)
  return OPEN_CHROME
}

/** A URL in one Chrome profile ('' its last used), run with no shell; undefined when Chrome is not found on Windows. */
export function chromeCall(url: string, dir: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, exists = fs.existsSync): { cmd: string; args: string[] } | undefined {
  const args = dir ? [`--profile-directory=${dir}`, url] : [url]
  if (platform === 'darwin') return { cmd: '/usr/bin/open', args: dir ? ['-na', 'Google Chrome', '--args', ...args] : ['-a', 'Google Chrome', url] }
  if (platform !== 'win32') return { cmd: 'google-chrome', args }
  const exe = path.join('Google', 'Chrome', 'Application', 'chrome.exe')
  const cmd = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].flatMap(d => (d ? [path.join(d, exe)] : [])).find(f => exists(f))
  return cmd ? { cmd, args } : undefined
}

/** VS Code's PATH often lacks Homebrew's bin. */
export const awsBinary = () => ['/opt/homebrew/bin/aws', '/usr/local/bin/aws'].find(p => fs.existsSync(p)) ?? 'aws'

function check(name: string): Promise<{ ok: boolean; account?: string; stderr: string }> {
  return new Promise(resolve => execFile(awsBinary(), ['sts', 'get-caller-identity', '--profile', name, '--output', 'json'],
    { timeout: 8000, maxBuffer: 1 << 20, windowsHide: true },
    (err, stdout, stderr) => {
      let account: string | undefined
      try { account = JSON.parse(String(stdout)).Account } catch { /* none */ }
      resolve({ ok: !err && /^\d{12}$/.test(account ?? ''), account, stderr: String(stderr) })
    }))
}

type Sts = (name: string) => Promise<{ ok: boolean; account?: string; stderr: string }>

/** Every profile with its label and status, by one free STS call each, two at a time; run on the slow refresh only.
 * An old default's backup is not asked: it only waits to be deleted. */
export async function awsProfiles(now = Date.now(), sts: Sts = check, config = readAwsConfig()): Promise<AwsProfile[]> {
  const labels = readLabels(), { chrome } = readPrefs()
  const sections = parseAwsConfig(config)
  const results: Awaited<ReturnType<Sts>>[] = []
  let next = 0
  await Promise.all([0, 1].map(async () => {
    while (next < sections.length) {
      const i = next++
      results[i] = isStale(sections[i].name) ? { ok: false, stderr: '' } : await sts(sections[i].name)
    }
  }))
  return sections.map((s, i) => {
    const r = results[i]
    const account = (r.ok ? r.account : undefined) ?? accountOf(s.values)
    const label = (account && labels[account]) || labels[`profile:${s.name}`]
    return {
      name: s.name, isDefault: s.isDefault, status: awsStatus(r.ok, r.stderr, s.values), checkedAt: now, ...(!r.ok && !isStale(s.name) && !signedOut(r.stderr) ? { unsure: true } : {}),
      ...(account ? { account } : {}), ...(label ? { label } : {}), ...(s.values.region ? { region: s.values.region } : {}),
      ...(chrome[s.name] !== undefined ? { chrome: chrome[s.name] } : {}), ...(isStale(s.name) ? { stale: true } : {}), ...(/:root$/.test(s.values.login_session ?? '') ? { root: true } : {}),
    }
  })
}
