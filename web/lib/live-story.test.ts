import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CrowdLive, MirofishState } from './hub-types'
import { crowdStory, liveHeadline, mfRunning, mirofishStory } from './live-story'

const crowd = (over: Partial<CrowdLive> = {}): CrowdLive => ({ run: 'r', startedAt: 0, lastAt: 50_000, items: 2000, done: 1340, ended: false, votes: [{ label: 'List', n: 402 }, { label: 'Map', n: 188 }], noPreference: 80, feed: [], ...over })
const sim = (over: Partial<MirofishState> = {}): MirofishState => ({ simId: 's', step: 'rounds', round: 7, rounds: 10, percent: 70, etaMs: 460_000, reportReady: false, ...over })

test('crowd: clear lead says so with numbers and time left', () => {
  const s = crowdStory(crowd())
  assert.equal(s.head, 'List ahead')
  assert.equal(s.confidence, 'clear')
  assert.match(s.line, /List is clearly ahead, 68% to 32% of 590 who picked/)
  assert.match(s.line, /1340 of 2000 ratings in, about 25 s to go/)
})

test('crowd: near tie is too close to call', () => {
  const s = crowdStory(crowd({ votes: [{ label: 'List', n: 300 }, { label: 'Map', n: 290 }] }))
  assert.equal(s.head, 'Too close to call')
  assert.equal(s.confidence, 'close')
})

test('crowd: few votes is too early, many no preference is no clear winner', () => {
  assert.equal(crowdStory(crowd({ votes: [{ label: 'List', n: 8 }, { label: 'Map', n: 2 }] })).head, 'Too early to say')
  const s = crowdStory(crowd({ votes: [{ label: 'List', n: 60 }, { label: 'Map', n: 40 }], noPreference: 300 }))
  assert.match(s.line, /No clear winner, many had no preference/)
})

test('crowd: stopped and finished wording', () => {
  assert.match(crowdStory(crowd({ stopped: true })).line, /Stopped at 1340 of 2000/)
  const s = crowdStory(crowd({ ended: true, done: 2000 }))
  assert.equal(s.tone, 'done')
  assert.doesNotMatch(s.line, /to go/)
})

test('mirofish: rounds, report, stalled, topic', () => {
  assert.match(mirofishStory(sim()).line, /7 of 10 rounds done, report in about 8 min/)
  assert.match(mirofishStory(sim({ stalled: true })).line, /Stalled at round 7 of 10/)
  assert.match(mirofishStory(sim({ step: 'report', reportSections: 2 })).line, /2 sections written/)
  const post = (who: string, text: string) => ({ at: '', who, platform: 'x', action: 'posted', text })
  const s = mirofishStory(sim({ feed: [post('A', 'The map is slow'), post('B', 'I like the map view'), post('C', 'Dots are fine')] }))
  assert.equal(s.topic, 'map')
  assert.match(s.line, /people so far mostly talk about "map"/)
})

test('headline sums up the runs', () => {
  assert.equal(liveHeadline(sim(), crowd()), '2 tests running. Crowd: List ahead. MiroFish: report in about 8 min.')
  assert.equal(liveHeadline(undefined, crowd({ stopped: true })), 'Nothing running. Crowd: stopped.')
  assert.equal(liveHeadline(undefined, undefined, 2), 'Nothing running. 2 saved reports to read.')
})

test('crowd: a stopped run lowercases the joined verdict, but not an option name', () => {
  assert.match(crowdStory(crowd({ stopped: true, votes: [{ label: 'List', n: 8 }, { label: 'Map', n: 2 }] })).line, /So far: too early to say, only 10 picks so far\.$/)
  assert.match(crowdStory(crowd({ stopped: true })).line, /So far: List is clearly ahead/)
})

test('headline: a report that gave up is not a running test', () => {
  const failed = sim({ step: 'done', reportReady: true, reportGaveUp: true, reportError: 'came back empty' })
  assert.equal(liveHeadline(failed), 'Nothing running. MiroFish: the report hit a problem.')
  assert.equal(mfRunning(failed), false)
  assert.equal(mfRunning(sim({ step: 'report', reportGaveUp: true })), false)
  assert.equal(mfRunning(sim()), true)
})
