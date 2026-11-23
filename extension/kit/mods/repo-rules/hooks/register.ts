// The user's standing rules, enforced on the tool call instead of carried in memory.
// Each refusal is also reported to the Switchboard window for this folder.
import type { EngineInterface, Register } from 'claude-code'

// Built from its code point so this file holds no em dash itself.
export const EM = String.fromCharCode(0x2014)

const HUB = 'The user presses the git buttons and Stop process in Switchboard themselves. Leave the work modified, and say what looks stuck.'

// flat: matched with \uXXXX and \xNN decoded, then quotes and backslashes stripped, so escaped JSON and quote-split paths read plainly.
const RULES: { test: RegExp; why: string; short: string; flat?: true }[] = [
  { test: /\bgit\b(\s+-[cC]\s+\S+)*\s+(commit|push)\b/, short: 'a git commit or push', why: 'The user commits and pushes themselves, from their own terminal or the editor\'s Source Control. Leave the work modified.' },
  { test: /\bgit\b(\s+-[cC]\s+\S+)*\s+rm\b[^|;&]*--cached/, short: 'git rm --cached', why: 'git rm --cached stages a deletion. Delete with plain rm; if the index was touched, git reset -q -- <paths>.' },
  // The hub's git buttons and Stop process are the user's. A speed bump, not a boundary: a script file gets past it,
  // and a chat with a shell can run git itself. The second rule refuses hub posts whose body or URL is built at run time;
// a URL held in a variable only counts when the command also posts, so reading /hub/state stays open.
  { flat: true, test: /^(?=[\s\S]*\/hub\/command\b)(?=[\s\S]*(\bhub-git\b|\bop\s*:\s*(ship|commit-push|commit|push|sync|undo|discard|stash|pop|switch|create|delete-branch|pr|rerun)\b|\bhub-stuck-stop\b|(^|\s)(-d|--data(-binary|-raw|-urlencode)?|--json|-F|--form)(\s+|=)?@))/, short: 'a hub button', why: HUB },
  { flat: true, test: /^(?=[\s\S]*\b(curl|wget|fetch|https?|node|python3?)\b)(?=[\s\S]*\/hub\/)(?=[\s\S]*((^|\s)(-d|--data(-binary|-raw|-urlencode|-ascii)?|--json|-F|--form|--post-data)(\s+|=)?[$`@]|--post-file)|(?=[\s\S]*(^|[\s;&|(])[A-Za-z_]\w*=[^\s;&|]*\/hub\/)(?=[\s\S]*((^|\s)(-X\s*POST|--request(\s+|=)POST|-d|--data\S*|--json|-F|--form|--post-data)(\s|=|$)|method\s*:\s*POST)))/, short: 'a hub button', why: HUB },
  { test: /\bprettier\b[^|;&]*\s(--write|-w)\b/, short: 'prettier --write', why: 'No formatter here: prettier --write rewraps whole files at 80 columns. Edit by hand.' },
]

const DASH = 'An em dash in the new text. Use a comma, a colon, or "to".'

export const bashRule = (command: string) => {
  const hex = (_: string, h: string) => String.fromCharCode(parseInt(h, 16))
  const flat = command.replace(/\\u([0-9a-fA-F]{4})/g, hex).replace(/\\x([0-9a-fA-F]{2})/g, hex).replace(/["'\\]/g, '')
  return RULES.find(r => r.test.test(r.flat ? flat : command))
}

const count = (s: string) => s.split(EM).length - 1
export const addsEmDash = (before: string, after: string) => count(after) > count(before)

export const norm = (p: string) => p.replace(/\\/g, '/')

/** New text under these folders gets no em dash: the repos, Claude's memory and the research folder. */
export const rootsFor = (home: string) => [`${norm(home)}/Documents/GitHub/`, `${norm(home)}/.claude/projects/`, `${norm(home)}/Documents/Research/`]
export const isUnder = (path: string, roots: string[]) => roots.some(root => norm(path).startsWith(root))

// The home folder, read once; HOME on macOS and Linux, USERPROFILE on Windows.
const cache: { roots?: string[] } = {}

async function roots($: EngineInterface) {
  cache.roots ??= rootsFor((await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '')
  return cache.roots
}

/** Tells the Switchboard window for this folder; silent when there is none. */
async function report($: EngineInterface, detail: string) {
  const home = norm((await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '')
  const dir = `${home}/.claude/switchboard`
  const cwd = norm(await $.session.cwd())
  let best: { port: number; token: string; workspace: string } | undefined
  for (const e of await $.fs.list(dir).catch(() => [])) {
    if (e.kind !== 'file' || !e.name.endsWith('.json') || e.name === 'workspaces.json') continue
    try {
      const f = JSON.parse(String(await $.fs.read(`${dir}/${e.name}`)))
      const w = typeof f.workspace === 'string' ? norm(f.workspace).replace(/\/+$/, '') : ''
      if (typeof f.port !== 'number' || typeof f.hubToken !== 'string' || !w || (cwd !== w && !cwd.startsWith(`${w}/`))) continue
      if (!best || w.length > best.workspace.length) best = { port: f.port, token: f.hubToken, workspace: w }
    } catch { /* a file mid-write */ }
  }
  if (!best) return
  await $.http.fetch(`http://127.0.0.1:${best.port}/hub`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: best.token, kind: 'guard', mod: 'repo-rules', action: 'refused', detail }),
  }).catch(() => undefined)
}

// File claims, from kem_glitch: two chats in one folder overwrite each other. A file a chat writes
// is held for it until 20 idle minutes pass or it ends. Keyed by absolute path, so worktrees never clash.
export const CLAIM_MS = 20 * 60_000
export type Claims = Record<string, { session: string; at: number }>

export const parseClaims = (text: string): Claims => {
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch { return {} }
}

const live = (claims: Claims, now: number) => Object.entries(claims).filter(([, c]) => typeof c?.session === 'string' && now - c.at < CLAIM_MS)

export const heldBy = (claims: Claims, path: string, session: string, now: number) =>
  live(claims, now).find(([p, c]) => p === path && c.session !== session)?.[1]

export const stamp = (claims: Claims, path: string, session: string, now: number): Claims =>
  ({ ...Object.fromEntries(live(claims, now)), [path]: { session, at: now } })

export const release = (claims: Claims, session: string): Claims =>
  Object.fromEntries(Object.entries(claims).filter(([, c]) => c?.session !== session))

const claimsDir = (home: string) => `${norm(home)}/.claude/switchboard/claims`
export const claimFile = (home: string, root: string) => `${claimsDir(home)}/${norm(root).replace(/[^A-Za-z0-9]+/g, '-')}.json`

const homeOf = async ($: EngineInterface) => (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''

// Nearest folder with a .git (a worktree's is a file); none means the file is not claimed.
async function repoRoot($: EngineInterface, path: string) {
  for (let dir = norm(path).replace(/\/[^/]*$/, ''); dir.includes('/'); dir = dir.replace(/\/[^/]*$/, '')) {
    if (await $.fs.exists(`${dir}/.git`)) return dir
  }
  return undefined
}

// Temp file then mv, so a reader never sees half a file.
// ponytail: two chats saving at once can drop one stamp (last rename wins); it comes back on that chat's next write.
async function save($: EngineInterface, file: string, claims: Claims, tag: string) {
  const tmp = `${file}.${tag.replace(/[^A-Za-z0-9-]/g, '')}.tmp`
  await $.fs.write(tmp, JSON.stringify(claims))
  await $.process.run(['mv', '-f', tmp, file])
}

async function checkClaim($: EngineInterface, path: string | undefined) {
  try {
    const root = path && await repoRoot($, path)
    if (!root || !path) return undefined
    const file = claimFile(await homeOf($), root)
    const claims = parseClaims(String(await $.fs.read(file).catch(() => '{}')))
    const [session, now] = await Promise.all([$.session.id(), $.clock.now()])
    const key = norm(path)
    const other = heldBy(claims, key, session, now)
    if (other) {
      const name = key.split('/').pop()
      await report($, `${name} held by chat ${other.session}`).catch(() => undefined)
      const mins = Math.max(1, Math.round((now - other.at) / 60_000))
      return { deny: `repo-rules: ${name} is held by chat ${other.session}, which wrote it ${mins} min ago. Find it with ListAgents and SendMessage it to make the change or say when it is done, or wait. The hold lapses after 20 idle minutes or when that chat ends.` }
    }
    await save($, file, stamp(claims, key, session, now), `${session}-${now}`)
  } catch { /* fail open */ }
  return undefined
}

async function releaseAll($: EngineInterface, session: string) {
  const dir = claimsDir(await homeOf($))
  for (const f of await $.fs.list(dir).catch(() => [])) {
    if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
    const file = `${dir}/${f.name}`
    const claims = parseClaims(String(await $.fs.read(file).catch(() => '{}')))
    const left = release(claims, session)
    if (Object.keys(left).length < Object.keys(claims).length) await save($, file, left, `${session}-end`)
  }
}

const WRITES = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// Only reached when the pure check says the call breaks a rule, so a failure elsewhere never holds a clean call.
const held = (what: string, err: { kind: string; message?: string }) =>
  ({ deny: `repo-rules: the guard failed (${err.kind}${err.message ? `: ${err.message}` : ''}), so the ${what} was held.` })

async function checkBash($: EngineInterface, command: string) {
  const rule = bashRule(command)
  if (!rule) return undefined
  await report($, rule.short).catch(() => undefined)
  return { deny: `repo-rules: ${rule.why}` }
}

async function checkText($: EngineInterface, path: string, before: string, after: string) {
  if (!addsEmDash(before, after) || !isUnder(path, await roots($))) return undefined
  await report($, `an em dash in ${path.split(/[\\/]/).pop()}`).catch(() => undefined)
  return { deny: `repo-rules: ${DASH}` }
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => (await checkBash($, e.command)) ?? next(e))
    .catch(($, e, next) => (next.called || !bashRule(e.command) ? next(e) : held('command', next.error)))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => (await checkText($, e.file_path, e.old_string, e.new_string)) ?? next(e))
    .catch(($, e, next) => (next.called || !addsEmDash(e.old_string, e.new_string) ? next(e) : held('edit', next.error)))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (!e.content.includes(EM) || !isUnder(e.file_path, await roots($))) return next(e)
    const before = await $.fs.read(e.file_path).catch(() => '')
    return (await checkText($, e.file_path, String(before), e.content)) ?? next(e)
  }).catch(($, e, next) => (next.called || !e.content.includes(EM) ? next(e) : held('write', next.error)))

  // Registered last so the em dash check answers first.
  on('tool.call', async ($, e, next) => {
    if (!WRITES.has(e.tool)) return next(e)
    const f = e as { file_path?: string; notebook_path?: string }
    return (await checkClaim($, f.file_path ?? f.notebook_path)) ?? next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    await releaseAll($, e.sessionId).catch(() => undefined)
    return next(e)
  })
}
