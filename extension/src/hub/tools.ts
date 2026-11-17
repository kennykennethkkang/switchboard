/**
 * Each chat's own plugins and skills, all on unless Kenneth turns one off in the panel, saved under
 * ~/.claude/switchboard/chat-profiles/<session id>.json with the settings file made from it
 * (<session id>.settings.json), which the chat starts and resumes with (--settings).
 * enabledPlugins there merges per key, so every plugin is written out; skillOverrides only
 * hides user and project skills, plugin skills go with their plugin. Mods are never touched.
 * Design references (assets) left on are named to the chat in its appended system note, to read before UI work.
 * The bundled design library (source 'library', absolute paths) is the opposite: off unless turned on by hand.
 * Every chat gets --settings with bypassPermissions (default with Ask before actions on, auto with Auto chosen), so a project's own mode cannot change it.
 * Bypass also approves project .mcp.json servers and skips the bypass warning; asking keeps both prompts.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { SHELL, ask, shellQuote, type Shell } from './projects'
import type { ChatProfile, IndefiniteEntry, Installed } from './types'
import type { HubService } from './hub-service'
import { writeJsonAtomic } from '../fs-utils'
import { LIBRARY, libraryCopies, libraryInventory, projectInventory } from './local'

export const PROFILES = path.join(os.homedir(), '.claude', 'switchboard', 'chat-profiles')
/** Run indefinitely flags, { session id: IndefiniteEntry }: onAt alone as a number, or an object with the budget; owned here, read by the usage-meter mod. */
export const INDEFINITE = path.join(os.homedir(), '.claude', 'switchboard', 'indefinite.json')
// Off in a new chat; Kenneth can turn one on per chat, and tool_on can. Only real conflicts:
// the second security-guidance runs the same hooks twice.
export const FLAGGED: string[] = ['security-guidance@claude-code-plugins']
// Plugins every chat keeps, by the name before the @.
export const ALWAYS = ['superpowers', 'ponytail', 'code-review', 'context7', 'playwright']
// Big niche bundles, off in a new chat so the rest of the skill listing keeps its descriptions.
// Smart turns one on from its keywords (smart-tools.ts RULES), tool_on any time. Short name -> what it is for.
export const GATED: Record<string, string> = { 'marketing-skills': 'SEO, copy, ads, pricing, launches', 'aws-core': 'AWS services', bland: 'voice agents and phone calls' }
// Claude Code drops skill descriptions past this share of context (default 0.01).
export const LISTING = { skillListingBudgetFraction: 0.02 }
/** Appended to a profiled chat's system prompt, so it never asks for a tool. */
export const TOOLS_NOTE = 'Every installed plugin and skill is yours to use without asking; if one is off, call the switchboard tool_on tool and use it at once from the file it points to.'

const short = (id: string) => id.split('@')[0]
const plugins = (inv: Installed[]) => inv.filter(i => i.kind === 'plugin')
// Archived skills cannot load anyway, so only ~/.claude/skills counts.
const skills = (inv: Installed[]) => inv.filter(i => i.kind === 'skill' && i.enabled)
const isLib = (i: Installed) => i.source === 'library'
const allAssets = (inv: Installed[]) => inv.filter(i => i.kind === 'asset' && i.path)
const library = (inv: Installed[]) => allAssets(inv).filter(isLib)
// Only a chat with design references or the library gets an assets map.
const assetMap = (inv: Installed[], on: (a: Installed) => boolean) => {
  const as = allAssets(inv)
  return as.length ? { assets: Object.fromEntries(as.map(a => [a.path!, on(a)])) } : {}
}
const fix = (id: string, on: boolean) => (ALWAYS.includes(short(id)) ? true : FLAGGED.includes(id) ? false : on)
// Held by the sweep until Kenneth approves it: off in every chat, whatever the profile says.
const heldNames = (inv: Installed[]) => new Set(inv.filter(i => i.held).map(i => i.name))

/** A new chat's tools: everything on but FLAGGED, GATED, the library and what the sweep holds. */
export function defaultProfile(inv: Installed[]): ChatProfile {
  const held = heldNames(inv)
  return {
    plugins: Object.fromEntries(plugins(inv).map(p => [p.name, !held.has(p.name) && fix(p.name, !Object.hasOwn(GATED, short(p.name)))])),
    skills: Object.fromEntries(skills(inv).map(s => [s.name, !held.has(s.name) && !FLAGGED.includes(s.name)])),
    ...assetMap(inv, a => !isLib(a)),
  }
}

/** A profile sent by the panel: only installed names, gaps from the defaults; a flagged plugin turned on by hand stays on, an ALWAYS one cannot be turned off. */
export function cleanProfile(p: ChatProfile, inv: Installed[]): ChatProfile {
  const d = defaultProfile(inv), held = heldNames(inv)
  const pick = (from: Record<string, boolean>, base: Record<string, boolean>) =>
    Object.fromEntries(Object.entries(base).map(([k, v]) => [k, held.has(k) ? false : typeof from[k] === 'boolean' && !ALWAYS.includes(short(k)) ? from[k] : v]))
  return { plugins: pick(p.plugins ?? {}, d.plugins), skills: pick(p.skills ?? {}, d.skills), ...(d.assets ? { assets: pick(p.assets ?? {}, d.assets) } : {}), ...keep(p) }
}

/** The Run indefinitely flag, its budget and the check-back ride every profile rewrite. */
const keep = (p: ChatProfile) => ({ ...(p.indefinite ? { indefinite: p.indefinite } : {}), ...(p.budget ? { budget: p.budget } : {}), ...(p.checkBack ? { checkBack: p.checkBack } : {}) })

/** Library looks a saved profile lacks (saved before the library shipped), added off so the panel can list them. */
export function withLibrary(p: ChatProfile, lib: Installed[]): ChatProfile {
  const add = library(lib).filter(a => !(a.path! in (p.assets ?? {})))
  return add.length ? { ...p, assets: { ...Object.fromEntries(add.map(a => [a.path!, false])), ...p.assets } } : p
}

/** A Switchboard chat's starting profile: the panel's, else the defaults; none with nothing installed. */
export function startProfile(inv: Installed[], sent: ChatProfile | undefined): ChatProfile | undefined {
  if (!inv.length) return undefined
  return sent ? cleanProfile(sent, inv) : defaultProfile(inv)
}

/** The gear's "Your name": one line, no quotes or shell characters, at most 40 chars; empty is off. */
export const cleanName = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').replace(/[\p{Cc}'"`$;\u2018-\u201F]/gu, '').replace(/ +/g, ' ').trim().slice(0, 40).trim() : '')

/** Appended to every chat Switchboard starts or resumes once a name is set. */
export function nameNote(name: string): string | undefined {
  const n = cleanName(name)
  return n ? `Address the user as ${n}. Speak to ${n} like a composed, quietly witty personal AI aide: brief, warm, capable. Use the name when talking to ${n} directly, not in every line. This is for chat replies only, never files, code or commits, and it never overrides the rules or formats the user set.` : undefined
}

/** TOOLS_NOTE plus the design references left on, for --append-system-prompt. */
export function toolsNote(p: ChatProfile, held?: Set<string>): string {
  const refs = Object.entries(p.assets ?? {}).filter(([, on]) => on).map(([k]) => k)
  // Held ones need Approve, not tool_on, so they stay out of the line.
  const off = Object.entries(p.plugins).filter(([k, on]) => !on && Object.hasOwn(GATED, short(k)) && !held?.has(k)).map(([k]) => `${short(k)} (${GATED[short(k)]})`)
  return [TOOLS_NOTE,
    off.length ? `Off until needed, turn on with tool_on when the task calls for it: ${off.join(', ')}.` : '',
    refs.length ? `Before any UI, styling or web design work, read these design references first: ${refs.join(', ')}.` : ''].filter(Boolean).join(' ')
}

// Read per write, so the Ask before actions switch reaches the next start or resume.
// Asking also drops the .mcp.json auto-trust: a cloned repo's server runs its own commands.
// LISTING rides here so a resume rewrites old settings files with it too.
const mode = () => ask.claude
  ? { ...LISTING, permissions: { defaultMode: 'default' } }
  : ask.auto
  ? { ...LISTING, permissions: { defaultMode: 'auto' } }
  : { ...LISTING, permissions: { defaultMode: 'bypassPermissions' }, skipDangerousModePermissionPrompt: true, enableAllProjectMcpServers: true }

export const profileSettings = (p: ChatProfile) => ({
  enabledPlugins: { ...p.plugins },
  skillOverrides: Object.fromEntries(Object.entries(p.skills).filter(([, on]) => !on).map(([k]) => [k, 'off'])),
  ...mode(),
})

const ID = /^[0-9a-f-]{8,64}$/i
const fileOf = (id: string, dir: string, ext = 'json') => {
  if (!ID.test(id)) throw new Error('Not a chat id')
  return path.join(dir, `${id}.${ext}`)
}

// --settings outranks ~/.claude/settings.json, so this turns auto-connect off for one chat and leaves the user's choice alone.
const NO_REMOTE = { remoteControlAtStartup: false }
const inline = (noRemote: boolean) => JSON.stringify({ ...(noRemote ? NO_REMOTE : {}), ...mode() })

/** A chat that must never connect to Remote Control (a To-do run) has an empty <id>.noremote here; every writer and reader checks it. */
export const isNoRemote = (id: string, dir = PROFILES) => ID.test(id) && fs.existsSync(fileOf(id, dir, 'noremote'))
function markNoRemote(id: string, dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(fileOf(id, dir, 'noremote'), '', { mode: 0o600 })
}

/** Writes the profile and the settings file made from it, Remote Control off for a no-remote chat; returns the settings file's path. */
export function saveProfile(id: string, p: ChatProfile, dir = PROFILES): string {
  const file = fileOf(id, dir, 'settings.json')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(fileOf(id, dir), `${JSON.stringify(p, null, 2)}\n`, { mode: 0o600 })
  fs.writeFileSync(file, `${JSON.stringify({ ...profileSettings(p), ...(isNoRemote(id, dir) ? NO_REMOTE : {}) }, null, 2)}\n`, { mode: 0o600 })
  return file
}

/** A new chat's --settings: its profile's file, else the mode inline, with the off switch for a no-remote chat. noRemote marks the chat for good. */
export function chatSettings(id: string | undefined, p: ChatProfile | undefined, noRemote = false, dir = PROFILES): string {
  if (id && noRemote) markNoRemote(id, dir)
  if (id && p) return saveProfile(id, p, dir)
  return inline(noRemote || !!(id && isNoRemote(id, dir)))
}

/** A handoff's fresh chat takes the old one's tools and its Remote Control switch. off: start it without --remote-control too. */
export function handoffSettings(from: string, to: string, p: ChatProfile | undefined, dir = PROFILES): { settings?: string; off: boolean } {
  const off = isNoRemote(from, dir)
  // A failed write still keeps off, so a To-do chat never starts on Remote Control.
  try { return { settings: chatSettings(to, p, off, dir), off } } catch { return { off } }
}

/** Saved profiles by session id; ids without one are left out. */
export function readProfiles(ids: string[], dir = PROFILES): Record<string, ChatProfile> {
  const out: Record<string, ChatProfile> = {}
  for (const id of new Set(ids)) {
    if (!ID.test(id)) continue
    try {
      const p = JSON.parse(fs.readFileSync(fileOf(id, dir), 'utf8')) as ChatProfile
      if (p && typeof p.plugins === 'object' && typeof p.skills === 'object') out[id] = p
    } catch { /* no profile */ }
  }
  return out
}

/** ` --settings '<file>'` for a chat that has a profile (rewritten for the current mode), else the mode inline; '' for a bad id; with picked design references or extra (the name note), --append-system-prompt too. */
export function resumeSettingsArg(id: string, dir = PROFILES, extra = '', shell: Shell = SHELL, lib = LIBRARY): string {
  if (!ID.test(id)) return ''
  const file = fileOf(id, dir, 'settings.json')
  const has = fs.existsSync(file)
  const p = has ? savedProfile(id, dir, lib) : undefined
  const note = p ? toolsNote(p) : TOOLS_NOTE
  const append = [note === TOOLS_NOTE ? '' : note, extra].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  if (p) saveProfile(id, p, dir)
  else if (has) remode(file)
  const settings = has ? file : inline(isNoRemote(id, dir))
  return ` --settings ${shellQuote(settings, shell)}${append ? ` --append-system-prompt ${shellQuote(append, shell)}` : ''}`
}

/** A settings file whose profile is unreadable keeps its tools but takes the current mode. */
function remode(file: string): void {
  try {
    const { permissions: _p, skipDangerousModePermissionPrompt: _s, enableAllProjectMcpServers: _e, ...rest } = JSON.parse(fs.readFileSync(file, 'utf8'))
    fs.writeFileSync(file, `${JSON.stringify({ ...rest, ...mode() }, null, 2)}\n`, { mode: 0o600 })
  } catch { /* unreadable: left for the CLI to report */ }
}

/** A chat's saved profile for a resume or handoff; one from before chats started all on is rewritten all on first. */
export function savedProfile(id: string, dir = PROFILES, lib = LIBRARY): ChatProfile | undefined {
  const p = readProfiles([id], dir)[id]
  if (!p) return undefined
  let current = false
  try { current = !!JSON.parse(fs.readFileSync(fileOf(id, dir, 'settings.json'), 'utf8')).permissions } catch { /* rewrite it */ }
  if (current) return p
  const on = allOn(p, lib)
  saveProfile(id, on, dir)
  return on
}

/** A profile saved before chats started all on (its settings lack permissions): all on but FLAGGED, library copies off, other assets as saved. */
function allOn(p: ChatProfile, lib: string): ChatProfile {
  const on = (m: Record<string, boolean>) => Object.fromEntries(Object.keys(m).map(k => [k, !FLAGGED.includes(k)]))
  const brand = (k: string) => /^design-md\/([^/]+)\//.exec(k)?.[1] ?? ''
  const copies = libraryCopies(Object.keys(p.assets ?? {}).map(brand).filter(Boolean), lib)
  return { plugins: on(p.plugins), skills: on(p.skills), ...(p.assets ? { assets: Object.fromEntries(Object.entries(p.assets).map(([k, v]) => [k, v && !copies.has(brand(k))])) } : {}), ...keep(p) }
}

/** A plugin (id or short name, either with :skill or :command) or a skill by name, on in the profile, and the file to read to use it now. */
export function turnOn(p: ChatProfile, inv: Installed[], name: string, cwd?: string): { profile: ChatProfile; use: string } | undefined {
  const n = name.trim().replace(/^\//, '')
  const cut = n.indexOf(':'), plug = cut < 0 ? n : n.slice(0, cut), skill = cut < 0 ? '' : n.slice(cut + 1)
  // The first file that exists; none found, the folder to look in.
  const first = (paths: string[], dir: string) => paths.find(f => fs.existsSync(f)) ?? dir
  const pl = plugins(inv).find(i => i.name === plug || short(i.name) === plug)
  if (pl?.held || skills(inv).find(i => i.name === n)?.held) throw new Error(`${pl?.name ?? n} needs approval in Switchboard (Settings, Installed) before a chat can use it`)
  if (pl) {
    const dir = pl.path
    const use = !dir ? pl.name : skill ? first([path.join(dir, 'skills', skill, 'SKILL.md'), path.join(dir, 'commands', `${skill}.md`)], dir) : dir
    return { profile: { ...p, plugins: { ...p.plugins, [pl.name]: true } }, use }
  }
  const sk = skills(inv).find(i => i.name === n)
  if (!sk) return undefined
  const roots = [...(sk.source === 'project' && cwd ? [path.join(cwd, '.claude', 'skills'), path.join(cwd, '.agents', 'skills')] : []), path.join(os.homedir(), '.claude', 'skills')]
  return { profile: { ...p, skills: { ...p.skills, [sk.name]: true } }, use: first(roots.map(r => path.join(r, sk.name, 'SKILL.md')), roots[0]) }
}

/** The same inventory the chat started with (chatInventory), or cleanProfile drops its design references. */
export async function toolInventory(hub: HubService, session: string): Promise<Installed[]> {
  const cwd = hub.get().chats.find(c => c.sessionId === session)?.cwd
  return [...hub.get().installed, ...(cwd ? await projectInventory(cwd).catch(() => []) : []), ...await libraryInventory()]
}

/** The tool_on tool: on for the chat from now on, saved so a resume or fresh chat keeps it; answers a line for the chat. */
export async function toolOn(hub: HubService, session: string, name: string): Promise<string> {
  if (!ID.test(session)) throw new Error('this chat has no Switchboard session id')
  const cwd = hub.get().chats.find(c => c.sessionId === session)?.cwd
  const inv = await toolInventory(hub, session)
  const on = turnOn(readProfiles([session])[session] ?? defaultProfile(inv), inv, name, cwd)
  if (!on) throw new Error(`nothing installed is named ${name}`)
  const profile = cleanProfile(on.profile, inv)
  saveProfile(session, profile)
  const tools = hub.get().tools
  if (tools) hub.set({ tools: { ...tools, chats: { ...tools.chats, [session]: profile } } })
  return `${name} is on for this chat. Use it now from ${on.use}. Its slash commands and MCP tools load when the chat next starts.`
}

/** When Run indefinitely went on for a chat, from its saved profile. */
export const indefiniteOn = (id: string, dir = PROFILES): number | undefined => readProfiles([id], dir)[id]?.indefinite

/** Rewrites the flag file from every saved profile, so a profile and the file never disagree. */
export function syncIndefinite(dir = PROFILES, file = INDEFINITE): Record<string, IndefiniteEntry> {
  let ids: string[] = []
  try { ids = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)) } catch { /* no profiles yet */ }
  const out: Record<string, IndefiniteEntry> = {}
  for (const [id, p] of Object.entries(readProfiles(ids, dir))) {
    if (!p.indefinite) continue
    out[id] = p.budget && Object.keys(p.budget).length ? { onAt: p.indefinite, ...p.budget } : p.indefinite
  }
  writeJsonAtomic(file, out)
  return out
}

/** Turns the flag off for a chat (done, switched off, handed off) and rewrites the file; the profile it leaves, if it had one. */
export function clearIndefinite(id: string, dir = PROFILES, file = INDEFINITE): ChatProfile | undefined {
  const p = readProfiles([id], dir)[id]
  let rest: ChatProfile | undefined
  if (p?.indefinite) {
    const { indefinite: _, budget: __, ...r } = p
    rest = r
    saveProfile(id, rest, dir)
  } else rest = p
  syncIndefinite(dir, file)
  return rest
}
