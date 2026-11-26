import { useSyncExternalStore } from 'react'
import type { HubState } from '@/lib/hub-types'
import { postCommand } from '@/lib/hub-remote'
import { demoResearchBody } from '@/lib/hub-demo'
import { vscodeBridge, type HubCommand } from '@/lib/vscode-bridge'

export type ResearchItem = NonNullable<HubState['research']>[number]
export type Folders = NonNullable<HubState['researchFolders']>

export type St = { items: ResearchItem[]; folders?: Folders; sel?: string; seen: Record<string, true>; toast?: string; filter: string; ready: boolean; note?: string; drag?: string; /** The open folder: its name, UNFILED, or ALL. */ at: string }
export const ALL = '__all'
export const UNFILED = '__unfiled'
const EMPTY: St = { items: [], seen: {}, filter: 'all', ready: false, at: ALL }
export let st = EMPTY
const subs = new Set<() => void>()
export const set = (p: Partial<St>) => { st = { ...st, ...p }; subs.forEach(f => f()); settle() }
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
export const useLib = () => useSyncExternalStore(sub, () => st, () => EMPTY)

/** A report is new again when Ask more adds to it, so seen and announced are keyed by id and the last add. */
export const keyOf = (r: ResearchItem) => `${r.id}:${r.added?.at ?? 0}`
export const unseen = (s: St, r: ResearchItem) => !r.seen && !s.seen[keyOf(r)]

let sender: ((c: HubCommand) => void) | undefined
export const setSender = (f?: (c: HubCommand) => void) => { sender = f }
/** Inside the editor the bridge sends; the demo and the hub's page use the hook's send, else /hub/command takes it. */
export const command = (c: HubCommand) => { if (vscodeBridge?.isVSCode) vscodeBridge.sendHub(c); else if (sender) sender(c); else void postCommand(c) }
export const loadBody = (id: string): Promise<string> => vscodeBridge?.researchRead(id) ?? Promise.resolve(demoResearchBody(id) ?? '')

export const pick = (id: string) => {
  const r = st.items.find(x => x.id === id)
  if (r && unseen(st, r)) command({ type: 'hub-research-seen', id })
  set({ sel: id, seen: r ? { ...st.seen, [keyOf(r)]: true } : st.seen, toast: st.toast === id ? undefined : st.toast })
}

let noteTimer: ReturnType<typeof setTimeout> | undefined
/** A short status line the pages announce; clears itself. */
export const tell = (note: string) => {
  set({ note })
  clearTimeout(noteTimer)
  noteTimer = setTimeout(() => set({ note: undefined }), 6000)
}

export const names = (s: St) => s.folders?.names ?? []
export const folderOf = (s: St, r: ResearchItem) => (r.folder && names(s).includes(r.folder) ? r.folder : undefined)
export const inFolder = (s: St, f: string | undefined) => s.items.filter(r => folderOf(s, r) === f)

/** A note that waits for the new state before it claims anything. */
let pending: { text: string; ok: (s: St) => boolean; timer: ReturnType<typeof setTimeout> } | undefined
const claim = (text: string, ok: (s: St) => boolean) => {
  clearTimeout(pending?.timer)
  pending = { text, ok, timer: setTimeout(() => { pending = undefined; tell('That did not go through. Try again.') }, 5000) }
}
function settle() {
  if (!pending || !pending.ok(st)) return
  clearTimeout(pending.timer)
  const text = pending.text
  pending = undefined
  tell(text)
}

export const ask = (id: string, text: string) => {
  const q = text.trim(), sent = Date.now()
  command({ type: 'hub-research-ask', id, text: q })
  claim('Asked. The answer will be added to this report.', s => { const r = s.items.find(x => x.id === id); return !!r && (!!r.asks?.some(a => a.question === q) || (r.added?.at ?? 0) >= sent) })
}
/** Same rule as the extension: case does not make a new name, and the page's own two are kept. */
export const nameTaken = (name: string, initial = '') => {
  const n = name.trim().toLowerCase()
  return n !== initial.toLowerCase() && [...names(st), 'Unfiled', 'All reports'].some(x => x.toLowerCase() === n)
}
export const addFolder = (name: string) => {
  const n = name.trim()
  if (!n || nameTaken(n)) return
  command({ type: 'hub-research-folder', op: 'add', name: n })
  claim(`Made folder ${n}.`, s => names(s).includes(n))
}
export const renameFolder = (name: string, to: string) => {
  const n = to.trim()
  if (!n || n === name || nameTaken(n, name)) return
  if (st.at === name) set({ at: n })
  command({ type: 'hub-research-folder', op: 'rename', name, to: n })
  claim(`Renamed to ${n}.`, s => names(s).includes(n))
}
export const deleteFolder = (name: string) => {
  const n = inFolder(st, name).length
  command({ type: 'hub-research-folder', op: 'delete', name })
  claim(n ? `Deleted ${name}. ${n} ${n === 1 ? 'report is' : 'reports are'} now in Unfiled.` : `Deleted ${name}.`, s => !names(s).includes(name))
}
export const move = (ids: string[], folder?: string) => {
  command({ type: 'hub-research-move', ids, folder })
  claim(`Moved ${ids.length === 1 ? '1 report' : `${ids.length} reports`} to ${folder ?? 'Unfiled'}.`, s => ids.every(id => { const r = s.items.find(x => x.id === id); return !r || folderOf(s, r) === folder }))
}
export const organize = (op: 'run' | 'all' | 'undo' | 'auto-on' | 'auto-off') => command({ type: 'hub-research-organize', op })

export const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p
export const hueOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
export const when = (at: number) => {
  const m = Math.round((Date.now() - at) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 24 * 60) return `${Math.round(m / 60)} h ago`
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
export const addedLine = (a: NonNullable<ResearchItem['added']>) => `Added to ${a.n === 1 ? 'once' : `${a.n} times`}, ${when(a.at)}`

/** The reports the project filter lets through. */
export const filtered = (s: St) => s.items.filter(r => s.filter === 'all' || (s.filter === 'general' ? !r.project : r.project === s.filter))
export const projectsOf = (s: St) => [...new Set(s.items.map(r => r.project).filter((p): p is string => !!p))]

export const announced = new Set<string>()
