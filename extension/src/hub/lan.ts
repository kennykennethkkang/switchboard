/** This Mac's tailnet name for the phone link, shared by the standalone app (server) and the panel (phone links). */
import { execFile } from 'child_process'
import * as crypto from 'crypto'
import * as fs from 'fs'

/** The 6 digits typed on a new device instead of the QR. From the secret, so it stays the same across restarts. */
export const phoneCode = (secret: string) => String(crypto.createHmac('sha256', secret).update('switchboard-code').digest().readUInt32BE(0) % 1e6).padStart(6, '0')

// VS Code's PATH often lacks /usr/local/bin; the Mac App Store app keeps its CLI inside the bundle.
const TS_BINS = ['/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale', '/usr/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale', 'C:\\Program Files\\Tailscale\\tailscale.exe']
export const tailscaleBin = () => TS_BINS.find(b => fs.existsSync(b))

// Only plain DNS labels, since a name ends up in Host checks and links.
const okName = (n: string) => (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(n) ? n : undefined)

/** Why the phone link cannot work yet, from `tailscale status --json` (undefined: no tailscale); undefined when it can. */
export function tailscaleProblem(json: string | undefined): string | undefined {
  if (json === undefined) return 'Phone access needs Tailscale. Install it on this Mac and your phone, and sign in on both.'
  let s: { BackendState?: unknown }
  try { s = JSON.parse(json) } catch { s = {} }
  if (s.BackendState !== 'Running') return 'Tailscale is off or signed out on this Mac. Open it and sign in, then press Phone again.'
  return undefined
}

/** Self.DNSName from `tailscale status --json`, while tailscale is up. */
export function tailscaleName(json: string): string | undefined {
  if (tailscaleProblem(json)) return undefined
  const dns = (JSON.parse(json) as { Self?: { DNSName?: unknown } }).Self?.DNSName
  return typeof dns === 'string' ? okName(dns.replace(/\.$/, '').toLowerCase()) : undefined
}

// The app listens on loopback only; tailscale serve puts it on https://<name>/ for the tailnet,
// or http://<name>/ while the tailnet has no HTTPS certs (no clipboard on the phone then: it needs a secure context).
const flag = (https: boolean) => https ? '--https=443' : '--http=80'
export const phoneServeArgs = (port: number, on: boolean, https = true) => on ? ['serve', '--bg', flag(https), `http://127.0.0.1:${port}`] : ['serve', flag(https), 'off']

/** https: the tailnet has certs (CertDomains), else the phone link falls back to plain http. */
export type MacNames = { tailscale?: string; https?: boolean; problem?: string }
export function macNamesOf(json: string | undefined): MacNames {
  const problem = tailscaleProblem(json)
  if (problem) return { problem }
  const certs = (JSON.parse(json!) as { CertDomains?: unknown }).CertDomains
  return { tailscale: tailscaleName(json!), https: Array.isArray(certs) && certs.length > 0 }
}
const out = (bin: string, args: string[]) => new Promise<string>(done => execFile(bin, args, { timeout: 5000 }, (err, stdout) => done(err ? '' : String(stdout))))
export async function readMacNames(): Promise<MacNames> {
  const ts = tailscaleBin()
  return macNamesOf(ts ? await out(ts, ['status', '--self', '--json']) : undefined)
}
let names: MacNames = {}
let namesAt = -Infinity
let reading: Promise<MacNames> = Promise.resolve(names)
/** This Mac's MagicDNS name as last read. A read older than 3 minutes starts a new one in the background, so no caller waits on tailscale. */
export function macNames(now = Date.now()): MacNames {
  if (now - namesAt >= 3 * 60_000) { namesAt = now; reading = readMacNames().then(n => (names = n)) }
  return names
}
/** The read macNames last started; the app awaits the first one before it listens. */
export const macNamesRead = () => reading
