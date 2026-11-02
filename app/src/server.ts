/**
 * Combined HTTP server: serves the visualizer UI and streams events via SSE.
 * Reuses the extension's hook server, transcript parser, and session watcher.
 */
import * as fs from 'fs'
import * as http from 'http'
import * as os from 'os'
import * as path from 'path'
import { exec, execFile, execFileSync } from 'child_process'

import { createRelay } from '../../scripts/relay'
import { serveStatic } from './static'
import { portTaken } from './port'
import { codeLogin, deniedAs, deviceAsks, forwardedIp, lanFor, lanGate, lanSetCookie, liveToken, macNames, phoneSecret, proxyHub, signInPage, tellWindows, uaSummary, waitPage, windows, type Lan } from './hub-proxy'
import { phoneServeArgs, readMacNames, tailscaleBin } from '../../extension/src/hub/lan'

interface ServerOptions {
  port: number
  openBrowser: boolean
  workspace: string
  verbose?: boolean
  lan?: boolean
}

const WEB_FILE = path.join(os.homedir(), '.claude', 'switchboard', 'web.url')
// Marks a --lan app and its port; the VS Code panel builds the phone links from the current addresses and phone.secret.
const LAN_FILE = path.join(os.homedir(), '.claude', 'switchboard', 'web.lan')

export async function startServer(options: ServerOptions) {
  const { port, openBrowser, workspace } = options
  // macOS lets a 127.0.0.1 and a 0.0.0.0 copy share the port; the second one would answer half the requests.
  if (await portTaken(port)) {
    console.log(`Port ${port} is already in use; is Switchboard already running?`)
    process.exit(1)
  }

  const relay = await createRelay({ workspace, verbose: options.verbose })

  const secret = options.lan ? phoneSecret(path.join(os.homedir(), '.claude', 'switchboard', 'phone.secret')) : ''

  const checkCode = codeLogin()
  const login = (res: http.ServerResponse, lan: Lan) =>
    res.writeHead(302, { Location: '/', 'Set-Cookie': lanSetCookie(port, lan.secret, !lan.plain), 'Cache-Control': 'no-store' }).end()
  const html = (res: http.ServerResponse, status: number, body: string) =>
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" }).end(body)
  const page = (res: http.ServerResponse, status: number, note?: string) => html(res, status, signInPage(note))
  const readBody = async (req: http.IncomingMessage, max: number) => {
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (body.length > max) return undefined
    }
    return body
  }
  const typedCode = async (req: http.IncomingMessage, res: http.ServerResponse, lan: Lan) => {
    const body = await readBody(req, 256)
    if (body === undefined) { res.writeHead(413).end(); return }
    const r = checkCode((new URLSearchParams(body).get('code') ?? '').replace(/\s/g, ''), lan.secret)
    if (r === 'ok') login(res, lan)
    else if (r === 'wrong') page(res, 401, 'Wrong code')
    else page(res, 429, 'Too many wrong codes. Sign-in is locked for a few minutes; scan the QR code instead.')
  }

  // Ask the Mac: the device waits on /device/wait?id=, VS Code answers on loopback /device/answer.
  const asks = deviceAsks()
  const askMac = (req: http.IncomingMessage, res: http.ServerResponse, lan: Lan) => {
    req.resume()
    const a = asks.ask({ ip: forwardedIp(req.headers), ua: uaSummary(req.headers['user-agent']), host: String(req.headers.host), network: 'Tailscale' })
    if (!a) { page(res, 429, 'Too many devices are waiting. Try again in a few minutes, or use the code.'); return }
    void tellWindows({ id: a.id, ip: a.ip, ua: a.ua, network: a.network, port })
    res.writeHead(303, { Location: `/device/wait?id=${a.id}`, 'Cache-Control': 'no-store' }).end()
  }
  const waitMac = (req: http.IncomingMessage, res: http.ServerResponse, lan: Lan) => {
    const id = new URL(req.url ?? '/', 'http://x').searchParams.get('id') ?? ''
    const st = asks.state(id)
    if (st === 'pending') html(res, 200, waitPage(id))
    else if (st === 'allowed') login(res, lan)
    else if (st === 'denied') page(res, 403, 'The Mac said no.')
    else page(res, 401, 'No answer from the Mac. Ask again, or use the code.')
  }
  const answerMac = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const body = await readBody(req, 1024)
    let b: { id?: unknown; allow?: unknown; token?: unknown } = {}
    try { b = JSON.parse(body ?? '') } catch { /* refused below */ }
    if (typeof b.id !== 'string' || typeof b.allow !== 'boolean') { res.writeHead(400).end(); return }
    if (!liveToken(await windows(), b.token)) { res.writeHead(403).end(); return }
    if (!asks.answer(b.id, b.allow)) { res.writeHead(409).end(); return }
    void tellWindows({ id: b.id, done: true })
    res.writeHead(204).end()
  }

  // What tailscale serve puts the app on: https, http (no tailnet certs) or nothing yet.
  let serving: 'https' | 'http' | undefined
  // lan: undefined for the Mac itself (lanFor), else the phone through tailscale serve; only the ts.net Host is accepted.
  const handle = (lan: Lan | undefined, req: http.IncomingMessage, res: http.ServerResponse) => {
    const gate = lanGate(req.headers, req.url ?? '/', port, lan)
    if (gate === 'deny') {
      const as = deniedAs(req.method, req.headers, req.url ?? '/', port, lan!)
      if (as === 'page') page(res, 401)
      else if (as === 'login') typedCode(req, res, lan!).catch(() => { if (!res.headersSent) res.writeHead(400); res.end() })
      else if (as === 'device') askMac(req, res, lan!)
      else if (as === 'wait') waitMac(req, res, lan!)
      else res.writeHead(403).end()
      return
    }
    if (gate === 'login') { login(res, lan!); return }

    // Loopback only: a signed-in phone passes the gate but must not answer for the Mac.
    if (req.method === 'POST' && req.url === '/device/answer') {
      if (lan) res.writeHead(403).end()
      else answerMac(req, res).catch(() => { if (!res.headersSent) res.writeHead(400); res.end() })
      return
    }

    // SSE endpoint
    if (req.url === '/events') {
      return relay.handleSSE(req, res)
    }

    // The hub, through a VS Code window's hook server
    if (req.url?.startsWith('/hub/')) {
      // A client dropping mid-body rejects here; uncaught, that exits the app.
      proxyHub(req, res, port, workspace, lan).catch(() => { if (!res.headersSent) res.writeHead(400); res.end() })
      return
    }

    // Static files (UI)
    if (req.method === 'GET') {
      return serveStatic(req, res)
    }

    res.writeHead(404)
    res.end('Not found')
  }
  // One bad request must not take the app down: with --lan the tailnet reaches it.
  // Kicks off the first read now; each call after reuses it and rereads in the background every few minutes.
  if (options.lan) macNames()
  const names = () => { const n = macNames().tailscale; return n ? [n] : [] }
  const server = http.createServer((req, res) => {
    try {
      // A rebound name (DNS rebinding) or a proxy the app did not set up is never the Mac; without --lan there is no phone.
      const lan = lanFor(req.headers, port, secret, names(), serving === 'http')
      if (lan && !options.lan) { res.writeHead(403).end(); return }
      handle(lan, req, res)
    } catch { if (!res.headersSent) res.writeHead(400); res.end() }
  })
  // Loopback only, --lan too: the phone comes in through tailscale serve, never straight to this socket.
  const host = '127.0.0.1'
  const up = await new Promise<boolean>(done => {
    server.once('error', err => { console.log(`Could not listen on ${host}:${port}: ${err.message}`); done(false) })
    server.listen(port, host, () => done(true))
  })
  if (!up) {
    relay.dispose()
    process.exit(1)
  }

  const url = `http://127.0.0.1:${port}`
  // Switchboard's browser link reads this; any port works.
  try { fs.mkdirSync(path.dirname(WEB_FILE), { recursive: true }); fs.writeFileSync(WEB_FILE, url) } catch { /* link falls back to 3001 */ }
  // Written only once the socket listens, so a failed start never leaves a phone link behind.
  const lanMark = `http://0.0.0.0:${port}`
  if (options.lan) {
    try { fs.writeFileSync(LAN_FILE, lanMark) } catch { /* no phone link */ }
    // Tailscale signed in or HTTPS turned on later: try again each minute until it serves https.
    let told = ''
    const servePhone = async () => {
      const n = await readMacNames()
      const bin = tailscaleBin()
      if (n.problem || !bin || !n.tailscale) { if (n.problem && n.problem !== told) console.log(`No phone access yet: ${told = n.problem}`); return }
      const want = n.https ? 'https' : 'http'
      if (want === serving) return
      try {
        if (serving) execFileSync(bin, phoneServeArgs(port, false, serving === 'https'), { timeout: 5000, stdio: 'ignore' })
        execFileSync(bin, phoneServeArgs(port, true, !!n.https), { timeout: 15000, stdio: 'ignore' })
      } catch (err) { console.log(`tailscale serve failed: ${(err as Error).message}`); return }
      serving = want
      if (n.https) clearInterval(retry)
      console.log(`Phone access on ${want}://${n.tailscale}/ (Tailscale; secret link in the Switchboard panel)${n.https ? '' : '. Phone copy buttons need HTTPS on the tailnet.'}`)
    }
    const retry = setInterval(() => void servePhone(), 60_000)
    retry.unref()
    void servePhone()
  }
  console.log(`Server running at ${url}`)
  console.log('Waiting for agent events...\n')
  if (openBrowser) openURL(url)

  // Cleanup on exit. Idempotent: repeat signals (Ctrl+C spam, SIGTERM+SIGHUP) run it once.
  let shuttingDown = false
  function cleanup() {
    if (shuttingDown) return
    shuttingDown = true
    // web.url stays: the extension probes it before use, and deleting it once cost the phone its link.
    try { if (options.lan && fs.readFileSync(LAN_FILE, 'utf8') === lanMark) fs.unlinkSync(LAN_FILE) } catch { /* gone */ }
    try { if (serving) execFileSync(tailscaleBin()!, phoneServeArgs(port, false, serving === 'https'), { timeout: 5000, stdio: 'ignore' }) } catch { /* tailscale gone */ }
    server.close()
    relay.dispose()
    process.exit(0)
  }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  // SIGHUP fires when the controlling terminal closes (SSH session drops, tmux
  // pane killed). Without a handler, Node terminates without running cleanup.
  process.on('SIGHUP', cleanup)
}

function openURL(url: string) {
  if (process.platform === 'win32') {
    // 'start' is a shell builtin on Windows; must use exec, not execFile
    exec(`start "" "${url}"`)
  } else {
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
    execFile(cmd, [url], () => {})
  }
}
