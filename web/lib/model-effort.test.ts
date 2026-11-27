import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyHub } from './hub-demo'
import { advisorsFor, fiveHourUse, heldLine, runFields, startPicks } from './model-effort'

const now = Date.now()
const later = new Date(now + 3600_000).toISOString()

test('runFields: auto sends auto only; picks ride along when set', () => {
  assert.deepEqual(runFields({ auto: true }, 'claude'), { auto: true })
  assert.deepEqual(runFields({ auto: false }, 'claude'), { auto: false })
  assert.deepEqual(runFields({ auto: false, model: 'opus', effort: 'xhigh', ultracode: true }, 'claude'), { auto: false, model: 'opus', effort: 'xhigh', ultracode: true })
})

test('runFields: ultracode is Claude only, a bad effort is dropped', () => {
  assert.deepEqual(runFields({ auto: false, model: 'gpt-6-luna', ultracode: true }, 'codex'), { auto: false, model: 'gpt-6-luna' })
  assert.deepEqual(runFields({ auto: false, effort: 'huge' }, 'claude'), { auto: false })
})

test('runFields: other AIs get nothing', () => {
  assert.deepEqual(runFields({ auto: false, model: 'opus' }, 'hermes'), {})
})

test('advisorsFor: only advisors ranked at or above the model', () => {
  const names = (m?: string) => advisorsFor(m).map(([a]) => a)
  assert.deepEqual(names(undefined), ['fable', 'opus', 'sonnet'])
  assert.deepEqual(names('haiku'), ['fable', 'opus', 'sonnet'])
  assert.deepEqual(names('opus'), ['fable', 'opus'])
  assert.deepEqual(names('fable'), ['fable'])
  assert.deepEqual(names('claude-opus-5-5'), ['fable', 'opus', 'sonnet'])
})

test('runFields: advisor is Claude only and dropped below the model', () => {
  assert.deepEqual(runFields({ auto: true, advisor: 'opus' }, 'claude'), { auto: true, advisor: 'opus' })
  assert.deepEqual(runFields({ auto: false, model: 'opus', advisor: 'sonnet' }, 'claude'), { auto: false, model: 'opus' })
  assert.deepEqual(runFields({ auto: false, advisor: 'opus' }, 'codex'), { auto: false })
  assert.deepEqual(runFields({ auto: false, advisor: 'gpt' }, 'claude'), { auto: false })
})

test('heldLine: from 60% on, and only while auto picks', () => {
  assert.equal(heldLine(59, true), undefined)
  assert.equal(heldLine(60, true), 'xhigh/max/ultracode held: 5h at 60%')
  assert.equal(heldLine(85, false), undefined)
})

test('fiveHourUse: the AI\'s own 5h window', () => {
  const h = { ...emptyHub(), live: [{ sessionId: 'a', cwd: '/w', at: now, limits: [{ kind: 'five_hour', percentUsed: 72, resetsAt: later }, { kind: 'codex_five_hour', percentUsed: 12, resetsAt: later }] }] }
  assert.equal(fiveHourUse(h, 'claude', now), 72)
  assert.equal(fiveHourUse(h, 'codex', now), 12)
  assert.equal(fiveHourUse(emptyHub(), 'claude', now), 0)
})

test('startPicks: auto unless the gear turned it off', () => {
  assert.deepEqual(startPicks(emptyHub()), { auto: true })
  const off = emptyHub()
  off.controls.switchboard.autoPick = false
  assert.deepEqual(startPicks(off), { auto: false })
})
