/** The Needs attention strip's text: what a stuck item uses, its diagnosis to copy, and the card chip's tone. */
import type { StuckItem } from './hub-types'
import { formatDuration } from './duration'

// Same lines as extension/src/hub/stuck.ts STUCK.
const HOT_CPU = 80, HOT_RSS = 2 * 1024 ** 3

const size = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`)
export const forHow = (i: StuckItem, now = Date.now()) => formatDuration(now - i.since, 'stuck')

/** "CPU 97% · 1.5 GB", or '' when neither is known. */
export const usage = (i: StuckItem) => [i.cpu !== undefined && `CPU ${Math.round(i.cpu)}%`, i.rss !== undefined && size(i.rss)].filter(Boolean).join(' · ')

/** Copy diagnosis: short, plain lines to paste into a chat or an issue. */
export function diagnosis(i: StuckItem, chat: string, now = Date.now()): string {
  return [
    `Chat: ${chat}`, `Stuck: ${i.what}`, `Since: ${new Date(i.since).toTimeString().slice(0, 5)} (${forHow(i, now)})`,
    usage(i) && `Use: ${usage(i)}`, i.pid && `Process: pid ${i.pid}`, i.command && `Command: ${i.command}`, i.last && `Last tool call: ${i.last}`,
  ].filter(Boolean).join('\n')
}

/** red: something in the chat eats CPU or memory; yellow: something only went quiet. */
export function stuckTone(stuck: StuckItem[] | undefined, sessionId: string): 'red' | 'yellow' | undefined {
  const mine = (stuck ?? []).filter(i => i.sessionId === sessionId)
  if (!mine.length) return undefined
  return mine.some(i => (i.cpu ?? 0) >= HOT_CPU || (i.rss ?? 0) >= HOT_RSS) ? 'red' : 'yellow'
}
