/**
 * The quick switcher (Cmd+K): named commands, every live chat and every History version, matched by name.
 * A substring wins over letters found in order; switcher.tsx draws the result.
 */
import type { ArchivedChat, ChatProgress, ChatRow, ChatState, StuckItem } from './hub-types'
import { chatShown } from './chat-state'
import { archiveChains, projectName, splitVersion } from './archive'
import { almostDone } from './look'
import { CODER_PAGES, type Page } from './route'

export type Command = { id: string; label: string; group: 'Go to' | 'Do'; hint?: string; keywords?: string }

export type SwitchItem =
  | { kind: 'live'; id: string; name: string; version: number; state: ChatState; almost?: boolean; chip?: string; /** Working, but something in it looks stuck (chatShown). */ stuck?: true }
  | { kind: 'history'; id: string; chain: string; name: string; version: number }
  | { kind: 'command'; id: string; label: string; group: Command['group']; hint?: string; keywords?: string }

type Cards = { chat: ChatRow; progress?: ChatProgress }[]

const chatName = (chat: ChatRow) => splitVersion(chat.name).origin || projectName(chat) || chat.sessionId.slice(0, 8)

/** The indices of q's letters in name: a substring if there is one, else letters in order; null when none fit. */
/** Indices count letters (code points), the unit switcher.tsx marks by, so an emoji is one letter. */
export function matchName(name: string, q: string): number[] | null {
  const n = [...name.toLowerCase()], query = [...q.trim().toLowerCase()]
  if (!query.length) return []
  for (let at = 0; at + query.length <= n.length; at++) {
    if (query.every((ch, i) => n[at + i] === ch)) return query.map((_, i) => at + i)
  }
  const out: number[] = []
  for (let i = 0, j = 0; i < n.length && j < query.length; i++) if (n[i] === query[j]) { out.push(i); j++ }
  return out.length === query.length ? out : null
}

/** Empty-query order: Go to commands, live chats, Do commands, History. */
export function switcherItems(cards: Cards, archive: ArchivedChat[], commands: Command[] = [], stuck?: StuckItem[]): SwitchItem[] {
  const live: SwitchItem[] = cards.map(({ chat, progress }) => (
    { kind: 'live', id: chat.sessionId, name: chatName(chat), version: splitVersion(chat.name).version, state: progress?.state ?? 'idle', ...(almostDone(progress) ? { almost: true } : {}), ...(progress?.state === 'done' ? { chip: 'Ready for your OK' } : {}), ...(chatShown(progress, stuck) === 'stuck' ? { stuck: true as const } : {}) }
  ))
  const history: SwitchItem[] = archiveChains(archive).flatMap(c => c.versions.map(v => ({ kind: 'history' as const, id: v.sessionId, chain: `${c.latest.cwd}\n${c.origin}`, name: c.origin, version: v.version })))
  const cmd = (g: Command['group']): SwitchItem[] => commands.filter(c => c.group === g).map(c => ({ kind: 'command', ...c }))
  return [...cmd('Go to'), ...live, ...cmd('Do'), ...history]
}

/** The shell's command list; it maps each id to an action. simple: Simple view, without the pages it hides. */
export function defaultCommands(o: { cards: Cards; repoChanges: boolean; vscode: boolean; awake?: boolean; calls?: boolean; simple?: boolean }): Command[] {
  const go = (id: Page, label: string, keywords?: string): Command[] => o.simple && CODER_PAGES.includes(id) ? [] : [{ id: `go:${id}`, label, group: 'Go to', ...(keywords ? { keywords } : {}) }]
  const onOff = (on?: boolean) => (on ? 'On' : 'Off')
  return [
    ...go('now', 'Now', 'home today needs'),
    ...go('chats', 'Chats', 'sessions history'),
    ...go('plan', 'Plan', 'todo to-do jev'),
    ...go('live', 'Live', 'mirofish crowd ab crowd-ab simulation feed'),
    ...go('ship', 'Ship', 'git dev servers terminals ci'),
    ...go('map-board', 'Map: Agents', 'board'),
    ...go('map-flow', 'Map: Code', 'flow'),
    ...go('map-memory', 'Map: Memory', 'vault notes'),
    ...go('usage', 'Usage', 'tokens cost limits spend codex'),
    ...go('settings', 'Settings', 'gear preferences'),
    { id: 'do:new', label: 'New chat', group: 'Do', keywords: 'start' },
    { id: 'do:check-updates', label: 'Check for updates', group: 'Do', keywords: 'upgrade version' },
    { id: 'do:sign-in', label: 'Sign in', group: 'Do', keywords: 'github sync account' },
    ...(o.repoChanges ? [
      { id: 'do:commit', label: 'Commit', group: 'Do' as const, keywords: 'git message' },
      { id: 'do:push', label: 'Push: open the Git panel', group: 'Do' as const, keywords: 'git origin' },
      { id: 'do:open-diff', label: 'Open diff', group: 'Do' as const, keywords: 'changes files' },
    ] : []),
    ...o.cards.filter(c => c.progress?.state === 'done').map(({ chat }): Command => ({ id: `do:approve:${chat.sessionId}`, label: `Approve ${chatName(chat)}`, group: 'Do', keywords: 'ok done' })),
    { id: 'do:awake', label: 'Toggle Keep awake', group: 'Do', hint: onOff(o.awake), keywords: 'sleep caffeinate' },
    { id: 'do:calls', label: 'Toggle Call me', group: 'Do', hint: onOff(o.calls), keywords: 'phone bland' },
    ...(o.vscode ? [{ id: 'do:phone', label: 'Open phone link', group: 'Do' as const, keywords: 'qr mobile' }] : []),
  ]
}

/** Matching items, best first: a substring at the start, then anywhere, then loose, then a command keyword; list order on a tie. */
export function rankItems(items: SwitchItem[], q: string): { item: SwitchItem; hits: number[] }[] {
  const score = (hits: number[]) => {
    if (!hits.length) return 0
    const tight = hits[hits.length - 1] - hits[0] === hits.length - 1
    return (tight ? (hits[0] === 0 ? 0 : 1) : 2) * 1000 + hits[0]
  }
  const rank = (item: SwitchItem): { hits: number[]; s: number } | null => {
    const hits = matchName(item.kind === 'command' ? item.label : item.name, q)
    if (hits) return { hits, s: score(hits) }
    // Keyword hit: nothing to mark in the label, ranked after any label hit.
    return item.kind === 'command' && item.keywords && matchName(item.keywords, q) ? { hits: [], s: 3000 } : null
  }
  return items
    .map((item, i) => ({ item, i, r: rank(item) }))
    .filter((x): x is { item: SwitchItem; i: number; r: { hits: number[]; s: number } } => x.r !== null)
    .sort((a, b) => a.r.s - b.r.s || a.i - b.i)
    .map(({ item, r }) => ({ item, hits: r.hits }))
}
