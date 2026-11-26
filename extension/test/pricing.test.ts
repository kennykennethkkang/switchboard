import { it } from 'node:test'
import assert from 'node:assert/strict'
import { costOf, costSplit } from '../src/hub/pricing'

it('prices cache writes, long haiku prompts, fast requests, and unknown models', () => {
  assert.equal(costOf('claude-haiku-5-5', { input: 100, output: 0, cacheRead: 0, cacheWrite: 100, thinking: 0 }, { cacheWrite5m: 100 }), 0.0000225)
  assert.equal(costOf('claude-haiku-5-5', { input: 100001, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 }), 0.0500005)
  assert.equal(costOf('gpt-6-luna', { input: 100, output: 100, cacheRead: 0, cacheWrite: 0, thinking: 0 }, { speed: 'fast' }), 0.00012)
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 100, thinking: 0 }
  assert.equal(costOf('claude-opus-4-1', tokens, { cacheWrite5m: 100 }), 0.001875)
  assert.equal(costOf('claude-opus-4-1', tokens, { cacheWrite1h: 100 }), 0.003)
  assert.equal(costOf('unknown', { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, thinking: 0 }), undefined)
})

it('keeps the cost split equal to the total with searches and fast mode', () => {
  for (const model of ['claude-fable-5-2', 'claude-fable-5-1', 'claude-mythos-5-2', 'claude-opus-5-5', 'claude-opus-4-1', 'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-haiku-5-5', 'gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex']) {
    const tokens = { input: 12_000, output: 4_000, cacheRead: 2_000, cacheWrite: 500, thinking: 0 }
    const opts = { searches: 3, speed: 'fast', cacheWrite5m: 200, cacheWrite1h: 300 }
    const split = costSplit(model, tokens, opts)!
    const sum = Object.values(split).reduce((n, value) => n + value, 0)
    assert.ok(Math.abs(sum - costOf(model, tokens, opts)!) <= 1e-9, model)
  }
})
