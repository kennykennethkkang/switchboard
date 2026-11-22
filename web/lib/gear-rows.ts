import type { HubState, Installed, SweepRecord } from './hub-types'

/** tips: each name's description, same order as names. */
export type GearRow = { label: string; hint: string; names: string[]; tips: (string | undefined)[]; match: boolean }
// skills: plugin:skill, the form Claude Code names them in.
type Entry = { text: string; key: string; skills?: string[]; tip?: string }

const short = (i: Installed) => i.name.split('@')[0]

// A review only counts for the files it saw, and never stands in for Approve on a hold.
const reviewed = (r: SweepRecord | undefined) => !!r?.reviewed && r.reviewed.digest === r.digest && !(r.hold && !(r.approvedAt && r.approvedDigest === r.digest))

/** A plugin's or skill's sweep badge: Clean, Review, Reviewed, Approved or Unscanned. */
export function sweepBadge(r: SweepRecord | undefined): 'Clean' | 'Review' | 'Reviewed' | 'Approved' | 'Unscanned' {
  if (r?.approvedAt && r.approvedDigest === r.digest) return 'Approved'
  if (r?.state === 'review' && reviewed(r)) return 'Reviewed'
  return r?.state === 'clean' ? 'Clean' : r?.state === 'review' ? 'Review' : 'Unscanned'
}

/** The sweep's tools still installed: a record for an uninstalled tool or an older plugin version never shows. */
export function sweptNow(hub: Pick<HubState, 'installed' | 'sweep'>): [string, SweepRecord][] {
  return Object.entries(hub.sweep?.tools ?? {}).filter(([n, r]) => hub.installed.some(i => i.name === n && (i.kind !== 'plugin' || !i.path || i.path === r.path)))
}

/** The triage verdict and why, for a tooltip, while the review counts. */
export const sweepTip = (r: SweepRecord | undefined) => (r?.reviewed && reviewed(r) ? `${r.reviewed.verdict}: ${r.reviewed.why}` : undefined)

/** The gear's lists of installed things. q is lower case; while set, a row keeps only the names that match. */
export function gearRows(hub: Pick<HubState, 'installed' | 'connections' | 'sweep'>, q: string): GearRow[] {
  const of = (kind: Installed['kind'], enabled?: boolean) => hub.installed.filter(i => i.kind === kind && (enabled === undefined || i.enabled === enabled))
  // Only plugins and skills are swept; no badge until a sweep has a result for that one.
  const badge = (i: Installed) => ((i.kind === 'plugin' || i.kind === 'skill') && hub.sweep?.tools[i.name] ? sweepBadge(hub.sweep.tools[i.name]).toLowerCase() : '')
  const tip = (i: Installed) => [i.description, sweepTip(hub.sweep?.tools[i.name])].filter(Boolean).join('. ') || undefined
  const plain = (items: Installed[]): Entry[] => items.map(i => ({ text: `${short(i)}${badge(i) ? ` (${badge(i)})` : ''}`, key: i.name, tip: tip(i) }))
  const marked = (items: Installed[]): Entry[] => items.map(i => {
    const notes = [i.skills?.length && String(i.skills.length), !i.enabled && 'off', badge(i)].filter(Boolean).join(', ')
    return { text: `${short(i)}${notes ? ` (${notes})` : ''}`, key: i.name, skills: (i.skills ?? []).map(s => `${short(i)}:${s}`), tip: tip(i) }
  })
  const mcp = [...new Set(hub.connections.filter(c => c.kind === 'mcp').map(c => c.name))]
  const lists: Array<[string, string, Entry[]]> = [
    ['Roles', 'role', plain(of('role'))],
    ['Skills', 'skill', plain(of('skill', true))],
    ['Archived skills', 'skill', plain(of('skill', false))],
    ['Plugins', 'plugin', marked(of('plugin'))],
    ['Mods', 'mod', marked(of('mod'))],
    ['MCP servers', 'server', mcp.map(n => ({ text: n, key: n }))],
    ['Jev presets', 'preset', plain(of('preset'))],
    ['Design references', 'reference', plain(of('asset'))],
  ]
  // Design references only show once a project has some.
  return lists.filter(([, word, entries]) => word !== 'reference' || entries.length).map(([label, word, entries]) => {
    const hint = `${entries.length} ${word}${entries.length === 1 ? '' : 's'}`
    const whole = `${label} ${hint}`.toLowerCase().includes(q)
    const shown = entries.flatMap(e => {
      const self = e.key.toLowerCase().includes(q) || !!q && !!e.tip?.toLowerCase().includes(q)
      const hits = q && !self ? (e.skills ?? []).filter(s => s.toLowerCase().includes(q)).map(s => s.slice(s.indexOf(':') + 1)) : []
      if (hits.length) return [{ name: `${e.text}: ${hits.join(', ')}`, tip: e.tip }]
      return whole || self ? [{ name: e.text, tip: e.tip }] : []
    })
    return { label, hint, names: shown.map(x => x.name), tips: shown.map(x => x.tip), match: whole || shown.length > 0 }
  })
}

/** Each role's model as it runs: its frontmatter model, or the lead's for inherit (and no line, which Claude Code reads as inherit). */
export function roleModels(installed: Installed[], lead?: string): Record<string, string> {
  return Object.fromEntries(installed.filter(i => i.kind === 'role').map(i => [i.name, i.codex ? i.codexModel ?? 'codex default' : !i.model || i.model === 'inherit' ? lead ?? 'inherit' : i.model]))
}

/** Whether a settings search hits one of the words: whole keywords by their start, so one letter does not match everything. A phrase matches word starts in a row. */
export const keywordHit = (words: string, q: string) => !!q && ` ${words}`.includes(` ${q}`)

/** Settings blocks that are not rows, so search has to know them by name. to: the section to open; none, it sits under every page. */
export const BLOCKS: Array<{ label: string; hint: string; to?: 'Accounts' | 'Installed' | 'Integrations' | 'Chats'; words: string }> = [
  { label: 'Accounts', to: 'Accounts', hint: 'AWS profiles, web app logins, and which ones each project uses.', words: 'accounts sign-ins sign in signin logins login aws web apps chrome projects' },
  { label: 'API keys', to: 'Accounts', hint: 'Keys kept in a project\'s env file, and the AI sign-ins.', words: 'api keys key openrouter env secrets ai sign-ins sign in' },
  { label: 'Sweep', to: 'Installed', hint: 'Scans plugins and skills; Fix in a chat, Rescan and Approve for the flagged ones.', words: 'sweep scan skillspector review flagged approve rescan safety' },
  { label: 'Set up', to: 'Installed', hint: 'Installs the plugins, mods, MCP servers, rules and roles Switchboard works with.', words: 'set up setup install kit' },
  { label: 'Export kit', to: 'Installed', hint: 'Roles, skills, plugins and mods as one folder to copy to another Mac.', words: 'export kit copy folder another mac' },
  { label: 'Add a plugin or skill', to: 'Installed', hint: 'A GitHub repo, swept before it is added.', words: 'add plugin skill github repo install' },
  { label: 'Spend limits', to: 'Integrations', hint: 'Monthly caps on paid tools.', words: 'spend limits cap monthly paid dollars budget' },
  { label: 'Check health', to: 'Chats', hint: 'Hook server, kit version, mods, CLIs, hub port and MCP config.', words: 'check health doctor fix hooks diagnose' },
  { label: 'About and credits', hint: 'At the bottom of every settings page.', words: 'about credits licenses license thanks' },
]
/** The blocks a settings search q (lower case) hits. */
export const blockHits = (q: string) => BLOCKS.filter(b => keywordHit(`${b.label.toLowerCase()} ${b.words}`, q))

/** What Models > Test models types into its new chat. */
export const benchPrompt = 'Run the model-bench skill: benchmark each role on the current Claude models, then show me the results and a recommended model per role.'

/** The pause-at value a switch sets: on brings back the last % (50 to 100), else 99; off is null. */
export const pauseValue = (on: boolean, last?: number) => (on ? (last !== undefined && last >= 50 && last <= 100 ? last : 99) : null)

// The Chats pane's headings and the rows under each; a row in no list (Advanced mode for one project) joins Advanced.
const CHAT_GROUPS: Array<[string, string[]]> = [
  ['Chats', ['Continue at usage limit', 'Pause near the limit', 'Auto-start chats', 'Claude chat permissions', 'Ask before actions (Codex)', 'Your name', 'Hide done chats', 'Fresh branch for new chats', 'Brief for new chats']],
  ['Notices', ['Chat notices', 'Where pop-ups show', 'Push to your phone', 'Notify when a chat needs input']],
  ['Windows and phone', ['Phone mode', 'Phone alerts', 'Keep phone access in Apple Notes', 'Show agent browsers', 'One window', 'Keep Switchboard app running']],
  ['Advanced', ['Fix stuck items', 'Learn automatically', 'Stop a chat\'s dev servers when it ends', 'Test anti-copy hardening (experimental)']],
]
export function chatGroups<T extends { label: string }>(rows: T[]) {
  const known = (l: string) => CHAT_GROUPS.some(([, ls]) => ls.includes(l))
  return CHAT_GROUPS.map(([head, ls]) => [head, rows.filter(r => ls.includes(r.label) || (head === 'Advanced' && !known(r.label)))] as const).filter(([, r]) => r.length)
}
