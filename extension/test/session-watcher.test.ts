import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// CLAUDE_DIR comes from the home folder at import, and the watcher needs vscode's EventEmitter.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-sw-'))
process.env.HOME = home
class Emitter<T> {
  private fns: ((v: T) => void)[] = []
  event = (fn: (v: T) => void) => { this.fns.push(fn); return { dispose() {} } }
  fire(v: T) { for (const f of this.fns) f(v) }
  dispose() {}
}
const Module = require('module')
const orig = Module._load
Module._load = function (req: string, ...a: unknown[]) { return req === 'vscode' ? { EventEmitter: Emitter, workspace: {} } : orig.call(this, req, ...a) }

const line = (role: 'user' | 'assistant', text: string) => JSON.stringify({ type: role, message: { role, content: [{ type: 'text', text }] } }) + '\n'

describe('session watcher', () => {
  it('keeps an ended session listed, capped, and re-attaches it without resending its last turn', async () => {
    const { SessionWatcher } = await import('../src/session-watcher')
    const { INACTIVITY_TIMEOUT_MS } = await import('../src/constants')
    const dir = path.join(home, '.claude', 'projects', '-p')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 's1.jsonl')
    fs.writeFileSync(file, line('user', 'first ask') + line('assistant', 'first answer'))
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
    const w = new SessionWatcher() as unknown as { watchSession(id: string, f: string): void; scanForActiveSessions(): void; replaySessionStart(ids?: string[]): void; getActiveSessions(): { id: string; status: string }[]; onEvent(fn: (e: { type: string; payload: Record<string, unknown> }) => void): void; dispose(): void }
    const said: string[] = [], types: string[] = []
    w.onEvent(e => { types.push(e.type); if (e.type === 'message') said.push(String(e.payload.content)) })
    try {
      w.watchSession('s1', file)
      assert.deepEqual(said, ['first ask', 'first answer'])
      mock.timers.tick(INACTIVITY_TIMEOUT_MS + 1)
      assert.deepEqual(w.getActiveSessions().map(s => [s.id, s.status]), [['s1', 'completed']])
      // A panel opened later draws it finished.
      types.length = 0
      w.replaySessionStart(['s1'])
      assert.deepEqual(types, ['agent_spawn', 'agent_complete'])

      fs.appendFileSync(file, line('assistant', 'later note'))
      const t = new Date(Date.now() + 5000)
      fs.utimesSync(file, t, t)
      said.length = 0
      w.scanForActiveSessions()
      assert.deepEqual(w.getActiveSessions().map(s => [s.id, s.status]), [['s1', 'active']])
      assert.deepEqual(said, ['later note'])

      // Ended records stop at 50.
      const ww = w as unknown as { ended: Map<string, unknown> }
      for (let i = 0; i < 60; i++) {
        const f = path.join(dir, `x${i}.jsonl`)
        fs.writeFileSync(f, line('user', `ask ${i}`))
        w.watchSession(`x${i}`, f)
      }
      mock.timers.tick(INACTIVITY_TIMEOUT_MS + 1)
      assert.equal(ww.ended.size, 50)
      assert.equal(w.getActiveSessions().length, 50)
    } finally {
      w.dispose()
      mock.timers.reset()
      fs.rmSync(home, { recursive: true, force: true })
    }
  })
})
