import test from 'node:test'
import assert from 'node:assert/strict'
import { mirofishStatus } from './mirofish'

const base = { simId: 's', round: 7, rounds: 10, percent: 70, reportReady: false }

test('mirofishStatus names each stage in words', () => {
  assert.deepEqual(mirofishStatus({ ...base, step: 'rounds', etaMs: 8 * 60e3 }), { stage: 'rounds', head: 'Running round 7 of 10', sub: 'About 8m left. Then the report is written and saved here.', tone: 'run', bar: 70 })
  assert.deepEqual(mirofishStatus({ ...base, step: 'report', reportPercent: 45, reportSections: 1 }), { stage: 'report', head: 'Rounds finished. Writing the report', sub: 'This takes a few minutes. 1 section written.', tone: 'run', bar: 45 })
  assert.deepEqual(mirofishStatus({ ...base, step: 'report', reportError: 'Report stalled at 20%. Trying again shortly.' }).head, 'Report hit a problem')
  assert.deepEqual(mirofishStatus({ ...base, step: 'done', reportReady: true, saved: false, reportGaveUp: true, reportError: 'came back empty' }), { stage: 'report', head: 'Report needs a look', sub: 'came back empty', tone: 'bad' })
  assert.deepEqual(mirofishStatus({ ...base, step: 'done', reportReady: true, saved: true }), { stage: 'saved', head: 'Finished. Report saved', sub: 'Read it under MiroFish reports.', tone: 'done' })
  assert.equal(mirofishStatus({ ...base, step: 'done', reportReady: true }).stage, 'report')
})

test('mirofishStatus calls a stalled sim stalled', () => {
  const s = mirofishStatus({ ...base, step: 'rounds', stalled: true })
  assert.equal(s.tone, 'bad')
  assert.equal(s.head, 'Stalled at round 7 of 10')
  assert.equal(s.bar, undefined)
})
