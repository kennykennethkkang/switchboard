import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_MESSAGE, UPLOAD_MAX, fmtSize, sendSlices, withAttached } from './attach'
import type { UploadAck, UploadToExtension } from './vscode-bridge'

// A fake extension: acks each chunk a tick later, answers end with the joined text. fail: answer done(problem) instead of acking that chunk.
function fakeExtension(fail?: number) {
  const sent: UploadToExtension[] = []
  let cb: (m: UploadAck) => void = () => {}
  let inFlight = 0, maxInFlight = 0, chunks = 0, text = ''
  const post = (m: UploadToExtension) => {
    sent.push(m)
    const id = m.id
    if (m.type === 'upload-chunk') {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); chunks++
      text += new TextDecoder().decode(m.data)
      const n = chunks
      setTimeout(() => { inFlight--; cb(n === fail ? { type: 'upload-done', id, problem: 'disk full' } : { type: 'upload-progress', id }) })
    }
    if (m.type === 'upload-end') setTimeout(() => cb({ type: 'upload-done', id, path: `/u/${text}` }))
  }
  const listen = (f: (m: UploadAck) => void) => { cb = f; return () => { cb = () => {} } }
  return { sent, post, listen, max: () => maxInFlight }
}
const head = { id: 'x', cwd: '/p', session: 's' }


describe('withAttached', () => {
  it('leaves a message with nothing attached as typed, trimmed', () => {
    assert.equal(withAttached('  hi  ', []), 'hi')
  })
  it('lists each attached path after the text, so the chat can Read them', () => {
    assert.equal(withAttached('look', ['/u/a.png', '/u/b c.txt']), 'look\n\nAttached files:\n- /u/a.png\n- /u/b c.txt')
  })
  it('sends attachments alone when there is no text', () => {
    assert.equal(withAttached(' ', ['/u/a.png']), 'Attached files:\n- /u/a.png')
  })
  it('says nothing to send for empty text and no files', () => {
    assert.equal(withAttached('  ', []), '')
  })
  it('counts the paths in the 4000 character cap', () => {
    assert.equal(MAX_MESSAGE, 4000)
    const t = withAttached('x'.repeat(3990), ['/u/a.png'])
    assert.ok(t.length > MAX_MESSAGE)
  })
})

describe('fmtSize', () => {
  it('reads like a file browser', () => {
    assert.deepEqual([fmtSize(12), fmtSize(2048), fmtSize(5 * 1024 * 1024)], ['12 B', '2.0 KB', '5.0 MB'])
    assert.equal(UPLOAD_MAX, 100 * 1024 * 1024)
  })
})

describe('sendSlices', () => {
  it('sends the file in order, one slice in flight, with progress per ack', async () => {
    const ext = fakeExtension(), seen: number[] = []
    const r = await sendSlices(new File(['abcdefg'], 'a.txt'), head, ext.post, ext.listen, f => seen.push(f), undefined, 3)
    assert.deepEqual(r, { path: '/u/abcdefg' })
    assert.deepEqual(ext.sent.map(m => m.type), ['upload-start', 'upload-chunk', 'upload-chunk', 'upload-chunk', 'upload-end'])
    assert.deepEqual(ext.sent[0], { type: 'upload-start', id: 'x', cwd: '/p', name: 'a.txt', session: 's' })
    assert.equal(ext.max(), 1)
    assert.deepEqual(seen.map(f => f.toFixed(2)), ['0.43', '0.86', '1.00'])
  })
  it('sends start and end for an empty file', async () => {
    const ext = fakeExtension()
    assert.deepEqual(await sendSlices(new File([], 'e'), head, ext.post, ext.listen, () => {}), { path: '/u/' })
    assert.deepEqual(ext.sent.map(m => m.type), ['upload-start', 'upload-end'])
  })
  it('stops at a slice the extension refused', async () => {
    const ext = fakeExtension(2)
    assert.deepEqual(await sendSlices(new File(['abcdefg'], 'a.txt'), head, ext.post, ext.listen, () => {}, undefined, 3), { problem: 'disk full' })
    assert.deepEqual(ext.sent.map(m => m.type), ['upload-start', 'upload-chunk', 'upload-chunk'])
  })
  it('aborts mid-upload: tells the extension and sends nothing more', async () => {
    const ext = fakeExtension(), ac = new AbortController()
    const r = await sendSlices(new File(['abcdefg'], 'a.txt'), head, ext.post, ext.listen, () => ac.abort(), ac.signal, 3)
    assert.deepEqual(r, { problem: 'removed' })
    assert.deepEqual(ext.sent.map(m => m.type), ['upload-start', 'upload-chunk', 'upload-abort'])
  })
})
