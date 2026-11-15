import { test } from 'node:test'
import assert from 'node:assert/strict'
import { budgetFill, budgetForm, budgetLine, budgetMsg, checkBackCount, elapsedText, freshRun, limitTag, limitText, trendText } from './budget-ui'

test('elapsed reads short', () => {
  assert.equal(elapsedText(10_000), 'just now')
  assert.equal(elapsedText(35 * 60_000), '35m')
  assert.equal(elapsedText(80 * 60_000), '1h 20m')
  assert.equal(elapsedText(120 * 60_000), '2h')
})

test('line and fill follow the nearer cap', () => {
  const c = { elapsedMs: 3_600_000, costUsd: 4, budget: { maxHours: 4, maxCostUsd: 5 } }
  assert.equal(budgetLine(c), '1h of 4h · $4.00 of $5')
  assert.equal(budgetFill(c), 0.8)
  assert.equal(budgetFill({ elapsedMs: 1, costUsd: 9, budget: { maxCostUsd: 5 } }), 1)
  assert.equal(budgetFill({ elapsedMs: 1, costUsd: 1 }), undefined)
  assert.equal(budgetLine({ costUsd: 1.5 }), '$1.50')
})

test('form to message: blanks and junk clear', () => {
  assert.deepEqual(budgetMsg('2', '', ' npm test '), { maxHours: 2, maxCostUsd: null, gate: 'npm test' })
  assert.deepEqual(budgetMsg('x', '-1', ''), { maxHours: null, maxCostUsd: null, gate: null })
  assert.deepEqual(budgetForm({ maxHours: 3, gate: 'make' }), { hours: '3', usd: '', gate: 'make' })
})

test('trend text and check-back count', () => {
  assert.equal(trendText({ value: 5, vsDay: 2, vsWeek: -1 }), '5 ↑2 vs day ↓1 vs week')
  assert.equal(trendText({ value: 1.5, vsDay: -0.5 }, true), '$1.50 ↓$0.50 vs day')
  assert.equal(trendText({ value: 0, vsDay: 0 }), '0 same vs day')
  assert.equal(checkBackCount({ everyMin: 30, count: 3 }), '3/12')
  assert.equal(checkBackCount(undefined), '')
})

test('freshRun names a dated run that differs per start', () => {
  const a = freshRun('triage', Date.UTC(2026, 10, 14, 9)), b = freshRun('triage', Date.UTC(2026, 10, 14, 9) + 1)
  assert.match(a, /^2026-11-14-triage-[0-9a-z]+$/)
  assert.notEqual(a, b)
})

test('limit text for the map badge', () => {
  assert.equal(limitText({}), '')
  assert.equal(limitText({ budget: { maxHours: 4, maxCostUsd: 5, gate: 'pnpm test' } }), 'limit 4h / $5, gate')
  assert.equal(limitText({ budget: { gate: 'x' } }), 'limit gate')
  assert.equal(limitText({ budget: { maxHours: 1.5 } }), 'limit 1.5h')
  assert.equal(limitText({ checkBack: { everyMin: 30, count: 3 } }), 'check back 30m 3/12')
  assert.equal(limitText({ budget: { maxCostUsd: 2 }, checkBack: { everyMin: 10, count: 0 } }), 'limit $2 \u00b7 check back 10m 0/12')
})

test('short limit tag for the yard', () => {
  assert.equal(limitTag({}), '')
  assert.equal(limitTag({ budget: { maxHours: 4, maxCostUsd: 5, gate: 'pnpm test' }, checkBack: { everyMin: 30, count: 3 } }), '4h $5 gate · back 3/12')
  assert.equal(limitTag({ checkBack: { everyMin: 10, count: 0 } }), 'back 0/12')
})
