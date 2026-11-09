import type { HubState } from './hub-types'

/** next, with prev's object for every top-level field that did not change, so memos keyed on hub.todos and the rest
 * hold across ticks; prev itself when nothing changed. A fresh 370 KB state mostly differs only in progress. */
export function keepSame(prev: HubState | null, next: HubState): HubState {
  if (!prev) return next
  const p = prev as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  let same = Object.keys(p).length === Object.keys(next).length
  for (const [k, v] of Object.entries(next)) {
    const old = p[k]
    const keep = old === v || (k in p && JSON.stringify(old) === JSON.stringify(v))
    out[k] = keep ? old : v
    if (!keep) same = false
  }
  return same ? prev : (out as unknown as HubState)
}
