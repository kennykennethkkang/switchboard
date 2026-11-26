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
  it('a line that throws does not drop the rest of the batch', async () => {
    const { SessionWatcher } = await import('../src/session-watcher')
    const dir = path.join(home, '.claude', 'projects', '-q')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'b1.jsonl')
    fs.writeFileSync(file, line('user', 'first'))
    const w = new SessionWatcher() as unknown as { watchSession(id: string, f: string): void; readNewLines(id: string): void; parser: { processTranscriptLine: (l: string, ...r: unknown[]) => void }; dispose(): void }
    try {
      w.watchSession('b1', file)
      const real = w.parser.processTranscriptLine.bind(w.parser)
      const seen: string[] = []
      w.parser.processTranscriptLine = (l, ...r) => { seen.push(l); if (l.includes('boom')) throw new Error('boom'); real(l, ...r) }
      fs.appendFileSync(file, line('user', 'boom') + line('user', 'after'))
      w.readNewLines('b1')
      assert.equal(seen.length, 2)
    } finally { w.dispose() }
  })
})


it('stats only changed files between deep scans and finds watched appends', async () => {
  const { SessionWatcher } = await import('../src/session-watcher')
  const dir = path.join(home, '.claude', 'projects', '-p')
  fs.mkdirSync(dir, { recursive: true })
  for (let i = 0; i < 500; i++) { const file = path.join(dir, `idle-${i}.jsonl`); fs.writeFileSync(file, ''); fs.utimesSync(file, new Date(0), new Date(0)) }
  const w = new SessionWatcher() as unknown as { workspacePath: string; resolvedWorkspace: string; watchProjectDirs(): void; scanForActiveSessions(force?: boolean): void; pendingFiles: Set<string>; dispose(): void }
  w.workspacePath = '-p'; w.resolvedWorkspace = '/p'
  const disk = require('fs') as { statSync: typeof fs.statSync }
  const originalStat = disk.statSync
  let statCalls = 0
  disk.statSync = ((...args: Parameters<typeof fs.statSync>) => { statCalls++; return originalStat(...args) }) as typeof fs.statSync
  try {
    w.watchProjectDirs()
    w.scanForActiveSessions(true)
    statCalls = 0
    for (let i = 0; i < 9; i++) w.scanForActiveSessions()
    assert.equal(statCalls, 0, `expected no idle file stats, got ${statCalls}`)
    const file = path.join(dir, 'resumed.jsonl')
    fs.writeFileSync(file, line('user', 'old'))
    fs.utimesSync(file, new Date(0), new Date(0))
    w.scanForActiveSessions(true)
    fs.appendFileSync(file, line('assistant', 'resumed'))
    const now = new Date()
    fs.utimesSync(file, now, now)
    await new Promise(resolve => setTimeout(resolve, 100))
    const sessions = (w as unknown as { sessions: Map<string, unknown> }).sessions
    assert.ok(sessions.has('resumed'))
    const fallback = path.join(dir, 'fallback.jsonl')
    fs.writeFileSync(fallback, line('user', 'fallback'))
    fs.utimesSync(fallback, now, now)
    w.scanForActiveSessions(true)
    assert.ok(sessions.has('fallback'))
  } finally { w.dispose(); disk.statSync = originalStat }
})

it('a deep scan finds a new subfolder project with no watch event', async () => {
  const { SessionWatcher } = await import('../src/session-watcher')
  const root = path.join(home, '.claude', 'projects'), dir = path.join(root, '-deep')
  fs.mkdirSync(dir, { recursive: true })
  const disk = require('fs') as { watch: typeof fs.watch }
  const originalWatch = disk.watch
  disk.watch = (() => ({ on() { return this }, close() {} } as unknown as fs.FSWatcher)) as unknown as typeof fs.watch
  const w = new SessionWatcher() as unknown as { workspacePath: string; resolvedWorkspace: string; isContainedProject(n: string): boolean; watchProjectDirs(): void; scanForActiveSessions(force?: boolean): void; sessions: Map<string, unknown>; dispose(): void }
  try {
    w.workspacePath = '-deep'; w.resolvedWorkspace = '/deep'; w.isContainedProject = () => true
    w.watchProjectDirs(); w.scanForActiveSessions(true)
    const sub = path.join(root, '-deep-sub')
    fs.mkdirSync(sub); fs.writeFileSync(path.join(sub, 'newsub.jsonl'), line('user', 'hi'))
    w.scanForActiveSessions(true)
    assert.ok(w.sessions.has('newsub'))
  } finally { w.dispose(); disk.watch = originalWatch }
})

it('ignores appends for watched sessions and finds an ended session on its next append', async () => {
  const { SessionWatcher } = await import('../src/session-watcher')
  const dir = path.join(home, '.claude', 'projects', '-watch')
  fs.mkdirSync(dir, { recursive: true })
  const busy = path.join(dir, 'busy.jsonl')
  const resumed = path.join(dir, 'resumed.jsonl')
  fs.writeFileSync(busy, line('user', 'busy'))
  fs.writeFileSync(resumed, line('user', 'before end'))
  const callbacks = new Map<string, (event: string, filename: string | null) => void>()
  const disk = require('fs') as { watch: typeof fs.watch }
  const originalWatch = disk.watch
  disk.watch = ((target: fs.PathLike, _options: unknown, callback?: (event: string, filename: string | null) => void) => {
    const fn = typeof _options === 'function' ? _options as (event: string, filename: string | null) => void : callback!
    callbacks.set(String(target), fn)
    return { on() { return this }, close() {} } as unknown as fs.FSWatcher
  }) as typeof fs.watch
  const w = new SessionWatcher() as unknown as {
    workspacePath: string
    watchDirForJsonl(dir: string): void
    scanForActiveSessions(force?: boolean): void
    sessions: Map<string, unknown>
    ended: Map<string, { mtime: number; info: unknown; model: null; fileSize: number }>
    pendingFiles: Set<string>
    dispose(): void
  }
  try {
    w.workspacePath = '-watch'
    w.watchDirForJsonl(dir)
    const session = { filePath: busy }
    w.sessions.set('busy', session)
    let scans = 0
    const scan = w.scanForActiveSessions.bind(w)
    w.scanForActiveSessions = (force?: boolean) => { scans++; scan(force) }
    const changed = callbacks.get(dir)!
    for (let i = 0; i < 100; i++) changed('change', 'busy.jsonl')
    assert.equal(scans, 0)
    assert.equal(w.pendingFiles.size, 0)

    const fresh = path.join(dir, 'fresh.jsonl')
    fs.writeFileSync(fresh, line('user', 'fresh'))
    changed('rename', 'fresh.jsonl')
    assert.ok(w.sessions.has('fresh'))

    w.sessions.delete('busy')
    const old = new Date(0)
    fs.utimesSync(resumed, old, old)
    w.ended.set('resumed', { info: {}, model: null, fileSize: fs.statSync(resumed).size, mtime: 0 })
    fs.appendFileSync(resumed, line('assistant', 'resumed'))
    const now = new Date()
    fs.utimesSync(resumed, now, now)
    changed('change', 'resumed.jsonl')
    assert.ok(w.sessions.has('resumed'))
  } finally { w.dispose(); disk.watch = originalWatch }
})
