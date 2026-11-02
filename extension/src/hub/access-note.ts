/**
 * Keeps one Apple Notes note, "Switchboard Access" (tagged #SwitchboardAccess), with the phone code and sign-in links.
 * Rewritten when its body changes, and checked against the note itself every 30 minutes; the state file holds a hash, never the secret.
 */

import { createHash } from 'crypto'
import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { PhoneUrls } from './types'
import { createLogger } from '../logger'
import { tryLock } from '../fs-utils'

const log = createLogger('Hub')
const TITLE = 'Switchboard Access'
// Found by this tag too, so a renamed note is still the one kept current.
const TAG = '#SwitchboardAccess'
const STATE_FILE = path.join(os.homedir(), '.claude', 'switchboard', 'access-note.sha')
const RETRY_MS = 10 * 60_000
const RECHECK_MS = 30 * 60_000
// Every window refreshes; a lock file keeps two of them from each creating the note.
const LOCK_MS = 60_000
const LINKS: [keyof PhoneUrls, string][] = [['tailscaleName', 'Tailscale'], ['tailscale', 'Tailscale IP'], ['wifiName', 'Wi-Fi (home only)'], ['wifi', 'Wi-Fi IP (home only)']]

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const firstLink = (urls: PhoneUrls) => LINKS.map(([k]) => urls[k]).find(Boolean)
const originOf = (u: string) => { try { return new URL(u).origin } catch { return u } }

export function noteBody(urls: PhoneUrls): string {
  const first = firstLink(urls)
  const address = first ? [`<div>Address: <a href="${esc(originOf(first))}">${esc(originOf(first))}</a> (type the code on a new device)</div>`] : []
  const links = LINKS.flatMap(([k, label]) => urls[k] ? [`<div>${label}: <a href="${esc(urls[k]!)}">${esc(urls[k]!)}</a></div>`] : [])
  return [`<div><h1>${TITLE}</h1></div>`, ...address, `<div>Code: <b>${esc(urls.code ?? '')}</b></div>`, ...links,
    '<div>Tailscale must be on, on the phone and the Mac. Switchboard keeps this note current; it is private, do not share it.</div>',
    `<div>${TAG}</div>`].join('\n')
}

// Body and link come in through SB_NOTE and SB_LINK so they never show in ps. Name match ignores case, so the
// old "Switchboard access" note is taken over. SB_FORCE rewrites (the body changed); a recheck only rewrites a note lacking the link.
// Walks folders and skips Recently Deleted: "container of" a note throws -1700 on iCloud.
const SCRIPT = `set b to system attribute "SB_NOTE"
set l to system attribute "SB_LINK"
set force to (system attribute "SB_FORCE") is "1"
tell application "Notes"
  set acct to default account
  repeat with fo in folders of acct
    if name of fo is not "Recently Deleted" then
      repeat with n in (notes of fo whose name is "${TITLE}" or body contains "${TAG}")
        if force or plaintext of n does not contain l then set body of n to b
        return
      end repeat
    end if
  end repeat
  make new note at default folder of acct with properties {body:b}
end tell`

export type Run = (args: string[], env: Record<string, string>) => Promise<void>
const osascript: Run = (args, env) => new Promise((resolve, reject) =>
  execFile('osascript', args, { timeout: 30_000, env: { ...process.env, ...env } }, err => err ? reject(err) : resolve()))

const state = new Map<string, { busy?: boolean; failedAt?: number; logged?: boolean; checkedAt?: number }>()

/** True when it ran the script (a write, or a 30-minute recheck). On a Mac only; one call in flight, and after a failure none for ten minutes. */
export async function syncAccessNote(urls: PhoneUrls | null, platform = process.platform, run = osascript, stateFile = STATE_FILE, now = Date.now): Promise<boolean> {
  if (platform !== 'darwin' || !urls?.code || !LINKS.some(([k]) => urls[k])) return false
  const s = state.get(stateFile) ?? {}
  state.set(stateFile, s)
  if (s.busy || (s.failedAt !== undefined && now() - s.failedAt < RETRY_MS)) return false
  // Busy before the first await, or a second call gets past the check too.
  s.busy = true
  try {
    const body = noteBody(urls)
    const sha = createHash('sha256').update(body).digest('hex')
    const current = async () => (await fs.promises.readFile(stateFile, 'utf8').catch(() => '')).trim() === sha
    // The common case, every 15 s in every window: nothing changed and the note was checked lately, so no lock.
    const due = s.checkedAt === undefined || now() - s.checkedAt >= RECHECK_MS
    if (!due && await current()) return false
    const release = tryLock(stateFile + '.lock', LOCK_MS)
    if (!release) return false
    try {
      // Another window may have written it while this one read.
      const same = await current()
      if (!due && same) return false
      try {
        await run(['-e', SCRIPT], { SB_NOTE: body, SB_LINK: firstLink(urls)!, SB_FORCE: same ? '' : '1' })
      } catch (err) {
        s.failedAt = now()
        if (!s.logged) log.warn(`Access note: could not update Apple Notes (${(err as Error).message.split('\n')[0]})`)
        s.logged = true
        return false
      }
      s.failedAt = undefined
      s.logged = false
      s.checkedAt = now()
      await fs.promises.mkdir(path.dirname(stateFile), { recursive: true })
      await fs.promises.writeFile(stateFile, sha + '\n', { mode: 0o600 })
      return true
    } finally { release() }
  } finally { s.busy = false }
}

/** Drops the stored hash, so the next sync writes the note even if it was deleted by hand. */
export const forgetAccessNote = (stateFile = STATE_FILE) => fs.rmSync(stateFile, { force: true })
