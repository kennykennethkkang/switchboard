import { test } from 'node:test'
import assert from 'node:assert/strict'
import { byDay, cacheHitRate, tokens, usd, groupBy, priorTotals, inRange, totals, type UsageReport, type UsageRow } from './usage'

const row = (day: string, project = 'repo', costUsd = 1): UsageRow => ({ day, ai: 'claude', model: 'm', project, role: 'lead', input: 10, output: 5, cacheRead: 20, cacheWrite: 5, thinking: 2, calls: 1, searches: 0, costUsd, split: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, search: 0 }, savedUsd: 0 })
const report: UsageReport = { at: new Date(2026, 10, 23, 12).getTime(), from: '2026-10-24', rows: [row('2026-11-23'), row('2026-11-22', 'Repo', 2)], chats: [] }

test('usage ranges, totals, previous window, and zero-filled days', () => {
  assert.equal(inRange(report, 'today').length, 1)
  assert.equal(totals(inRange(report, '7d')).tokens, 80)
  assert.equal(priorTotals(report, '30d'), undefined)
  assert.equal(priorTotals(report, '7d')?.calls, 0)
  assert.equal(byDay(report, '7d').length, 7)
  assert.equal(byDay(report, '7d')[0].day, '2026-11-17')
})

test('usage group shares and display formatters', () => {
  assert.deepEqual(groupBy(report.rows, 'project').map(x => x.name), ['Repo', 'repo'])
  assert.equal(usd(0.001), '<$0.01')
  assert.equal(usd(1), '$1.00')
  assert.equal(usd(125.2), '$125')
  assert.equal(tokens(950), '950')
  assert.equal(tokens(412_000), '412K')
  assert.equal(tokens(999_999), '1M')
  assert.equal(tokens(12_600_000), '12.6M')
  assert.equal(tokens(999_950_000), '1B')
  assert.equal(tokens(1_240_000_000), '1.24B')
  assert.equal(cacheHitRate(row('2026-11-23')), 20 / 35)
  assert.equal(totals([row('2026-11-23')]).tokens, 40)
})
