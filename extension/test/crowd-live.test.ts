import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { crowdLive, dismissCrowd } from '../src/hub/crowd-live'

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'crowd-live-'))
const write = (d: string, name: string, rows: unknown[]) => fs.writeFileSync(path.join(d, name), rows.map(r => JSON.stringify(r)).join('\n') + '\n')
const seg = { age: '50-64', device: 'phone', access: 'dyslexia', tech: 'low', intent: 'first visit', patience: 'average' }
const display = ['p', 'o', 'label', 'age', 'tech', 'device', 'access', 'intent', 'patience']
const rate = (p: number, o: number, appeal: number, at: number, call = 'c1') => ({ t: 'd', at, appeal, reason: 'clearer', show: { p: String(p), o: String(o), label: o ? 'Current' : 'New', call, ...seg } })

describe('crowd-ab live feed', () => {
  it('counts a persona once all options are rated, ties as no preference, pilot joined', () => {
    const d = dir()
    write(d, '1000-1.jsonl', [{ t: 'start', run: '1000-1', preset: 'crowd-ab', items: 4, display, at: 1000 }, rate(0, 0, 4, 1100), rate(0, 1, 2, 1101), { t: 'end', at: 1200 }])
    write(d, '5000-2.jsonl', [{ t: 'start', run: '5000-2', preset: 'crowd-ab', items: 6, display, at: 5000 },
      rate(1, 0, 3, 5100), rate(1, 1, 3.1, 5101), rate(2, 1, 4, 5102), rate(2, 0, 1, 5103), rate(3, 0, 2, 5104)])
    write(d, '900-3.jsonl', [{ t: 'start', run: '900-3', preset: 'other', items: 1, display: ['x'], at: 900 }])
    write(d, '800-4.jsonl', [{ t: 'start', run: '800-4', preset: 'crowd-ab', items: 2, display, at: 800 }, rate(9, 0, 1, 810, 'c0')])
    const live = crowdLive(d, 6000)!
    assert.equal(live.run, '1000-1')
    assert.equal(live.items, 10)
    assert.equal(live.done, 7)
    assert.equal(live.ended, false)
    assert.deepEqual(live.votes, [{ label: 'Current', n: 1 }, { label: 'New', n: 1 }])
    assert.equal(live.noPreference, 1)
    assert.deepEqual(live.feed[0], { at: 5104, who: '50-64, phone, dyslexia', option: 'New', appeal: 2, reason: 'clearer' })
  })

  it('reads haiku panel picks and old runs without labels, and drops stale runs', () => {
    const d = dir()
    write(d, '2000-1.jsonl', [{ t: 'start', run: '2000-1', preset: 'crowd-ab', items: 2, display, at: 2000 },
      { t: 'd', at: 2100, pick: 'B', reason: 'faster', why: 'fewer taps', show: seg }, { t: 'd', at: 2101, pick: 'none', reason: 'none', show: seg }])
    const live = crowdLive(d, 3000)!
    assert.deepEqual(live.votes, [{ label: 'B', n: 1 }])
    assert.equal(live.noPreference, 1)
    assert.equal(live.feed[1].why, 'fewer taps')
    assert.equal(crowdLive(d, 2101 + 31 * 60_000), undefined)

    const old = dir()
    write(old, '1-1.jsonl', [{ t: 'start', run: '1-1', preset: 'preset', items: 2, display: ['p', 'o', 'patience'], at: 1 }, { t: 'd', at: 2, appeal: 3, show: { p: '0', o: '1' } }])
    assert.equal(crowdLive(old, 10)!.feed[0].option, 'Option B')
  })

  it('keeps the pilot on the card while the main run has no rows yet', () => {
    const d = dir()
    write(d, '1000-1.jsonl', [{ t: 'start', run: '1000-1', preset: 'crowd-ab', items: 2, display, at: 1000 }, rate(0, 0, 4, 1100), rate(0, 1, 1, 1101), { t: 'end', at: 1200 }])
    write(d, '1300-2.jsonl', [{ t: 'start', run: '1300-2', preset: 'crowd-ab', items: 6, display, at: 1300 }])
    const live = crowdLive(d, 1400)!
    assert.deepEqual([live.items, live.done, live.ended, live.votes.find(v => v.label === 'New')?.n], [8, 2, false, 1])
  })

  it('marks a run with no new rows for 5 minutes as stopped, and dismiss hides it', () => {
    const d = dir()
    write(d, '1000-1.jsonl', [{ t: 'start', run: '1000-1', preset: 'crowd-ab', items: 4, display, at: 1000 }, rate(0, 0, 4, 1100)])
    assert.equal(crowdLive(d, 1100 + 4 * 60_000)!.stopped, undefined)
    assert.equal(crowdLive(d, 1100 + 6 * 60_000)!.stopped, true)
    write(d, '1000-1.jsonl', [{ t: 'start', run: '1000-1', preset: 'crowd-ab', items: 4, display, at: 1000 }, rate(0, 0, 4, 1100), { t: 'end', at: 1200 }])
    assert.equal(crowdLive(d, 1200 + 6 * 60_000)!.stopped, undefined, 'an ended run is finished, not stopped')
    write(d, '1000-1.jsonl', [{ t: 'start', run: '1000-1', preset: 'crowd-ab', items: 4, display, at: 1000 }, rate(0, 0, 4, 1100)])
    dismissCrowd('1000-1', d, 1100)
    assert.equal(crowdLive(d, 1100 + 6 * 60_000), undefined)
    write(d, '1000-1.jsonl', [{ t: 'start', run: '1000-1', preset: 'crowd-ab', items: 4, display, at: 1000 }, rate(0, 0, 4, 1100), rate(1, 0, 3, 1100 + 6 * 60_000)])
    assert.ok(crowdLive(d, 1100 + 7 * 60_000), 'new rows after the dismiss bring it back')
  })

  it('forgets dismissed runs after 24 hours', () => {
    const d = dir()
    write(d, '1000-1.jsonl', [{ t: 'start', run: '1000-1', preset: 'crowd-ab', items: 4, display, at: 1000 }, rate(0, 0, 4, 1100)])
    fs.writeFileSync(path.join(d, 'dismissed.txt'), `1000-1 1100 ${Date.now() - 25 * 3600_000}\n`)
    assert.ok(crowdLive(d, 1100 + 6 * 60_000))
    assert.equal(fs.readFileSync(path.join(d, 'dismissed.txt'), 'utf8').trim(), '')
  })
})
