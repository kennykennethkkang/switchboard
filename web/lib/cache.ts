import type { CacheKeep } from './hub-types'

/** The chat card's cache chip: "cache warm 42 min" or "cache cold"; nothing once cache-keeper is off for the chat. */
export function cacheChip(all: CacheKeep[] | undefined, sessionId: string, now: number): { label: string; title: string } | undefined {
  const c = all?.find(x => x.sessionId === sessionId)
  if (!c || c.state === 'off') return undefined
  const size = `${Math.round(c.tokens / 1000)}k tokens`
  if (c.state === 'cold' || c.warmUntil <= now) return { label: 'cache cold', title: `Prompt cache expired: the next prompt re-reads ${size}` }
  const pings = c.pings ? `, ${c.pings} keep-alive ping${c.pings === 1 ? '' : 's'} sent` : ''
  return { label: `cache warm ${Math.max(1, Math.round((c.warmUntil - now) / 60_000))} min`, title: `Prompt cache of ${size} stays warm for now${pings}` }
}
