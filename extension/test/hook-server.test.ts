/** Hook posts need the window's token and no browser Origin, so a web page cannot forge chat events. */
import { test } from 'node:test'
import assert from 'node:assert/strict'

class Emitter<T> {
  private fns: ((v: T) => void)[] = []
  event = (fn: (v: T) => void) => { this.fns.push(fn); return { dispose() {} } }
  fire(v: T) { for (const f of this.fns) f(v) }
  dispose() {}
}
const Module = require('module')
const orig = Module._load
Module._load = function (req: string, ...a: unknown[]) { return req === 'vscode' ? { EventEmitter: Emitter, workspace: {} } : orig.call(this, req, ...a) }

test('a hook post counts only with the window token and no Origin', async () => {
  const { HookServer } = await import('../src/hook-server')
  const { hub } = await import('../src/hub/hub-service')
  const server = new HookServer()
  const port = await server.start()
  const seen: string[] = []
  server.onRaw(({ payload }) => seen.push(String(payload.session_id)))
  const post = (id: string, headers: Record<string, string>) => fetch(`http://127.0.0.1:${port}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ session_id: id, hook_event_name: 'SessionEnd' }),
  })
  try {
    assert.equal((await post('none', {})).status, 403)
    assert.equal((await post('wrong', { 'x-switchboard-token': 'nope' })).status, 403)
    assert.equal((await post('browser', { 'x-switchboard-token': hub.token, Origin: 'https://evil.example' })).status, 403)
    assert.equal((await post('ok', { 'x-switchboard-token': hub.token })).status, 200)
    assert.deepEqual(seen, ['ok'])
  } finally {
    server.dispose()
  }
})
