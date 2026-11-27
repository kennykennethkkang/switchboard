/** The shell's page lives in the URL hash; the old ?board link still opens the Board. */
export const PAGES = ['now', 'chats', 'plan', 'live', 'ship', 'map-board', 'map-flow', 'map-memory', 'settings', 'research', 'workbench', 'usage'] as const
export type Page = typeof PAGES[number]

/** Simple view leaves these out; a link to one shows Home instead. */
export const CODER_PAGES: Page[] = ['live', 'ship', 'map-board', 'map-flow', 'map-memory']

export const isMap = (p: Page) => p.startsWith('map-')

export function pageOf(hash: string, search = ''): Page {
  const h = hash.replace(/^#/, '')
  if ((PAGES as readonly string[]).includes(h)) return h as Page
  return new URLSearchParams(search).has('board') ? 'map-board' : 'now'
}

/** The header word for a page; the three map modes share one. */
export const pageTitle = (p: Page) => isMap(p) ? 'Map' : p[0].toUpperCase() + p.slice(1)

/** One line under the header title: what the page is for. */
export const pageBlurb = (p: Page) => isMap(p) ? 'How chats, code and memory connect.' : ({
  now: 'What needs you, what is running, what just finished.',
  chats: 'Every chat across your projects, with its status and changes.',
  plan: 'The shared to-do: work saved for later chats.',
  live: 'Crowd tests, MiroFish sims and source checks: running now and their results.',
  ship: 'Pick a repo or worktree to commit, push or merge, chat or no chat.',
  settings: 'Sign-ins, limits, updates and how Switchboard behaves.',
  research: 'Finished research reports, newest first.',
  workbench: 'Research turned into changes on this Mac, with a log and Undo.',
  usage: 'What Claude and Codex used, what it would cost, and how much of each plan is left.',
} as Record<string, string>)[p] ?? ''
