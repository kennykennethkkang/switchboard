import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advancedRows, chatRun, raiseLine, raisesFor, stageView } from './stages-ui'
import type { Escalation, HubState, Project, Stage } from './hub-types'

const esc = (o: Partial<Escalation>): Escalation => ({ project: '/r/app', role: 'qa', from: 'sonnet', to: 'opus', files: ['web/components/switchboard/board.tsx'], reason: 'after 3 redesign rounds', at: 1, ...o })

test('raiseLine names the role, model, first file and reason', () => {
  assert.equal(raiseLine(esc({})), 'qa raised to opus on board.tsx after 3 redesign rounds')
  assert.equal(raiseLine(esc({ role: 'designer', to: 'fable', files: ['a/x.css', 'b/y.tsx'], reason: 'after 1 redesign round' })), 'designer raised to fable on x.css and 1 more after 1 redesign round')
})

test('raisesFor finds the project by path or name and keeps the newest per role', () => {
  const hub = { escalations: { '/r/app': [esc({ at: 1, to: 'opus' }), esc({ at: 5, to: 'fable' })], '/r/other': [esc({ role: 'designer' })] } }
  assert.equal(raisesFor(hub, '/r/app').qa.to, 'fable')
  assert.equal(raisesFor(hub, '/elsewhere/app/').qa.to, 'fable')
  assert.equal(raisesFor(hub, '/r/app').designer, undefined)
  assert.deepEqual(raisesFor(hub), {})
})

const proj = (path: string): Project => ({ name: path.split('/').pop()!, path, kind: 'repo', isOpen: true })
const ctl = (advancedMode: Record<string, boolean>) => ({ switchboard: { advancedMode } }) as unknown as HubState['controls']

test('advancedRows lists every project when there are several, else the current one', () => {
  assert.deepEqual(advancedRows({ projects: [proj('/r/a'), proj('/r/b')], controls: ctl({ '/r/b': true }) }, '/r/a').map(r => [r.name, r.on]), [['a', false], ['b', true]])
  assert.deepEqual(advancedRows({ projects: [proj('/r/a')], controls: ctl({}) }, '/r/z'), [{ path: '/r/z', name: 'z', on: false }])
})

const s = (status: Stage['status'], name: string = status, n = 0): Stage => ({ n, name, role: 'engineer', status })

test('chatRun matches by sessionId, newest run, only with Advanced mode on', () => {
  const stages = { '/r/a': [{ run: 'r1', sessionId: 'x', at: 1, stages: [s('done')] }, { run: 'r2', sessionId: 'x', at: 2, stages: [s('doing')] }, { run: 'r3', sessionId: 'y', at: 3, stages: [s('todo')] }] }
  assert.equal(chatRun({ stages, controls: ctl({ '/r/a': true }) }, 'x')?.run.run, 'r2')
  assert.equal(chatRun({ stages, controls: ctl({}) }, 'x'), undefined)
  assert.equal(chatRun({ stages, controls: ctl({ '/r/a': true }) }, 'z'), undefined)
})

test('stageView counts the current stage and points at a redo first', () => {
  const v = stageView([s('done'), s('redo', 'Build'), s('doing'), s('todo')])
  assert.deepEqual([v.at, v.done, v.quiet, v.gate, v.line], [1, 1, false, -1, 'Stage 2 of 4 sent back: Build, engineer'])
  assert.equal(stageView([s('done'), s('doing', 'Build'), s('todo')]).line, 'Stage 2 of 3 running: Build, engineer')
})

test('stageView opens a review gate after a finished stage when nothing runs', () => {
  assert.deepEqual(stageView([s('done'), s('todo', 'Review')]), { quiet: true, at: 1, done: 1, total: 2, gate: 0, line: 'Stage 2 of 2 waiting on your review: Review, engineer' })
  assert.equal(stageView([s('todo', 'Plan')]).line, 'Stage 1 of 1 next: Plan, engineer')
  assert.equal(stageView([s('done'), s('done')]).line, 'All 2 stages done')
  assert.equal(stageView([]).total, 0)
})
