// Keeps the Switchboard browser app up. launchd runs this (src/hub/keeper.ts installs it); it starts the app
// the way the extension last did (app.args) when nothing answers on its port, and otherwise waits.
// app.nokeep (Settings, Keep Switchboard app running off) stops it starting anything; an app that keeps dying at start is retried less and less often.
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const LOG_MAX = 2 << 20
const sleep = ms => new Promise(r => setTimeout(r, ms))

// A timeout counts as up: a busy app is still there, and a second one would only die on EADDRINUSE.
const answers = port => new Promise(done => {
  const s = net.connect({ port, host: '127.0.0.1' })
  s.setTimeout(1000)
  s.once('connect', () => { s.destroy(); done(true) })
  s.once('timeout', () => { s.destroy(); done(true) })
  s.once('error', () => done(false))
})
// launchd's PATH may lack /usr/sbin
const listeners = port => new Promise(done => execFile(fs.existsSync('/usr/sbin/lsof') ? '/usr/sbin/lsof' : 'lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { timeout: 5000 },
  (_err, out) => done(String(out ?? '').split('\n').filter(Boolean).map(Number))))
const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
const fresh = (file, ms) => { try { return Date.now() - fs.statSync(file).mtimeMs < ms } catch { return false } }

const BACKOFF_MAX = 5 * 60_000

export function keep({ dir = path.join(os.homedir(), '.claude', 'switchboard'), everyMs = 2000, misses = 3, backoffMs = 5000, stableMs = 60_000, log = console.log } = {}) {
  // upSince: when the app this keeper started first answered; fails resets only once it stayed up stableMs.
  let down = 0, stopped = false, timer, fails = 0, waitUntil = 0, upSince = 0
  const backoff = why => {
    const wait = Math.min(BACKOFF_MAX, backoffMs * 2 ** fails++)
    waitUntil = Date.now() + wait
    log(`${why}; trying again in ${Math.round(wait / 1000)} s`)
  }

  const start = async (launch, port) => {
    const file = path.join(dir, 'app.log')
    try { if (fs.statSync(file).size > LOG_MAX) fs.truncateSync(file, 0) } catch { /* no log yet */ }
    log(`${new Date().toISOString()} starting ${launch.args.join(' ')}`)
    const out = fs.openSync(file, 'a')
    const child = spawn(process.execPath, launch.args, {
      cwd: fs.existsSync(launch.cwd ?? '') ? launch.cwd : os.homedir(), detached: true, stdio: ['ignore', out, out],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    fs.closeSync(out)
    child.unref()
    let gone = false
    child.once('exit', () => { gone = true })
    for (let i = 0; i < 50 && !gone && !(await answers(port)); i++) await sleep(200)
    // A click's start that took the port first makes this one exit; its pid in app.pid stays.
    if (gone || !alive(child.pid)) return backoff('the app exited')
    upSince = Date.now()
    if ((await listeners(port)).includes(child.pid)) fs.writeFileSync(path.join(dir, 'app.pid'), String(child.pid))
    else log(`port ${port} is held, but not by the app it started (${child.pid}); app.pid left as is`)
  }

  const tick = async () => {
    if (fs.existsSync(path.join(dir, 'app.nokeep')) || Date.now() < waitUntil) return
    let launch
    try { launch = JSON.parse(fs.readFileSync(path.join(dir, 'app.args'), 'utf8')) } catch { return }
    if (!Array.isArray(launch?.args) || !fs.existsSync(launch.args[0])) return
    const port = Number(launch.args[launch.args.indexOf('-p') + 1]) || 3131
    // ensureWeb holds app.lock while it stops and starts the app for an update; past a minute it is left over.
    if ((await answers(port)) || fresh(path.join(dir, 'app.lock'), 60_000)) {
      down = 0
      // An app someone else started counts as stable.
      if (!upSince || Date.now() - upSince >= stableMs) fails = 0
      return
    }
    // Ours served a moment, then died: wait like a failed start, not every few seconds.
    if (upSince) {
      const short = Date.now() - upSince < stableMs
      upSince = 0
      if (short) return backoff('the app stopped soon after starting')
    }
    if (++down < misses) return
    down = 0
    await start(launch, port)
  }

  const loop = async () => {
    try { await tick() } catch (err) { log(`keeper: ${err.message}`) }
    if (!stopped) timer = setTimeout(loop, everyMs)
  }
  void loop()
  return { stop: () => { stopped = true; clearTimeout(timer) } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) keep()
