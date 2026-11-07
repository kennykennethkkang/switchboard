/**
 * The standalone app's way to the hub: /hub/state, /hub/voice, /hub/graph, /hub/runs, /hub/command and /hub/upload are passed to
 * a VS Code window's hook server, found through ~/.claude/switchboard/*.json, with
 * the window's token added here so it never reaches the browser. Only the app's
 * own page may call it: a custom header (no form can send one), the same Origin
 * when there is one, and a loopback Host (no DNS rebinding). Called by server.ts.
 */
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as http from 'http'
import * as os from 'os'
import * as path from 'path'
import { pipeline } from 'stream'
import * as zlib from 'zlib'

type Win = { port: number; hubToken: string; workspace: string; mtimeMs: number; pid?: number }
const DIR = path.join(os.homedir(), '.claude', 'switchboard')
const MAX_BODY = 64 * 1024
// Same cap as extension/src/hub/uploads.ts; the window checks it again.
const UPLOAD_MAX = 100 * 1024 * 1024
// How long a cut off upload may keep sending before the socket is dropped.
const LINGER_MS = 5_000
// A tool pick or a sync with origin runs well past 5 s; the panel never times them out, so the app waits too.
const COMMAND_MS = 120_000

// EPERM: the process exists but belongs to someone else.
function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM' }
}

const real = (p: string) => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }

const usable = (f: Partial<Win>, alive: (pid: number) => boolean): f is Win =>
  typeof f.port === 'number' && typeof f.hubToken === 'string' && typeof f.workspace === 'string' && (typeof f.pid !== 'number' || alive(f.pid))

/** The live window holding the command's folder (deepest, then newest), else the one holding the app's folder, else the newest.
 * A closed window can leave its file behind. */
export function pickWindow(files: Partial<Win>[], workspace: string, alive: (pid: number) => boolean = pidAlive, folder?: string): Win | undefined {
  const ok = files.filter(f => usable(f, alive))
  const newest = [...ok].sort((a, b) => b.mtimeMs - a.mtimeMs)
  const holding = (dir: string) => {
    const here = real(dir)
    const ws = (f: Win) => real(f.workspace)
    return newest.filter(f => here === ws(f) || here.startsWith(ws(f).endsWith(path.sep) ? ws(f) : ws(f) + path.sep))
      .sort((a, b) => ws(b).length - ws(a).length)[0]
  }
  return (folder ? holding(folder) : undefined) ?? holding(workspace) ?? newest[0]
}

/** The project a to-do or new-chat command names, so its chat opens in that project's window. Others stay on the usual
 * window: their answers (a tool pick, a dev terminal) live in the window that ran them, and the page reads that one. */
export function commandFolder(body: string): string | undefined {
  try {
    const c = JSON.parse(body) as { type?: unknown; path?: unknown }
    const routed = typeof c?.type === 'string' && (c.type.startsWith('hub-todo-') || c.type === 'hub-new-chat')
    return routed && typeof c.path === 'string' ? c.path : undefined
  } catch { return undefined }
}

// The mic records the room, and a spoken reply (hub-jarvis with voice) plays in it; the rest reach keys, sign-ins, AWS, setup, links opened on the Mac, dev servers and pushes.
const MAC_ONLY = new Set(['hub-device', 'hub-voice', 'hub-open-url', 'hub-dev-start', 'hub-setup', 'hub-rules-sync', 'hub-kit-export', 'hub-toggle', 'hub-switchboard', 'hub-browser'])

/** A command that only this Mac may send, never the phone. */
export function macOnly(body: string): boolean {
  try {
    const c = JSON.parse(body) as { type?: unknown; op?: unknown; voice?: unknown }
    if (typeof c?.type !== 'string') return false
    return MAC_ONLY.has(c.type) || (c.type === 'hub-jarvis' && c.voice !== undefined) || /^hub-(key|login|aws)-/.test(c.type) || (c.type === 'hub-git' && MAC_ONLY_GIT.has(c.op as GitOp))
  } catch { return false }
}

/** The chat a command names (send, answer, focus, git...), so it can go to the window holding that chat's terminal. */
export function commandSession(body: string): string | undefined {
  try {
    const id = (JSON.parse(body) as { sessionId?: unknown })?.sessionId
    return typeof id === 'string' && /^[\w-]{1,64}$/.test(id) ? id : undefined
  } catch { return undefined }
}

// 204: this window holds the chat's terminal (a Codex tie, a Claude terminal); its Codex typing and focus work only there.
const holds = (w: Win, id: string) => new Promise<boolean>(done => {
  const r = http.request({ host: '127.0.0.1', port: w.port, path: `/hub/holds?session=${encodeURIComponent(id)}`, headers: { 'X-Switchboard-Token': w.hubToken }, timeout: 1500 }, x => { x.resume(); done(x.statusCode === 204) })
  r.on('error', () => done(false))
  r.on('timeout', () => r.destroy())
  r.end()
})

/** lan only for a phone request (lanFor), already through lanGate. */
export function allowed(h: http.IncomingHttpHeaders, port: number, lan?: Lan): boolean {
  if (h['x-switchboard'] !== '1' || !hostOk(h, port, lan)) return false
  return h.origin === undefined || sameOrigin(h.origin, port, lan)
}

const loopHosts = (port: number) => [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, `0.0.0.0:${port}`]
// Exact names only: a rebound name (evil.test pointing here) never matches. tailscale serve passes the phone's Host on.
const hostsFor = (port: number, lan?: Lan) => lan ? lan.names.flatMap(n => [n.toLowerCase(), `${n.toLowerCase()}:${lan.plain ? 80 : 443}`]) : loopHosts(port)
const sameOrigin = (origin: string, port: number, lan?: Lan) => (lan ? lan.names.map(n => `${lan.plain ? 'http' : 'https'}://${n.toLowerCase()}`) : loopHosts(port).map(x => `http://${x}`)).includes(origin.toLowerCase())

/** The Host check alone, for every request: a rebound name (evil.test pointing at 127.0.0.1) must not read /events either.
 * EventSource cannot send x-switchboard, so /events gets this and not allowed(). */
export function hostOk(h: http.IncomingHttpHeaders, port: number, lan?: Lan): boolean {
  return hostsFor(port, lan).includes(String(h.host).toLowerCase())
}

/** names: this Mac's MagicDNS name, the only Host a phone may use. plain: served over http (no tailnet certs). */
export type Lan = { secret: string; names: string[]; plain?: boolean }
import { phoneCode } from '../../extension/src/hub/lan'
import { MAC_ONLY_GIT, type GitOp } from '../../web/lib/hub-types'
export { macNames, phoneCode, tailscaleName, tailscaleProblem } from '../../extension/src/hub/lan'

const PROXIED = ['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'tailscale-user-login']
/** The app listens on loopback only and the phone comes through tailscale serve, so the socket says nothing:
 * the Mac itself is a loopback Host with no proxy headers, anything else is the phone and gets gated. */
export function lanFor(h: http.IncomingHttpHeaders, port: number, secret: string, names: string[] = [], plain = false): Lan | undefined {
  return hostOk(h, port) && !PROXIED.some(k => h[k] !== undefined) ? undefined : plain ? { secret, names, plain } : { secret, names }
}
/** The phone's address as tailscale serve reports it. */
export const forwardedIp = (h: http.IncomingHttpHeaders) => String(h['x-forwarded-for'] ?? '').split(',')[0].trim()

// Browsers send cookies to every port on the host, so the port in the name only keeps two Switchboard apps apart.
// Anything else on this Mac that sees it could already read phone.secret.
export const lanCookie = (port: number) => `sb${port}`
// Secure over tailscale serve's https; dropped on the plain http fallback, where a browser would never keep it.
export const lanSetCookie = (port: number, secret: string, secure = true) => `${lanCookie(port)}=${secret}; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Strict; Path=/; Max-Age=${30 * 24 * 3600}`

/** The phone link's secret, kept in a file so a restart (an update) does not log the phone out. */
export function phoneSecret(file: string): string {
  const kept = (() => { try { return fs.readFileSync(file, 'utf8').trim() } catch { return '' } })()
  if (/^[0-9a-f]{64}$/.test(kept)) return kept
  const secret = crypto.randomBytes(32).toString('hex')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, secret, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
  return secret
}

const same = (a: string | null | undefined, b: string) => {
  const x = Buffer.from(a ?? ''), y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/** Phone access. lan is undefined for a loopback localAddress, which passes as before. For a LAN one: the
 * Mac's own Host only, then /?k=<secret> once ('login': set the cookie), then the cookie on every request. */
export function lanGate(h: http.IncomingHttpHeaders, url: string, port: number, lan: Lan | undefined): 'ok' | 'login' | 'deny' {
  if (!lan) return 'ok'
  if (!hostOk(h, port, lan)) return 'deny'
  // '//' and the like throw, and a throw here takes the whole app down.
  let u: URL
  try { u = new URL(url, 'http://x') } catch { return 'deny' }
  if (u.pathname === '/' && u.searchParams.has('k')) return same(u.searchParams.get('k'), lan.secret) ? 'login' : 'deny'
  const name = `${lanCookie(port)}=`
  const cookie = String(h.cookie ?? '').split(';').map(c => c.trim()).find(c => c.startsWith(name))
  return same(cookie?.slice(name.length), lan.secret) ? 'ok' : 'deny'
}

/** What a LAN request lanGate denied gets instead of a bare 403: the sign-in page for a page on the Mac's own Host,
 * the code check for POST /login there, an ask to the Mac on POST /device and its answer on GET /device/wait.
 * Assets, /events and /hub/* stay refused. */
export function deniedAs(method: string | undefined, h: http.IncomingHttpHeaders, url: string, port: number, lan: Lan): 'page' | 'login' | 'device' | 'wait' | 'forbid' {
  if (!hostOk(h, port, lan)) return 'forbid'
  let u: URL
  try { u = new URL(url, 'http://x') } catch { return 'forbid' }
  if (method === 'POST') {
    // Another site's form could post wrong codes and keep sign-in locked, or fill the Mac with asks.
    if (h.origin !== undefined && !sameOrigin(h.origin, port, lan)) return 'forbid'
    return u.pathname === '/login' ? 'login' : u.pathname === '/device' ? 'device' : 'forbid'
  }
  if (method === 'GET' && u.pathname === '/device/wait') return 'wait'
  return method === 'GET' && (u.pathname === '/' || String(h.accept ?? '').includes('text/html')) ? 'page' : 'forbid'
}

export type DeviceAsk = { id: string; ip: string; ua: string; host: string; network: 'Wi-Fi' | 'Tailscale'; at: number }
const ASK_MS = 2 * 60_000

/** Devices asking the Mac to let them in. At most 3 wait at once; an unanswered one is gone after 2 minutes.
 * state() hands an answer out once, to the device that knows the id. */
export function deviceAsks(now = Date.now) {
  const asks = new Map<string, DeviceAsk & { allow?: boolean }>()
  const prune = () => { for (const [id, a] of asks) if (now() - a.at >= ASK_MS) asks.delete(id) }
  return {
    ask(d: Omit<DeviceAsk, 'id' | 'at'>): DeviceAsk | undefined {
      prune()
      if ([...asks.values()].filter(a => a.allow === undefined).length >= 3) return undefined
      const a = { ...d, id: crypto.randomBytes(16).toString('hex'), at: now() }
      asks.set(a.id, a)
      return a
    },
    answer(id: string, allow: boolean): boolean {
      prune()
      const a = asks.get(id)
      if (!a || a.allow !== undefined) return false
      a.allow = allow
      return true
    },
    state(id: string): 'pending' | 'allowed' | 'denied' | 'gone' {
      prune()
      const a = asks.get(id)
      if (!a) return 'gone'
      if (a.allow === undefined) return 'pending'
      asks.delete(id)
      return a.allow ? 'allowed' : 'denied'
    },
  }
}

/** "iPhone Safari" and the like, for the Mac's prompt. */
export function uaSummary(ua: string | undefined): string {
  const s = ua ?? ''
  const device = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /Macintosh/.test(s) ? 'Mac' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : ''
  const browser = /Edg(e|A|iOS)?\//.test(s) ? 'Edge' : /Firefox\/|FxiOS/.test(s) ? 'Firefox' : /Chrome\/|CriOS/.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : ''
  return device && browser ? `${device} ${browser}` : device || browser || 'Unknown browser'
}

/** True when token is the hubToken of a live VS Code window, read from the window files. */
export function liveToken(files: Partial<Win>[], token: unknown, alive: (pid: number) => boolean = pidAlive): boolean {
  return typeof token === 'string' && token !== '' && files.some(f => usable(f, alive) && same(token, f.hubToken))
}

const LOCK_MS = 10 * 60_000

/** The typed code check, one per server. 5 wrong codes in 10 minutes lock it, the right code too; a right code clears the count. */
// One lock for everyone, so anyone on the network can lock sign-in (the QR link still works). Count per IP if that bites.
export function codeLogin(now = Date.now) {
  let wrong: number[] = []
  return (code: string, secret: string): 'ok' | 'wrong' | 'locked' => {
    wrong = wrong.filter(t => now() - t < LOCK_MS)
    if (wrong.length >= 5) return 'locked'
    if (same(code, phoneCode(secret))) { wrong = []; return 'ok' }
    wrong.push(now())
    return 'wrong'
  }
}

const pageHead = (title: string, extra = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${extra}
<title>${title}</title><style>
:root{color-scheme:light dark;--bg:#f6f6f4;--card:#fff;--ink:#1d1d1b;--mute:#6b6b66;--line:#d9d9d4;--blue:#2f6fde;--red:#c4372b}
@media (prefers-color-scheme: dark){:root{--bg:#141413;--card:#1f1f1d;--ink:#ecece8;--mute:#a3a39c;--line:#3a3a36;--blue:#6d9cf0;--red:#f07a6d}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--ink);font:400 15px/1.5 -apple-system,system-ui,sans-serif}
main{width:100%;max-width:320px;display:grid;gap:12px;padding:20px;border:1px solid var(--line);border-radius:12px;background:var(--card)}
form{display:grid;gap:12px}form+form{padding-top:12px;border-top:1px solid var(--line)}
h1{margin:0;font-size:18px}p{margin:0;color:var(--mute)}.note{color:var(--red)}a{color:var(--blue)}
input{font:500 24px/1 ui-monospace,Menlo,monospace;letter-spacing:.2em;text-align:center;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);width:100%}
button{font:600 15px/1 inherit;padding:12px;border:0;border-radius:8px;background:var(--blue);color:#fff}
button.alt{background:transparent;color:var(--blue);border:1px solid var(--line)}
</style></head><body><main>`

/** The sign-in page for a typed address. Self-contained: the device has no cookie, so nothing else would load. */
export function signInPage(note?: string): string {
  return `${pageHead('Switchboard sign-in')}<h1>Switchboard</h1>${note ? `<p class="note" role="alert">${note}</p>` : ''}
<form action="/login" method="post"><p>Enter the code shown in Switchboard's Phone menu on your Mac.</p>
<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="7" aria-label="Code" required>
<button type="submit">Sign in with the code</button></form>
<form action="/device" method="post"><p>Or, when someone is at the Mac, ask it: VS Code shows a prompt there to click Allow.</p>
<button type="submit" class="alt">Ask the Mac to let me in</button></form></main></body></html>`
}

/** Shown while the Mac decides; reloads itself every 2 s, no script needed. */
export function waitPage(id: string): string {
  const safe = id.replace(/[^0-9a-f]/g, '')
  return `${pageHead('Waiting for the Mac', `<meta http-equiv="refresh" content="2;url=/device/wait?id=${safe}">`)}<h1>Waiting for your Mac</h1>
<p role="status">Click Allow in the prompt VS Code shows on your Mac. This page goes on by itself.</p>
<p><a href="/">Cancel and use the code instead</a></p></main></body></html>`
}

// Window files only: company.json and workspaces.json lack a port and token, so pickWindow drops them.
export async function windows(): Promise<Partial<Win>[]> {
  const out: Partial<Win>[] = []
  for (const n of await fs.promises.readdir(DIR).catch(() => [] as string[])) {
    if (!n.endsWith('.json') || n === 'workspaces.json') continue
    const p = path.join(DIR, n)
    try { out.push({ ...JSON.parse(await fs.promises.readFile(p, 'utf8')), mtimeMs: (await fs.promises.stat(p)).mtimeMs }) } catch { /* mid-write */ }
  }
  return out
}

/** Posts body to /hub/device on every live window; fire and forget. */
export async function tellWindows(body: object): Promise<void> {
  for (const w of (await windows()).filter(f => usable(f, pidAlive))) {
    const r = http.request({ host: '127.0.0.1', port: w.port, method: 'POST', path: '/hub/device', headers: { 'Content-Type': 'application/json', 'X-Switchboard-Token': w.hubToken }, timeout: 2000 }, x => x.resume())
    r.on('error', () => {})
    r.on('timeout', () => r.destroy())
    r.end(JSON.stringify(body))
  }
}

const CHAT_READS = new Set(['/hub/chat/outputs', '/hub/chat/transcript', '/hub/chat/shot'])

/** list: the window files, swapped in tests so none reaches a real window. */
export async function proxyHub(req: http.IncomingMessage, res: http.ServerResponse, port: number, workspace: string, lan?: Lan, list = windows): Promise<void> {
  let u: URL
  try { u = new URL(req.url ?? '/', 'http://x') } catch { res.writeHead(400).end(); return }
  const route = req.method === 'GET' && u.pathname === '/hub/state' ? 'state' : req.method === 'GET' && u.pathname === '/hub/voice' ? 'voice' : req.method === 'GET' && u.pathname === '/hub/graph' ? 'graph' : req.method === 'GET' && u.pathname === '/hub/runs' ? 'runs'
    : req.method === 'GET' && CHAT_READS.has(u.pathname) ? u.pathname.slice('/hub/'.length) : req.method === 'POST' && u.pathname === '/hub/command' ? 'command'
    : req.method === 'POST' && u.pathname === '/hub/upload' ? 'upload' : undefined
  if (!route || !allowed(req.headers, port, lan)) { res.writeHead(route ? 403 : 404).end(); return }
  if (route === 'upload') return proxyUpload(req, res, u, workspace, list)
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > MAX_BODY) { res.writeHead(413).end(); return }
  }
  if (lan && route === 'command' && macOnly(body)) { res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Only the Mac can do that, not the phone.'); return }
  const files = await list()
  const folder = route === 'command' ? commandFolder(body) : undefined
  let win = pickWindow(files, workspace, undefined, folder)
  if (!win) { res.writeHead(502).end(); return }
  const session = route === 'command' && !folder ? commandSession(body) : undefined
  if (session) {
    const live = files.filter((f): f is Win => usable(f, pidAlive))
    // First window to say yes wins, so a hung one only costs its timeout when nobody holds the chat.
    const holder = await new Promise<Win | undefined>(done => {
      let left = live.length
      if (!left) done(undefined)
      for (const w of live) void holds(w, session).then(yes => { if (yes) done(w); else if (--left === 0) done(undefined) })
    })
    if (holder) win = holder
  }
  // Reads pass their own fields only, so a token the page put in the query never reaches the window.
  const fields = route === 'runs' ? ['session', 'role'] : route === 'chat/outputs' ? ['session'] : route === 'chat/transcript' ? ['session', 'before'] : route === 'chat/shot' ? ['session', 'path'] : []
  const query = new URLSearchParams(fields.flatMap(k => { const v = u.searchParams.get(k); return v === null ? [] : [[k, v]] })).toString()
  const up = http.request({ host: '127.0.0.1', port: win.port, method: req.method, path: `/hub/${route}${query ? `?${query}` : ''}`, headers: { 'Content-Type': 'application/json', 'X-Switchboard-Token': win.hubToken }, timeout: route === 'state' || route === 'voice' ? 5000 : COMMAND_MS }, r => {
    const head = { 'Content-Type': r.headers['content-type'] ?? 'text/plain', 'Cache-Control': 'no-store' }
    if (route !== 'state' || r.statusCode !== 200) { res.writeHead(r.statusCode ?? 502, head); pipeline(r, res, err => { if (err) res.destroy() }); return }
    // The page polls state every 2s: a 304 when nothing changed, else gzip, since a full state runs to a few hundred KB.
    const parts: Buffer[] = []
    r.on('data', (c: Buffer) => parts.push(c))
    r.on('error', () => { if (!res.headersSent) res.writeHead(502).end() })
    r.on('end', () => {
      const raw = Buffer.concat(parts)
      const etag = `"${crypto.createHash('sha1').update(raw).digest('hex')}"`
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-store' }).end(); return }
      const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))
      res.writeHead(200, { ...head, ETag: etag, Vary: 'Accept-Encoding', ...(gzip ? { 'Content-Encoding': 'gzip' } : {}) })
      res.end(gzip ? zlib.gzipSync(raw) : raw)
    })
  })
  up.on('error', () => { if (!res.headersSent) res.writeHead(502).end() })
  up.on('timeout', () => up.destroy())
  up.end(body)
}

/** POST /hub/upload?cwd=&name=&session=, streamed to the window holding cwd: never buffered, cut off past 100 MB. */
async function proxyUpload(req: http.IncomingMessage, res: http.ServerResponse, u: URL, workspace: string, list: typeof windows): Promise<void> {
  let cut = false
  const tooBig = () => {
    if (cut) return
    cut = true
    if (res.headersSent) { req.destroy(); return }
    // Closing with unread bytes sends a reset, and the client drops the 413 for EPIPE. Swallow the rest for a bit instead.
    res.writeHead(413, { 'Content-Type': 'text/plain' }).end('the file is over the 100 MB limit')
    req.resume()
    const t = setTimeout(() => req.destroy(), LINGER_MS).unref()
    req.once('end', () => clearTimeout(t))
  }
  if (Number(req.headers['content-length']) > UPLOAD_MAX) { tooBig(); return }
  const cwd = u.searchParams.get('cwd') ?? ''
  const win = pickWindow(await list(), workspace, undefined, cwd || undefined)
  if (!win) { res.writeHead(502).end(); return }
  // Only the three fields go on, so a token the page put in the query never reaches the window.
  const q = new URLSearchParams({ cwd, name: u.searchParams.get('name') ?? '', session: u.searchParams.get('session') ?? '' })
  const up = http.request({ host: '127.0.0.1', port: win.port, method: 'POST', path: `/hub/upload?${q}`, headers: { 'Content-Type': 'application/octet-stream', 'X-Switchboard-Token': win.hubToken }, timeout: COMMAND_MS }, r => {
    res.writeHead(r.statusCode ?? 502, { 'Content-Type': r.headers['content-type'] ?? 'text/plain', 'Cache-Control': 'no-store' })
    pipeline(r, res, err => { if (err) res.destroy() })
  })
  up.on('error', () => { if (!res.headersSent) res.writeHead(502).end() })
  up.on('timeout', () => up.destroy())
  let size = 0
  req.on('data', (c: Buffer) => {
    size += c.length
    if (size > UPLOAD_MAX) { req.unpipe(up); up.destroy(); tooBig() }
  })
  // A phone dropping mid-file: the window sees its request break and deletes the part it wrote.
  req.on('close', () => { if (!req.complete) up.destroy() })
  req.pipe(up)
}
