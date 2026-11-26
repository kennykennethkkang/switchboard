import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoStartPlan, holdReason } from '../src/hub/todo'

const item = (id: string) => ({ id, text: `do ${id}`, at: 0 })
const base = { on: true, folder: '/p', todo: [item('a'), item('b')], busy: false, limited: false, tried: new Set<string>(), now: 10 * 60_000 }

test('memory pressure holds autopilot at its live chat thresholds', () => {
  assert.deepEqual(holdReason({ ...base, memory: { level: 2, chats: 8 } }), { kind: 'memory', text: 'Next to-do waits: memory is low and 8 chats are open' })
  assert.deepEqual(holdReason({ ...base, memory: { level: 4, chats: 4 } }), { kind: 'memory', text: 'Next to-do waits: memory is low and 4 chats are open' })
  assert.equal(holdReason({ ...base, memory: { level: 2, chats: 7 } }), undefined)
  assert.equal(holdReason({ ...base, limited: true, memory: { level: 4, chats: 8 } })?.kind, 'limit')
})

test('memory pressure holds auto-start and leaves the manual path alone', () => {
  assert.equal(autoStartPlan({ ...base, memory: { level: 2, chats: 8 } }), undefined)
  assert.equal(autoStartPlan({ ...base, memory: { level: 4, chats: 4 } }), undefined)
  assert.ok(autoStartPlan({ ...base, memory: { level: 2, chats: 7 } }))
})
