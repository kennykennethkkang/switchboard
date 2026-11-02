import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { boxNote, sendFailure } from './message-box'
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
