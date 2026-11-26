/** What Ship lists and picks: repos with work first, the rest folded; each worktree under its repo. */
import type { ShipRepo, ShipTree } from './hub-types'

const under = (dir: string, cwd: string) => cwd === dir || cwd.startsWith(`${dir}/`) || cwd.startsWith(`${dir}\\`)

/** hub.repo and hub.changes carry a repo's or worktree's path here, a chat's id elsewhere. */
export const isShipId = (id: string) => /[\\/]/.test(id)

export const hasWork = (r: ShipRepo) => r.files > 0 || r.ahead > 0 || r.trees.length > 0
/** For the nav count: repos with work of their own, and worktrees. */
export const shipCount = (ship: ShipRepo[] = []) => ship.reduce((n, r) => n + (r.files > 0 || r.ahead > 0 ? 1 : 0) + r.trees.length, 0)

/** projects: the page's filter chips. */
export function shipRows(ship: ShipRepo[], projects: string[]): { ready: ShipRepo[]; clean: ShipRepo[] } {
  const all = ship.filter(r => !projects.length || projects.includes(r.name))
  return { ready: all.filter(hasWork), clean: all.filter(r => !hasWork(r)) }
}

/** The worktree (deepest) or repo a folder is in. */
export function shipOf(ship: ShipRepo[], cwd: string | undefined): { repo: ShipRepo; tree?: ShipTree } | undefined {
  if (!cwd) return undefined
  const repo = ship.filter(r => under(r.id, cwd)).sort((a, b) => b.id.length - a.id.length)[0]
  return repo && { repo, tree: repo.trees.find(t => under(t.id, cwd)) }
}

/** The shown one: the pick while it is listed (a merged worktree falls back to its repo), else the open chat's repo when it has work, else the first with work. */
export function shipPick(ship: ShipRepo[], rows: { ready: ShipRepo[]; clean: ShipRepo[] }, picked?: string, chatCwd?: string): { repo: ShipRepo; tree?: ShipTree } | undefined {
  const shown = (p?: { repo: ShipRepo; tree?: ShipTree }) => (p && (rows.ready.includes(p.repo) || rows.clean.includes(p.repo)) ? p : undefined)
  const own = shown(shipOf(ship, chatCwd))
  const first = rows.ready[0] ?? rows.clean[0]
  return shown(shipOf(ship, picked)) ?? (own && hasWork(own.repo) ? { repo: own.repo } : first && { repo: first })
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
/** "3 files · 2 to push" */
export const repoLine = (r: ShipRepo) => [r.files ? plural(r.files, 'file') : '', r.ahead ? `${r.ahead} to push` : ''].filter(Boolean).join(' · ') || (r.trees.length ? 'Worktrees only' : 'Nothing to ship')

export type TreeState = { text: string; tone?: 'blue' | 'green'; can: 'merge' | 'queue' | 'no' }
export function treeState(t: ShipTree, merging?: boolean): TreeState {
  if (t.queued) return { text: t.live ? 'Merges when chat ends' : 'Merging next', tone: 'blue', can: 'no' }
  if (t.live) return { text: 'Chat running', tone: 'blue', can: 'queue' }
  if (merging) return { text: 'Waiting on a merge', can: 'no' }
  if (!t.files && !t.commits) return { text: 'Nothing to merge', can: 'no' }
  return { text: 'Ready to merge', tone: 'green', can: 'merge' }
}
export const treeLine = (t: ShipTree) => [t.files ? plural(t.files, 'file') : '', t.commits ? plural(t.commits, 'commit') : ''].filter(Boolean).join(' · ') || 'No changes'
