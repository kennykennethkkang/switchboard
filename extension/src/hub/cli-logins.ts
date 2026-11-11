/**
 * Web apps whose sign-in is a CLI login (Auth0 now). Signing in runs the CLI; its tenants become saved logins with a
 * domain and a status. Apps not in CLI_APPS keep the plain open-the-URL Sign in. Tokens stay in the CLI's own store.
 */
import { execFile } from 'child_process'
import * as fs from 'fs'
import type { AwsStatus, WebApp, WebLogin } from './types'

/** bins: where to look first (VS Code's PATH often lacks Homebrew). check: a cheap call that needs a live token. */
export type CliApp = { bins: string[]; login: string[]; list: string[]; check: (tenant: string) => string[]; tenantFlag: string; url: string }

export const CLI_APPS: Record<string, CliApp> = {
  // --agent-mode: no prompts; a bare login prints the device URL as JSON and waits for the browser.
  auth0: {
    bins: ['/opt/homebrew/bin/auth0', '/usr/local/bin/auth0', 'auth0'],
    login: ['login', '--agent-mode'],
    list: ['tenants', 'list', '--json', '--agent-mode'],
    check: t => ['apps', 'list', '--json', '--agent-mode', '--no-input', '--number', '1', '--tenant', t],
    tenantFlag: '--tenant',
    url: 'https://manage.auth0.com/dashboard/',
  },
}

export const cliBinary = (c: CliApp) => c.bins.find(b => !b.includes('/') || fs.existsSync(b)) ?? c.bins[c.bins.length - 1]

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i
const parse = (s: string): unknown => { try { return JSON.parse(s) } catch { return undefined } }
const envelope = (v: unknown) => (v as { error?: { code?: unknown; reason?: unknown } } | undefined)?.error

/** Tenant domains from `tenants list --json`; [] when the CLI has no login yet, undefined when it could not tell. */
export function tenantsOf(out: string): string[] | undefined {
  const v = parse(out.trim())
  const err = envelope(v)
  if (err) return /no_config|not_logged_in/.test(String(err.reason)) ? [] : undefined
  const rows = Array.isArray(v) ? v : (v as { tenants?: unknown } | undefined)?.tenants
  if (!Array.isArray(rows)) return undefined
  return rows.flatMap(r => {
    const o = r as Record<string, unknown>
    const d = typeof r === 'string' ? r : [o?.domain, o?.Domain, o?.name, o?.Name].find(x => typeof x === 'string')
    return typeof d === 'string' && DOMAIN.test(d) ? [d] : []
  })
}

/** The device verification URL a login printed, the one with the code filled in first. */
export function deviceUrl(out: string): string | undefined {
  const urls: Array<[string, string]> = []
  for (const line of out.split(/\r?\n/)) {
    const v = parse(line.trim())
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (/verification/i.test(k) && typeof x === 'string' && /^https:\/\/\S+$/.test(x)) urls.push([k, x])
  }
  return (urls.find(([k]) => /complete/i.test(k)) ?? urls[0])?.[1]
}

/** A tenant check's result: undefined when it could not tell (network, rate limit, timeout). */
export function checkStatus(ok: boolean, out: string): AwsStatus | undefined {
  if (ok) return 'signed-in'
  if (/failed to find tenant/i.test(out)) return 'never'
  const err = envelope(parse(out.trim()))
  if (err?.code === 'auth' || /token expired|run 'auth0 login'/i.test(out)) return 'expired'
  return undefined
}

const short = (d: string) => d.split('.')[0]

/** The app with one login per listed tenant: known ones keep their label, email and Chrome; unlisted ones go to never, hand-added ones stay. */
export function mergeTenants(app: WebApp, domains: string[], status: Record<string, AwsStatus>, url = CLI_APPS[app.id]?.url ?? app.url): WebApp {
  const listed = new Set(domains)
  // A check with no answer keeps the last status, or none; it never reads as signed in.
  const put = <T extends object>(o: T, s: AwsStatus | undefined) => { const { status: _s, ...rest } = o as T & { status?: AwsStatus }; return s ? { ...rest, status: s } : rest }
  // A hand-added login whose dashboard url names the tenant is that tenant: it keeps its id, so project picks hold.
  const names = (l: WebLogin, d: string) => !l.domain && new RegExp(`^https://manage\\.auth0\\.com/dashboard/[a-z]{2}/${d.split('.')[0].replace(/[^\w-]/g, '')}/?$`).test(l.url)
  const adopted = app.logins.map(l => { const d = domains.find(x => names(l, x)); return d ? { ...l, domain: d } : l })
  // ponytail: drops an auto-added twin by its id; a project pick on that id reads as Not used.
  const kept = adopted.filter(l => !(l.id === l.domain && adopted.some(o => o !== l && o.domain === l.domain && o.id !== o.domain)))
  const logins = kept.map(l => {
    if (!l.domain) return l
    const twin = adopted.find(o => o !== l && o.id === o.domain && o.domain === l.domain)
    return put(l, listed.has(l.domain) ? status[l.domain] ?? l.status ?? twin?.status : 'never')
  }) as WebLogin[]
  for (const d of domains) {
    if (!logins.some(l => l.domain === d)) logins.push(put({ id: d, label: short(d), url, domain: d }, status[d]) as WebLogin)
  }
  return { ...app, logins }
}

// One running CLI login per app id: each would open another device page.
const running = new Set<string>()
/** Claims app's login slot; false while one already runs. */
export const startCli = (app: string) => !running.has(app) && !!running.add(app)
export const endCli = (app: string) => { running.delete(app) }
export const cliBusy = () => [...running]

/** Runs a CLI call with no shell; ok and stdout plus stderr. */
export function runCli(bin: string, args: string[], timeout = 8000): Promise<{ ok: boolean; out: string }> {
  return new Promise(resolve => execFile(bin, args, { timeout, maxBuffer: 1 << 20, windowsHide: true },
    (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}\n${stderr}`.trim() })))
}

/** An app's tenants and their status from the CLI, for mergeTenants; undefined when the CLI could not tell. */
export async function readTenants(appId: string, run = runCli): Promise<{ domains: string[]; status: Record<string, AwsStatus> } | undefined> {
  const c = CLI_APPS[appId]
  if (!c) return undefined
  const bin = cliBinary(c)
  const listed = await run(bin, c.list)
  const domains = tenantsOf(listed.out)
  if (!domains) return undefined
  const status: Record<string, AwsStatus> = {}
  for (const d of domains) {
    const r = await run(bin, c.check(d))
    const s = checkStatus(r.ok, r.out)
    if (s) status[d] = s
  }
  return { domains, status }
}
