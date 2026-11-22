import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoLine, smartReason } from './auto-reason'

test('autoLine: nothing to pick from an empty task', () => {
  assert.equal(autoLine('  ', 'claude', 0), undefined)
})

test('autoLine: model, effort and why, from the same rules as the extension', () => {
  const l = autoLine('fix the typo in the readme', 'claude', 0)
  assert.match(l ?? '', /^Smart: \w+ · \w+, .+/)
  assert.match(l ?? '', /small change/)
})

test('autoLine: a high 5h window says what was held', () => {
  const l = autoLine('migrate the whole database across every route and fix the broken auth', 'claude', 80)
  assert.match(l ?? '', /5h at 80%/)
})

test('autoLine: codex gets its own models', () => {
  assert.match(autoLine('add an endpoint', 'codex', 0) ?? '', /gpt-/)
})

test('autoLine: other AIs have no pick', () => {
  assert.equal(autoLine('add an endpoint', 'hermes', 0), undefined)
})

test('smartReason: learned reasons are called an override', () => {
  assert.equal(smartReason('learned: sonnet kept 80% of 12'), 'learned override, sonnet kept 80% of 12')
  assert.equal(smartReason('small change'), 'small change')
})
