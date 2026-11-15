// Advanced mode and smart model switch, as the page shows them.
import type { Escalation, HubState, Stage, StageRun } from './hub-types'
type StageStatus = Stage['status']

const base = (f: string) => f.slice(f.replace(/[\\/]+$/, '').search(/[^\\/]*[\\/]*$/)).replace(/[\\/]+$/, '')

/** One line in a role's row: "qa raised to opus on board.tsx after 3 redesign rounds". */
export function raiseLine(r: Escalation): string {
  const on = r.files.length ? ` on ${base(r.files[0])}${r.files.length > 1 ? ` and ${r.files.length - 1} more` : ''}` : ''
  return `${r.role} raised to ${r.to}${on}${r.reason ? ` ${r.reason}` : ''}`
}

/** The project's newest raise per role; the map is keyed by project path or name, so either finds it. */
export function raisesFor(hub: Pick<HubState, 'escalations'>, folder?: string): Record<string, Escalation> {
  if (!folder) return {}
  const name = base(folder)
  const rows = Object.entries(hub.escalations ?? {}).filter(([k]) => k === folder || base(k) === name).flatMap(([, v]) => v)
  const out: Record<string, Escalation> = {}
  for (const r of rows) if (!out[r.role] || r.at > out[r.role].at) out[r.role] = r
  return out
}

/** Advanced mode rows: every project when there are several, else just this one. */
export function advancedRows(hub: Pick<HubState, 'projects' | 'controls'>, folder?: string): { path: string; name: string; on: boolean }[] {
  const on = hub.controls.switchboard.advancedMode ?? {}
  const paths = hub.projects.length > 1 ? hub.projects.map(p => p.path) : folder ? [folder] : hub.projects.map(p => p.path)
  return paths.map(path => ({ path, name: hub.projects.find(p => p.path === path)?.name ?? base(path), on: on[path] === true }))
}

/** A chat's newest stage run, only while its project has Advanced mode on. */
export function chatRun(hub: Pick<HubState, 'stages' | 'controls'>, sessionId: string): { path: string; run: StageRun } | undefined {
  const on = hub.controls.switchboard.advancedMode ?? {}
  let best: { path: string; run: StageRun } | undefined
  for (const [path, runs] of Object.entries(hub.stages ?? {})) {
    if (on[path] !== true) continue
    for (const run of runs) if (run.sessionId === sessionId && run.stages.length && (!best || run.at > best.run.at)) best = { path, run }
  }
  return best
}

export type StageView = { quiet: boolean; at: number; done: number; total: number; line: string; gate: number }

/**
 * at: the stage to point at (sent back first, then running, then the next to do; -1 when all done).
 * quiet: nothing runs and nothing waits on a redo, so the line drops its color.
 * gate: a finished stage waiting on Looks good or Redo before the next one starts, else -1.
 */
export function stageView(stages: Stage[]): StageView {
  const total = stages.length, done = stages.filter(s => s.status === 'done').length
  const find = (st: StageStatus) => stages.findIndex(s => s.status === st)
  const redo = find('redo'), doing = find('doing')
  const at = redo >= 0 ? redo : doing >= 0 ? doing : find('todo')
  const quiet = redo < 0 && doing < 0
  const gate = quiet && at > 0 && stages[at - 1].status === 'done' ? at - 1 : -1
  if (!total) return { quiet: true, at: -1, done: 0, total: 0, line: '', gate }
  if (at < 0) return { quiet, at, done, total, line: `All ${total} stages done`, gate }
  const s = stages[at]
  const what = redo >= 0 ? 'sent back' : doing >= 0 ? 'running' : gate >= 0 ? 'waiting on your review' : 'next'
  return { quiet, at, done, total, line: `Stage ${at + 1} of ${total} ${what}: ${s.name}, ${s.role}`, gate }
}
