import { it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as http from 'http'
import type { AddressInfo } from 'net'
import * as os from 'os'
import * as path from 'path'
import * as zlib from 'zlib'
import { serveStatic } from './static'

const get = (port: number, file: string, headers: Record<string, string> = {}) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((ok, fail) => {
  http.get({ host: '127.0.0.1', port, path: file, headers }, x => {
    const parts: Buffer[] = []
    x.on('data', c => parts.push(c))
    x.on('end', () => ok({ status: x.statusCode ?? 0, headers: x.headers, body: Buffer.concat(parts) }))
  }).on('error', fail)
})

it('serves assets gzipped with an ETag, answers 304 on a match, plain when gzip is not taken', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-static-'))
  const js = 'console.log("hi");'.repeat(100)
  fs.writeFileSync(path.join(dir, 'index.js'), js)
  const app = http.createServer((req, res) => serveStatic(req, res, dir))
  await new Promise<void>(ok => app.listen(0, '127.0.0.1', ok))
  const port = (app.address() as AddressInfo).port
  try {
    const z = await get(port, '/index.js', { 'Accept-Encoding': 'gzip, br' })
    assert.equal(z.status, 200)
    assert.equal(z.headers['content-encoding'], 'gzip')
    assert.equal(z.headers['content-type'], 'application/javascript')
    assert.ok(z.headers['cache-control'])
    assert.equal(zlib.gunzipSync(z.body).toString(), js)
    const tag = String(z.headers.etag)
    assert.match(tag, /^"[0-9a-f]+"$/)
    const plain = await get(port, '/index.js')
    assert.deepEqual([plain.headers['content-encoding'], plain.body.toString(), plain.headers.etag], [undefined, js, tag])
    const same = await get(port, '/index.js', { 'If-None-Match': tag })
    assert.deepEqual([same.status, same.body.length], [304, 0])
    const page = await get(port, '/')
    assert.equal(page.headers['x-frame-options'], 'DENY')
    assert.equal((await get(port, '/missing.js')).status, 404)
    assert.equal((await get(port, '/x.exe')).status, 404)
  } finally { app.close() }
})
