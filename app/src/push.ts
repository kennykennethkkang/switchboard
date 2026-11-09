/**
 * Phone alerts: the manifest and service worker that let the home-screen app take Web Push,
 * and the routes it subscribes through. Sits behind lanGate, so only the Mac or a signed-in phone gets here.
 */
import * as http from 'http'
import { addSubscription, PUSH_DIR, vapidKeys } from '../../extension/src/hub/web-push'

const MANIFEST = JSON.stringify({
  name: 'Switchboard',
  short_name: 'Switchboard',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#07080a',
  theme_color: '#0d0d0d',
  icons: [{ src: '/apple-icon.png', sizes: '180x180', type: 'image/png' }, { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
})

const SW = `self.addEventListener('push', e => {
  let d = {}
  try { d = e.data.json() } catch {}
  e.waitUntil(self.registration.showNotification(d.title || 'Switchboard', { body: d.body || '', icon: '/apple-icon.png' }))
})
self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(l => l.length ? l[0].focus() : clients.openWindow('/')))
})
`

async function readBody(req: http.IncomingMessage, max: number) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > max) return undefined
  }
  return body
}

async function subscribe(req: http.IncomingMessage, res: http.ServerResponse, dir: string) {
  // JSON only: a cross-site form can not send it without a preflight.
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) { req.resume(); res.writeHead(415).end(); return }
  const body = await readBody(req, 4096)
  if (body === undefined) { res.writeHead(413).end(); return }
  let sub: unknown
  try { sub = JSON.parse(body) } catch { res.writeHead(400).end(); return }
  res.writeHead(addSubscription(sub, dir) ? 204 : 400).end()
}

/** true when the request was one of these; dir: swapped in tests. */
export function pushRoute(req: http.IncomingMessage, res: http.ServerResponse, dir = PUSH_DIR): boolean {
  const url = new URL(req.url ?? '/', 'http://x').pathname
  if (req.method === 'GET' && url === '/manifest.webmanifest') {
    res.writeHead(200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' }).end(MANIFEST)
  } else if (req.method === 'GET' && url === '/sw.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' }).end(SW)
  } else if (req.method === 'GET' && url === '/push/key') {
    try { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ key: vapidKeys(dir).publicKey })) } catch { res.writeHead(500).end() }
  } else if (req.method === 'POST' && url === '/push/subscribe') {
    subscribe(req, res, dir).catch(() => { if (!res.headersSent) res.writeHead(400); res.end() })
  } else return false
  return true
}
