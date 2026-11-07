import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cacheChip } from './cache'
import type { CacheKeep } from './hub-types'

const MIN = 60_000
const keep = (extra: Partial<CacheKeep>): CacheKeep => ({ sessionId: 's1', state: 'warm', warmUntil: 42 * MIN, tokens: 312_000, pings: 1, at: 0, ...extra })

describe('cache chip', () => {
  it('says warm with the minutes left, cold once lapsed, and nothing when off or unknown', () => {
    const all = [keep({}), keep({ sessionId: 's2', state: 'cold' }), keep({ sessionId: 's3', state: 'off' }), keep({ sessionId: 's4', warmUntil: 10 })]
    assert.equal(cacheChip(all, 's1', 0)?.label, 'warm 42m')
    assert.match(cacheChip(all, 's1', 0)?.title ?? '', /312k tokens/)
    assert.equal(cacheChip(all, 's2', 0)?.label, 'cold')
    assert.equal(cacheChip(all, 's3', 0), undefined)
    assert.equal(cacheChip(all, 's4', 20)?.label, 'cold')
    assert.equal(cacheChip(all, 'nope', 0), undefined)
    assert.equal(cacheChip(undefined, 's1', 0), undefined)
  })
})
