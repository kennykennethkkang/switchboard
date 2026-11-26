import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EVERY, everyText, goalLine, isLoopPick, loopOf, scheduleText } from '../src/hub/loop'

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
