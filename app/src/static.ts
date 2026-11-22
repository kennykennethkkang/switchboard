/**
 * Static file server for the pre-built webview assets.
 * Serves index.html, index.js, and index.css from app/dist/webview/.
 */
import * as crypto from 'crypto'
import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import * as zlib from 'zlib'

const WEBVIEW_DIR = path.join(__dirname, 'webview')

const HTML_SHELL = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff">
  <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0d0d0d">
  <title>Switchboard</title>
  <link rel="icon" href="data:,">
  <link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">
  <link rel="apple-touch-icon" href="/apple-icon.png">
  <link rel="stylesheet" href="/index.css">
  <style>html, body { height: 100%; margin: 0; padding: 0; }</style>
</head>
<body class="font-sans antialiased" style="background: var(--hub-canvas, #07080a);">
  <div id="root" style="height: 100%;"></div>
  <script type="module" src="/index.js"></script>
</body>
</html>`

const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

// Read and gzipped once per file: the assets only change with a new build, which restarts the app.
const cache = new Map<string, { raw: Buffer; gz: Buffer; etag: string }>()
function load(file: string) {
  let hit = cache.get(file)
  if (!hit) {
    const raw = fs.readFileSync(file)
    hit = { raw, gz: zlib.gzipSync(raw), etag: `"${crypto.createHash('sha1').update(raw).digest('hex')}"` }
    cache.set(file, hit)
  }
  return hit
}

/** dir: swapped in tests. */
export function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, dir = WEBVIEW_DIR) {
  // The query (like ?layout=desk) is for the page, not the file.
  const url = new URL(req.url || '/', 'http://x').pathname

  if (url === '/' || url === '/index.html') {
    // No framing: another site could overlay the page and steal clicks.
    res.writeHead(200, { 'Content-Type': 'text/html', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" })
    res.end(HTML_SHELL)
    return
  }

  // Only serve known asset files from the webview directory
  const basename = path.basename(url)
  const ext = path.extname(basename)
  const mime = MIME_TYPES[ext]

  if (!mime) {
    res.writeHead(404)
    res.end('Not found')
    return
  }

  const filePath = path.join(dir, basename)

  // Prevent path traversal
  if (!filePath.startsWith(dir)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  try {
    const { raw, gz, etag } = load(filePath)
    // no-cache: the browser keeps the file but checks the ETag, so a new build shows up on the next load.
    // Chunks carry a content hash in their name, so a phone keeps them without asking again.
    const head = { 'Content-Type': mime, ETag: etag, 'Cache-Control': /-[\w-]{8}\.js$/.test(basename) ? 'public, max-age=31536000, immutable' : 'no-cache', Vary: 'Accept-Encoding' }
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, head).end(); return }
    const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))
    res.writeHead(200, { ...head, ...(gzip ? { 'Content-Encoding': 'gzip' } : {}) })
    res.end(gzip ? gz : raw)
  } catch {
    res.writeHead(404)
    res.end('Not found')
  }
}
