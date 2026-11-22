/** The stations track on a Working card (Research, Build, Gate, Review, Your call) from its roles and last test run, or its stage run's own stages; the Verified badge; Done's three groups. */
import type { ArchivedChat, ChatProgress, RepoView, RoleStep, StageRun, TestRun } from './hub-types'
import { stageView } from './stages-ui'

export type Station = 'research' | 'build' | 'gate' | 'review' | 'call'
/** back: a stage sent back; skip: passed by without running (no gate before review, say). */
export type StepState = 'done' | 'doing' | 'todo' | 'fail' | 'skip' | 'back'
export type Step = { id: string; label: string; state: StepState; title: string }
/** at: where the chat is now. round: 1 plus each send-back; back: what sent the current round back. fresh: gate ran after the last build started. stages: steps are a stage run's. */
export type Track = { steps: Step[]; at: Station; round: number; back?: 'gate' | 'review'; gate?: TestRun; fresh: boolean; stages?: true }

const ORDER: Station[] = ['research', 'build', 'gate', 'review', 'call']
export const STATION: Record<Station, string> = { research: 'Research', build: 'Build', gate: 'Gate', review: 'Review', call: 'Your call' }
const WORD: Record<StepState, string> = { done: 'done', doing: 'now', todo: 'not yet', fail: 'failed', skip: 'skipped', back: 'sent back' }

/** Helpers such as jev sit outside the track. */
export function stationOf(role: string): Station | undefined {
  const r = role.toLowerCase()
  if (/^(researcher|explore|plan)/.test(r)) return 'research'
  if (/qa|review/.test(r)) return 'review'
  if (/^(engineer|designer|ops|growth|general)/.test(r)) return 'build'
  return undefined
}

const end = (r: RoleStep) => r.at ?? r.startedAt

/** Round 2 when a build starts after a review or after a red gate that came after a build. ponytail: an engineer rerun for another reason over-counts; needs a send-back event from the hub to fix. */
function rounds(roles: RoleStep[], tests?: TestRun): { round: number; back?: 'gate' | 'review' } {
  const evs = roles.flatMap(r => { const st = stationOf(r.role); return st ? [{ at: r.startedAt, st: st as Station | 'red' }] : [] })
  if (tests && !tests.ok) evs.push({ at: tests.at, st: 'red' })
  evs.sort((a, b) => a.at - b.at)
  let round = 0, pending: 'gate' | 'review' | undefined, back: 'gate' | 'review' | undefined
  for (const e of evs) {
    if (e.st === 'build') { if (!round) round = 1; else if (pending) { round++; back = pending; pending = undefined } }
    else if (round && e.st === 'review') pending = 'review'
    else if (round && e.st === 'red') pending = 'gate'
  }
  return { round, ...(back && { back }) }
}

export function gateTitle(t: TestRun): string {
  const n = t.total !== undefined ? t.ok ? `${t.total - (t.failed ?? 0)} of ${t.total} passed` : `${t.failed ?? '?'} of ${t.total} failed` : t.ok ? 'passed' : 'failed'
  return `${t.command}: ${n}`
}

export function track(p: ChatProgress | undefined, run?: StageRun): Track {
  const roles = (p?.roles ?? []).filter(r => stationOf(r.role))
  const tests = p?.tests
  const { round, back } = rounds(roles, tests)
  const lastBuild = Math.max(0, ...roles.filter(r => stationOf(r.role) === 'build').map(r => r.startedAt))
  const fresh = !!tests && tests.at >= lastBuild
  const active = roles.filter(r => r.state === 'active').sort((a, b) => b.startedAt - a.startedAt)[0]
  const last = [...roles].sort((a, b) => end(b) - end(a))[0]
  const at: Station = p?.state === 'needs-you' || p?.state === 'done' ? 'call'
    : active ? stationOf(active.role)!
    : tests && tests.at >= (last ? end(last) : 0) ? 'gate'
    : last ? stationOf(last.role)! : 'build'
  const base = { round, ...(back && { back }), ...(tests && { gate: tests }), fresh }
  if (run?.stages.length) {
    const v = stageView(run.stages), cur = run.stages[v.at]
    const steps = run.stages.map(s => { const state: StepState = s.status === 'redo' ? 'back' : s.status; return { id: `s${s.n}`, label: s.name, state, title: `${s.n}. ${s.name}, ${s.role}: ${WORD[state]}` } })
    return { ...base, steps, at: at === 'call' ? 'call' : cur ? stationOf(cur.role) ?? at : at, stages: true }
  }
  const a = ORDER.indexOf(at)
  const seen = roles.length > 0 || !!tests
  const ran = (s: Station) => s === 'gate' ? fresh : roles.some(r => stationOf(r.role) === s)
  const steps = ORDER.map((s, i): Step => {
    let state: StepState = i < a ? ran(s) ? 'done' : seen ? 'skip' : 'todo' : i === a ? 'doing' : 'todo'
    if (s === 'gate' && tests && fresh) state = tests.ok ? 'done' : 'fail'
    const title = s === 'gate' && tests ? `Gate, ${fresh ? '' : 'before the last build, '}${gateTitle(tests)}` : `${STATION[s]}: ${s === 'call' && state === 'doing' ? 'waiting on you' : WORD[state]}`
    return { id: s, label: STATION[s], state, title }
  })
  return { ...base, steps, at }
}

export type Verify = { ok: boolean; reasons: string[]; edit: number; gate?: TestRun; review?: RoleStep }
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** Verified: a qa or review role finished after the last edit and the last gate passed after it. None until something was edited. */
export function verify(p?: ChatProgress): Verify | undefined {
  if (!p) return undefined
  const times = [...(p.tools ?? []).filter(t => EDITS.has(t.tool)).map(t => t.at), ...p.roles.filter(r => stationOf(r.role) === 'build').map(end)]
  if (!times.length) return undefined
  const edit = Math.max(...times)
  const review = p.roles.filter(r => r.state === 'done' && stationOf(r.role) === 'review' && end(r) >= edit).sort((a, b) => end(b) - end(a))[0]
  const t = p.tests
  const reasons = [
    !review && 'no review after the last edit',
    !t ? 'no gate run' : !t.ok ? `gate failed${t.failed !== undefined && t.total !== undefined ? `: ${t.failed} of ${t.total}` : ''}` : t.at < edit && 'gate ran before the last edit',
  ].filter((x): x is string => !!x)
  return { ok: !reasons.length, reasons, edit, ...(t && { gate: t }), ...(review && { review }) }
}

export type DoneKind = 'merged' | 'approved' | 'stopped'
type Repo = Pick<RepoView, 'sessionId' | 'log'> & { pr?: RepoView['pr'] }

/** merged: approved and its PR merged, or its commit's summary line is in the branch log. stopped: ended on its own, never approved. Handoffs are neither. */
export function doneKind(a: ArchivedChat, repo?: Repo): DoneKind | undefined {
  if (!a.approvedAt) return a.ended ? 'stopped' : undefined
  const subject = a.commit?.split('\n')[0].trim()
  const merged = !!repo && ((repo.sessionId === a.sessionId && repo.pr?.state === 'MERGED') || (!!subject && repo.log.some(l => l.subject === subject)))
  return merged ? 'merged' : 'approved'
}

/** done: approved today (the Now lanes' list); archive: for the chats that stopped today. */
export function doneGroups(done: ArchivedChat[], archive: ArchivedChat[], repo: Repo | undefined, now = Date.now()): Record<DoneKind, ArchivedChat[]> {
  const day = new Date(now).toDateString()
  return {
    merged: done.filter(a => doneKind(a, repo) === 'merged'),
    approved: done.filter(a => doneKind(a, repo) === 'approved'),
    stopped: archive.filter(a => doneKind(a) === 'stopped' && new Date(a.archivedAt).toDateString() === day).sort((a, b) => b.archivedAt - a.archivedAt),
  }
}
