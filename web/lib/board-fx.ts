/** Board effects: wait ropes between chats, and the usage pause freeze and thaw. */
import type { ChatLink, LimitPause } from './hub-types'
import { baseName } from './wait-links'

/** One rope per chat pair; from waits on to (the first link seen). file: an auto link's file name. */
export type Rope = { key: string; from: string; to: string; file?: string }
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export function ropesOf(links: ChatLink[] = []): Rope[] {
  const out = new Map<string, Rope>()
  for (const l of links) for (const to of l.to) {
    const key = pairKey(l.from, to)
    if (l.from !== to && !out.has(key)) out.set(key, { key, from: l.from, to, file: l.auto ? baseName(l.reason) : undefined })
  }
  return [...out.values()]
}

/** Ropes in was that now no longer has: their end flash plays once. */
export const endedRopes = (was: Rope[], now: Rope[]) => { const keep = new Set(now.map(r => r.key)); return was.filter(r => !keep.has(r.key)) }

/** Lantern, tag and full gold at zoom 1 or more, or with either chat hovered or picked. hot: chat ids. */
export const ropeAwake = (r: Rope, z: number, hot: Array<string | undefined>) => z >= 1 || hot.some(id => !!id && (id === r.from || id === r.to))

export const heldChats = (p?: LimitPause) => new Set(p?.chats.map(c => c.sessionId))

/** Awake ropes animate (lantern, sand); quiet ones need no frame loop. */
export const ropesBusy = (ropes: Rope[], z: number, hot: Array<string | undefined>) => ropes.some(r => ropeAwake(r, z, hot))

/** The banner's second line. on: the chat has a courtyard on the board; fmt: ms to a clock. */
export function pauseLine(p: LimitPause, on: (id: string) => boolean, now: number, thawing: boolean, fmt: (ms: number) => string) {
  const n = p.chats.filter(c => on(c.sessionId)).length
  const when = thawing || (p.resumeAt !== undefined && p.resumeAt <= now) ? 'resuming' : p.resumeAt ? `resumes in ${fmt(p.resumeAt - now)}` : 'resumes soon'
  return `${n} ${n === 1 ? 'chat' : 'chats'} held · ${when}`
}

/** Keeps the last pause while it thaws; thaw: when it cleared (ms). */
export type PauseFx = { pause?: LimitPause; thaw?: number }
export function nextPause(was: PauseFx, p: LimitPause | undefined, at: number): PauseFx {
  if (p) return { pause: p, thaw: undefined }
  if (was.pause && was.thaw === undefined) return { pause: was.pause, thaw: at }
  return was
}

/** Seconds for the green end flash and for the thaw. */
export const END_S = 1.6, THAW_S = 1.8

/** e: 0 frozen to 1 thawed. The ice holds while it cracks and the carp jumps, then melts; reduced motion only fades. */
export type Thaw = { ice: number; crack: number; jump: number; basket: number; banner: number; frozen: boolean }
export function thawAt(e: number, reduced: boolean): Thaw {
  const c = (x: number) => Math.min(1, Math.max(0, x))
  if (reduced) return { ice: c(1 - e), crack: 0, jump: 0, basket: 0, banner: c(1 - e), frozen: e < 0.5 }
  return {
    ice: e < 0.55 ? 1 : c(1 - (e - 0.55) / 0.4), crack: e > 0 ? c(e / 0.45) : 0, jump: c((e - 0.15) / 0.4),
    basket: c(e / 0.15), banner: e < 0.75 ? 1 : c(1 - (e - 0.75) / 0.25), frozen: e < 0.6,
  }
}
