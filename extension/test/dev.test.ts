import { describe, it } from 'node:test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import assert from 'node:assert/strict'
import * as http from 'http'
import { awakeArgs, awakePid, devCommand, devHome, devLink, devRows, knownDev, needsWindow, offArgs, markReloading, postCommand, postWindow, readWindows, sendHome, serveArgs, servedPorts } from '../src/hub/dev'
import { HubService } from '../src/hub/hub-service'
import { handleHub } from '../src/hub/routes'

describe('dev button', () => {
  it('runs the dev script with the package manager its lockfile names', () => {
    const pkg = { scripts: { dev: 'next dev' } }
    assert.equal(devCommand(pkg, ['package.json', 'pnpm-lock.yaml']), 'pnpm run dev')
    assert.equal(devCommand(pkg, ['yarn.lock']), 'yarn run dev')
    assert.equal(devCommand(pkg, ['bun.lockb']), 'bun run dev')
    assert.equal(devCommand(pkg, ['bun.lock']), 'bun run dev')
    assert.equal(devCommand(pkg, ['package-lock.json']), 'npm run dev')
    assert.equal(devCommand(pkg, []), 'npm run dev')
  })

  it('has no command without a dev script', () => {
    assert.equal(devCommand({ scripts: { build: 'x' } }, ['pnpm-lock.yaml']), undefined)
    assert.equal(devCommand(undefined, []), undefined)
    assert.equal(devCommand({ scripts: { dev: 3 } }, []), undefined)
  })

  it('serves on port+10000, https with cert domains, else http', () => {
    assert.deepEqual(serveArgs(5173, true), ['serve', '--bg', '--https=15173', 'http://localhost:5173'])
    assert.deepEqual(serveArgs(5173, false), ['serve', '--bg', '--http=15173', 'http://localhost:5173'])
    assert.deepEqual(offArgs(5173, true), ['serve', '--https=15173', 'off'])
    assert.deepEqual(offArgs(5173, false), ['serve', '--http=15173', 'off'])
    assert.equal(devLink('mac.tail1.ts.net.', 5173, true), 'https://mac.tail1.ts.net:15173')
    assert.equal(devLink('mac.tail1.ts.net', 5173, false), 'http://mac.tail1.ts.net:15173')
  })

  it('reads the served ports from serve status --json', () => {
    assert.deepEqual(servedPorts('{"TCP":{"15173":{"HTTP":true},"443":{"HTTPS":true}}}'), new Set([15173, 443]))
    assert.deepEqual(servedPorts(''), new Set())
    assert.deepEqual(servedPorts('{}'), new Set())
  })

  it('sends dev-start to the window holding the folder, else keeps it here', () => {
    const wins = [
      { pid: 1, port: 9001, hubToken: 'a', workspace: '/r/switchboard' },
      { pid: 2, port: 9002, hubToken: 'b', workspace: '/r/QR-Test' },
      { pid: 3, port: 9003, hubToken: 'c', workspace: '/r' },
    ]
    assert.equal(devHome(wins, '/r/QR-Test', 1)?.pid, 2)
    assert.equal(devHome(wins, '/r/switchboard/web', 2)?.pid, 1)
    assert.equal(devHome(wins, '/r/Other', 1)?.pid, 3)
    assert.equal(devHome(wins.slice(0, 2), '/x/Other', 1), undefined)
    assert.equal(devHome(wins, '/r/QR-Test', 2), undefined)
    assert.equal(devHome(wins, '/r/QR-Test-2', 1)?.pid, 3)
  })

  it('a chat whose project has no window gets its own, unless a move is closing that folder', () => {
    const wins = [
      { pid: 1, port: 9001, hubToken: 'a', workspace: '/r/Armasu' },
      { pid: 2, port: 9002, hubToken: 'b', workspace: '/r/switchboard' },
    ]
    assert.equal(needsWindow(wins, '/r/agent-flow', ''), true)
    assert.equal(needsWindow(wins, '/r/switchboard/web', ''), false)
    assert.equal(needsWindow(wins, '/r/Armasu', ''), false)
    assert.equal(needsWindow(wins, '/r/agent-flow', '/r/agent-flow'), false)
    assert.equal(needsWindow(wins, '', ''), false)
  })

  it('lists folders with a dev script, running when a server cwd is inside, linked when served', () => {
    const read = (f: string) => f === '/r/QR-Test' ? { command: 'npm run dev' } : f === '/r/Web' ? { command: 'pnpm run dev' } : undefined
    const servers = [
      { pid: 7, command: 'node', port: 3131, folder: 'r/QR-Test', cwd: '/r/QR-Test' },
      { pid: 8, command: 'node', port: 5173, folder: 'QR-Test/app', cwd: '/r/QR-Test/app' },
    ]
    const rows = devRows(['/r/QR-Test', '/r/Web', '/r/QR-Test', '/r/None'], read, servers, { dns: 'mac.ts.net', https: false, served: new Set([15173]) })
    assert.deepEqual(rows, [
      { folder: '/r/QR-Test', project: 'QR-Test', repo: 'QR-Test', command: 'npm run dev', port: 5173, link: 'http://mac.ts.net:15173' },
      { folder: '/r/Web', project: 'Web', repo: 'Web', command: 'pnpm run dev' },
    ])
    assert.deepEqual(devRows(['/r/QR-Test'], read, servers, null)[0], { folder: '/r/QR-Test', project: 'QR-Test', repo: 'QR-Test', command: 'npm run dev', port: 5173 })
  })

  it('files a repo subfolder row under its repo, keeping the folder name for its terminal', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-dev-'))
    try {
      const web = path.join(tmp, 'switchboard', 'web')
      fs.mkdirSync(path.join(tmp, 'switchboard', '.git'), { recursive: true })
      fs.mkdirSync(web)
      const [row] = devRows([web], () => ({ command: 'pnpm dev' }), [], null)
      assert.deepEqual([row.project, row.repo], ['web', 'switchboard'])
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('starts only a listed project folder, never a free path', () => {
    const rows = [{ folder: '/r/QR-Test', project: 'QR-Test', repo: 'QR-Test', command: 'npm run dev' }]
    assert.equal(knownDev(rows, '/r/QR-Test')?.project, 'QR-Test')
    assert.equal(knownDev(rows, '/r/QR-Test/../Armasu'), undefined)
    assert.equal(knownDev(rows, '/etc'), undefined)
    assert.equal(knownDev(undefined, '/r/QR-Test'), undefined)
  })
})

describe('keep awake', () => {
  it('lives as long as VS Code, not the extension host, so an extension update or reload keeps it on', () => {
    assert.deepEqual(awakeArgs(4242), ['-dis', '-w', '4242'])
    // The extension host is a child of the VS Code app process.
    assert.deepEqual(awakeArgs(), ['-dis', '-w', String(process.ppid)])
  })

  it('takes the pid file only for our caffeinate, so a reused pid is never shown on or killed', { skip: process.platform !== 'darwin' && 'caffeinate is macOS only' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-awake-')), file = path.join(dir, 'awake.pid')
    const { spawn } = await import('child_process')
    // Claude Code runs this form all the time.
    const theirs = spawn('caffeinate', ['-i', '-t', '30'], { stdio: 'ignore' })
    const ours = spawn('caffeinate', awakeArgs(process.pid), { stdio: 'ignore' })
    try {
      fs.writeFileSync(file, String(theirs.pid))
      assert.equal(await awakePid(file), undefined)
      assert.ok(!fs.existsSync(file), 'stale file removed')
      fs.writeFileSync(file, String(ours.pid))
      assert.equal(await awakePid(file), ours.pid)
    } finally {
      theirs.kill(); ours.kill()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('postCommand', () => {
  it('counts a run, a refusal with a reason and a slow answer as taken, so the command never runs in two windows', async () => {
    const h = new HubService()
    const seen: string[] = []
    let answer: boolean | string = true
    h.runner = async c => { seen.push(c.type); if (answer === 'slow') await new Promise(r => setTimeout(r, 300)); return answer === 'slow' ? true : answer }
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', d => { body += d })
      req.on('end', async () => {
        const r = await handleHub(h, req.method, req.url, body)
        res.writeHead(r?.status ?? 404).end(r?.body ?? '')
      })
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const w = { pid: 1, port, hubToken: h.token, workspace: '/r/Armasu' }
    const chat = { type: 'hub-new-chat', path: '/r/Armasu', remote: false }
    try {
      assert.equal(await postCommand(w, chat), true)
      answer = 'that project has no to-do list here'
      assert.equal(await postCommand(w, chat), true)
      answer = false
      assert.equal(await postCommand(w, chat), false)
      answer = 'slow'
      assert.equal(await postCommand(w, chat, 50), true)
      assert.equal(await postCommand({ ...w, hubToken: 'no' }, chat), false)
      assert.deepEqual(seen, ['hub-new-chat', 'hub-new-chat', 'hub-new-chat', 'hub-new-chat'])
    } finally {
      // A kept-alive socket would still answer after close.
      server.closeAllConnections()
      await new Promise(r => server.close(r))
    }
    // A gone window on a port fetch never pooled: a reset socket left in the pool makes undici throw an uncaught EINVAL on macOS.
    const gone = http.createServer()
    await new Promise<void>(r => gone.listen(0, '127.0.0.1', r))
    const gonePort = (gone.address() as { port: number }).port
    await new Promise(r => gone.close(r))
    assert.equal(await postCommand({ ...w, port: gonePort }, chat), false)
  })
})

describe('window posts', () => {
  it('use a fresh socket each time, and a window that resets or is gone is false, not an uncaught error', async () => {
    const seen: Array<string | undefined> = []
    const uncaught: unknown[] = []
    const onUncaught = (e: unknown) => { uncaught.push(e) }
    process.on('uncaughtException', onUncaught)
    let reset = false
    const server = http.createServer((req, res) => {
      seen.push(req.headers.connection)
      if (reset) { req.socket.destroy(); return }
      req.resume()
      req.on('end', () => res.writeHead(200).end())
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const w = { pid: 1, port: (server.address() as { port: number }).port, hubToken: 't', workspace: '/r' }
    const chat = { type: 'hub-new-chat' }
    try {
      assert.equal(await postWindow(w, { kind: 'dev-stop' }), true)
      assert.equal(await postCommand(w, chat), true)
      assert.deepEqual(seen, ['close', 'close'])
      reset = true
      assert.equal(await postWindow(w, { kind: 'dev-stop' }), false)
      assert.equal(await postCommand(w, chat), false)
    } finally {
      server.closeAllConnections()
      await new Promise(r => server.close(r))
    }
    assert.equal(await postWindow(w, { kind: 'dev-stop' }), false)
    assert.equal(await postCommand(w, chat), false)
    await new Promise(r => setTimeout(r, 20))
    process.off('uncaughtException', onUncaught)
    assert.deepEqual(uncaught, [])
  })
})

describe('sendHome', () => {
  it('markReloading clears markers older than the reload wait', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-win-'))
    const old = path.join(dir, '111.reloading')
    fs.writeFileSync(old, '/r/Gone')
    const t = new Date(Date.now() - 60_000)
    fs.utimesSync(old, t, t)
    fs.writeFileSync(path.join(dir, `abc-${process.pid}.json`), JSON.stringify({ pid: process.pid, port: 1, hubToken: 't', workspace: '/r/Armasu' }))
    markReloading(dir, process.pid)
    assert.deepEqual(fs.readdirSync(dir).filter(n => n.endsWith('.reloading')), [`${process.pid}.reloading`])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('waits for a window that is mid-reload instead of opening the chat here', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-win-'))
    const seen: string[] = []
    const server = http.createServer((req, res) => { seen.push(req.url ?? ''); req.resume(); req.on('end', () => res.writeHead(200).end()) })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const file = (pid: number) => path.join(dir, `abc-${pid}.json`)
    const write = (pid: number) => fs.writeFileSync(file(pid), JSON.stringify({ pid, port, hubToken: 't', workspace: '/r/Armasu' }))
    try {
      // Before the reload: a live window holds the folder.
      write(process.pid)
      markReloading(dir, process.pid)
      // Reloading: dispose removed the file and the old host pid is gone, so nothing is listed and nothing is refused.
      fs.rmSync(file(process.pid))
      assert.deepEqual(readWindows(dir), [])
      // The window comes back a moment later.
      setTimeout(() => write(process.pid), 300)
      assert.equal(await sendHome('/r/Armasu/web', { type: 'hub-new-chat' }, 0, dir, 50), true)
      assert.equal(seen.length, 1)
      // No reload marker for the folder: falls back here at once.
      assert.equal(await sendHome('/r/Other', { type: 'hub-new-chat' }, 0, dir, 50), false)
      // This window holds it: stays here even while another one reloads.
      assert.equal(await sendHome('/r/Armasu', { type: 'hub-new-chat' }, process.pid, dir, 50), false)
      // A window just asked to open a new repo: waits for it to list itself, then hands over.
      const mine = (pid: number) => path.join(dir, `new-${pid}.json`)
      setTimeout(() => fs.writeFileSync(mine(process.pid), JSON.stringify({ pid: process.pid, port, hubToken: 't', workspace: '/r/my-app' })), 300)
      assert.equal(await sendHome('/r/my-app', { type: 'hub-new-chat' }, 0, dir, 50, 5000), true)
      // It never shows up: gives up after waitMs.
      assert.equal(await sendHome('/r/never', { type: 'hub-new-chat' }, 0, dir, 50, 200), false)
      // A window on the parent folder does not take a new repo's chat; the repo's own window does.
      fs.writeFileSync(path.join(dir, 'root-1.json'), JSON.stringify({ pid: process.ppid, port, hubToken: 'root', workspace: '/r' }))
      seen.length = 0
      setTimeout(() => fs.writeFileSync(mine(process.pid), JSON.stringify({ pid: process.pid, port, hubToken: 't', workspace: '/r/fresh' })), 300)
      assert.equal(await sendHome('/r/fresh', { type: 'hub-new-chat' }, 0, dir, 50, 5000), true)
      assert.deepEqual(seen.map(u => u.includes('token=t')), [true])
      // Same when this window is the parent one: it waits for the new window instead of keeping the chat.
      fs.rmSync(mine(process.pid))
      setTimeout(() => fs.writeFileSync(mine(process.pid), JSON.stringify({ pid: process.pid, port, hubToken: 't', workspace: '/r/fresh' })), 300)
      assert.equal(await sendHome('/r/fresh', { type: 'hub-new-chat' }, process.ppid, dir, 50, 5000), true)
    } finally {
      server.closeAllConnections()
      await new Promise(r => server.close(r))
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
