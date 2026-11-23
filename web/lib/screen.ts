/**
 * The chat view's Screen tab: a chat's terminal as extension/src/hub/screen.ts serves it (same shape), the keys
 * it may be sent, and a poll that runs once a second while the tab is on screen. The app reads it over /hub/chat/*,
 * the VS Code panel through chat-get (read only there: the real terminal is beside it).
 */
import { downReason } from './hub-remote'
import { vscodeBridge } from './vscode-bridge'

/** typing: this Mac's setting is on and a command runs. */
export type Screen = { cols: number; rows: number; text: string; ansi?: string; running: boolean; at: number; typing: boolean }
export type ScreenKey = 'enter' | 'esc' | 'up' | 'down' | 'left' | 'right' | 'tab' | 'ctrl-c'
export type ScreenInput = { text: string } | { key: ScreenKey }
/** The key row under the screen, in order: [button label, spoken name]. */
export const KEY_LABELS: Record<ScreenKey, [string, string]> = {
  esc: ['Esc', 'Escape'], tab: ['Tab', 'Tab'], up: ['↑', 'Arrow up'], down: ['↓', 'Arrow down'], left: ['←', 'Arrow left'], right: ['→', 'Arrow right'], enter: ['Enter', 'Enter'], 'ctrl-c': ['Ctrl-C', 'Control C'],
}
/** Phones get the screen fit to their width; everything else draws it at full size and scrolls inside its box. */
export const PHONE_SCREEN = '(pointer: coarse), (max-width: 599px)'
/** Scale for a terminal drawn at 12px to fit room: never under 11px so it stays readable (the box scrolls past that), never over 14px. */
export const fitScale = (room: number, width: number) => Math.min(14 / 12, Math.max(11 / 12, room / width))

// Box drawing (frames and rules). Claude Code's tree mark, spinners and block bars sit outside this range.
const BOX = /[\u2500-\u257f]/

/** The screen for the Text view and screen readers: box drawing dropped (a framed line loses its indent too), wide
 *  gaps closed to two spaces, blank runs to one. Every word stays; Copy keeps the raw screen. */
export const readable = (text: string) => text.split('\n')
  .map(l => {
    const t = BOX.test(l) ? l.replace(new RegExp(BOX, 'g'), ' ').trim() : l.trimEnd()
    const lead = /^ */.exec(t)![0]
    return lead + t.slice(lead.length).replace(/ {3,}/g, '  ')
  })
  .join('\n').replace(/^\n+|\n+$/g, '').replace(/\n{3,}/g, '\n\n')

/** null: no screen for this chat on this Mac. A string: why it could not be read. */
export async function loadScreen(session: string, f: typeof fetch = fetch): Promise<Screen | null | string> {
  if (vscodeBridge?.isVSCode) return vscodeBridge.chat(session, 'screen').then(a => a.problem ?? a.screen ?? null)
  try {
    const r = await f(`/hub/chat/screen?${new URLSearchParams({ session, ansi: '1' })}`, { headers: { 'X-Switchboard': '1' }, cache: 'no-store' })
    return r.ok ? ((await r.json()) as Screen) : r.status === 404 ? null : downReason(r.status)
  } catch {
    return downReason(undefined)
  }
}

/** undefined once sent; else why not, in the Mac's own words when it refused. */
export async function sendKeys(session: string, input: ScreenInput, f: typeof fetch = fetch): Promise<string | undefined> {
  try {
    const r = await f('/hub/chat/keys', { method: 'POST', headers: { 'X-Switchboard': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ session, ...input }), cache: 'no-store' })
    return r.ok ? undefined : (await r.text()) || downReason(r.status)
  } catch {
    return downReason(undefined)
  }
}

type Timers = { set: (f: () => void, ms: number) => unknown; clear: (h: unknown) => void }
const MAX_WAIT = 15_000

/** Polls load every `every` ms while visible; no screen or an error doubles the wait up to 15 s, a screen resets it. Returns stop. */
export function pollScreen(o: { load: () => Promise<Screen | null | string>; onScreen: (r: Screen | null | string) => void; visible?: () => boolean; every?: number; timers?: Timers }): () => void {
  const every = o.every ?? 1000
  const timers = o.timers ?? { set: (f, ms) => setTimeout(f, ms), clear: h => clearTimeout(h as ReturnType<typeof setTimeout>) }
  let stopped = false, wait = every, handle: unknown
  const tick = async () => {
    if (stopped) return
    if (o.visible && !o.visible()) { handle = timers.set(() => void tick(), every); return }
    const r = await o.load()
    if (stopped) return
    o.onScreen(r)
    wait = typeof r === 'object' && r !== null ? every : Math.min(wait * 2, MAX_WAIT)
    handle = timers.set(() => void tick(), wait)
  }
  void tick()
  return () => { stopped = true; timers.clear(handle) }
}
