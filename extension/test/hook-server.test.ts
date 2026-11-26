/** Hook posts need the window's token and no browser Origin, so a web page cannot forge chat events. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

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

test('a refused closing question never counts as asked', async () => {
  const { HookServer } = await import('../src/hook-server')
  const { hub } = await import('../src/hub/hub-service')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'closing-'))
  const transcript_path = path.join(dir, 't.jsonl')
  fs.writeFileSync(transcript_path, [
    { type: 'user', message: { content: 'fix it' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/r/a.ts' } }] } },
  ].map(e => JSON.stringify(e)).join('\n') + '\n')
  const server = new HookServer()
  const port = await server.start()
  const seen: string[] = []
  server.onRaw(({ payload }) => seen.push(String(payload.tool_use_id)))
  const ask = (tool_use_id: string, question: string) => fetch(`http://127.0.0.1:${port}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-switchboard-token': hub.token },
    body: JSON.stringify({ session_id: 'c', cwd: '/r', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id, transcript_path, tool_input: { questions: [{ question, options: [{ label: 'Approve' }, { label: 'Send back' }] }] } }),
  }).then(r => r.text())
  try {
    assert.match(await ask('early', 'Approve this chat as finished?'), /"deny"/)
    assert.equal(await ask('other', 'Which layout?'), '')
    assert.deepEqual(seen, ['other'])
  } finally {
    server.dispose()
    fs.rmSync(dir, { recursive: true })
  }
})

test('a Codex role run gets the edit guard but makes no chat of its own', async () => {
  const { HookServer } = await import('../src/hook-server')
  const { hub } = await import('../src/hub/hub-service')
  const server = new HookServer()
  const port = await server.start()
  const seen: string[] = []
  server.onRaw(({ payload }) => seen.push(String(payload.session_id)))
  const post = (body: object) => fetch(`http://127.0.0.1:${port}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-switchboard-token': hub.token }, body: JSON.stringify(body),
  })
  try {
    assert.equal((await post({ session_id: 'role', hook_event_name: 'Stop', cwd: '/r', role_run: 'engineer-codex' })).status, 200)
    assert.equal((await post({ session_id: 'chat', hook_event_name: 'Stop', cwd: '/r' })).status, 200)
    assert.deepEqual(seen, ['chat'])
  } finally {
    server.dispose()
  }
})

test('a role run edit counts as its parent chat\'s, from a mirror too, and Codex apply_patch edits are guarded', async () => {
  const { HookServer } = await import('../src/hook-server')
  const { hub } = await import('../src/hub/hub-service')
  const now = Date.now()
  hub.set({ progress: ['lead', 'other'].map(sessionId => ({ sessionId, cwd: '/w/p', state: 'working' as const, roles: [], tasks: [], startedAt: now, at: now })) })
  const server = new HookServer()
  const port = await server.start()
  const post = (body: Record<string, unknown>, mirror = false) => fetch(`http://127.0.0.1:${port}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-switchboard-token': hub.token, ...(mirror ? { 'x-switchboard-mirror': '1' } : {}) },
    body: JSON.stringify({ cwd: '/w/p', hook_event_name: 'PreToolUse', ...body }),
  }).then(r => r.text())
  const patch = (file: string) => ({ tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Update File: ${file}\n@@\n-a\n+b\n*** End Patch\n` } })
  const role = { session_id: 'codex-run', role_run: 'engineer-codex', role_parent: 'lead' }
  try {
    await post({ ...role, ...patch('a.ts'), hook_event_name: 'PostToolUse' }, true)
    const out = JSON.parse(await post({ session_id: 'other', tool_name: 'Edit', tool_input: { file_path: '/w/p/a.ts' } }))
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /edited a\.ts/)
    // A plain Codex chat: apply_patch PostToolUse noted, its next patch on the same file guarded.
    await post({ session_id: 'other', tool_name: 'Write', tool_input: { file_path: '/w/p/b.ts' }, hook_event_name: 'PostToolUse' })
    const deny = JSON.parse(await post({ ...role, ...patch('/w/p/b.ts') }))
    assert.equal(deny.hookSpecificOutput.permissionDecision, 'deny')
    // A move names its destination too.
    await post({ session_id: 'other', tool_name: 'Write', tool_input: { file_path: '/w/p/c.ts' }, hook_event_name: 'PostToolUse' })
    const move = { tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Update File: /w/p/old.ts\n*** Move to: /w/p/c.ts\n@@\n-a\n+b\n*** End Patch\n' } }
    assert.equal(JSON.parse(await post({ ...role, ...move })).hookSpecificOutput.permissionDecision, 'deny')
    // The chat-wait mod is on, but a role run does not run it.
    hub.set({ installed: [{ kind: 'mod', name: 'chat-wait@kenneth-mods', enabled: true }] })
    await post({ session_id: 'other', tool_name: 'Write', tool_input: { file_path: '/w/p/d.ts' }, hook_event_name: 'PostToolUse' })
    assert.equal(JSON.parse(await post({ ...role, ...patch('/w/p/d.ts') })).hookSpecificOutput.permissionDecision, 'deny')
  } finally {
    hub.set({ installed: [] })
    server.dispose()
    hub.set({ progress: [] })
  }
})

test('a rebound Host is refused; loopback hosts and multibyte bodies split across chunks pass', async () => {
  const http = await import('node:http')
  const { HookServer } = await import('../src/hook-server')
  const { hub } = await import('../src/hub/hub-service')
  const server = new HookServer()
  const port = await server.start()
  const seen: string[] = []
  server.onRaw(({ payload }) => seen.push(String(payload.cwd)))
  const send = (host: string | undefined, chunks: Buffer[]) => new Promise<number>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', headers: { ...(host ? { Host: host } : {}), 'x-switchboard-token': hub.token, 'Content-Type': 'application/json' } }, r => { r.resume(); resolve(r.statusCode ?? 0) })
    req.on('error', reject)
    for (const c of chunks) req.write(c)
    req.end()
  })
  const body = Buffer.from(JSON.stringify({ session_id: 'u', hook_event_name: 'SessionEnd', cwd: '/w/ééé' }))
  const cut = body.indexOf(0xc3) + 1
  try {
    assert.equal(await send('evil.test', [body]), 403)
    assert.equal(await send(`localhost:${port}`, [body.subarray(0, cut), body.subarray(cut)]), 200)
    assert.equal(await send(`127.0.0.1:${port}`, [body]), 200)
    await new Promise(r => setTimeout(r, 50))
    assert.deepEqual(seen, ['/w/ééé', '/w/ééé'])
  } finally {
    server.dispose()
  }
})

test('POST /hub/discuss runs the discussion with the token, checks its shape, and never spawns on a bad one', async () => {
  const { handleHub } = await import('../src/hub/routes')
  const { hub } = await import('../src/hub/hub-service')
  const seen: string[] = []
  const cli = async (ai: string, prompt: string, cwd: string) => { seen.push(`${ai}@${cwd}`); return 'ok\nAgreed on: all\nDisagreed on: none' }
  const post = (body: unknown, token: string | undefined = hub.token) => handleHub(hub, 'POST', '/hub/discuss', JSON.stringify(body), undefined, undefined, undefined, undefined, undefined, token, undefined, cli as never)
  const good = { question: 'Q', cwd: '/p', from: 'claude' }
  assert.equal(((await post(good, 'nope')) as { status: number }).status, 403)
  assert.equal(((await post({ ...good, from: 'gpt' })) as { status: number }).status, 400)
  assert.equal(((await post({ ...good, question: ' ' })) as { status: number }).status, 400)
  assert.deepEqual(seen, [])
  const r = (await post(good)) as { status: number; body: string }
  assert.equal(r.status, 200)
  assert.match(JSON.parse(r.body).text, /Agreed on: all/)
  assert.deepEqual(seen, ['codex@/p'])
})
