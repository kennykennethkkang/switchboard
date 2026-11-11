/** The shell's page lives in the URL hash; the old ?board link still opens the Board. */
export const PAGES = ['now', 'chats', 'plan', 'ship', 'map-board', 'map-flow', 'map-memory', 'settings'] as const
export type Page = typeof PAGES[number]

export const isMap = (p: Page) => p.startsWith('map-')

export function pageOf(hash: string, search = ''): Page {
  const h = hash.replace(/^#/, '')
  if ((PAGES as readonly string[]).includes(h)) return h as Page
  return new URLSearchParams(search).has('board') ? 'map-board' : 'now'
}

/** The header word for a page; the three map modes share one. */
export const pageTitle = (p: Page) => isMap(p) ? 'Map' : p[0].toUpperCase() + p.slice(1)
