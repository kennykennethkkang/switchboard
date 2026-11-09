import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as http from 'http'
import type { AddressInfo } from 'net'
import * as os from 'os'
import * as path from 'path'
import { pushRoute } from './push'

async function serve(dir: string) {
  const server = http.createServer((req, res) => { if (!pushRoute(req, res, dir)) res.writeHead(404).end() })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { base, close: () => server.close() }
}

const sub = (endpoint: string) => JSON.stringify({ endpoint, keys: { p256dh: 'p', auth: 'a' }, expirationTime: null })
const post = (base: string, body: string, type = 'application/json') => fetch(`${base}/push/subscribe`, { method: 'POST', headers: { 'Content-Type': type }, body })

describe('pushRoute', () => {
  it('serves the manifest, service worker and VAPID key', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-'))
    const s = await serve(dir)
    try {
      const m = await (await fetch(`${s.base}/manifest.webmanifest`)).json()
      assert.equal(m.display, 'standalone')
      const sw = await fetch(`${s.base}/sw.js`)
      assert.match(sw.headers.get('content-type') ?? '', /javascript/)
      assert.match(await sw.text(), /addEventListener\('push'/)
      const k = await (await fetch(`${s.base}/push/key`)).json()
      assert.equal(Buffer.from(k.key, 'base64url').length, 65)
      assert.equal((await fetch(`${s.base}/other`)).status, 404)
    } finally { s.close() }
  })
  it('stores a subscription once per endpoint and caps the body', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-'))
    const s = await serve(dir)
    try {
      assert.equal((await post(s.base, sub('https://web.push.apple.com/1'))).status, 204)
      assert.equal((await post(s.base, sub('https://web.push.apple.com/1'))).status, 204)
      assert.equal((await post(s.base, sub('https://web.push.apple.com/1') + ' '.repeat(5000))).status, 413)
      assert.equal((await post(s.base, 'not json')).status, 400)
      assert.equal((await post(s.base, sub('http://web.push.apple.com/2'))).status, 400)
      // A plain form post from another page cannot subscribe.
      assert.equal((await post(s.base, sub('https://web.push.apple.com/3'), 'text/plain')).status, 415)
      const list = JSON.parse(fs.readFileSync(path.join(dir, 'push.json'), 'utf8'))
      assert.deepEqual(list.map((x: { endpoint: string }) => x.endpoint), ['https://web.push.apple.com/1'])
    } finally { s.close() }
  })
})
