/**
 * Smart toggle: each prompt (and each subagent start) picks the plugins, skills and design library entries
 * the task needs by cheap keyword and role rules, turns them on in the chat's profile and turns off only
 * the ones it turned on before. The why per pick is kept in <session>.smart.json beside the profile.
 * --settings is read once at start (the docs' hot reload covers user, project, local and managed files only),
 * so a change applies on the chat's next start or resume: pending until its SessionStart.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { ChatProfile, Installed, SmartRecord } from './types'
import type { HubService } from './hub-service'
import { FLAGGED, PROFILES, toolInventory, cleanProfile, defaultProfile, readProfiles, saveProfile } from './tools'
import { LIBRARY } from './local'

export type Pick = { name: string; kind: 'plugin' | 'skill' | 'asset'; rule: string; held?: boolean }

export const DESIGN_SKILLS = [
  'impeccable', 'frontend-design', 'emil-design-eng', 'apple-design', 'animate', 'animate-expo', 'animation-vocabulary',
  'animation-styles', 'find-animation-opportunities', 'improve-animations', 'accessible-motion', 'hover-interactions',
  'page-transitions', 'scroll-animations', 'web-design-guidelines', 'accessibility', 'dataviz', 'mobile-native', 'awwwards',
  'brandkit', 'ask-sonner', 'imagegen-frontend-web', 'imagegen-frontend-mobile', 'image-to-code-skill', 'gsap-greensock', 'gsap-scrolltrigger',
]
const DESIGN = /\b(ui|ux|(re)?design(er|ing)?|css|(re)?styl(e|es|ing)|layout|frontend|front-end|animat\w*|motion|typography|colou?rs?|theme|landing page|components?|tailwind|figma|mockups?|dashboard|responsive|hover|transitions?|visual|screens?)\b/i
const PIXEL = /\b(pixel[- ]?art|sprites?|game juice)\b/i
// Keyword rules for the rest: regex, then the short names (plugin before the @, or skill) it turns on.
const RULES: Array<[RegExp, string, string[]]> = [
  [/\b(aws|lambda|s3|ec2|cloudformation|cdk|bedrock|dynamodb|cloudwatch|aws amplify)\b/i, 'AWS words', ['aws-core']],
  [/\b(bland|voice agents?|phone calls?|bland pathways?|conversational pathways?)\b/i, 'Bland words', ['bland']],
  [/\b(seo|marketing|copywriting|ad copy|ad creative|pricing page|cold email|email sequence|launch post|conversion rate|growth (hacking|marketing|loops?)|competitor (analysis|profiling|research)|onboarding emails?)\b/i, 'marketing words', ['marketing-skills']],
  [/\b(pricing strategy|pitch deck|fundrais(e|ing)|go-to-market|gtm plan|mvp scope|validate (the|my|an?) idea|investor update|unit economics|user personas?)\b/i, 'founder words', ['founder']],
  [/\b(playwright|e2e|end-to-end)\b/i, 'browser test words', ['e2e-testing', 'playwright']],
  [/\b(charts?|graphs?|plots?|dataviz)\b/i, 'chart words', ['dataviz']],
  [/\bjev\b/i, 'Jev words', ['claude-x-jev']],
  [/\bauth0\b/i, 'Auth0 words', ['auth0']],
]
const short = (n: string) => n.split('@')[0]
const usable = (inv: Installed[]) => inv.filter(i => (i.kind === 'plugin' || (i.kind === 'skill' && i.enabled)) && !FLAGGED.includes(i.name))
const asPick = (i: Installed, rule: string): Pick => ({ name: i.name, kind: i.kind as 'plugin' | 'skill', rule, ...(i.held ? { held: true } : {}) })

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
  return [...out.values()]
}

/** A new chat's profile with what its first message or goal picks turned on, so a gated bundle is there from the start. */
export function withGoal(p: ChatProfile, text: string, inv: Installed[]): ChatProfile {
  const plugins = { ...p.plugins }, skills = { ...p.skills }
  for (const k of pickTools(text, undefined, inv)) {
    const m = k.kind === 'plugin' ? plugins : k.kind === 'skill' ? skills : undefined
    if (m && k.name in m && !k.held) m[k.name] = true
  }
  return { ...p, plugins, skills }
}

/**
 * picks applied to a profile. A prompt that fires nothing, or a subagent start (merge), keeps the last set;
 * otherwise what it turned on before and no longer wants goes off. Held tools stay off and are listed.
 */
export function applyPicks(p: ChatProfile, inv: Installed[], picks: Pick[], prev: SmartRecord | undefined, now = Date.now(), merge = false): { profile: ChatProfile; record: SmartRecord; changed: boolean } {
  const keep = merge || !picks.length
  const plugins = { ...p.plugins }, skills = { ...p.skills }, assets = { ...(p.assets ?? {}) }
  const of = (k: Pick['kind']) => (k === 'plugin' ? plugins : k === 'skill' ? skills : assets)
  const on: Record<string, string> = keep ? { ...prev?.on } : {}
  const why: Record<string, string> = keep ? { ...prev?.why } : {}
  const refused = new Set(keep ? prev?.refused ?? [] : [])
  const library = new Set(keep ? prev?.library ?? [] : [])
  let changed = false
  for (const k of picks) {
    why[k.name] = k.rule
    if (k.held || inv.some(i => i.name === k.name && i.held)) { refused.add(k.name); continue }
    if (k.kind === 'asset') library.add(k.name)
    const m = of(k.kind)
    if (prev?.on[k.name]) on[k.name] = k.rule
    if (m[k.name] !== true) { m[k.name] = true; on[k.name] = k.rule; changed = true }
  }
  if (!keep) {
    for (const name of Object.keys(prev?.on ?? {})) {
      if (name in on) continue
      const m = [plugins, skills, assets].find(x => x[name] === true)
      if (m) { m[name] = false; changed = true }
    }
  }
  const profile = { plugins, skills, ...(Object.keys(assets).length ? { assets } : {}) }
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

function writeSmart(id: string, r: SmartRecord, dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(smartFile(id, dir), `${JSON.stringify(r, null, 2)}\n`, { mode: 0o600 })
}

/** One hook payload against a chat's profile; the saved profile when picks changed it, else undefined. */
export function smartEvent(payload: Record<string, unknown>, profile: ChatProfile, inv: Installed[], dir = PROFILES, index = '', now = Date.now()): ChatProfile | undefined {
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
  const profile = smartEvent(payload, readProfiles([id])[id] ?? defaultProfile(inv), inv, PROFILES, index)
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
