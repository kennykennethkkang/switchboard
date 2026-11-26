/**
 * AWS sign-ins: profiles from ~/.aws/config, their status, display labels and which Chrome
 * profile opens their sign-in. The parsers and rewrites are pure (tested); ~/.aws/credentials is never written, and only its section headers are read.
 */
import { execFile } from 'child_process'
import { createHash } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { readJsonOr } from '../fs-utils'
import { writeJsonAtomic } from '../hook-entries'
import { redact } from './brain'
import { FIND_JXA } from './tabs'
import type { AwsProfile, AwsStatus, ChromeProfile } from './types'

const HOME = os.homedir()
export const AWS_CONFIG = path.join(HOME, '.aws', 'config')
const AWS_CREDENTIALS = path.join(HOME, '.aws', 'credentials')
const SB = path.join(HOME, '.claude', 'switchboard')
const LABELS = path.join(SB, 'aws-labels.json')
const IDENTITY = path.join(SB, 'aws-identity.json')
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

export type Section = { name: string; values: Record<string, string> }
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
    return name ? [{ name, values: valuesOf(body(lines, b)) }] : []
  })
}

/** The 12-digit account a profile signs in to, from its config alone. */
export function accountOf(v: Record<string, string>): string | undefined {
  const arn = /^arn:aws[\w-]*:(?:iam|sts)::(\d{12}):/
  return arn.exec(v.login_session ?? '')?.[1] ?? (/^\d{12}$/.test(v.sso_account_id ?? '') ? v.sso_account_id : undefined) ?? arn.exec(v.role_arn ?? '')?.[1]
}

const stamp = (now: number) => new Date(now).toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')

/** The profile `name` copies after a sign-in: same login_session and region, first in the file. */
export function sameLogin(text: string, name: string): string | undefined {
  const all = parseAwsConfig(text)
  const me = all.find(s => s.name === name)
  const ls = me?.values.login_session
  if (!me || !ls) return undefined
  return all.find(s => s !== me && s.values.login_session === ls && s.values.region === me.values.region)?.name
}

/**
 * The config with [profile name] in region. A taken name keeps its other lines and gets the new region, so adding
 * it again is a retry. undefined when the name or region is bad.
 */
export function addProfile(text: string, name: string, region: string): string | undefined {
  if (!validProfileName(name) || name === 'default' || !validRegion(region)) return undefined
  const lines = text.split(/\r?\n/)
  const b = blocks(lines).find(x => nameOf(x.header) === name)
  if (!b) return `${text.replace(/\s*$/, '')}${text.trim() ? '\n\n' : ''}[profile ${name}]\nregion = ${region}\n`
  const at = lines.slice(b.start + 1, b.end).findIndex(l => /^\s*region\s*=/.test(l))
  if (at >= 0) lines[b.start + 1 + at] = `region = ${region}`
  else lines.splice(b.start + 1, 0, `region = ${region}`)
  return lines.join('\n')
}

/** The config with [profile from] as [profile to] and every source_profile = from following it; undefined when from is missing or to is bad or taken. */
export function renameProfile(text: string, from: string, to: string): string | undefined {
  if (!validProfileName(to) || to === 'default') return undefined
  const lines = text.split(/\r?\n/)
  const all = blocks(lines)
  const b = all.find(x => nameOf(x.header) === from)
  if (!b || all.some(x => nameOf(x.header) === to)) return undefined
  lines[b.start] = `[profile ${to}]`
  return lines.map(l => (/^\s*source_profile\s*=\s*(.*?)\s*$/.exec(l)?.[1] === from ? `source_profile = ${to}` : l)).join('\n')
}

/** The config without [profile name] and the comment right above it, or why not: a profile another one names as source_profile stays. */
export function removeProfile(text: string, name: string): { text: string } | { problem: string } {
  const lines = text.split(/\r?\n/)
  const all = blocks(lines)
  const target = all.find(b => nameOf(b.header) === name)
  if (!target) return { problem: `no AWS profile named ${name}` }
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

const isSso = (v: Record<string, string>) => !!(v.sso_session || v.sso_start_url)
/** Signs in through single sign-on: `aws sso login`, since `aws login` refuses such a profile. */
export const ssoProfile = (name: string, config = readAwsConfig()) => parseAwsConfig(config).some(s => s.name === name && isSso(s.values))

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
/** The key for the browser a folder with no pick of its own gets. AWS has no such default. */
export const ANY_FOLDER = '*'
/** The pick for the deepest project folder holding `cwd`; none above it means none. */
export function profileFor(projects: Record<string, string>, cwd: string): string | undefined {
  const c = norm(cwd)
  const hit = Object.keys(projects).filter(k => k !== ANY_FOLDER && (c === norm(k) || c.startsWith(`${norm(k)}/`))).sort((a, b) => b.length - a.length)[0]
  return hit ? projects[hit] : undefined
}
/** The browser for `cwd`: its folder's pick, else the ANY_FOLDER one. Mirrored in sign-ins.tsx. */
export const browserFor = (browsers: Record<string, string>, cwd: string) => profileFor(browsers, cwd) ?? browsers[ANY_FOLDER]

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

/** The last lines of a failed aws login, for its row: no colors, keys, tokens, device codes or URL queries. */
export function loginError(out: string): string {
  const lines = out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(l)).slice(-5)
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
 * stays through a check that could not tell. Single sign-on has no 12 h session, so no row here.
 */
export function trackSessions(s: AwsSessions, rows: { name: string; status: AwsStatus; unsure?: boolean; sso?: boolean }[], now: number, cache: Record<string, CacheTimes> = {}): AwsSessions {
  return Object.fromEntries(rows.filter(r => !r.sso).flatMap(r => {
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
  const v = readJsonOr(file)
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
}
const strings = (v: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).filter(([, x]) => typeof x === 'string')) as Record<string, string>

/** chrome: per AWS profile; projects: AWS profile per folder; browsers: Chrome folder per project folder ('' system browser). */
export type AwsPrefs = { chrome: Record<string, string>; projects: Record<string, string>; browsers: Record<string, string> }

/** Picks for `from` under `to` (rename, or a twin folded in); a Chrome pick `to` already has wins. */
export function moveProfile(p: AwsPrefs, from: string, to: string): AwsPrefs {
  const { [from]: pick, ...chrome } = p.chrome
  return { ...p, chrome: { ...chrome, ...(pick !== undefined && chrome[to] === undefined ? { [to]: pick } : {}) },
    projects: Object.fromEntries(Object.entries(p.projects).map(([f, n]) => [f, n === from ? to : n])) }
}

/** Who an account signs in as, from AWS at the last sign-in: alias or contact name, and the primary email. */
export type AwsIdentity = { name?: string; email?: string }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const trimmed = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : undefined)

/** The identity from the answers of list-account-aliases, get-contact-information and get-primary-email (undefined = refused). */
export function identityOf(aliases: unknown, contact: unknown, primary: unknown): AwsIdentity {
  const a = (aliases as { AccountAliases?: unknown[] } | undefined)?.AccountAliases
  const c = (contact as { ContactInformation?: { FullName?: unknown; CompanyName?: unknown } } | undefined)?.ContactInformation
  const name = (Array.isArray(a) ? trimmed(a[0]) : undefined) ?? trimmed(c?.CompanyName) ?? trimmed(c?.FullName)
  const email = trimmed((primary as { PrimaryEmail?: unknown } | undefined)?.PrimaryEmail)
  return { ...(name ? { name } : {}), ...(email && EMAIL.test(email) ? { email } : {}) }
}

/** Labels with a profile:<from> key moved to profile:<to>; undefined when there is none. */
export function renameLabel(labels: Record<string, string>, from: string, to: string): Record<string, string> | undefined {
  const { [`profile:${from}`]: was, ...rest } = labels
  return was === undefined ? undefined : { ...rest, [`profile:${to}`]: was }
}

/** Whether an INI file has a [name] section; header lines only. */
export const hasSection = (text: string, name: string) => text.split(/\r?\n/).some(l => HEADER.exec(l)?.[1].trim() === name)

/** label: the email set by hand, by account id (profile:<name> without one). */
export const readLabels = () => strings(readJson(LABELS))
export const writeLabels = (labels: Record<string, string>) => { fs.mkdirSync(SB, { recursive: true }); writeJsonAtomic(LABELS, labels) }
export const readIdentities = (): Record<string, AwsIdentity> => Object.fromEntries(Object.entries(readJson(IDENTITY)).map(([k, v]) => [k, { ...strings(v) }]))

/** Asks AWS who `profile` is (each call may be denied; 6 s each) and keeps what answered under its account id. */
export async function refreshIdentity(profile: string): Promise<void> {
  const ask = (args: string[]) => new Promise<unknown>(resolve => execFile(awsBinary(), [...args, '--profile', profile, '--output', 'json'],
    { timeout: 6000, maxBuffer: 1 << 20, windowsHide: true }, (err, out) => { try { resolve(err ? undefined : JSON.parse(String(out))) } catch { resolve(undefined) } }))
  const account = trimmed((await ask(['sts', 'get-caller-identity']) as { Account?: unknown } | undefined)?.Account)
  if (!account || !/^\d{12}$/.test(account)) return
  const [aliases, contact, primary] = await Promise.all([ask(['iam', 'list-account-aliases']), ask(['account', 'get-contact-information']), ask(['account', 'get-primary-email', '--account-id', account])])
  const got = identityOf(aliases, contact, primary)
  if (!Object.keys(got).length) return
  const all = readIdentities()
  fs.mkdirSync(SB, { recursive: true })
  writeJsonAtomic(IDENTITY, { ...all, [account]: { ...all[account], ...got } })
}
export const readPrefs = (): AwsPrefs => { const j = readJson(PREFS); return { chrome: strings(j.chrome), projects: strings(j.projects), browsers: strings(j.browsers) } }
export const writePrefs = (p: AwsPrefs) => { fs.mkdirSync(SB, { recursive: true }); writeJsonAtomic(PREFS, p) }
export const readChrome = (): ChromeProfile[] => { try { return chromeProfiles(fs.readFileSync(chromeState(), 'utf8')) } catch { return [] } }
/** Without single sign-on profiles, which an older build counted. */
export const readSessions = (file = SESSIONS, config = readAwsConfig()): AwsSessions => {
  const j = readJson(file)
  return Object.fromEntries(Object.entries(j).flatMap(([k, v]) => {
    const o = v as { at?: unknown; warned?: unknown; out?: unknown }
    return o && typeof o.at === 'number' && !ssoProfile(k, config) ? [[k, { at: o.at, ...(typeof o.warned === 'number' ? { warned: o.warned } : {}), ...(typeof o.out === 'number' ? { out: o.out } : {}) }]] : []
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

/** Deletes [profile name] after copying the config to config.backup-<time> beside it. Answers why it could not. */
export function deleteAwsProfile(name: string, file = AWS_CONFIG, now = Date.now()): string | undefined {
  if (!validProfileName(name)) return 'Not a profile name'
  const text = fs.readFileSync(file, 'utf8')
  const r = removeProfile(text, name)
  if ('problem' in r) return r.problem
  backUp(file, text, now)
  writeAwsConfig(r.text, file)
  return undefined
}

/** config.backup-<time>, then -2, -3 when a change in the same second already wrote one. */
function backUp(file: string, text: string, now: number): void {
  for (let n = 1; ; n++) {
    try { fs.writeFileSync(`${file}.backup-${stamp(now)}${n > 1 ? `-${n}` : ''}`, text, { mode: 0o600, flag: 'wx' }); return } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || n > 99) throw e }
  }
}

/** Renames [profile from] to [profile to] after the same backup as deleteAwsProfile. Answers why it could not. */
export function renameAwsProfile(from: string, to: string, file = AWS_CONFIG, now = Date.now(), creds = AWS_CREDENTIALS): string | undefined {
  const text = fs.readFileSync(file, 'utf8')
  let keys = ''
  try { keys = fs.readFileSync(creds, 'utf8') } catch { /* no credentials file */ }
  // Keys under [to] would sign the renamed profile in as someone else.
  if (hasSection(keys, to)) return `~/.aws/credentials already has a [${to}] section; pick another name`
  // Keys under [from] would stay behind, since credentials is never written.
  if (hasSection(keys, from)) return `${from} keeps its keys in ~/.aws/credentials, so it cannot be renamed here`
  const next = renameProfile(text, from, to)
  if (!next) return !validProfileName(to) || to === 'default' ? 'Names use letters, digits and . _ @ + - (up to 64)' : parseAwsConfig(text).some(s => s.name === to) ? `${to} is already in ~/.aws/config` : `no AWS profile named ${from}`
  backUp(file, text, now)
  writeAwsConfig(next, file)
  return undefined
}

/**
 * The BROWSER script Python's webbrowser runs so `aws login` opens in one Chrome profile; the folder comes from the env.
 * -g: an agent's aws login opens Chrome behind whatever is in front. None on Windows: webbrowser would run a .cmd through cmd.exe, which splits the sign-in URL at its &s.
 */
export function openChromeScript(platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform === 'win32') return undefined
  const [plain, own] = platform === 'darwin' ? ['/usr/bin/open -g -a "Google Chrome"', '/usr/bin/open -gna "Google Chrome" --args'] : ['google-chrome', 'google-chrome']
  const opens = `if [ -z "$SWITCHBOARD_CHROME_DIR" ]; then exec ${plain} "$1"; fi\nexec ${own} --profile-directory="$SWITCHBOARD_CHROME_DIR" "$1"\n`
  if (platform !== 'darwin') return `#!/bin/sh\n${opens}`
  // A chat's page: opened the same way, then its tab id goes in TABS for tabs.ts to close. The alarm covers a Mac still asking to let it see Chrome.
  return `#!/bin/sh
chat="\${CLAUDE_CODE_SESSION_ID:-$CODEX_THREAD_ID}"
case "$chat" in *[!A-Za-z0-9_-]*) chat= ;; esac
if [ -z "$chat$SWITCHBOARD_CHAT" ] || [ -n "$SWITCHBOARD_TAB" ]; then
${opens}fi
tabs() { /usr/bin/perl -e 'alarm 20; exec @ARGV' /usr/bin/osascript -l JavaScript - "$@" 2>/dev/null <<'JXA'
${FIND_JXA}
JXA
}
before=$(tabs)
SWITCHBOARD_TAB=1 "$0" "$1" || exit
[ -n "$before" ] || exit 0
umask 077
dir="$HOME/.claude/switchboard/tabs"
mkdir -p "$dir"
set -C
# In the back, so whoever opened the page goes on.
tabs "$before" "$1" | while read -r id origin; do
  case "$id" in ''|*[!0-9]*) continue ;; esac
  printf '%s\\t%s\\n' "$chat" "$origin" > "$dir/$id" && break
done >/dev/null 2>&1 &
`
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

/** Every profile with its email, account name and status, by one free STS call each, two at a time; run on the slow refresh only. */
export async function awsProfiles(now = Date.now(), sts: Sts = check, config = readAwsConfig()): Promise<AwsProfile[]> {
  const labels = readLabels(), ids = readIdentities(), { chrome } = readPrefs()
  const sections = parseAwsConfig(config)
  const results: Awaited<ReturnType<Sts>>[] = []
  let next = 0
  await Promise.all([0, 1].map(async () => {
    while (next < sections.length) {
      const i = next++
      results[i] = await sts(sections[i].name)
    }
  }))
  return sections.map((s, i) => {
    const r = results[i]
    const account = (r.ok ? r.account : undefined) ?? accountOf(s.values)
    const label = (account && labels[account]) || labels[`profile:${s.name}`]
    const id = account ? ids[account] : undefined
    return {
      name: s.name, status: awsStatus(r.ok, r.stderr, s.values), checkedAt: now, ...(!r.ok && !signedOut(r.stderr) ? { unsure: true } : {}),
      ...(account ? { account } : {}), ...(label ? { label } : {}), ...(id?.name ? { who: id.name } : {}), ...(id?.email ? { email: id.email } : {}), ...(s.values.region ? { region: s.values.region } : {}),
      ...(chrome[s.name] !== undefined ? { chrome: chrome[s.name] } : {}), ...(/:root$/.test(s.values.login_session ?? '') ? { root: true } : {}), ...(isSso(s.values) ? { sso: true } : {}),
    }
  })
}
