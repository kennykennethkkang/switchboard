/**
 * GET /hub/chat/screen and POST /hub/chat/keys: token gated, the screen from the window that holds the terminal.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { HubService } from '../src/hub/hub-service'
import { handleHub, type ChatReads, type HubReply } from '../src/hub/routes'
import type { Typed } from '../src/hub/screen'

const snap = { cols: 80, rows: 24, text: 'claude is here', running: true, at: 5, typing: false }
const typed: Array<[string, unknown]> = []

describe('the Screen routes', () => {
  const h = new HubService()
  const t = () => `token=${h.token}`
  const chat = (o: Partial<ChatReads> = {}): ChatReads => ({
    outputs: async () => null,
    transcript: async () => null,
    screen: async (s, ansi) => s === 's1' ? { ...snap, ...(ansi ? { ansi: '\x1b[1mclaude\x1b[0m' } : {}) } : undefined,
    keys: async (s, input): Promise<Typed> => {
      typed.push([s, input])
      return s === 'off' ? { status: 403, problem: 'Typing from here is off.' } : s === 'idle' ? { status: 409, problem: 'claude or codex is not running there' } : s === 's1' ? { status: 204 } : { status: 404, problem: 'no terminal' }
    },
    ...o,
  })
  const get = (q: string, c = chat()) => handleHub(h, 'GET', q, '', undefined, undefined, undefined, undefined, c) as HubReply | Promise<HubReply>
  const post = (q: string, body: string, c = chat()) => handleHub(h, 'POST', q, body, undefined, undefined, undefined, undefined, c) as HubReply | Promise<HubReply>

  it('needs the token to read the screen or type', async () => {
    assert.equal((await get('/hub/chat/screen?session=s1')).status, 403)
    assert.equal((await get('/hub/chat/screen?session=s1&token=x')).status, 403)
    assert.equal((await post('/hub/chat/keys', '{"session":"s1","key":"enter"}')).status, 403)
    assert.equal((await post('/hub/chat/keys?token=x', '{"session":"s1","key":"enter"}')).status, 403)
    assert.deepEqual(typed, [])
  })

  it('serves the screen as text, and the ANSI copy only when asked', async () => {
    const plain = await get(`/hub/chat/screen?session=s1&${t()}`)
    assert.equal(plain.status, 200)
    assert.equal(plain.contentType, 'application/json')
    assert.deepEqual(JSON.parse(plain.body), snap)
    const colour = JSON.parse((await get(`/hub/chat/screen?session=s1&ansi=1&${t()}`)).body)
    assert.equal(colour.ansi, '\x1b[1mclaude\x1b[0m')
  })

  it('answers 404 for a chat with no screen here, and for a window with no screen feed', async () => {
    assert.equal((await get(`/hub/chat/screen?session=zz&${t()}`)).status, 404)
    assert.equal((await get(`/hub/chat/screen?session=s1&${t()}`, { outputs: async () => null, transcript: async () => null })).status, 404)
  })

  it('answers 500 with the reason when reading the screen throws', async () => {
    const r = await get(`/hub/chat/screen?session=s1&${t()}`, chat({ screen: async () => { throw new Error('xterm broke') } }))
    assert.deepEqual([r.status, r.body], [500, 'xterm broke'])
  })

  it('types a key or text, 204 when sent', async () => {
    typed.length = 0
    assert.equal((await post(`/hub/chat/keys?${t()}`, '{"session":"s1","key":"enter"}')).status, 204)
    assert.equal((await post(`/hub/chat/keys?${t()}`, '{"session":"s1","text":"hello"}')).status, 204)
    assert.deepEqual(typed, [['s1', { key: 'enter' }], ['s1', { text: 'hello' }]])
  })

  it('says why it did not type: off, nothing there, or not claude', async () => {
    const r = async (session: string) => post(`/hub/chat/keys?${t()}`, JSON.stringify({ session, key: 'esc' }))
    assert.deepEqual([(await r('off')).status, (await r('off')).body], [403, 'Typing from here is off.'])
    assert.equal((await r('idle')).status, 409)
    assert.equal((await r('gone')).status, 404)
    assert.equal((await post(`/hub/chat/keys?${t()}`, '{"session":"s1","key":"esc"}', { outputs: async () => null, transcript: async () => null })).status, 404)
  })

  it('refuses a body that is not exactly session plus text or key', async () => {
    typed.length = 0
    for (const body of ['', 'nope', '[]', '{}', '{"key":"enter"}', '{"session":5,"key":"enter"}', '{"session":"s1","key":"enter","extra":1}', '{"session":"s1","key":"enter","token":"x"}', `{"session":"${'a'.repeat(65)}","key":"enter"}`, '{"session":"a b","key":"enter"}']) {
      assert.equal((await post(`/hub/chat/keys?${t()}`, body)).status, 400, body)
    }
    assert.deepEqual(typed, [])
  })

  it('passes bad key input down to be refused with 400', async () => {
    const real = chat({ keys: undefined })
    const { typeKeys } = await import('../src/hub/screen')
    const r = await post(`/hub/chat/keys?${t()}`, '{"session":"s1","text":"a\\u001b[A"}', { ...real, keys: (s, i) => typeKeys(s, i, { snapshot: async () => undefined, typing: () => true, type: async () => ({ status: 204 }) }) })
    assert.equal(r.status, 400)
  })

  it('has no GET for keys and no POST for the screen', async () => {
    assert.equal((await get(`/hub/chat/keys?session=s1&${t()}`)).status, 404)
    assert.equal((await post(`/hub/chat/screen?session=s1&${t()}`, '{}')).status, 404)
  })
})
