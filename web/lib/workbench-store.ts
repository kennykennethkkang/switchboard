// The Workbench store: hub.adjust live, sample data in the demo. Live actions are hub commands; the demo plays them.
import { useSyncExternalStore } from 'react'
import type { HubState } from './hub-types'
import { postCommand } from './hub-remote'
import { vscodeBridge, type HubCommand } from './vscode-bridge'
import { DEMO_DEVICE, DEVICE_LINE, seedChanges, seedSuggestions } from './workbench-demo'
import type { ActionState, Change, SuggestedChanges } from './workbench'

type Adjust = NonNullable<HubState['adjust']>
type St = Adjust & {
  ready: boolean
  /** A listed project: hub-new-chat needs one even for the Workbench folder. */
  path?: string
  /** Apply pressed, no record yet: when. */
  starting: Record<string, number>
  skipped: Record<string, true>
  undoing: Record<string, number>
  sel?: string
  note?: string
}
const EMPTY: St = { device: '', changes: [], suggestions: [], ready: false, starting: {}, skipped: {}, undoing: {} }
let st = EMPTY
let demo = false
const subs = new Set<() => void>()
const set = (p: Partial<St>) => { st = { ...st, ...p }; subs.forEach(fn => fn()) }
export const useWorkbench = () => useSyncExternalStore(fn => { subs.add(fn); return () => { subs.delete(fn) } }, () => st, () => EMPTY)

// Report ids hold a slash, keys never hold a #.
export const idOf = (report: string, key: string) => `${report}#${key}`
export const partsOf = (id: string): [string, string] => [id.slice(0, id.lastIndexOf('#')), id.slice(id.lastIndexOf('#') + 1)]

// An Apply whose chat never logged anything stops showing as starting after this.
export const START_MS = 10 * 60_000
// Past the hub's own 150 s limit on an undo.
const UNDO_MS = 160_000
/** The starting marks still worth showing: not timed out, and the hub has not caught up. Pure. */
export function stillStarting(starting: Record<string, number>, suggestions: SuggestedChanges[], now: number): Record<string, number> {
  const state = new Map(suggestions.flatMap(s => s.actions.map(a => [idOf(s.report, a.key), a.state] as const)))
  return Object.fromEntries(Object.entries(starting).filter(([id, at]) => now - at < START_MS && state.get(id) !== 'open' && state.get(id) !== 'applied'))
}

/** New hub state in; undefined in the demo. */
export function feedWorkbench(adjust: Adjust | undefined, path?: string): void {
  if (!adjust) {
    if (!demo) { demo = true; reset() }
    return
  }
  demo = false
  set({ ...adjust, said: adjust.said, path, ready: true, starting: stillStarting(st.starting, adjust.suggestions, Date.now()), undoing: {} })
}

/** Inside the editor the bridge sends; in the browser app the hub's /hub/command takes it. */
const command = (c: HubCommand) => { if (vscodeBridge?.isVSCode) vscodeBridge.sendHub(c); else void postCommand(c) }

export const select = (id: string) => set({ sel: id })
export const reset = () => { const now = Date.now(); set({ ...EMPTY, device: DEVICE_LINE, changes: seedChanges(now), suggestions: seedSuggestions(now), ready: true, sel: idOf('r4', 'cache-zsh-completions') }) }
export const isSample = () => demo
export const clearNote = () => set({ note: undefined })

const setState = (report: string, key: string, state: ActionState) =>
  set({ suggestions: st.suggestions.map(s => s.report !== report ? s : { ...s, actions: s.actions.map(a => a.key === key ? { ...a, state } : a) }) })

export function apply(report: string, keys: string[]) {
  if (!keys.length) return
  if (!demo) {
    const now = Date.now()
    set({ starting: { ...st.starting, ...Object.fromEntries(keys.map(k => [idOf(report, k), now])) }, note: 'A chat is starting on it. The change shows in the log as it works.' })
    command({ type: 'hub-adjust-apply', report, keys })
    return
  }
  for (const key of keys) {
    const s = st.suggestions.find(x => x.report === report)
    const a = s?.actions.find(x => x.key === key)
    if (!s || !a || !['new', 'undone', 'failed'].includes(a.state)) continue
    const now = Date.now()
    const id = `demo-${now}-${key.slice(0, 24)}`
    const c: Change = {
      id, title: a.title, why: s.question, area: a.area === 'project' ? 'dev' : a.area, target: a.detail.match(/~\/[\w./-]+/)?.[0] ?? 'this Mac', device: DEMO_DEVICE, status: 'open', at: now,
      report, action: key, chat: `Workbench: ${a.title}`, sessionId: `demo-wb-${id}`, undo: a.undo,
      noUndo: a.ask ? 'This cannot be undone. You were asked first.' : undefined,
      files: a.undo?.startsWith('cp ') ? [{ path: a.undo.split(' ')[2], backup: 'files/0', before: 'a1f3', after: 'c9d2' }] : [],
    }
    set({ changes: [c, ...st.changes] })
    setState(report, key, 'open')
    // A project action starts a chat in that repo and stays open; the rest finish after a moment.
    if (a.area === 'project') continue
    setTimeout(() => {
      set({ changes: st.changes.map(x => x.id === id ? { ...x, status: 'applied', doneAt: Date.now(), check: { cmd: 'sh -c check', ok: true, out: 'ok' } } : x) })
      setState(report, key, 'applied')
    }, 1100)
  }
}

export function skip(report: string, key: string) {
  set({ skipped: { ...st.skipped, [idOf(report, key)]: true } })
  if (!demo) command({ type: 'hub-adjust-skip', report, key })
}

export function undo(id: string, force?: boolean) {
  const c = st.changes.find(x => x.id === id)
  if (!c) return
  if (!demo) {
    set({ undoing: { ...st.undoing, [id]: Date.now() } })
    command({ type: 'hub-adjust-undo', id, ...(force ? { force } : {}) })
    // The hub answers with new state; a lost command must not leave it saying Undoing.
    setTimeout(() => { const { [id]: _, ...rest } = st.undoing; set({ undoing: rest }) }, UNDO_MS)
    return
  }
  set({ changes: st.changes.map(x => x.id === id ? { ...x, status: 'undone', undoneAt: Date.now() } : x) })
  if (c.report && c.action) setState(c.report, c.action, 'undone')
}

/** Starts a Workbench chat on typed text. */
export function start(text: string) {
  const t = text.trim()
  if (!t) return
  const note = 'Workbench chat started. Its changes land in the log as it works.'
  if (!demo) {
    if (!st.path) return set({ note: 'Open a project in Switchboard first.' })
    command({ type: 'hub-new-chat', path: st.path, text: t, remote: false, research: true, workbench: true })
    return set({ note })
  }
  const now = Date.now()
  const title = t.length > 60 ? `${t.slice(0, 57)}...` : t[0].toUpperCase() + t.slice(1)
  set({ changes: [{ id: `${now}-ask`, title, why: 'Asked in Workbench.', area: 'mac', target: 'this Mac', device: DEMO_DEVICE, status: 'open', at: now, chat: `Workbench: ${t.slice(0, 30)}`, sessionId: 'demo-wb-ask', files: [] }, ...st.changes], note })
}

/** Actions a report still offers (skipped ones left out). */
export const actionsOf = (s: Pick<St, 'suggestions' | 'skipped'>, report: string) => s.suggestions.find(x => x.report === report)?.actions.filter(a => !s.skipped[idOf(report, a.key)]) ?? []
export const pending = (s: Pick<St, 'suggestions' | 'skipped'>) => s.suggestions.flatMap(x => x.actions.filter(a => a.state === 'new' && !s.skipped[idOf(x.report, a.key)]).map(a => ({ s: x, a })))
