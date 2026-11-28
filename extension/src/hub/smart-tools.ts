/**
 * Smart toggle: each prompt (and each subagent start) picks the plugins, skills, MCP servers, built-in tools and design library entries
 * the task needs by cheap keyword and role rules, turns them on in the chat's profile and turns off only
 * the ones it turned on before. The why per pick is kept in <session>.smart.json beside the profile.
 * --settings is read once at start (the docs' hot reload covers user, project, local and managed files only),
 * so a change applies on the chat's next start or resume: pending until its SessionStart.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { writeJsonAtomic } from '../fs-utils'
import { JEV } from './picker'
import type { ChatProfile, Installed, SmartRecord } from './types'
import type { HubService } from './hub-service'
import { ALWAYS, FLAGGED, GATED, PROFILES, toolInventory, cleanProfile, defaultProfile, readProfiles, saveProfile } from './tools'
import { LIBRARY } from './local'

export type Pick = { name: string; kind: 'plugin' | 'skill' | 'asset' | 'builtin' | 'mcp'; rule: string; held?: boolean }

export const DESIGN_SKILLS = [
  'impeccable', 'frontend-design', 'emil-design-eng', 'apple-design', 'animate', 'animation-styles', 'accessible-motion',
  'web-design-guidelines', 'accessibility', 'dataviz', 'awwwards', 'brandkit', 'imagegen-frontend-web', 'imagegen-frontend-mobile',
  'image-to-code-skill', 'gsap-scrolltrigger',
]
const DESIGN = /\b(ui|ux|(re)?design(er|ing)?|css|(re)?styl(e|es|ing)|layout|frontend|front-end|animat\w*|motion|typography|colou?rs?|theme|landing page|components?|tailwind|figma|mockups?|dashboard|responsive|hover|transitions?|visual|screens?)\b/i
const PIXEL = /\b(pixel[- ]?art|sprites?|game juice)\b/i
// Keyword rules for the rest: regex, then the short names (plugin before the @, or skill) it turns on.
const RULES: Array<[RegExp, string, string[]]> = [
  [/\b(aws|lambda|s3|ec2|cloudformation|cdk|bedrock|dynamodb|cloudwatch|aws amplify)\b/i, 'AWS words', ['aws-core']],
  [/\b(bland|voice agents?|phone calls?|bland pathways?|conversational pathways?)\b/i, 'Bland words', ['bland']],
  [/\b(seo|marketing|copywriting|ad copy|ad creative|pricing page|cold email|email sequence|launch post|conversion rate|growth (hacking|marketing|loops?)|competitor (analysis|profiling|research)|onboarding emails?)\b/i, 'marketing words', ['marketing-skills']],
  [/\b(pricing strategy|pitch deck|fundrais(e|ing)|go-to-market|gtm plan|mvp scope|validate (the|my|an?) idea|investor update|unit economics|user personas?)\b/i, 'founder words', ['founder']],
  [/\b(playwright|e2e|end-to-end)\b/i, 'browser test words', ['playwright']],
  [/\b(scrapling|scrap(?:e|ing)|crawl(?:er|ing)?|anti-bot)\b/i, 'scraping words', ['mcp:scrapling']],
  [/\b(charts?|graphs?|plots?|dataviz)\b/i, 'chart words', ['dataviz']],
  [/\bjev\b/i, 'Jev words', ['claude-x-jev']],
  [/\bauth0\b/i, 'Auth0 words', ['auth0']],
  [/\b(artifact tool|claude artifacts?|publish\w* (it |this |that )?(as )?an? artifact)\b|claude\.ai\/(code\/)?artifact\//i, 'Artifact words', ['Artifact']],
  [/\b(ultracode|multi-agent workflow|(use|run|as|with) a workflow|fan out (the )?agents|orchestrate\b.{0,40}\bsubagents)\b/i, 'workflow words', ['Workflow']],
  [/(^|\s)\/loop\b/i, '/loop', ['ScheduleWakeup']],
  [/(^|\s)\/(code-review|review)\b/i, '/code-review', ['ReportFindings']],
  [/(^|\s)\/feedback\b|\bfeedback (about|on|for|to) (claude code|anthropic)\b/i, 'feedback words', ['SendFeedback']],
  [/\b(an?|the|full|new) (google |claude )?doc(ument)?\b/i, 'document words', ['mcp:claude.ai Claude Docs', 'mcp:claude.ai Google Drive']],
]
const short = (n: string) => n.split('@')[0]
const usable = (inv: Installed[]) => inv.filter(i => (i.kind === 'plugin' || i.kind === 'builtin' || i.kind === 'mcp' || (i.kind === 'skill' && i.enabled)) && !FLAGGED.includes(i.name))
const asPick = (i: Installed, rule: string): Pick => ({ name: i.name, kind: i.kind as Pick['kind'], rule, ...(i.held ? { held: true } : {}) })

/** Every installed design skill and stitch plugin; pixelfx only for pixel work. */
export function designSet(inv: Installed[], pixel: boolean, rule = 'design'): Pick[] {
  return usable(inv).filter(i => DESIGN_SKILLS.includes(short(i.name)) || short(i.name).startsWith('stitch-') || (pixel && short(i.name) === 'pixelfx')).map(i => asPick(i, rule))
}

/** Library entries for a design task from INDEX.md: brands the task names, else up to 3 lines sharing 2+ words with it. */
// ponytail: word overlap, no stemming; swap for a Jev match if picks feel off.
export function indexPick(text: string, index: string, inv: Installed[]): string[] {
  const lib = new Map(inv.filter(i => i.kind === 'asset' && i.source === 'library' && i.path).map(i => [i.name.toLowerCase(), i.path!]))
  const low = text.toLowerCase()
  const lines = index.split('\n').filter(l => l.startsWith('- `')).map(l => ({ brands: [...l.matchAll(/`([^`]+)`/g)].map(m => m[1].toLowerCase()), tail: l.slice(l.indexOf(':') + 1) }))
  const named = lines.flatMap(l => l.brands).filter(b => lib.has(b) && new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(low))
  if (named.length) return [...new Set(named)].map(b => lib.get(b)!)
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? [])
  const want = words(text)
  return lines.map(l => ({ b: l.brands.find(x => lib.has(x)), n: [...words(l.tail)].filter(w => want.has(w)).length }))
    .filter(x => x.b && x.n >= 2).sort((a, b) => b.n - a.n).slice(0, 3).map(x => lib.get(x.b!)!)
}

/** What a prompt or a role needs: the design set for design words or the designer role, then the keyword rules. */
export function pickTools(text: string, role: string | undefined, inv: Installed[], index = ''): Pick[] {
  const out = new Map<string, Pick>()
  const word = DESIGN.exec(text)?.[0]
  const design = role === 'designer' ? 'designer role' : word ? `design words: "${word.toLowerCase()}"` : ''
  if (design) {
    for (const p of designSet(inv, PIXEL.test(text), design)) out.set(p.name, p)
    for (const a of index ? indexPick(text, index, inv) : []) out.set(a, { name: a, kind: 'asset', rule: `${design}, design library index` })
  }
  for (const [re, rule, names] of RULES) {
    if (!re.test(text)) continue
    for (const i of usable(inv).filter(i => names.includes(short(i.name)))) if (!out.has(i.name)) out.set(i.name, asPick(i, rule))
  }
  // A server the message names.
  const low = text.toLowerCase()
  for (const i of inv.filter(i => i.kind === 'mcp')) {
    const server = i.name.replace(/^mcp:(claude\.ai )?/, '').toLowerCase()
    if (!out.has(i.name) && new RegExp(`(^|[^\\w-])${server.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w-])`).test(low)) out.set(i.name, asPick(i, 'named in the message'))
  }
  return [...out.values()]
}

// A copy of a profile, and the map in it each kind of tool sits in.
function edit(p: ChatProfile) {
  const out = { ...p, plugins: { ...p.plugins }, skills: { ...p.skills }, ...(p.assets ? { assets: { ...p.assets } } : {}), ...(p.extras ? { extras: { ...p.extras } } : {}) }
  const of = (kind: Installed['kind']): Record<string, boolean> | undefined => kind === 'plugin' ? out.plugins : kind === 'skill' ? out.skills : kind === 'asset' ? out.assets : kind === 'builtin' || kind === 'mcp' ? out.extras : undefined
  return { out, of }
}

/** A new chat's profile with what its first message or goal picks turned on, so a gated bundle is there from the start. */
export function withGoal(p: ChatProfile, text: string, inv: Installed[]): ChatProfile {
  const { out, of } = edit(p)
  for (const k of pickTools(text, undefined, inv)) {
    const m = k.kind === 'asset' ? undefined : of(k.kind)
    if (m && k.name in m && !k.held) m[k.name] = true
  }
  return out
}

export type Precedence = 'always' | 'auto' | 'never'
const PRECEDENCE = path.join(os.homedir(), '.claude', 'switchboard', 'tool-precedence.json')

/** Kenneth's per-tool precedence: always (never turned off) or never (off unless on by hand or tool_on); unset is auto and left out. */
export function readPrecedence(file = PRECEDENCE): Record<string, 'always' | 'never'> {
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    return Object.fromEntries(Object.entries(m).filter(([, v]) => v === 'always' || v === 'never')) as Record<string, 'always' | 'never'>
  } catch { return {} }
}

export function setPrecedence(name: string, value: Precedence, file = PRECEDENCE): Record<string, 'always' | 'never'> {
  const m: Record<string, 'always' | 'never'> = readPrecedence(file)
  if (value === 'auto') delete m[name]; else m[name] = value
  fs.mkdirSync(path.dirname(file), { recursive: true })
  writeJsonAtomic(file, m)
  return m
}

/** Jev's chance (0 to 1) that each candidate tool helps with the task; a name it did not answer for is missing. */
export type JevAsk = (task: string, items: Array<{ name: string; about: string }>) => Promise<Record<string, number> | undefined>
// Below this a tool is off; unsure counts as needed.
const NOT_NEEDED = 0.3
// A built-in tool needs this much to go on: 12.7k tokens for Artifact, against one headless call (about 24 cents to publish, measured) when a chat needs it after all.
const SURELY = 0.7
const JEV_MS = 3000
const PRESET = { name: 'switchboard-tools', model: 'typesafe/jev-1.13', description: 'Which plugins and skills help with the first message of a chat', state_fields: ['task'], display_fields: [], thresholds: {}, rules: [] }
// The 32k-token context holds about this many one-line questions.
const JEV_MAX = 250

/** One Jev request: a noul question per tool, all answered in parallel on the same task (about 0.6 s for 180); undefined when Jev is missing, slow or fails. */
const viaJev: JevAsk = async (task, items) => {
  if (!fs.existsSync(JEV)) return undefined
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-tools-'))
  try {
    const used = items.slice(0, JEV_MAX)
    const questions = Object.fromEntries(used.map((i, n) => [`t${n}`, { type: 'noul', instructions: `Could the tool "${i.name.split('@')[0]}" (${i.about || 'no description'}) be of real use for doing \`task\`? Answer yes if the task might call on it, even a little; no only when it is clearly unrelated.` }]))
    fs.writeFileSync(path.join(dir, 'preset.json'), JSON.stringify({ ...PRESET, questions }))
    fs.writeFileSync(path.join(dir, 'items.json'), JSON.stringify([{ _id: '0', task: task.slice(0, 1500) }]))
    // No Keychain read here: jev.py looks its own key up inside the time limit.
    const out = await new Promise<string | undefined>(done => execFile('python3', [JEV, 'ask', '--preset', path.join(dir, 'preset.json'), '--input', path.join(dir, 'items.json'), '--timeout', '3'],
      { timeout: JEV_MS, maxBuffer: 4 << 20, env: process.env }, (err, o) => done(err ? undefined : String(o))))
    const res: Record<string, number> = {}
    for (const line of out?.split('\n') ?? []) {
      try {
        const r = JSON.parse(line) as Record<string, unknown>
        used.forEach((i, n) => { if (typeof r[`t${n}`] === 'number') res[i.name] = r[`t${n}`] as number })
      } catch { /* summary line or noise */ }
    }
    return Object.keys(res).length ? res : undefined
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

/**
 * A new chat's profile from its first message: Jev says per plugin, enabled skill, MCP server and built-in tool whether the task needs it.
 * A confident no turns one off; a built-in tool is off unless Jev is confident it is needed. The regex picks, ALWAYS plugins and precedence "always" stay on; "never" is off. Jev down or slow: the regex-only
 * start (withGoal). No message: all on. why: Jev's line per candidate, else the regex rule.
 */
export async function jevStart(start: ChatProfile, text: string, inv: Installed[], prec: Record<string, 'always' | 'never'>, ask: JevAsk = viaJev): Promise<{ profile: ChatProfile; why: Record<string, string> }> {
  const base = withGoal(start, text, inv)
  const why: Record<string, string> = {}
  const regex = pickTools(text, undefined, inv)
  for (const k of regex) why[k.name] = k.rule
  const fixed = new Set(regex.map(k => k.name))
  const out = (p: ChatProfile) => {
    const { out: q } = edit(p)
    for (const [n, v] of Object.entries(prec)) for (const m of [q.plugins, q.skills, q.extras ?? {}]) if (n in m) m[n] = v === 'always'
    return { profile: q, why }
  }
  if (!text.trim()) return out(base)
  const cand = usable(inv).filter(i => i.kind !== 'asset' && !i.held && !fixed.has(i.name) && !prec[i.name] && !(i.kind === 'plugin' && (ALWAYS.includes(short(i.name)) || Object.hasOwn(GATED, short(i.name)))))
  let got: Record<string, number> | undefined
  try { got = cand.length ? await ask(text, cand.map(i => ({ name: i.name, about: (i.description ?? '').replace(/\s+/g, ' ').slice(0, 200) }))) : undefined } catch { got = undefined }
  if (!got) return out(base)
  const { out: next, of } = edit(base)
  for (const i of cand) {
    const p = got[i.name], m = of(i.kind)
    if (p === undefined || !m) continue
    const no = p < NOT_NEEDED, surely = i.kind === 'builtin' || i.name === 'mcp:scrapling', unsure = surely && !no && p < SURELY
    why[i.name] = unsure ? `Jev: ${Math.round(p * 100)}% likely to be needed, goes on at ${SURELY * 100}%` : `Jev: ${no ? 'not needed' : 'needed'} (${p.toFixed(2)})`
    if (no || unsure) m[i.name] = false
    else if (surely) m[i.name] = true
  }
  return out(next)
}

/**
 * picks applied to a profile. A prompt that fires nothing, or a subagent start (merge), keeps the last set;
 * otherwise what it turned on before and no longer wants goes off. Held tools stay off and are listed.
 */
export function applyPicks(p: ChatProfile, inv: Installed[], picks: Pick[], prev: SmartRecord | undefined, now = Date.now(), merge = false): { profile: ChatProfile; record: SmartRecord; changed: boolean } {
  const keep = merge || !picks.length
  const { out: profile, of } = edit({ ...p, assets: p.assets ?? {}, extras: p.extras ?? {} })
  const on: Record<string, string> = keep ? { ...prev?.on } : {}
  // Jev's start lines outlive a prompt's own picks.
  const why: Record<string, string> = keep ? { ...prev?.why } : Object.fromEntries(Object.entries(prev?.why ?? {}).filter(([, v]) => v.startsWith('Jev:')))
  const refused = new Set(keep ? prev?.refused ?? [] : [])
  const library = new Set(keep ? prev?.library ?? [] : [])
  let changed = false
  for (const k of picks) {
    why[k.name] = k.rule
    if (k.held || inv.some(i => i.name === k.name && i.held)) { refused.add(k.name); continue }
    if (k.kind === 'asset') library.add(k.name)
    const m = of(k.kind)!
    if (prev?.on[k.name]) on[k.name] = k.rule
    if (m[k.name] !== true) { m[k.name] = true; on[k.name] = k.rule; changed = true }
  }
  if (!keep) {
    for (const name of Object.keys(prev?.on ?? {})) {
      if (name in on) continue
      const m = [profile.plugins, profile.skills, profile.assets!, profile.extras!].find(x => x[name] === true)
      if (m) { m[name] = false; changed = true }
    }
  }
  for (const k of ['assets', 'extras'] as const) if (!Object.keys(profile[k] ?? {}).length) delete profile[k]
  return { profile, changed, record: { why, on, refused: [...refused], library: [...library], pending: changed || !!prev?.pending, at: now } }
}

const ID = /^[0-9a-f-]{8,64}$/i
const smartFile = (id: string, dir: string) => path.join(dir, `${id}.smart.json`)

export function readSmart(ids: string[], dir = PROFILES): Record<string, SmartRecord> {
  const out: Record<string, SmartRecord> = {}
  for (const id of new Set(ids)) {
    if (!ID.test(id)) continue
    try { out[id] = JSON.parse(fs.readFileSync(smartFile(id, dir), 'utf8')) as SmartRecord } catch { /* none */ }
  }
  return out
}

/** A new chat's start picks, kept so the panel can show why each tool is on or off. */
export const saveSmartStart = (id: string, why: Record<string, string>, dir = PROFILES): void => { if (ID.test(id) && Object.keys(why).length) writeSmart(id, { why, on: {}, refused: [], library: [], pending: false, at: Date.now() }, dir) }

function writeSmart(id: string, r: SmartRecord, dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(smartFile(id, dir), `${JSON.stringify(r, null, 2)}\n`, { mode: 0o600 })
}

/** One hook payload against a chat's profile; the saved profile when picks changed it, else undefined. */
export function smartEvent(payload: Record<string, unknown>, profile: ChatProfile, inv: Installed[], dir = PROFILES, index = '', now = Date.now(), prec: Record<string, 'always' | 'never'> = {}): ChatProfile | undefined {
  const id = typeof payload.session_id === 'string' ? payload.session_id : ''
  if (!ID.test(id)) return undefined
  const ev = payload.hook_event_name
  const prev = readSmart([id], dir)[id]
  if (ev === 'SessionStart') {
    if (prev?.pending) writeSmart(id, { ...prev, pending: false }, dir)
    return undefined
  }
  let picks: Pick[], merge = false
  if (ev === 'UserPromptSubmit' && !payload.agent_id) picks = pickTools(String(payload.prompt ?? '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ''), undefined, inv, index)
  else if (ev === 'SubagentStart' && typeof payload.agent_type === 'string') { picks = pickTools('', payload.agent_type, inv, index); merge = true }
  else return undefined
  // A tool set to never stays off for the prompt's picks too.
  picks = picks.filter(k => prec[k.name] !== 'never')
  if (!picks.length && !prev) return undefined
  const r = applyPicks(profile, inv, picks, prev, now, merge)
  writeSmart(id, r.record, dir)
  if (!r.changed) return undefined
  const clean = cleanProfile(r.profile, inv)
  saveProfile(id, clean, dir)
  return clean
}

const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json')

/** Skills ~/.claude/settings.json turns off for every chat. */
export function globalOff(file = SETTINGS): string[] {
  try { return Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')).skillOverrides ?? {}).filter(([, v]) => v === 'off').map(([k]) => k) } catch { return [] }
}

/** The hook server's payloads: picks for the chat, saved and pushed to the panel. Codex chats keep their own tools. */
export async function smartHook(hub: HubService, payload: Record<string, unknown>): Promise<void> {
  const ev = payload.hook_event_name, id = String(payload.session_id ?? '')
  if ((ev !== 'UserPromptSubmit' && ev !== 'SubagentStart' && ev !== 'SessionStart') || !ID.test(id) || !hub.get().installed.length) return
  if ((hub.get().chats.find(c => c.sessionId === id)?.ai ?? 'claude') !== 'claude') return
  const inv = await toolInventory(hub, id)
  const index = await fs.promises.readFile(path.join(LIBRARY, 'INDEX.md'), 'utf8').catch(() => '')
  const profile = smartEvent(payload, readProfiles([id])[id] ?? defaultProfile(inv), inv, PROFILES, index, Date.now(), readPrecedence())
  const tools = hub.get().tools
  if (tools) hub.set({ tools: { ...tools, chats: profile ? { ...tools.chats, [id]: profile } : tools.chats, smart: { ...tools.smart, ...readSmart([id]) } } })
}

type Watcher = { watch: (p: string, fn: (event?: string) => void) => { close: () => void } }

/** Watches each path (a missing one is skipped) and calls onChange once per burst; a replaced file is watched again. */
export function watchTools(paths: string[], onChange: () => void, ms = 500, w: Watcher = fs as unknown as Watcher): () => void {
  let timer: NodeJS.Timeout | undefined
  const open = new Map<string, { close: () => void }>()
  const rearms = new Set<NodeJS.Timeout>()
  let stopped = false
  const fire = () => { clearTimeout(timer); timer = setTimeout(onChange, ms) }
  const arm = (p: string) => {
    if (stopped) return
    open.get(p)?.close()
    try {
      open.set(p, w.watch(p, event => {
        fire()
        // An atomic save swaps the file, and the old watch goes quiet.
        if (event === 'rename') { const t = setTimeout(() => { rearms.delete(t); arm(p) }, 50); rearms.add(t) }
      }))
    } catch { open.delete(p) }
  }
  paths.forEach(arm)
  return () => { stopped = true; clearTimeout(timer); rearms.forEach(clearTimeout); rearms.clear(); for (const x of open.values()) x.close(); open.clear() }
}
