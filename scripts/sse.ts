import type * as http from 'http'

// Idle proxies and phones cut a silent stream; a comment line keeps it open.
const PING_MS = 25_000
// Pings in a row that hit a full buffer before a stalled client is dropped.
const MAX_MISSES = 3

export function sseClients(pingMs = PING_MS) {
  const clients = new Map<http.ServerResponse, number>()
  const drop = (res: http.ServerResponse) => { if (clients.delete(res)) res.destroy() }
  const write = (res: http.ServerResponse, chunk: string) => {
    try { return res.write(chunk) } catch { drop(res); return true }
  }
  return {
    get size() { return clients.size },
    add(req: http.IncomingMessage, res: http.ServerResponse) {
      clients.set(res, 0)
      const ping = setInterval(() => {
        if (!clients.has(res)) return clearInterval(ping)
        const misses = write(res, ': ping\n\n') ? 0 : clients.get(res)! + 1
        if (misses >= MAX_MISSES) drop(res)
        else if (clients.has(res)) clients.set(res, misses)
      }, pingMs)
      ping.unref()
      req.on('close', () => { clearInterval(ping); clients.delete(res) })
      res.on('error', () => { clearInterval(ping); drop(res) })
    },
    send(res: http.ServerResponse, data: string) { write(res, `data: ${data}\n\n`) },
    broadcast(data: string) { for (const res of clients.keys()) write(res, `data: ${data}\n\n`) },
  }
}
