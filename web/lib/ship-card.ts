/** The finished chat's git card, from RepoView and the chat's test run alone. */
import type { LaneCommit, RepoView, TestRun } from './hub-types'

// routes.ts MAX_PATHS: the hub refuses a longer file list.
const MAX_PATHS = 1000
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export type ShipAction =
  | { kind: 'pull' | 'merge'; label: string; note: string }
  | { kind: 'ship' | 'push'; label: string; files: string[]; kept: string[] }
  | { kind: 'none'; label: string }

/** What the card's main button does, in the server's order: Pull first, Merge main first, commit and push, push alone.
 *  The file split is git.ts shipFiles, sent as r.ship; an extension too old to send it gets no button. */
export function shipAction(r: RepoView): ShipAction {
  if (!r.branch) return { kind: 'none', label: 'Not on a branch' }
  if (r.behind) return { kind: 'pull', label: 'Pull first', note: `${r.upstream} has ${plural(r.behind, 'new commit')}` }
  const m = r.merge
  if (m?.files && m.base !== r.branch) return { kind: 'merge', label: `Merge ${m.base} first`, note: `${plural(m.files, 'file')} would conflict with ${m.base}` }
  if (!r.ship) return { kind: 'none', label: 'Update Switchboard to ship from here' }
  const { files, kept } = r.ship
  if (files.length > MAX_PATHS) return { kind: 'none', label: `More than ${MAX_PATHS} files changed: commit these from a terminal` }
  if (files.length) return { kind: 'ship', label: 'Commit & push', files, kept }
  if (!r.upstream) return { kind: 'push', label: `Publish ${r.branch}`, files, kept }
  if (r.ahead) return { kind: 'push', label: `Push ${r.ahead}`, files, kept }
  return { kind: 'none', label: 'Nothing to push' }
}

/** The chat's message as git takes it: the first line, then the body with no attribution trailers. */
export function splitMessage(text: string): { summary: string; description: string } {
  const [first = '', ...rest] = text.split('\n')
  const description = rest.filter(l => !/^\s*(co-authored-by|claude-session):/i.test(l)).join('\n').trim()
  return { summary: first.trim(), description }
}

/** Two messages as one, like the extension's mergeCommit: add's summary on top, its lines, old's summary as a bullet, then the old lines it lacks. */
export function mergeMessage(old: string, add: string): string {
  const body = (m: string) => m.split('\n').slice(1).map(l => l.trimEnd()).filter(l => l.trim())
  const summary = add.split('\n')[0].trim(), was = old.split('\n')[0].trim()
  const lines = body(add)
  const have = new Set([summary, ...lines.map(l => l.trim())])
  const keep = (l: string) => { if (!have.has(l.trim())) { lines.push(l); have.add(l.trim()) } }
  if (was && !have.has(was)) keep(`- ${was}`)
  for (const l of body(old)) keep(l)
  return lines.length ? `${summary}\n\n${lines.join('\n')}` : summary
}

export type Check = { name: string; ok: boolean; detail?: string }

/** The newest test run, and types and lint when its command ran them too.
 *  shortcut: a run that only linted is not caught (isTestCommand needs a test runner); add a lint hook if that matters. */
export function checks(t: TestRun | undefined): Check[] {
  if (!t) return []
  const detail = t.failed ? `${t.failed}${t.total ? ` of ${t.total}` : ''} failed` : t.total ? `${t.total} passed` : undefined
  const out: Check[] = [{ name: 'Tests', ok: t.ok, ...(detail ? { detail } : {}) }]
  if (/\b(tsc|lint|eslint|typecheck)\b/.test(t.command)) out.push({ name: 'Types and lint', ok: t.ok })
  return out
}

/** One row per dot, newest first: lane 0 is HEAD's, lane 1 the base's; the fork closes both. */
export function laneRows(l: RepoView['lanes']): { commit: LaneCommit; lane: 0 | 1 }[] {
  if (!l) return []
  const rows = l.commits.map(commit => ({ commit, lane: commit.side === 'base' ? 1 as const : 0 as const }))
  return l.fork ? [...rows, { commit: l.fork, lane: 0 }] : rows
}
