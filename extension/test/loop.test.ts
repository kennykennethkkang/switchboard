import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EVERY, autoLoop, everyOf, everyText, goalLine, isLoopPick, isSmartLoop, loopOf, scheduleText } from '../src/hub/loop'

test('loopOf: goal wins over a timer, else turn', () => {
  assert.equal(loopOf(undefined), 'turn')
  assert.equal(loopOf({}), 'turn')
  assert.equal(loopOf({ checkBack: { everyMin: 30, count: 0 } }), 'timer')
  assert.equal(loopOf({ indefinite: 1, checkBack: { everyMin: 30, count: 0 } }), 'goal')
})

test('isLoopPick: modes, intervals and lengths', () => {
  assert.ok(isLoopPick({ mode: 'turn' }))
  assert.ok(isLoopPick({ mode: 'goal', doneWhen: 'tests pass' }))
  assert.ok(isLoopPick({ mode: 'timer', everyMin: 1440, text: 'check the inbox' }))
  assert.equal(isLoopPick({ mode: 'timer' }), false)
  assert.equal(isLoopPick({ mode: 'timer', everyMin: 5 }), false)
  assert.equal(isLoopPick({ mode: 'proactive' }), false)
  assert.equal(isLoopPick({ mode: 'goal', doneWhen: 'x'.repeat(2001) }), false)
  assert.equal(isLoopPick(null), false)
})

test('loop texts', () => {
  assert.deepEqual(EVERY.map(everyText), ['every 10 min', 'every 30 min', 'every 1 h', 'every 3 h', 'daily'])
  assert.equal(scheduleText('  every weekday at 9am triage new issues '), '/schedule every weekday at 9am triage new issues')
  assert.match(goalLine(' lighthouse 90 '), /goal skill.*: lighthouse 90$/)
})

test('autoLoop: a schedule, a check-back, a keep-going word, else turn', () => {
  assert.equal(autoLoop('Every weekday at 9am, triage new issues', 'other').mode, 'proactive')
  assert.equal(autoLoop('Keep an eye on CI every 2 hours', 'other').mode, 'timer')
  assert.equal(autoLoop('Keep an eye on CI every 3 hours', 'other').everyMin, 180)
  assert.equal(autoLoop('Fix the login bug until all tests pass', 'fix').mode, 'goal')
  assert.match(autoLoop('Fix the login bug until all tests pass', 'fix').why, /keep going \("until"\)/)
  assert.equal(autoLoop('Make the site crash free', 'fix').mode, 'goal')
  assert.equal(autoLoop('Why does the build fail?', 'other').mode, 'turn')
  assert.equal(autoLoop('Why does the build fail?', 'other').everyMin, undefined)
  assert.equal(autoLoop('Fix the schedule page header', 'fix').mode, 'turn')
})

test('autoLoop: the learned table overrides the rule only with 5+ rows and a clear lead', () => {
  const few = { loop: { fix: { goal: { n: 4, useful: 4 } } } }
  assert.equal(autoLoop('Fix the login bug', 'fix', few).mode, 'turn')
  const many = { loop: { fix: { goal: { n: 6, useful: 6 }, turn: { n: 6, useful: 1 } } } }
  const p = autoLoop('Fix the login bug', 'fix', many)
  assert.equal(p.mode, 'goal')
  assert.equal(p.rule, 'turn')
  assert.match(p.why, /^learned override, goal kept 100% of 6/)
  assert.equal(autoLoop('Fix the login bug', 'ui', many).mode, 'turn')
})

test('everyOf: nearest interval, 30 min by default', () => {
  assert.equal(everyOf('every 5 min'), 10)
  assert.equal(everyOf('every 45 minutes'), 30)
  assert.equal(everyOf('poll it hourly'), 60)
  assert.equal(everyOf('check back'), 30)
})

test('isSmartLoop', () => {
  assert.ok(isSmartLoop({ task: 'fix', pick: 'goal', why: 'x' }))
  assert.ok(isSmartLoop({ task: 'fix', pick: 'goal', why: 'x', final: 'turn' }))
  assert.equal(isSmartLoop({ task: 'fix', pick: 'auto', why: 'x' }), false)
  assert.equal(isSmartLoop({ task: 'fix', pick: 'goal', why: 'x', final: 'loop' }), false)
  assert.equal(isSmartLoop({ task: 'x'.repeat(41), pick: 'goal', why: 'x' }), false)
  assert.equal(isSmartLoop(null), false)
})
