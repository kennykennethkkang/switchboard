import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { EventEmitter } from 'node:events'
import type * as http from 'node:http'

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'relay-')))
const was = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, CODEX_HOME: process.env.CODEX_HOME, SWITCHBOARD_RUNTIME: process.env.SWITCHBOARD_RUNTIME }
Object.assign(process.env, { HOME: home, USERPROFILE: home })
delete process.env.CODEX_HOME
process.env.SWITCHBOARD_RUNTIME = 'auto'
after(() => {
  for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  fs.rmSync(home, { recursive: true, force: true })
})

test('transcripts are read only once a page opens the event stream, which then gets the live session', async t => {
  const workspace = path.join(home, 'proj')
  const dir = path.join(home, '.claude', 'projects', workspace.replace(/[^a-zA-Z0-9]/g, '-'))
  const codex = path.join(home, '.codex', 'sessions')
  for (const d of [workspace, dir, codex]) fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(dir, 's1.jsonl'), JSON.stringify({ type: 'user', cwd: workspace, sessionId: 's1', uuid: 'u1', timestamp: new Date().toISOString(), message: { role: 'user', content: 'hello there' } }) + '\n')

  // After HOME moved: the relay takes its folders from it at load.
  const require = createRequire(__filename)
  const Module = require('module') as { _load: (...a: unknown[]) => unknown }
  const load = Module._load
  t.mock.method(Module, '_load', function (this: unknown, name: unknown, ...rest: unknown[]) { return name === 'vscode' ? require('./vscode-shim.js') : load.call(this, name, ...rest) })
  const { createRelay } = await import('./relay')
  const raw = require('fs') as typeof fs
  const reads = t.mock.method(raw, 'readdirSync')
  const scans = () => reads.mock.calls.filter(c => [path.dirname(dir), dir, codex].includes(String(c.arguments[0]))).length

  const relay = await createRelay({ workspace })
  t.after(() => relay.dispose())
  assert.equal(scans(), 0)

  const sent: string[] = []
  const res = Object.assign(new EventEmitter(), { writeHead() {}, write(s: string) { sent.push(s); return true }, destroy() {} }) as unknown as http.ServerResponse
  const req = new EventEmitter() as http.IncomingMessage
  relay.handleSSE(req, res)
  assert.ok(scans() > 0)
  assert.match(sent.join(''), /"type":"session-list".*"id":"s1"/)
  assert.match(sent.join(''), /agent-event-batch/)
  req.emit('close')
})
