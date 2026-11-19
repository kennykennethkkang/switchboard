import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { pickHit } from './board-hit'

const hits = [{ x: 0, y: 0, w: 100, h: 22, id: 'hall' }, { x: 0, y: 40, w: 100, h: 22, id: 'tea' }]

describe('pickHit', () => {
  it('takes an exact hit first, topmost wins', () => {
    assert.equal(pickHit([...hits, { x: 0, y: 0, w: 50, h: 22, id: 'over' }], { x: 10, y: 10 }, 44), 'over')
  })
  it('misses just outside a thin box without a min size', () => {
    assert.equal(pickHit(hits, { x: 10, y: 28 }), undefined)
  })
  it('grows a thin box to the min size around its center', () => {
    assert.equal(pickHit(hits, { x: 10, y: 28 }, 44), 'hall')
    assert.equal(pickHit(hits, { x: 10, y: 200 }, 44), undefined)
  })
  it('picks the nearer center when two grown boxes overlap', () => {
    assert.equal(pickHit(hits, { x: 10, y: 34 }, 44), 'tea')
  })
})
