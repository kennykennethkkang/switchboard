import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { HubService } from '../src/hub/hub-service'
import { commandProblem, handleVoice } from '../src/hub/routes'

describe('hub-git ops', () => {
  it('takes the fast-forward push op', () => {
    assert.equal(commandProblem({ type: 'hub-git', sessionId: 's', op: 'push' }), undefined)
    assert.match(commandProblem({ type: 'hub-git', sessionId: 's', op: 'force' }) ?? '', /op/)
  })
})

describe('POST /hub/voice', () => {
  const clip = (h: HubService, type: string | undefined, body: Buffer[], token = h.token) => handleVoice(h, `/hub/voice?token=${token}`, type, body)
  it('passes the bytes to the mic and answers the text', async () => {
    const h = new HubService()
    let got: Buffer | undefined
    h.voiceClip = async b => { got = Buffer.from(b); return 'hello there' }
    const r = await clip(h, 'audio/webm;codecs=opus', [Buffer.from('ab'), Buffer.from('cd')])
    assert.deepEqual([r.status, JSON.parse(r.body)], [200, { text: 'hello there' }])
    assert.equal(got?.toString(), 'abcd')
  })
  it('refuses a bad token, a non audio type and an oversized clip', async () => {
    const h = new HubService()
    let calls = 0
    h.voiceClip = async () => { calls++; return '' }
    assert.equal((await clip(h, 'audio/webm', [Buffer.from('x')], 'nope')).status, 403)
    assert.equal((await clip(h, 'text/html', [Buffer.from('x')])).status, 415)
    assert.equal((await clip(h, undefined, [Buffer.from('x')])).status, 415)
    assert.equal((await clip(h, 'audio/mp4', [Buffer.alloc(5 * 1024 * 1024 + 1)])).status, 413)
    assert.equal(calls, 0)
  })
  it('answers the mic problem as plain text, 503 with no mic', async () => {
    const h = new HubService()
    assert.equal((await clip(h, 'audio/mp4', [Buffer.from('x')])).status, 503)
    h.voiceClip = async () => { throw new Error('Voice needs models.') }
    const r = await clip(h, 'audio/mp4', [Buffer.from('x')])
    assert.deepEqual([r.status, r.body], [500, 'Voice needs models.'])
  })
})
