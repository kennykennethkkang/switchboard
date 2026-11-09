import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { keepSame } from './hub-share'
import type { HubState } from './hub-types'

const st = (o: Record<string, unknown>) => o as unknown as HubState

describe('keepSame', () => {
  it('keeps the old object for each field whose content did not change', () => {
    const prev = st({ chats: [{ sessionId: 'a' }], todos: { items: [1] }, progress: [{ at: 1 }] })
    const next = st({ chats: [{ sessionId: 'a' }], todos: { items: [1] }, progress: [{ at: 2 }] })
    const out = keepSame(prev, next)
    assert.equal(out.chats, prev.chats)
    assert.equal((out as unknown as Record<string, unknown>).todos, (prev as unknown as Record<string, unknown>).todos)
    assert.equal(out.progress, next.progress)
    assert.notEqual(out, prev)
  })

  it('answers the old state itself when nothing changed', () => {
    const prev = st({ chats: [], voice: 'off' })
    assert.equal(keepSame(prev, st({ chats: [], voice: 'off' })), prev)
  })

  it('takes the new state when there is no old one, and drops fields the new one left out', () => {
    const next = st({ chats: [] })
    assert.equal(keepSame(null, next), next)
    const out = keepSame(st({ chats: [], repo: { files: [] } }), st({ chats: [] }))
    assert.equal('repo' in out, false)
  })
})
