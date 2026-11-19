import { test } from 'node:test'
import assert from 'node:assert/strict'
import { indefiniteHint, indefiniteOn } from './indefinite'

const p = (indefinite?: number) => ({ plugins: {}, skills: {}, ...(indefinite ? { indefinite } : {}) })

test('on only with a saved flag time', () => {
  assert.equal(indefiniteOn(undefined), false)
  assert.equal(indefiniteOn(p()), false)
  assert.equal(indefiniteOn(p(5)), true)
})

test('the hint says how long it has been on', () => {
  const now = 10_000_000
  assert.match(indefiniteHint(p(), now), /asks its questions once/)
  assert.match(indefiniteHint(p(now - 5_000), now), /just now/)
  assert.match(indefiniteHint(p(now - 12 * 60_000), now), /12 min ago/)
  assert.match(indefiniteHint(p(now - 3 * 3_600_000), now), /3 h ago/)
})

test('the hint says No limit set while it is on with no hours, cost or gate', () => {
  const now = 10_000_000, on = p(now - 5_000)
  assert.match(indefiniteHint(on, now), /No limit set/)
  assert.match(indefiniteHint(on, now, {}), /No limit set/)
  assert.doesNotMatch(indefiniteHint(on, now, { maxHours: 2 }), /No limit set/)
  assert.doesNotMatch(indefiniteHint(on, now, { gate: 'pnpm test' }), /No limit set/)
  assert.doesNotMatch(indefiniteHint(p(), now), /No limit set/)
})
