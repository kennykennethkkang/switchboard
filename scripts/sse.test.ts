import { describe, it, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type * as http from 'http'
import { sseClients } from './sse'

const fake = (ok = () => true) => {
  const res = Object.assign(new EventEmitter(), { chunks: [] as string[], destroyed: false, write(c: string) { this.chunks.push(c); return ok() }, destroy() { this.destroyed = true } })
  return { req: new EventEmitter() as http.IncomingMessage, res, r: res as unknown as http.ServerResponse }
}
// Mocked clock: real timers miss pings on a busy machine.
const clock = (t: TestContext) => { t.mock.timers.enable({ apis: ['setInterval'] }); return (ms: number) => t.mock.timers.tick(ms) }

describe('sse clients', () => {
  it('pings an idle client and stops once it closes', t => {
    const wait = clock(t)
    const hub = sseClients(10)
    const { req, res, r } = fake()
    hub.add(req, r)
    hub.broadcast('{"a":1}')
    wait(35)
    assert.equal(res.chunks[0], 'data: {"a":1}\n\n')
    assert.ok(res.chunks.filter(c => c === ': ping\n\n').length >= 2)
    req.emit('close')
    assert.equal(hub.size, 0)
    const n = res.chunks.length
    wait(25)
    assert.equal(res.chunks.length, n)
  })

  it('drops a stalled client after repeated full buffers, and one whose socket errors', t => {
    const wait = clock(t)
    const hub = sseClients(5)
    const stalled = fake(() => false)
    const broken = fake()
    hub.add(stalled.req, stalled.r)
    hub.add(broken.req, broken.r)
    broken.res.emit('error', new Error('reset'))
    assert.equal(hub.size, 1)
    assert.ok(broken.res.destroyed)
    wait(40)
    assert.equal(hub.size, 0)
    assert.ok(stalled.res.destroyed)
  })

  it('keeps a client whose buffer drains between pings', t => {
    const wait = clock(t)
    let n = 0
    const hub = sseClients(5)
    const slow = fake(() => ++n % 2 === 0)
    hub.add(slow.req, slow.r)
    wait(40)
    assert.equal(hub.size, 1)
    slow.req.emit('close')
  })
})
