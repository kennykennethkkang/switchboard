import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bestByKind, chatSmart, keptText, optionSmart, recentPicks, smartMarkText, type SmartRate, type SmartPickRow } from './smart'

const r = (kind: string, task: string, pick: string, n: number, useful: number): SmartRate => ({ kind, task, pick, n, useful })

test('bestByKind: highest Laplace rate wins per task, kinds in order, empty kinds dropped', () => {
  const g = bestByKind([r('model', 'fix', 'haiku', 2, 2), r('model', 'fix', 'sonnet', 12, 10), r('ponytail', 'tiny', 'full', 5, 4), r('effort', 'fix', 'low', 0, 0)])
  assert.deepEqual(g.map(x => x.kind), ['ponytail', 'model'])
  assert.equal(g[1].rows[0].pick, 'sonnet')
})

test('keptText: whole percent and n', () => assert.equal(keptText(r('model', 'fix', 'sonnet', 12, 10)), 'kept 83% of 12'))

test('optionSmart: only the named option', () => {
  assert.deepEqual(optionSmart({ smart: { option: 1, rate: 0.8, n: 12 } }, 1), { option: 1, rate: 0.8, n: 12 })
  assert.equal(optionSmart({ smart: { option: 1 } }, 0), undefined)
  assert.equal(optionSmart({}, 0), undefined)
})

test('smartMarkText: rate only when known', () => {
  assert.equal(smartMarkText({}), 'Smart pick')
  assert.equal(smartMarkText({ rate: 0.8, n: 12 }), 'Smart pick, kept 80% of 12')
})

test('recentPicks: newest first, capped', () => {
  const p = (at: number): SmartPickRow => ({ at, session: 's', kind: 'model', task: 'fix', pick: 'x', why: '', verdict: 'pending' })
  assert.deepEqual(recentPicks([p(1), p(3), p(2)], 2).map(x => x.at), [3, 2])
})

test('chatSmart: the chat latest model and effort, the switch wins, learned flagged', () => {
  const row = (kind: string, pick: string, at: number, extra = {}) => ({ at, session: 's1', kind, task: 'fix', pick, why: 'small change', verdict: 'pending' as const, ...extra })
  assert.equal(chatSmart([], 's1'), undefined)
  const picks = [row('model', 'haiku', 1), row('model', 'sonnet', 2, { final: 'opus' }), row('effort', 'medium', 2, { why: 'learned: medium kept 80% of 10' }), { ...row('model', 'fable', 3), session: 's2' }]
  assert.deepEqual(chatSmart(picks, 's1'), { model: 'opus', line: 'Smart: opus · medium, learned' })
})
