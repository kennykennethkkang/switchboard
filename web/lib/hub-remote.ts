/**
 * The standalone web app's way to the live hub: its own server's /hub proxy
 * (app/src/hub-proxy.ts), which adds the window's token. Used by use-hub.ts.
 */
import type { HubState } from './hub-types'
import { applyDelta } from './hub-share'
import type { HubCommand } from './vscode-bridge'

const HEADERS = { 'X-Switchboard': '1', 'Content-Type': 'application/json' }

/** What the page says while it cannot reach the hub; status undefined: no answer at all. */
export const downReason = (status: number | undefined) =>
  status === 401 || status === 403 ? 'This device is signed out. Scan the QR code or type the code from the Switchboard panel again.'
  : status === undefined ? 'Cannot reach the Mac. Check Wi-Fi or Tailscale.'
  : 'No editor window with Switchboard is open on the Mac.'

// The proxy answers 304 when the state has not changed since this ETag; no-store keeps the browser cache out of it.
let last: { etag: string; hub: HubState } | undefined

export async function fetchHubWhy(f: typeof fetch = fetch): Promise<{ hub: HubState | null; why?: string; /** 404: nothing serves /hub here (the demo build), so asking again is pointless. */ noHub?: true }> {
  // NEXT_PUBLIC_DEMO=1 is the sample-data build: nothing serves /hub, and a probe only logs a 404.
  if (process.env.NEXT_PUBLIC_DEMO === '1') return { hub: null, why: downReason(404), noHub: true }
  try {
    // The base this request names; a poll and a post-command fetch can overlap and answer out of order.
    const base = last
    const r = await f('/hub/state', { headers: { ...HEADERS, ...(base ? { 'If-None-Match': base.etag, 'X-Base': base.etag } : {}) }, cache: 'no-store' })
    if (r.status === 304 && base) return { hub: base.hub }
    if (!r.ok) return { hub: null, why: downReason(r.status), ...(r.status === 404 ? { noHub: true as const } : {}) }
    const body = (await r.json()) as unknown
    // X-Delta: only the fields that changed since the state this page named; the rest keep their objects.
    // A delta only fits its own base: if another reply moved `last` meanwhile, drop it and ask for the whole state.
    if (r.headers.get('X-Delta') && (!base || last !== base)) { last = undefined; return fetchHubWhy(f) }
    const hub = r.headers.get('X-Delta') && base ? applyDelta(base.hub, body as { set: Record<string, unknown>; del: string[] }) : (body as HubState)
    const etag = r.headers.get('ETag')
    last = etag ? { etag, hub } : undefined
    return { hub }
  } catch {
    return { hub: null, why: downReason(undefined) }
  }
}

export type VoicePoll = { voice: HubState['voice']; level: number; heard: HubState['heard'] }

/** The mic's level, state and last transcript: polled while it runs, since state comes every 2 s. */
export async function fetchVoice(f: typeof fetch = fetch): Promise<VoicePoll | null> {
  try {
    const r = await f('/hub/voice', { headers: HEADERS, cache: 'no-store' })
    return r.ok ? ((await r.json()) as VoicePoll) : null
  } catch {
    return null
  }
}

export const fetchHub = async (f: typeof fetch = fetch) => (await fetchHubWhy(f)).hub

/** Undefined when the command ran; otherwise why not, from the hub's own reply where it gave one. */
export async function postCommand(c: HubCommand, f: typeof fetch = fetch): Promise<string | undefined> {
  try {
    const r = await f('/hub/command', { method: 'POST', headers: HEADERS, body: JSON.stringify(c) })
    if (r.ok) return undefined
    return (await r.text().catch(() => '')).trim().slice(0, 200) || `the hub answered ${r.status}`
  } catch {
    return 'could not reach the hub'
  }
}

/** Streams one file to /hub/upload; XHR for its upload progress, which fetch does not give. */
export function uploadFile(file: File, cwd: string, session: string | undefined, onProgress: (f: number) => void, signal?: AbortSignal): Promise<{ path: string } | { problem: string }> {
  return new Promise(done => {
    const x = new XMLHttpRequest()
    const q = new URLSearchParams({ cwd, name: file.name, ...(session ? { session } : {}) })
    x.open('POST', `/hub/upload?${q}`)
    x.setRequestHeader('X-Switchboard', '1')
    x.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total) }
    x.onload = () => {
      if (x.status === 200) {
        try { return done({ path: (JSON.parse(x.responseText) as { path: string }).path }) } catch { /* below */ }
      }
      done({ problem: x.status === 413 ? 'over the 100 MB limit' : x.responseText.trim().slice(0, 200) || downReason(x.status) })
    }
    x.onerror = () => done({ problem: downReason(undefined) })
    // The hub drops the partial file when the body breaks off.
    x.onabort = () => done({ problem: 'removed' })
    signal?.addEventListener('abort', () => x.abort(), { once: true })
    x.send(file)
  })
}
