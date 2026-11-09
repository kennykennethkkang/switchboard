import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { clearDraft, getDraft, setDraft, DRAFT_DAYS, MAX_DRAFT, MAX_DRAFTS } from './drafts'

const mem = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v) },
  removeItem: (k: string) => { mem.delete(k) },
}
const DAY = 86_400_000

describe('drafts', () => {
  beforeEach(() => mem.clear())

  it('keeps text per key, and empty text removes it', () => {
    setDraft('msg:a', 'hello', 1)
    setDraft('msg:b', 'other', 1)
    assert.equal(getDraft('msg:a', 2), 'hello')
    assert.equal(getDraft('msg:b', 2), 'other')
    setDraft('msg:a', '', 3)
    assert.equal(getDraft('msg:a', 4), '')
    assert.equal(getDraft('nope'), '')
  })

  it('drops drafts older than the expiry', () => {
    setDraft('msg:a', 'old', 0)
    assert.equal(getDraft('msg:a', DRAFT_DAYS * DAY - 1), 'old')
    assert.equal(getDraft('msg:a', DRAFT_DAYS * DAY + 1), '')
  })

  it('caps one draft and the number kept, dropping the oldest', () => {
    setDraft('big', 'x'.repeat(MAX_DRAFT + 50), 1)
    assert.equal(getDraft('big', 2).length, MAX_DRAFT)
    for (let i = 0; i < MAX_DRAFTS + 5; i++) setDraft(`k${i}`, 't', 10 + i)
    assert.equal(getDraft('k0', 100), '')
    assert.equal(getDraft(`k${MAX_DRAFTS + 4}`, 100), 't')
  })

  it('clears with a stamp only if nothing newer was saved', () => {
    const at = setDraft('msg:a', 'sent', 5)
    setDraft('msg:a', 'sent', 6)
    clearDraft('msg:a', at, 7)
    assert.equal(getDraft('msg:a', 7), 'sent')
    clearDraft('msg:a', 6, 7)
    assert.equal(getDraft('msg:a', 7), '')
  })

  it('clear then remount restores nothing, and typing after a clear is kept', () => {
    setDraft('msg:a', 'just sent', 1)
    clearDraft('msg:a', undefined, 2)
    assert.equal(getDraft('msg:a', 3), '')
    setDraft('msg:a', 'next one', 4)
    assert.equal(getDraft('msg:a', 5), 'next one')
  })

  it('survives broken or missing storage', () => {
    mem.set('switchboard-drafts', '{not json')
    assert.equal(getDraft('msg:a'), '')
    const real = (globalThis as any).localStorage
    ;(globalThis as any).localStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
    try {
      assert.doesNotThrow(() => setDraft('msg:a', 'x'))
      assert.equal(getDraft('msg:a'), '')
    } finally { (globalThis as any).localStorage = real }
  })
})
