import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { endedOnLimit, limitReset, pauseDue, resumeOrder } from '../src/hub/limit-pause'

const resetMs = (v = '') => Date.parse(v)

describe('limitReset', () => {
  // 2026-11-07 20:00 in Los Angeles (PST, UTC-8) is 2026-11-08 04:00 UTC.
  const now = Date.UTC(2026, 10, 8, 4, 0)
  it('reads the time in the named zone', () => {
    assert.equal(limitReset("You've hit your 5-hour limit · resets 11:50pm (America/Los_Angeles)", now), Date.UTC(2026, 10, 8, 7, 50))
    assert.equal(limitReset('resets 11:50pm (Asia/Tokyo)', now), Date.UTC(2026, 10, 8, 14, 50))
  })
  it('rolls a time already past over to the next day', () => {
    assert.equal(limitReset('resets 7pm (America/Los_Angeles)', now), Date.UTC(2026, 10, 9, 3, 0))
    assert.equal(limitReset('resets 12am (America/Los_Angeles)', now), Date.UTC(2026, 10, 8, 8, 0))
  })
  it('reads a dated weekly reset', () => {
    assert.equal(limitReset("You've hit your weekly limit · resets Nov 10, 9am (America/Los_Angeles)", now), Date.UTC(2026, 10, 10, 17, 0))
  })
  it('takes the offset at the reset, not now, across a DST change', () => {
    // Oct 31 2026 20:00 PDT; PST from Nov 1 2am.
    assert.equal(limitReset('resets 9am (America/Los_Angeles)', Date.UTC(2026, 10, 1, 3)), Date.UTC(2026, 10, 1, 17))
    // Mar 13 2027 20:00 PST; PDT from Mar 14 2am.
    assert.equal(limitReset('resets 9am (America/Los_Angeles)', Date.UTC(2027, 2, 14, 4)), Date.UTC(2027, 2, 14, 16))
    assert.equal(limitReset('resets Mar 20, 9am (America/Los_Angeles)', now), Date.UTC(2027, 2, 20, 16))
    // 1:30am happens twice on Nov 1 2026: 08:30Z (PDT) then 09:30Z (PST).
    assert.equal(limitReset('resets 1:30am (America/Los_Angeles)', Date.UTC(2026, 10, 1, 8)), Date.UTC(2026, 10, 1, 8, 30))
    assert.equal(limitReset('resets 1:30am (America/Los_Angeles)', Date.UTC(2026, 10, 1, 8, 40)), Date.UTC(2026, 10, 1, 9, 30))
    assert.equal(limitReset('resets 1:30am (America/Los_Angeles)', Date.UTC(2026, 10, 1, 9, 10)), Date.UTC(2026, 10, 1, 9, 30))
  })
  it('no reset in the text is undefined', () => {
    assert.equal(limitReset('API Error: overloaded', now), undefined)
  })
})

describe('pauseDue', () => {
  const now = Date.UTC(2026, 10, 7, 12)
  const iso = (h: number) => new Date(now + h * 3_600_000).toISOString()
  it('fires at or past the threshold, with the latest reset', () => {
    assert.equal(pauseDue([{ kind: 'five_hour', percentUsed: 98.9, resetsAt: iso(2) }], 99, resetMs, now), undefined)
    assert.deepEqual(pauseDue([{ kind: 'five_hour', percentUsed: 99, resetsAt: iso(2) }, { kind: 'seven_day', percentUsed: 100, resetsAt: iso(30) }], 99, resetMs, now),
      { kind: 'seven_day', percent: 100, resetsAt: now + 30 * 3_600_000 })
  })
  it('off, or a window already reset, never fires', () => {
    assert.equal(pauseDue([{ kind: 'five_hour', percentUsed: 100, resetsAt: iso(2) }], null, resetMs, now), undefined)
    assert.equal(pauseDue([{ kind: 'five_hour', percentUsed: 100, resetsAt: iso(-1) }], 99, resetMs, now), undefined)
  })
})

describe('resumeOrder', () => {
  it('chats holding subagents first, then queue order', () => {
    const q = [{ id: 'a', at: 3 }, { id: 'b', at: 1 }, { id: 'c', at: 5, agents: [{}] }, { id: 'd', at: 2, agents: [{}] }]
    assert.deepEqual(resumeOrder(q).map(x => x.id), ['d', 'c', 'b', 'a'])
  })
})

describe('endedOnLimit', () => {
  const j = (...xs: object[]) => xs.map(x => JSON.stringify(x)).join('\n')
  it('true only when the last assistant entry is the limit error', () => {
    assert.equal(endedOnLimit(j({ type: 'assistant', isApiErrorMessage: true, error: 'rate_limit' }, { type: 'system' })), true)
    assert.equal(endedOnLimit(j({ type: 'assistant', isApiErrorMessage: true, error: 'rate_limit' }, { type: 'assistant', message: {} })), false)
    assert.equal(endedOnLimit(j({ type: 'assistant', isApiErrorMessage: true, error: 'overloaded' })), false)
    assert.equal(endedOnLimit('{"type":"assist'), false)
    assert.equal(endedOnLimit(''), false)
  })
})
