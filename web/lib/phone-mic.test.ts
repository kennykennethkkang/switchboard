import assert from 'node:assert/strict'
import { test } from 'node:test'
import { phoneMic, pickMime, sendClip } from './phone-mic'

test('pickMime takes webm on Chrome and mp4 on iOS Safari', () => {
  assert.equal(pickMime(m => m.startsWith('audio/webm')), 'audio/webm;codecs=opus')
  assert.equal(pickMime(m => m === 'audio/mp4'), 'audio/mp4')
  assert.equal(pickMime(() => false), '')
  assert.equal(pickMime(() => { throw new Error('old Safari') }), '')
})

test('phoneMic needs a secure context and a recorder', () => {
  const ok = { isSecureContext: true, MediaRecorder: function () {}, navigator: { mediaDevices: { getUserMedia: () => {} } } }
  assert.equal(phoneMic(ok), 'ok')
  assert.equal(phoneMic({ ...ok, isSecureContext: false }), 'insecure')
  assert.equal(phoneMic({ isSecureContext: true, navigator: {} }), 'none')
  assert.equal(phoneMic(undefined), 'none')
})

test('sendClip posts the clip with its type and reads the transcript', async () => {
  let seen: RequestInit | undefined, url = ''
  const f = (async (u: string, init: RequestInit) => { url = u; seen = init; return new Response(JSON.stringify({ text: ' hi there ' })) }) as unknown as typeof fetch
  assert.deepEqual(await sendClip(new Blob(['x'], { type: 'audio/mp4' }), f), { text: 'hi there' })
  assert.equal(url, '/hub/voice')
  assert.equal(seen?.method, 'POST')
  assert.deepEqual(seen?.headers, { 'Content-Type': 'audio/mp4' })
})

test('sendClip says why there is no transcript', async () => {
  const answer = (r: Response) => (async () => r) as unknown as typeof fetch
  assert.deepEqual(await sendClip(new Blob(['x']), answer(new Response(JSON.stringify({ text: '' })))), { problem: "Didn't catch that. Tap the mic to try again." })
  assert.deepEqual(await sendClip(new Blob(['x']), answer(new Response('', { status: 404 }))), { problem: 'Could not transcribe (hub answered 404).' })
  const down = (async () => { throw new Error('offline') }) as unknown as typeof fetch
  assert.deepEqual(await sendClip(new Blob(['x']), down), { problem: 'Could not reach the Mac (offline).' })
})
