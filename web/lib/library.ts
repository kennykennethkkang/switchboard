// Library keys are absolute paths (~/.claude/switchboard/design-md/<brand>/DESIGN.md); project ones are relative.
export const isLib = (k: string) => /^([/\\]|[A-Za-z]:)/.test(k)
export const brand = (k: string) => k.split(/[/\\]/).slice(-2)[0]

/** Library keys matching the search, on ones first, then by brand. */
export function libraryLooks(map: Record<string, boolean>, query: string): string[] {
  const q = query.trim().toLowerCase()
  return Object.keys(map).filter(k => isLib(k) && brand(k).toLowerCase().includes(q))
    .sort((a, b) => Number(map[b]) - Number(map[a]) || brand(a).localeCompare(brand(b)))
}

export type LibraryOrder = { q: string; keys: string[] }

/** The shown order, kept while only on/off changes, so a pressed chip stays put; sorted again on a new search or a changed set of looks. */
export function libraryOrder(prev: LibraryOrder | undefined, map: Record<string, boolean>, query: string): LibraryOrder {
  const keys = libraryLooks(map, query)
  const same = prev && prev.q === query && prev.keys.length === keys.length && keys.every(k => prev.keys.includes(k))
  return same ? prev : { q: query, keys }
}
