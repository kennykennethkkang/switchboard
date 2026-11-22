import { test } from 'node:test'
import assert from 'node:assert/strict'
import { doneGroups, doneKind, stationOf, track, verify } from './stations'
import type { ArchivedChat, ChatProgress, RoleStep, StageRun, TestRun } from './hub-types'

const M = 60e3
const role = (id: string, r: string, start: number, end?: number): RoleStep => ({ id, role: r, state: end === undefined ? 'active' : 'done', startedAt: start * M, ...(end !== undefined && { at: end * M }) })
const prog = (roles: RoleStep[], extra: Partial<ChatProgress> = {}): ChatProgress => ({ sessionId: 's', cwd: '/x', state: 'working', roles, tasks: [], startedAt: 0, at: 100 * M, ...extra })
const states = (p: ChatProgress, run?: StageRun) => track(p, run).steps.map(s => `${s.id}:${s.state}`).join(' ')

test('stationOf: roles map to stations, helpers sit outside', () => {
  assert.equal(stationOf('researcher'), 'research')
  assert.equal(stationOf('Explore'), 'research')
  assert.equal(stationOf('engineer-codex'), 'build')
  assert.equal(stationOf('designer'), 'build')
  assert.equal(stationOf('qa-codex'), 'review')
  assert.equal(stationOf('security-reviewer'), 'review')
  assert.equal(stationOf('jev'), undefined)
})

test('track: research done, build running, the rest ahead', () => {
  const p = prog([role('r1', 'researcher', 1, 5), role('e1', 'engineer', 6)])
  assert.equal(states(p), 'research:done build:doing gate:todo review:todo call:todo')
  assert.equal(track(p).at, 'build')
  assert.equal(track(p).round, 1)
})

test('track: a red gate after the build stops at the gate; a rebuild makes it round 2, sent back by the gate', () => {
  const red: TestRun = { command: 'pnpm test', ok: false, at: 20 * M, failed: 2, total: 538 }
  const p = prog([role('e1', 'engineer', 5, 15)], { tests: red })
  assert.equal(states(p), 'research:skip build:done gate:fail review:todo call:todo')
  assert.equal(track(p).at, 'gate')
  const again = prog([role('e1', 'engineer', 5, 15), role('e2', 'engineer', 25)], { tests: red })
  const t = track(again)
  assert.deepEqual([t.at, t.round, t.back, t.fresh], ['build', 2, 'gate', false])
  assert.equal(states(again), 'research:skip build:doing gate:todo review:todo call:todo')
})

test('track: qa then engineer again is round 2 from review; parallel engineers are one round', () => {
  const p = prog([role('e1', 'engineer', 1, 10), role('e2', 'engineer', 2, 9), role('q1', 'qa', 11, 14), role('e3', 'engineer', 15)])
  const t = track(p)
  assert.deepEqual([t.round, t.back, t.at], [2, 'review', 'build'])
  assert.equal(track(prog([role('e1', 'engineer', 1), role('e2', 'engineer', 2), role('e3', 'engineer', 3)])).round, 1)
})

test('track: a gate before any build does not count as a send-back', () => {
  const t = track(prog([role('e1', 'engineer', 30)], { tests: { command: 'x', ok: false, at: 10 * M } }))
  assert.deepEqual([t.round, t.back], [1, undefined])
})

test('track: a green gate then qa running; a chat waiting on you sits at Your call', () => {
  const ok: TestRun = { command: 'pnpm test', ok: true, at: 20 * M, total: 538 }
  const p = prog([role('e1', 'engineer', 5, 15), role('q1', 'qa', 21)], { tests: ok })
  assert.equal(states(p), 'research:skip build:done gate:done review:doing call:todo')
  assert.equal(track({ ...p, state: 'needs-you' }).at, 'call')
  assert.equal(states({ ...p, state: 'needs-you' }), 'research:skip build:done gate:done review:done call:doing')
})

test('track: the lead alone is at Build; no roles and no gate', () => {
  assert.equal(states(prog([])), 'research:todo build:doing gate:todo review:todo call:todo')
})

test('track: a stage run gives its own stages, named, with redo as sent back', () => {
  const run: StageRun = { run: 'r', at: 1, stages: [{ n: 1, name: 'Plan', role: 'researcher', status: 'done' }, { n: 2, name: 'Picker screens', role: 'designer', status: 'redo' }, { n: 3, name: 'Wire up', role: 'engineer', status: 'todo' }] }
  const t = track(prog([]), run)
  assert.equal(t.steps.map(s => `${s.label}:${s.state}`).join(' '), 'Plan:done Picker screens:back Wire up:todo')
  assert.equal(t.at, 'build')
  assert.equal(t.stages, true)
})

test('verify: Verified needs a review that finished after the last edit and a green gate after it', () => {
  const tools = [{ tool: 'Edit', target: 'a.ts', role: 'engineer', at: 10 * M }]
  const good = prog([role('e1', 'engineer', 1, 10), role('q1', 'qa', 11, 14)], { tools, tests: { command: 'pnpm test', ok: true, at: 12 * M, total: 9 } })
  const v = verify(good)!
  assert.equal(v.ok, true)
  assert.equal(v.review?.role, 'qa')
  assert.deepEqual(v.reasons, [])
  const red = verify({ ...good, tests: { command: 'pnpm test', ok: false, at: 12 * M, failed: 2, total: 9 } })!
  assert.deepEqual([red.ok, red.reasons], [false, ['gate failed: 2 of 9']])
  const late = verify({ ...good, tools: [...tools, { tool: 'Write', role: 'lead', at: 20 * M }] })!
  assert.deepEqual(late.reasons, ['no review after the last edit', 'gate ran before the last edit'])
  assert.deepEqual(verify(prog([role('e1', 'engineer', 1, 10)]))!.reasons, ['no review after the last edit', 'no gate run'])
  assert.equal(verify(prog([])), undefined)
  assert.equal(verify(undefined), undefined)
})

test('doneKind and doneGroups: merged when its commit is in the log, approved, stopped today', () => {
  const now = new Date(2026, 10, 20, 15).getTime()
  const a = (id: string, x: Partial<ArchivedChat>): ArchivedChat => ({ sessionId: id, ai: 'claude', name: id, origin: id, version: 1, cwd: '/x', project: 'x', archivedAt: now - M, ...x })
  const repo = { sessionId: 'z', log: [{ hash: '1', subject: 'Fix the cookie check', when: 'now' }] }
  const merged = a('m', { approvedAt: now - 2 * M, commit: 'Fix the cookie check\n\n- body' })
  const approved = a('p', { approvedAt: now - M, commit: 'Something else' })
  const stopped = a('s', { ended: true })
  assert.equal(doneKind(merged, repo), 'merged')
  assert.equal(doneKind(merged), 'approved')
  assert.equal(doneKind(a('pr', { approvedAt: 1 }), { sessionId: 'pr', log: [], pr: { url: '', state: 'MERGED', title: '' } }), 'merged')
  assert.equal(doneKind(stopped), 'stopped')
  assert.equal(doneKind(a('h', {})), undefined)
  const g = doneGroups([approved, merged], [stopped, a('old', { ended: true, archivedAt: now - 48 * 60 * M }), a('h', {})], repo, now)
  assert.deepEqual([g.merged.map(x => x.sessionId), g.approved.map(x => x.sessionId), g.stopped.map(x => x.sessionId)], [['m'], ['p'], ['s']])
})

test('?demo=stations shows a send-back, a Verified chat at Review and all three Done groups', async () => {
  const { demoHub } = await import('./hub-demo')
  const { demoStations } = await import('./stations-demo')
  const now = Date.now(), h = demoStations(demoHub(now), now, '?demo=stations')
  const p = (id: string) => h.progress.find(x => x.sessionId === id)
  assert.deepEqual([track(p('d-wrap')).round, track(p('d-wrap')).back], [2, 'review'])
  assert.equal(track(p('d-tree')).at, 'review')
  assert.equal(verify(p('d-tree'))?.ok, true)
  const g = doneGroups(h.archive!.filter(a => a.approvedAt), h.archive!, h.repo ?? undefined, now)
  assert.deepEqual([g.merged, g.approved, g.stopped].map(x => x.map(a => a.sessionId)), [['d-merged'], ['d-approved'], ['d-stopped']])
  assert.equal(demoStations(h, now, ''), h)
})
