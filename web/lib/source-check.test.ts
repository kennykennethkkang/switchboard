import test from 'node:test'
import assert from 'node:assert/strict'
import { bandTone, runningChecks, siteOf, summaryLine } from './source-check'

const s = (band: Parameters<typeof bandTone>[0], score = 50) => ({ url: 'https://x.org', band, score, reasons: [] })

test('summaryLine counts sources per band in a fixed order and skips empty bands', () => {
  assert.equal(summaryLine([s('Mixed'), s('Reliable'), s('Reliable'), s('Unreliable'), s('Reliable')]), '5 sources: 3 reliable, 1 mixed, 1 unreliable')
  assert.equal(summaryLine([s('Retracted'), s('Satire'), s('Unverifiable')]), '3 sources: 1 satire, 1 retracted, 1 unverifiable')
  assert.equal(summaryLine([s('Reliable')]), '1 source: 1 reliable')
  assert.equal(summaryLine([]), 'No sources yet')
})

test('siteOf splits a url into host (no www) and a short path', () => {
  assert.deepEqual(siteOf('https://www.cjr.org/tow_center/we-compared-eight-ai-search-engines.php?x=1'), { host: 'cjr.org', path: '/tow_center/we-compared-eight-ai-search-engines.php' })
  assert.deepEqual(siteOf('https://doi.org/10.1016/S0140-6736(97)11096-0'), { host: 'doi.org', path: '/10.1016/S0140-6736(97)11096-0' })
  assert.deepEqual(siteOf('https://example.org/'), { host: 'example.org', path: '' })
  assert.deepEqual(siteOf('not a url'), { host: 'not a url', path: '' })
})

test('bandTone gives every band a state color and flags the ones that need a second look', () => {
  assert.deepEqual([bandTone('Reliable'), bandTone('Mixed'), bandTone('Unreliable'), bandTone('Satire'), bandTone('Retracted'), bandTone('Unverifiable')].map(t => t.color),
    ['green', 'yellow', 'red', 'violet', 'red', 'ash'])
  assert.deepEqual(['Reliable', 'Mixed', 'Unreliable', 'Satire', 'Retracted', 'Unverifiable'].map(b => bandTone(b as Parameters<typeof bandTone>[0]).look), [false, false, true, true, true, true])
})

test('runningChecks counts runs still being written', () => {
  const run = (done: boolean) => ({ id: 'a', question: 'q', at: 1, done, sources: [s('Mixed')] })
  assert.equal(runningChecks(undefined), 0)
  assert.equal(runningChecks([run(true), run(false), run(false)]), 2)
})
