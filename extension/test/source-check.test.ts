import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { sourceChecks } from '../src/hub/source-check'
import { HubService } from '../src/hub/hub-service'

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'source-check-'))
const put = (d: string, name: string, body: unknown, mtime?: number) => {
  const f = path.join(d, name)
  fs.writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body))
  if (mtime) fs.utimesSync(f, mtime / 1000, mtime / 1000)
  return f
}
const src = (over: Record<string, unknown> = {}) => ({
  url: 'https://example.org/a', title: 'A', score: 82, verdict: 'Reliable',
  contributions: [
    { id: 'prior', label: 'Domain prior', weight: 20, value: 0.9, points: 18, reasons: ['rated high by Lin et al.'] },
    { id: 'citations', label: 'Citations', weight: 25, value: 0.8, points: 20, reasons: ['6 of 6 links resolve', 'primary sources'] },
    { id: 'author', label: 'Author', weight: 5, value: null, points: 0, reasons: ['no byline'] },
  ],
  adjustments: [], flags: [], ...over,
})
const NOW = Date.parse('2026-11-20T12:00:00Z')

describe('source-check runs', () => {
  it('reads a CLI --json result: question, band, score, strongest reasons', () => {
    const d = dir()
    put(d, 'r1.json', { question: 'does X cause Y', at: '2026-11-20T11:00:00Z', sources: [src(), src({ url: 'https://onion.example', score: 40, verdict: 'Satire', adjustments: [{ delta: -5, reason: 'rounded' }, { delta: -30, reason: 'outlet is satire' }] })] })
    const [r] = sourceChecks(d, NOW)!
    assert.equal(r.id, 'r1')
    assert.equal(r.question, 'does X cause Y')
    assert.equal(r.at, Date.parse('2026-11-20T11:00:00Z'))
    assert.equal(r.done, true)
    assert.deepEqual(r.sources.map(s => [s.url, s.band, s.score]), [['https://example.org/a', 'Reliable', 82], ['https://onion.example', 'Satire', 40]])
    // adjustments lead (they explain a cap), then contributions by points; a signal with no value is left out
    assert.deepEqual(r.sources[0].reasons, ['Citations: 6 of 6 links resolve', 'Domain prior: rated high by Lin et al.'])
    assert.equal(r.sources[1].reasons[0], 'outlet is satire')
    assert.ok(!r.sources[1].reasons.includes('rounded'))
  })

  it('names a URL run by its root, marks a partial file not done, and finds the sibling html report', () => {
    const d = dir()
    put(d, 'r2.json',{ root: 'https://example.org/a', done: false, sources: [src()] }, NOW)
    const html = put(d, 'r2.html', '<html></html>')
    const [r] = sourceChecks(d, NOW)!
    assert.equal(r.question, 'https://example.org/a')
    assert.equal(r.done, false)
    assert.equal(r.report, html)
  })

  it('takes the file time when the run has no at, newest first, and drops old, broken and empty files', () => {
    const d = dir()
    put(d, 'old.json', { question: 'old', sources: [src()] }, NOW - 9 * 24 * 3600_000)
    put(d, 'a.json', { question: 'a', sources: [src()] }, NOW - 2 * 3600_000)
    put(d, 'b.json', { question: 'b', sources: [src()] }, NOW - 1 * 3600_000)
    put(d, 'bad.json', '{ not json')
    put(d, 'none.json', { question: 'none', sources: [] })
    put(d, 'note.txt', 'x')
    assert.deepEqual(sourceChecks(d, NOW)!.map(r => r.id), ['b', 'a'])
    assert.equal(sourceChecks(d, NOW)![0].at, NOW - 3600_000)
  })

  it('derives the band from the score when a verdict is missing or unknown, and keeps at most 5 runs', () => {
    const d = dir()
    put(d, 'x.json', { question: 'q', sources: [src({ verdict: undefined, score: 50 }), src({ verdict: 'Weird', score: 20 })] }, NOW)
    const [r] = sourceChecks(d, NOW)!
    assert.deepEqual(r.sources.map(s => s.band), ['Mixed', 'Unreliable'])
    for (let i = 0; i < 7; i++) put(d, `n${i}.json`, { question: `n${i}`, sources: [src()] }, NOW - i * 60_000)
    assert.equal(sourceChecks(d, NOW)!.length, 5)
  })

  it('is undefined when the folder is missing or holds nothing recent', () => {
    assert.equal(sourceChecks(path.join(os.tmpdir(), 'no-such-source-check-dir'), NOW), undefined)
    assert.equal(sourceChecks(dir(), NOW), undefined)
  })
})

describe('hub source-check feed', () => {
  it('puts the runs on hub state and pushes again only when they change', () => {
    const hub = new HubService()
    let runs = [{ id: 'r', question: 'q', at: 1, done: true, sources: [{ url: 'https://x.org', band: 'Mixed' as const, score: 50, reasons: [] }] }]
    let reads = 0
    hub.startSourceChecks(() => { reads++; return runs })
    try {
      assert.deepEqual(hub.get().sourceChecks, runs)
      runs = [{ ...runs[0], done: false }]
      assert.equal(hub.get().sourceChecks![0].done, true, 'only the next tick sees the change')
      assert.equal(reads, 1)
    } finally { hub.stopMirofish() }
  })
})
