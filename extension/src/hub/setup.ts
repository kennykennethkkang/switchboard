/**
 * Set up: the steps that give a new machine the plugins, mods, MCP servers and skills (kit/setup.json).
 * Each step is left out when that piece is already there. No vscode here.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { ApiKey } from './types'
import { cliCall } from './windows'

const CLAUDE_ONLY = 'openai-codex'

export type SetupKit = {
  marketplaces: Record<string, string>
  plugins: string[]
  mods: string[]
  /** keyHeader: the server needs the 21st key, sent in this header. command + keyEnv: a stdio server that reads that saved Sign-ins key at launch. */
  mcps: { name: string; url?: string; keyHeader?: string; command?: string[]; keyEnv?: ApiKey['name'] }[]
  /** Fetched from GitHub into ~/.claude/skills; names are SKILL.md names, not folder names. */
  skills?: SkillRepo[]
  /** Switchboard's own skills, bundled in kit/skills (esbuild.js) and copied to ~/.claude/skills by the runner. */
  own?: string[]
  /** Python tools: uv installs them, then their skill and stdio MCP go to Claude and Codex. */
  tools?: Tool[]
  /** Global npm CLIs, bin named like the package; then: run once after a fresh install; os: only there. */
  npm?: { pkg: string; then?: string[]; os?: NodeJS.Platform[] }[]
}
/** path: the folder holding the skill folders (default skills); file: the one to use as SKILL.md. */
export type SkillRepo = { repo: string; names: string[]; path?: string; file?: string }
export type Tool = { uv: string; skill?: { repo: string; path: string; name: string; file?: string }; mcp?: { name: string; command: string } }
/** What Codex has, from its config.toml. */
/** askOld: the switchboard entry was added without --codex, so Codex lacks chats_wait, chats_check, hub_ask and hub_recall. */
export type CodexState = { plugins: string[]; marketplaces: string[]; mcps: string[]; askOld?: true }
/** What the machine has: plugin ids, marketplace names, user-scope MCP server names, ~/.claude/skills and ~/.agents/skills folders; plain: those holding a literal header, left out of mcps. */
export type SetupState = { plugins: string[]; marketplaces: string[]; mcps: string[]; plain: string[]; skills: string[]; agentsSkills: string[]; codex: CodexState }

/** The terminal's env carries the key; kit/setup-run.mjs moves it to the OS secret store, never into a command or config. */
export const KEY_ENV = 'API_KEY_21ST'
const MODS = '~/.claude/switchboard/mods'
const ASK = '~/.claude/switchboard/ask/ask-server.mjs'

/** One step for kit/setup-run.mjs: say a line, or copy then run, only when ifExists is there; key: store the key and add that server; skills: clone the repo and copy those in;
 * own: copy those bundled skills from the folder, where missing or an older copy of ours. needs: skipped with a note when one of these commands is missing.
 * unless: skipped when this command answers --version. then: run after run succeeds.
 * wait: seconds after which a still running command counts as done. ~/ is the home folder. */
export type SetupStep = { label?: string; say?: string; needs?: string[]; unless?: string; then?: string[]; wait?: number; ifExists?: string; copy?: { from: string; to: string }; run?: string[]; quiet?: true; key?: { name: string; url: string; header: string }; skills?: SkillRepo; own?: { from: string; names: string[] } }

const KEY_LABEL: Record<ApiKey['name'], string> = { GEMINI_API_KEY: 'Gemini', OPENROUTER_API_KEY: 'OpenRouter (Jev, MiroFish)', PERPLEXITY_API_KEY: 'Perplexity', FIRECRAWL_API_KEY: 'Firecrawl', ZEP_API_KEY: 'Zep (MiroFish)' }
const KEY_URL: Partial<Record<ApiKey['name'], string>> = { OPENROUTER_API_KEY: 'https://openrouter.ai/keys', FIRECRAWL_API_KEY: 'https://www.firecrawl.dev/app/api-keys', ZEP_API_KEY: 'https://app.getzep.com' }
const paste = (n: ApiKey['name']) => `${KEY_URL[n] ? `Get one at ${KEY_URL[n]} and paste` : 'Paste'} it in Switchboard: Settings, Accounts, API keys.`
const keyLine = (k: ApiKey) => `${KEY_LABEL[k.name]} key: ${!k.saved ? `missing. ${paste(k.name)}` : `saved (ends ${k.last4})${k.checked ? (k.checked.ok ? ', works' : `, failed its test (${k.checked.reason ?? 'no reason'})`) : ''}.`}`

/** key21st: whether the env holds the key. modsDir: the bundled marketplace, copied out since the extension folder moves on update. skillsDir: kit/skills.
 * keys: Sign-ins' API keys, one line each. */
/** sh that reads the saved key from the Keychain or the 0600 file (keys.ts) at launch, so no config holds it. */
const keyLaunch = (env: string, cmd: string[], platform: NodeJS.Platform) =>
  `${env}=$(${platform === 'darwin' ? `security find-generic-password -s switchboard -a ${env} -w` : `cat "$HOME/.claude/switchboard/keys/${env}"`}) exec ${cmd.join(' ')}`

export function setupSteps(kit: SetupKit, o: SetupState & { key21st: boolean; modsDir: string; skillsDir: string; platform?: NodeJS.Platform; keys?: ApiKey[] }): SetupStep[] {
  const out: SetupStep[] = []
  const platform = o.platform ?? process.platform
  // Keyed stdio servers, the same launch line for Claude and Codex; null when skipped.
  const keyed = new Map<string, string[] | null>()
  for (const m of kit.mcps) {
    if (!m.command || !m.keyEnv) continue
    const ok = o.keys?.some(k => k.name === m.keyEnv && k.saved) && platform !== 'win32'
    keyed.set(m.name, ok ? ['--', 'sh', '-c', keyLaunch(m.keyEnv, m.command, platform)] : null)
  }
  const claude = (label: string, ...args: string[]) => out.push({ label, run: ['claude', ...args] })
  for (const [name, repo] of Object.entries(kit.marketplaces)) if (!o.marketplaces.includes(name)) claude(name, 'plugin', 'marketplace', 'add', repo)
  const copy = { from: o.modsDir, to: MODS }
  if (!o.marketplaces.includes('kenneth-mods')) out.push({ label: 'Mods', copy, run: ['claude', 'plugin', 'marketplace', 'add', MODS] })
  // Our own copy gets this version's mods; a kenneth-mods pointing elsewhere (a claude-mods clone) is left alone.
  else out.push({ label: 'Refresh mods', ifExists: MODS, copy, run: ['claude', 'plugin', 'marketplace', 'update', 'kenneth-mods'] })
  for (const id of [...kit.plugins, ...kit.mods.map(m => `${m}@kenneth-mods`)]) if (!o.plugins.includes(id)) claude(id, 'plugin', 'install', id)
  for (const m of kit.mcps) {
    if (keyed.has(m.name)) {
      const cmd = keyed.get(m.name)
      if (cmd && !o.mcps.includes(m.name)) claude(m.name, 'mcp', 'add', '--scope', 'user', m.name, ...cmd)
      else if (!cmd) out.push({ say: platform === 'win32' ? `${m.name}: not added on Windows, its launch line needs sh.` : `${m.name}: no key saved, skipped. Paste it in Switchboard: Settings, Accounts, API keys, then run Set up again.` })
      continue
    }
    // A new key always goes to the store; a plain-text one is moved there without asking, except on linux, which has no store.
    if (m.keyHeader && (o.key21st || (o.plain.includes(m.name) && platform !== 'linux'))) { out.push({ label: m.name, key: { name: m.name, url: m.url!, header: m.keyHeader } }); continue }
    if (o.mcps.includes(m.name)) continue
    if (!m.keyHeader) out.push({ label: m.name, run: ['claude', 'mcp', 'add', '--scope', 'user', '--transport', 'http', m.name, m.url!] })
    else out.push({ say: `${m.name}: no key given, skipped. Get one at https://21st.dev/mcp and run Set up again.` })
  }
  const lacking = (n: string) => !o.skills.includes(n) || !o.agentsSkills.includes(n)
  for (const k of kit.skills ?? []) {
    const names = k.names.filter(lacking)
    if (names.length) out.push({ label: k.repo, skills: { ...k, names } })
  }
  // Always handed over: whether a present copy is ours and older takes a look inside it, which the runner does.
  if (kit.own?.length) out.push({ label: 'Switchboard skills', own: { from: o.skillsDir, names: kit.own } })
  if (!o.mcps.includes('switchboard')) out.push({ label: 'Ask tool', ifExists: ASK, run: ['claude', 'mcp', 'add', '--scope', 'user', 'switchboard', '--', 'node', ASK] })
  // Codex gets the same kit; the mods are Claude hooks, so they stay out.
  const cx = o.codex
  const codex = (label: string, ...args: string[]) => out.push({ label: `${label} (Codex)`, needs: ['codex'], run: ['codex', ...args] })
  // The Codex plugin drives Codex from Claude, so Codex itself never gets it.
  for (const [name, repo] of Object.entries(kit.marketplaces)) if (name !== CLAUDE_ONLY && !cx.marketplaces.includes(name)) codex(name, 'plugin', 'marketplace', 'add', repo)
  for (const id of kit.plugins) if (!id.endsWith(`@${CLAUDE_ONLY}`) && !cx.plugins.includes(id)) codex(id, 'plugin', 'add', id)
  for (const m of kit.mcps) {
    if (cx.mcps.includes(m.name)) continue
    if (keyed.has(m.name)) {
      const cmd = keyed.get(m.name)
      if (cmd) codex(m.name, 'mcp', 'add', m.name, ...cmd)
      continue
    }
    // The entry is written before codex starts a browser login, which would hang Set up.
    if (!m.keyHeader) out.push({ label: `${m.name} (Codex)`, needs: ['codex'], wait: 20, run: ['codex', 'mcp', 'add', m.name, '--url', m.url!] })
    else if (o.key21st) out.push({ say: `${m.name} for Codex: not added, its key goes in an x-api-key header that codex mcp add cannot set.` })
  }
  // The context7 plugin is an http server Codex wants an OAuth login for (AuthRequired); the stdio one needs none.
  if (!cx.mcps.includes('context7') && kit.plugins.some(id => id.startsWith('context7@'))) out.push({ label: 'context7 (Codex)', needs: ['codex', 'npx'], run: ['codex', 'mcp', 'add', 'context7', '--', 'npx', '-y', '@upstash/context7-mcp'] })
  // --codex is what turns on the chat-wait and hub tools, which Codex has no mods for.
  if (cx.askOld) out.push({ label: 'Ask tool (Codex, old entry)', needs: ['codex'], ifExists: ASK, run: ['codex', 'mcp', 'remove', 'switchboard'] })
  if (!cx.mcps.includes('switchboard') || cx.askOld) out.push({ label: 'Ask tool (Codex)', needs: ['codex'], ifExists: ASK, run: ['codex', 'mcp', 'add', 'switchboard', '--', 'node', ASK, '--codex'] })
  for (const t of kit.tools ?? []) {
    out.push({ label: t.uv, needs: ['uv'], quiet: true, run: ['uv', 'tool', 'install', t.uv] })
    const k = t.skill
    if (k && lacking(k.name)) out.push({ label: k.repo, needs: ['uv'], skills: { repo: k.repo, names: [k.name], path: k.path, ...(k.file ? { file: k.file } : {}) } })
    if (!t.mcp) continue
    // ponytail: uv's default bin folder, no .exe; Windows needs the real path.
    const bin = platform === 'win32'
      ? path.join(os.homedir(), '.local', 'bin', `${t.mcp.command}.exe`)
      : `~/.local/bin/${t.mcp.command}`
    if (!o.mcps.includes(t.mcp.name)) out.push({ label: t.mcp.name, needs: ['uv'], run: ['claude', 'mcp', 'add', '--scope', 'user', t.mcp.name, '--', bin] })
    if (!cx.mcps.includes(t.mcp.name)) out.push({ label: `${t.mcp.name} (Codex)`, needs: ['uv', 'codex'], run: ['codex', 'mcp', 'add', t.mcp.name, '--', bin] })
  }
  for (const n of kit.npm ?? []) {
    if (n.os && !n.os.includes(platform)) continue
    out.push({ label: n.pkg, needs: ['npm'], unless: n.pkg, run: ['npm', 'install', '-g', n.pkg], ...(n.then ? { then: n.then } : {}) })
  }
  const oauth = kit.mcps.filter(m => m.url && !m.keyHeader).map(m => m.name)
  out.push({ say: '' }, ...(o.keys ?? []).map(k => ({ say: keyLine(k) })), { say: `Set up done. Sign in to ${oauth.join(', ')} with /mcp in a chat, then run /reload-plugins in chats that were already open.` },
    { say: `In Codex, sign in with ${oauth.map(n => `codex mcp login ${n}`).join(', ')}.` })
  return out
}

const names = (file: string, pick: (j: Record<string, unknown>) => unknown) => {
  try { return Object.keys((pick(JSON.parse(fs.readFileSync(file, 'utf8'))) ?? {}) as object) } catch { return [] }
}

/** A server whose headers hold a literal value, as Set up before 0.18 wrote the 21st key; it counts as missing so a rerun replaces it. */
const plain = (m: unknown) => Object.values((m as { headers?: object })?.headers ?? {}).some(v => typeof v === 'string' && !v.includes('${'))

const dirs = (d: string) => (fs.existsSync(d) ? fs.readdirSync(d).filter(n => !n.startsWith('.')) : [])

/** Table names from Codex's config.toml: [plugins."id"], [marketplaces.name], [mcp_servers.name] (not its .env subtables). */
export function codexState(file: string): CodexState {
  let toml = ''
  try { toml = fs.readFileSync(file, 'utf8') } catch { /* no Codex */ }
  const tables = (key: string) => [...toml.matchAll(new RegExp(`^\\[${key}\\.(?:"([^"]+)"|([^\\]."]+))\\]\\s*$`, 'gm'))].map(m => m[1] ?? m[2])
  const ask = toml.match(/^\[mcp_servers\.switchboard\]\s*\n((?:(?!\[).*\n?)*)/m)?.[1]
  return { plugins: tables('plugins'), marketplaces: tables('marketplaces'), mcps: tables('mcp_servers'), ...(ask && !/^args\s*=.*--codex/m.test(ask) ? { askOld: true as const } : {}) }
}

export function setupState(home: string): SetupState {
  const plugins = path.join(home, '.claude', 'plugins')
  const plainOnes = names(path.join(home, '.claude.json'), j => Object.fromEntries(Object.entries((j.mcpServers ?? {}) as object).filter(([, m]) => plain(m))))
  return {
    plugins: names(path.join(plugins, 'installed_plugins.json'), j => j.plugins),
    marketplaces: names(path.join(plugins, 'known_marketplaces.json'), j => j),
    mcps: names(path.join(home, '.claude.json'), j => j.mcpServers).filter(n => !plainOnes.includes(n)),
    plain: plainOnes,
    skills: dirs(path.join(home, '.claude', 'skills')),
    agentsSkills: dirs(path.join(home, '.agents', 'skills')),
    codex: codexState(path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'config.toml')),
  }
}

/** VS Code's PATH often lacks ~/.local/bin, where the claude CLI lives. */
export function claudeBinary(): string {
  const local = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude')
  return fs.existsSync(local) ? local : 'claude'
}

/** Calls the Windows command shim with quoted args. */
export function claudeCall(args: string[], platform: NodeJS.Platform = process.platform): { cmd: string; args: string[]; shell: boolean; windowsVerbatimArguments?: boolean } {
  if (platform === 'win32') return { ...cliCall('claude', args, platform), shell: false }
  return { cmd: claudeBinary(), args, shell: false }
}
