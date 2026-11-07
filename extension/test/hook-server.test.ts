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

test('an edit of a file another open chat just edited gets a deny with the reason; other posts get an empty body', async () => {
  const { HookServer } = await import('../src/hook-server')
  const { hub } = await import('../src/hub/hub-service')
  const now = Date.now()
  hub.set({ progress: [{ sessionId: 'them', cwd: '/w/p', state: 'working', roles: [], tasks: [], startedAt: now, at: now }] })
  const server = new HookServer()
  const port = await server.start()
  const post = (body: Record<string, unknown>, mirror = false) => fetch(`http://127.0.0.1:${port}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-switchboard-token': hub.token, ...(mirror ? { 'x-switchboard-mirror': '1' } : {}) },
    body: JSON.stringify({ session_id: 'me', cwd: '/w/p', hook_event_name: 'PreToolUse', ...body }),
  }).then(r => r.text())
  const edit = { tool_name: 'Edit', tool_input: { file_path: '/w/p/x.ts' } }
  try {
    // A denied or pending call is no edit; only its PostToolUse counts, from a mirror too.
    assert.equal(await post({ ...edit, session_id: 'them' }), '')
    assert.equal(await post(edit), '')
    await post({ ...edit, session_id: 'them', hook_event_name: 'PostToolUse' }, true)
    const out = JSON.parse(await post(edit))
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /edited x\.ts 1 min ago/)
    assert.equal(await post(edit), '', 'retry goes through')
    assert.equal(await post({ tool_name: 'Read', tool_input: { file_path: '/w/p/x.ts' } }), '')
  } finally {
    server.dispose()
    hub.set({ progress: [] })
  }
})
