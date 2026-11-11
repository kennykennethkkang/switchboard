import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { installKeeper, keeperPlist, keepApp, KEEPER_LABEL } from '../src/hub/keeper'
// @ts-expect-error plain ESM, no types
import { keep } from '../keeper/app-keeper.mjs'

const KEEPER = path.join(__dirname, '..', 'keeper')

describe('app keeper launch agent', () => {
  it('runs the keeper with the given node, falling back to one on PATH, and logs to app.log', () => {
    const p = keeperPlist('/Apps/Code & Co/Code Helper', '/h/.claude/switchboard/app-keeper.mjs', '/h/.claude/switchboard')
    assert.match(p, new RegExp(`<string>${KEEPER_LABEL}</string>`))
    assert.match(p, /<key>KeepAlive<\/key><true\/>/)
    assert.match(p, /<key>RunAtLoad<\/key><true\/>/)
    assert.match(p, /<string>\/Apps\/Code &amp; Co\/Code Helper<\/string><string>\/h\/.claude\/switchboard\/app-keeper.mjs<\/string>/)
    assert.match(p, /command -v node/)
    assert.match(p, /<key>ELECTRON_RUN_AS_NODE<\/key><string>1<\/string>/)
    assert.match(p, /<key>StandardOutPath<\/key><string>\/h\/.claude\/switchboard\/app.log<\/string>/)
  })

  it('installs once, reloads only when the plist or the keeper changes', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-keep-'))
    const calls: string[] = []
    let loaded = false
    const launchctl = async (args: string[]) => {
      calls.push(args[0])
      if (args[0] === 'bootstrap') loaded = true
      if (args[0] === 'bootout') loaded = false
      return args[0] === 'print' ? loaded : true
    }
    const plist = path.join(home, 'Library', 'LaunchAgents', `${KEEPER_LABEL}.plist`)
    await installKeeper(KEEPER, { home, node: '/a/node', uid: 501, launchctl })
    assert.deepEqual(calls, ['bootout', 'bootstrap'])
    assert.ok(fs.existsSync(path.join(home, '.claude', 'switchboard', 'app-keeper.mjs')))
    assert.match(fs.readFileSync(plist, 'utf8'), /\/a\/node/)
    calls.length = 0
    await installKeeper(KEEPER, { home, node: '/a/node', uid: 501, launchctl })
    assert.deepEqual(calls, ['print'], 'nothing changed')
    loaded = false
    calls.length = 0
    await installKeeper(KEEPER, { home, node: '/a/node', uid: 501, launchctl })
    assert.deepEqual(calls, ['print', 'bootstrap'], 'unloaded: loaded again')
    calls.length = 0
    await installKeeper(KEEPER, { home, node: '/b/node', uid: 501, launchctl })
    assert.deepEqual(calls, ['bootout', 'bootstrap'], 'VS Code moved')
    assert.match(fs.readFileSync(plist, 'utf8'), /\/b\/node/)
    calls.length = 0
    fs.appendFileSync(path.join(home, '.claude', 'switchboard', 'app-keeper.mjs'), '\n// old')
    await installKeeper(KEEPER, { home, node: '/b/node', uid: 501, launchctl })
    assert.deepEqual(calls, ['print', 'kickstart'], 'new keeper code')
  })
})

describe('app keeper', () => {
  const freePort = () => new Promise<number>(done => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => done(p)) }) })
  const until = async (ok: () => boolean, ms = 5000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise(r => setTimeout(r, 20)); return ok() }
  const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

  it('starts the recorded app when its port stays down, writes its pid, and waits while it runs or a restart holds the lock', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-keeper-'))
    const port = await freePort()
    const app = path.join(dir, 'fake-app.js')
    fs.writeFileSync(app, "require('http').createServer((q, r) => r.end('ok')).listen(Number(process.argv[3]), '127.0.0.1', () => console.log('up', process.argv.slice(4).join(' ')))")
    const pidOf = () => Number(fs.readFileSync(path.join(dir, 'app.pid'), 'utf8').trim() || 0)
    const pids: number[] = []
    // Nothing recorded yet: never started by the extension, so nothing to start.
    const k = keep({ dir, everyMs: 30, misses: 2, stableMs: 100, log: () => {} })
    try {
      await new Promise(r => setTimeout(r, 200))
      assert.equal(fs.existsSync(path.join(dir, 'app.pid')), false)
      // A restart in progress holds the lock.
      fs.writeFileSync(path.join(dir, 'app.lock'), '1')
      fs.writeFileSync(path.join(dir, 'app.args'), JSON.stringify({ cwd: dir, args: [app, '-p', String(port), '--no-open', '--lan'] }))
      await new Promise(r => setTimeout(r, 200))
      assert.equal(fs.existsSync(path.join(dir, 'app.pid')), false, 'locked')
      fs.rmSync(path.join(dir, 'app.lock'))
      assert.ok(await until(() => fs.existsSync(path.join(dir, 'app.pid'))))
      const first = pidOf()
      pids.push(first)
      assert.ok(alive(first))
      await new Promise(r => setTimeout(r, 200))
      assert.equal(pidOf(), first, 'running: left alone')
      process.kill(first)
      assert.ok(await until(() => pidOf() !== first && pidOf() > 0))
      pids.push(pidOf())
      assert.match(fs.readFileSync(path.join(dir, 'app.log'), 'utf8'), /up --no-open --lan/)
    } finally {
      k.stop()
      for (const p of pids) try { process.kill(p) } catch { /* gone */ }
    }
  })

  it('writes no pid when something other than its child ends up holding the port', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-keeper-'))
    const port = await freePort()
    const app = path.join(dir, 'fake-app.js')
    // The child stays up while a grandchild takes the port, like a second window's start winning it.
    fs.writeFileSync(app, `const fs = require('fs'); fs.writeFileSync(${JSON.stringify(path.join(dir, 'child'))}, String(process.pid))
const g = require('child_process').spawn(process.execPath, ['-e', "require('http').createServer().listen(${port}, '127.0.0.1')"], { stdio: 'ignore' })
fs.writeFileSync(${JSON.stringify(path.join(dir, 'grand'))}, String(g.pid)); setInterval(() => {}, 1000)`)
    fs.writeFileSync(path.join(dir, 'app.args'), JSON.stringify({ cwd: dir, args: [app, '-p', String(port)] }))
    const logs: string[] = []
    const k = keep({ dir, everyMs: 30, misses: 1, log: (m: string) => logs.push(m) })
    try {
      assert.ok(await until(() => logs.some(l => /not by the app it started/.test(l))), logs.join('\n'))
      assert.equal(fs.existsSync(path.join(dir, 'app.pid')), false)
    } finally {
      k.stop()
      for (const f of ['child', 'grand']) try { process.kill(Number(fs.readFileSync(path.join(dir, f), 'utf8'))) } catch { /* gone */ }
    }
  })

  it('cuts app.log once it grows past the cap', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-keeper-'))
    const port = await freePort()
    const app = path.join(dir, 'fake-app.js')
    fs.writeFileSync(app, "require('http').createServer().listen(Number(process.argv[3]), '127.0.0.1')")
    fs.writeFileSync(path.join(dir, 'app.log'), 'x'.repeat(3 << 20))
    fs.writeFileSync(path.join(dir, 'app.args'), JSON.stringify({ cwd: dir, args: [app, '-p', String(port)] }))
    const k = keep({ dir, everyMs: 30, misses: 1, log: () => {} })
    try {
      assert.ok(await until(() => fs.existsSync(path.join(dir, 'app.pid'))))
      assert.ok(fs.statSync(path.join(dir, 'app.log')).size < 1 << 20)
    } finally {
      k.stop()
      try { process.kill(Number(fs.readFileSync(path.join(dir, 'app.pid'), 'utf8'))) } catch { /* gone */ }
    }
  })

  it('starts nothing while Keep Switchboard app running is off', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-keeper-'))
    const port = await freePort()
    const app = path.join(dir, 'fake-app.js')
    fs.writeFileSync(app, "require('http').createServer().listen(Number(process.argv[3]), '127.0.0.1')")
    fs.writeFileSync(path.join(dir, 'app.args'), JSON.stringify({ cwd: dir, args: [app, '-p', String(port)] }))
    keepApp(false, dir)
    const k = keep({ dir, everyMs: 30, misses: 1, log: () => {} })
    try {
      await new Promise(r => setTimeout(r, 300))
      assert.equal(fs.existsSync(path.join(dir, 'app.pid')), false)
      keepApp(true, dir)
      assert.ok(await until(() => fs.existsSync(path.join(dir, 'app.pid'))))
    } finally {
      k.stop()
      try { process.kill(Number(fs.readFileSync(path.join(dir, 'app.pid'), 'utf8'))) } catch { /* gone */ }
    }
  })

  it('backs off when the app keeps crashing at start', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-keeper-'))
    const port = await freePort()
    const app = path.join(dir, 'fake-app.js')
    fs.writeFileSync(app, 'process.exit(1)')
    fs.writeFileSync(path.join(dir, 'app.args'), JSON.stringify({ cwd: dir, args: [app, '-p', String(port)] }))
    const logs: string[] = []
    const k = keep({ dir, everyMs: 20, misses: 1, backoffMs: 600, log: (m: string) => logs.push(m) })
    try {
      await new Promise(r => setTimeout(r, 1000))
      const starts = logs.filter(l => / starting /.test(l)).length
      assert.ok(starts >= 1 && starts <= 2, logs.join('\n'))
    } finally { k.stop() }
  })

  it('backs off an app that serves for a moment and then crashes, and forgets that once one stays up', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-keeper-'))
    const port = await freePort()
    const app = path.join(dir, 'fake-app.js')
    const life = path.join(dir, 'life')
    // Serves, then exits after the ms in the life file.
    fs.writeFileSync(app, `require('http').createServer().listen(Number(process.argv[3]), '127.0.0.1', () => setTimeout(() => process.exit(1), Number(require('fs').readFileSync(${JSON.stringify(life)}, 'utf8'))))`)
    fs.writeFileSync(life, '600')
    fs.writeFileSync(path.join(dir, 'app.args'), JSON.stringify({ cwd: dir, args: [app, '-p', String(port)] }))
    const logs: string[] = []
    const starts = () => logs.filter(l => / starting /.test(l)).length
    const waits = () => logs.filter(l => /trying again in/.test(l)).length
    const k = keep({ dir, everyMs: 20, misses: 1, backoffMs: 700, stableMs: 1000, log: (m: string) => logs.push(m) })
    try {
      // Starts at 0, dies at ~0.7 s, waits 0.7 s, starts, dies, waits 1.4 s: two starts by 3.2 s, where no backoff makes four.
      await new Promise(r => setTimeout(r, 3200))
      assert.ok(starts() >= 1 && starts() <= 2, logs.join('\n'))
      assert.ok(waits() >= 1, logs.join('\n'))
      // Up past stableMs: its crash restarts at once, with no wait logged.
      fs.writeFileSync(life, '1300')
      const n = starts()
      assert.ok(await until(() => starts() > n, 5000), logs.join('\n'))
      const w = waits()
      assert.ok(await until(() => starts() >= n + 2, 4000), logs.join('\n'))
      assert.equal(waits(), w, logs.join('\n'))
    } finally {
      k.stop()
      try { process.kill(Number(fs.readFileSync(path.join(dir, 'app.pid'), 'utf8'))) } catch { /* gone */ }
    }
  })
})
