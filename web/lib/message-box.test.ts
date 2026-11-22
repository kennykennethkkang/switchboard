import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { boxNote, effortCommand, MAX_OPTS, readOpts, replyBox, sendFailure, sendKeywords, withKeywords, writeOpts } from './message-box'
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

  it('leaves a slash command alone, so a sticky keyword never becomes its argument', () => {
    assert.equal(withKeywords('/compact', { ultrathink: true, ultracode: true }), '/compact')
    assert.equal(withKeywords('/effort xhigh', { ultrathink: false, ultracode: true }), '/effort xhigh')
  })

  it('still adds keywords to a message that starts with a path', () => {
    assert.equal(withKeywords('/Users/me/app/foo.ts throws, fix it', { ultrathink: false, ultracode: true }), '/Users/me/app/foo.ts throws, fix it ultracode')
  })

  it('adds the chat-wide ultracode to every send, once', () => {
    assert.equal(withKeywords('fix it', sendKeywords({ ultrathink: false, ultracode: false }, true)), 'fix it ultracode')
    assert.equal(withKeywords('fix it', sendKeywords({ ultrathink: false, ultracode: true }, true)), 'fix it ultracode')
    assert.equal(withKeywords('fix it', sendKeywords({ ultrathink: true, ultracode: false }, true)), 'fix it ultrathink ultracode')
    assert.equal(withKeywords('fix it', sendKeywords({ ultrathink: true, ultracode: false }, false)), 'fix it ultrathink')
  })
})

describe('chat effort and ultracode', () => {
  it('types /effort with the level, Default as auto', () => {
    assert.equal(effortCommand('xhigh'), '/effort xhigh')
    assert.equal(effortCommand('default'), '/effort auto')
  })

  it('keeps each chat its own picks', () => {
    let raw = writeOpts(null, 'a', { effort: 'xhigh', ultracode: true })
    raw = writeOpts(raw, 'b', { effort: 'low' })
    assert.deepEqual(readOpts(raw, 'a'), { effort: 'xhigh', ultracode: true })
    assert.deepEqual(readOpts(raw, 'b'), { effort: 'low' })
    assert.deepEqual(readOpts(raw, 'c'), {})
  })

  it('drops a chat back to Default and off', () => {
    const raw = writeOpts(writeOpts(null, 'a', { effort: 'max', ultracode: true }), 'a', { effort: 'default', ultracode: false })
    assert.deepEqual(readOpts(raw, 'a'), {})
    assert.equal(raw, '{}')
  })

  it('reads junk or a bad value as nothing set', () => {
    assert.deepEqual(readOpts('not json', 'a'), {})
    assert.deepEqual(readOpts('{"a":{"effort":"huge","ultracode":"yes"}}', 'a'), {})
    assert.deepEqual(readOpts(writeOpts('[1]', 'a', { effort: 'high' }), 'a'), { effort: 'high' })
  })

  it('keeps only the newest chats past the cap', () => {
    let raw: string | null = null
    for (let i = 0; i <= MAX_OPTS; i++) raw = writeOpts(raw, `c${i}`, { effort: 'high' })
    assert.deepEqual(readOpts(raw, 'c0'), {})
    assert.deepEqual(readOpts(raw, `c${MAX_OPTS}`), { effort: 'high' })
    assert.equal(Object.keys(JSON.parse(raw!)).length, MAX_OPTS)
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
