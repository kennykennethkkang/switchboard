/** run-story: the drawer's plain-language headline and facts for one role. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { storyOf } from './run-story'
import type { RunDetail } from './runs'

const run = (o: Partial<RunDetail> = {}): RunDetail => ({
  id: 'r', role: 'engineer', startedAt: 0, endedAt: 8 * 60e3, finished: true, brief: '', files: [], calls: [], callCount: 0,
  loops: [], tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, file: '', ...o,
})
const done = { status: 'done', changed: ['a'], checked: ['npx tsx --test auth, 538 pass'], open: [] }

test('no runs', () => {
  assert.equal(storyOf('engineer', [], { active: false }).headline, 'Engineer has not run in this chat.')
  assert.equal(storyOf('engineer', [], { active: true }).headline, 'Engineer is queued and has not started yet.')
})

test('one finished run with passing tests', () => {
  const s = storyOf('engineer', [run({ report: done })], { active: false })
  assert.equal(s.headline, 'Engineer ran once and finished. It passed 538 tests.')
  assert.ok(s.facts.includes('8m 00s total'))
})

test('sent back then passed', () => {
  const a = run({ id: 'a', loops: [{ at: 5, by: 'qa', text: 'login still loops. Fix it and add a test.' }], report: done })
  const b = run({ id: 'b', startedAt: 10 * 60e3, endedAt: 20 * 60e3, report: done })
  const s = storyOf('engineer', [b, a], { active: false })
  assert.equal(s.headline, 'Engineer ran twice. QA sent it back once: login still loops. The last run passed 538 tests.')
})

test('active run with time left', () => {
  const a = run({ id: 'a', report: done }), b = run({ id: 'b', startedAt: 10 * 60e3, finished: false })
  assert.equal(storyOf('engineer', [a, b], { active: true, left: '8 min' }).headline, 'Still on run 2, about 8 min left.')
  assert.equal(storyOf('engineer', [a, b], { active: true }).headline, 'Still on run 2.')
})

test('active run after a send back, odd left words', () => {
  const a = run({ id: 'a', loops: [{ at: 5, by: 'qa', text: 'x' }], report: done }), b = run({ id: 'b', startedAt: 10 * 60e3, finished: false })
  assert.equal(storyOf('engineer', [a, b], { active: true, left: 'about 9 to 11 min' }).headline, 'Still on run 2 after QA sent the last one back, about 9 to 11 min left.')
  assert.equal(storyOf('engineer', [b], { active: true, left: 'longer than usual' }).headline, 'Still on run 1, taking longer than usual.')
  assert.equal(storyOf('engineer', [b], { active: true, left: 'estimating' }).headline, 'Still on run 1.')
})

test('concerns and blocked', () => {
  const c = run({ report: { ...done, status: 'done with concerns', open: ['x', 'y'] } })
  assert.equal(storyOf('qa', [c], { active: false }).headline, 'QA ran once and finished with concerns. It passed 538 tests. 2 things are still open.')
  const b = run({ report: { status: 'blocked', changed: [], checked: [], open: [] } })
  assert.equal(storyOf('qa', [b], { active: false }).headline, 'QA ran once and is blocked.')
})

test('lead', () => {
  const l = run({ role: 'lead', callCount: 12, dispatches: [{ at: 1, role: 'engineer', brief: '' }, { at: 2, role: 'qa', brief: '' }] })
  assert.equal(storyOf('lead', [l], { active: false }).headline, 'The lead handed work to 2 roles in 12 tool calls.')
  assert.equal(storyOf('lead', [l], { active: true }).headline, 'The lead is working and has handed work to 2 roles so far.')
})

test('lead with no handoffs', () => {
  const l = run({ role: 'lead', callCount: 4, dispatches: [] })
  assert.equal(storyOf('lead', [l], { active: false }).headline, 'The lead worked alone in 4 tool calls.')
  assert.equal(storyOf('lead', [l], { active: true }).headline, 'The lead is working and has not handed out any work yet.')
})

test('lead counts distinct roles, not briefs', () => {
  const d = (role: string, at: number) => ({ at, role, brief: '' })
  const l = run({ role: 'lead', callCount: 12, dispatches: [d('engineer', 1), d('qa', 2), d('engineer', 3), d('qa', 4), d('researcher', 5), d('researcher', 6)] })
  assert.equal(storyOf('lead', [l], { active: false }).headline, 'The lead sent 6 briefs to 3 roles in 12 tool calls.')
  assert.equal(storyOf('lead', [l], { active: true }).headline, 'The lead is working and has sent 6 briefs to 3 roles so far.')
})

test('failures and blocked win over passes, 0 passed says nothing', () => {
  const r = (checked: string[], status = 'done') => run({ report: { status, changed: [], checked, open: [] } })
  assert.equal(storyOf('engineer', [r(['pnpm test: 3 failed, 10 passed'])], { active: false }).headline, 'Engineer ran once and finished. 3 tests failed.')
  assert.equal(storyOf('engineer', [r(['0 passing'])], { active: false }).headline, 'Engineer ran once and finished.')
  const a = run({ id: 'a', loops: [{ at: 1, by: 'qa', text: 'x broke.' }] })
  const b = run({ id: 'b', startedAt: 100, report: { status: 'blocked on key', changed: [], checked: ['12 passed'], open: [] } })
  assert.equal(storyOf('engineer', [a, b], { active: false }).headline, 'Engineer ran twice. QA sent it back once: x broke. The last run is blocked.')
  const c = run({ id: 'c', startedAt: 100, report: { status: 'done', changed: [], checked: ['1 failed, 9 passed'], open: [] } })
  assert.equal(storyOf('engineer', [a, c], { active: false }).headline, 'Engineer ran twice. QA sent it back once: x broke. In the last run 1 test failed.')
})
