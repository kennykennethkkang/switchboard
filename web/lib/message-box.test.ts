import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { boxNote, replyBox, sendFailure, withKeywords } from './message-box'
import type { ChatRow } from './hub-types'

const row = (extra: Partial<ChatRow>): ChatRow => ({ pid: 1, sessionId: 's1', cwd: '/w', link: '', live: true, why: [], ...extra })

describe('message box', () => {
  it('has no note for a chat that takes messages', () => {
    assert.equal(boxNote(row({ takes: true })), undefined)
  })

  it('says why a chat cannot take messages, per AI', () => {
    assert.match(boxNote(row({ ai: 'codex' }))!, /Codex/)
    assert.match(boxNote(row({}))!, /usage-meter/)
  })

  it('says a chat that is not live is not running, whatever its AI', () => {
    assert.match(boxNote(row({ ai: 'codex', live: false }))!, /not running/)
  })
})

describe('send failure', () => {
  const a = { type: 'hub-send', sessionId: 's1', text: 'A' } as const
  const b = { type: 'hub-send', sessionId: 's1', text: 'B' } as const
  it('belongs only to the send it came from', () => {
    assert.equal(sendFailure(a, { text: 'send failed: gone', at: 1, for: a }), 'send failed: gone')
    assert.equal(sendFailure(b, { text: 'send failed: gone', at: 1, for: a }), undefined)
  })
  it('ignores other commands and no send', () => {
    assert.equal(sendFailure(a, null), undefined)
    assert.equal(sendFailure(undefined, { text: 'send failed: x', at: 1, for: a }), undefined)
    assert.equal(sendFailure(a, { text: 'star failed: x', at: 1 }), undefined)
  })
})

describe('thinking keywords', () => {
  it('adds the toggled keywords to this send only, after the text', () => {
    assert.equal(withKeywords('fix it', { ultrathink: true, ultracode: false }), 'fix it ultrathink')
    assert.equal(withKeywords('fix it', { ultrathink: true, ultracode: true }), 'fix it ultrathink ultracode')
    assert.equal(withKeywords('fix it', { ultrathink: false, ultracode: false }), 'fix it')
  })

  it('leaves an empty message empty, and a typed keyword as typed', () => {
    assert.equal(withKeywords('', { ultrathink: true, ultracode: true }), '')
    assert.equal(withKeywords('ultrathink this', { ultrathink: false, ultracode: false }), 'ultrathink this')
  })
})

describe('map reply box', () => {
  it('targets a live chat, with the note when it cannot take messages', () => {
    const chats = [row({ sessionId: 'a', takes: true }), row({ sessionId: 'b' }), row({ sessionId: 'c', live: false })]
    assert.deepEqual(replyBox(chats, 'a'), { sessionId: 'a', note: undefined })
    assert.match(replyBox(chats, 'b')!.note!, /usage-meter/)
    assert.equal(replyBox(chats, 'c'), undefined)
    assert.equal(replyBox(chats, 'x'), undefined)
    assert.equal(replyBox(chats, undefined), undefined)
  })
})
