/** GitHub sign-in and sync of memory, the vault and prefs through a private repo in the user's account. The planning is in sync-core.ts. */
import * as vscode from 'vscode'
import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { promisify } from 'util'
import { createLogger } from '../logger'
import { tryLock } from '../fs-utils'
import type { WebviewToExtensionMessage } from '../protocol'
import { hub } from './hub-service'
import { authEnv, buildMapping, runSync } from './sync-core'
import { refuse, type HubReply } from './hub-panel-shared'

const log = createLogger('Sync')
const REPO = 'switchboard-sync'
const EVERY_MS = 15 * 60_000
const DIR = path.join(os.homedir(), '.claude', 'switchboard', 'sync')
const STATE = path.join(DIR, 'state.json')
const LOCK = path.join(os.homedir(), '.claude', 'switchboard', 'sync.lock')
const run = promisify(execFile)

type Saved = { on?: boolean; login?: string; last?: number }
const readSaved = (): Saved => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { return {} } }
const patchSaved = (p: Saved) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify({ ...readSaved(), ...p }, null, 2)) }

const api = async (token: string, method: string, url: string, body?: unknown) => fetch('https://api.github.com' + url, {
  method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'switchboard' },
  body: body ? JSON.stringify(body) : undefined,
})

/** Errors can carry the auth header from the git command line: never log it. */
const scrub = (e: unknown, token: string) => (token ? String((e as Error)?.message ?? e).split(token).join('***') : String((e as Error)?.message ?? e)).replace(/Basic [A-Za-z0-9+/=]+/g, 'Basic ***').split('\n')[0]

async function remoteOf(folder: string): Promise<string | undefined> {
  try { return (await run('git', ['config', '--get', 'remote.origin.url'], { cwd: folder, windowsHide: true })).stdout.trim() } catch { return undefined }
}

async function ensureRepo(token: string, login: string): Promise<void> {
  const got = await api(token, 'GET', `/repos/${login}/${REPO}`)
  if (got.ok) {
    if ((await got.json() as { private?: boolean }).private !== true) throw new Error(`${login}/${REPO} is not private, so nothing is synced to it`)
    return
  }
  if (got.status !== 404) throw new Error(`GitHub answered ${got.status}`)
  const made = await api(token, 'POST', '/user/repos', { name: REPO, private: true, description: 'Switchboard sync' })
  if (!made.ok) throw new Error(`could not create ${REPO} (${made.status})`)
}

export function syncPanel() {
  let busy = false
  let problem: string | undefined
  const show = () => { const s = readSaved(); hub.set({ sync: { on: s.on === true, login: s.login, last: s.last, busy, note: problem } }) }
  const session = (create: boolean) => vscode.authentication.getSession('github', ['repo'], create ? { createIfNone: true } : { silent: true })

  /** One sync, or nothing when another is running here or in another window. auto: skipped while a recent one stands. */
  async function syncNow(auto: boolean, create = false): Promise<string | undefined> {
    const saved = readSaved()
    if (!saved.on || busy) return undefined
    if (auto && saved.last && Date.now() - saved.last < EVERY_MS - 60_000) return undefined
    const release = tryLock(LOCK, 10 * 60_000)
    if (!release) return undefined
    busy = true
    show()
    let token = ''
    try {
      const s = await session(create)
      if (!s) return 'Sign in with GitHub first'
      token = s.accessToken
      const login = s.account.label
      await ensureRepo(token, login)
      const projects = await Promise.all(hub.get().projects.map(async p => ({ path: p.path, remote: await remoteOf(p.path) })))
      const home = os.homedir()
      const r = await runSync({
        repoDir: path.join(DIR, 'repo'), remote: `https://github.com/${login}/${REPO}.git`,
        authEnv: authEnv(token),
        map: buildMapping({ projects, claudeProjects: path.join(home, '.claude', 'projects'), vault: path.join(home, 'Documents', 'vault'), sbDir: path.join(home, '.claude', 'switchboard'), jev: path.join(home, '.claude', 'jev-presets') }),
        stateFile: path.join(DIR, 'files.json'), backupDir: path.join(home, '.claude', 'switchboard', 'backups', 'sync'), host: os.hostname(),
      })
      patchSaved({ login, last: Date.now() })
      problem = undefined
      log.info(`Synced: ${r.pushed} up, ${r.pulled} down, ${r.merged} merged, ${r.removed} removed`)
      return undefined
    } catch (err) {
      const msg = scrub(err, token)
      log.warn('Sync failed:', msg)
      problem = msg
      return `Sync failed (${msg})`
    } finally { busy = false; release(); show() }
  }

  async function signIn(): Promise<string | undefined> {
    try {
      const s = await session(true)
      if (!s) return 'Sign in cancelled'
      patchSaved({ on: true, login: s.account.label })
      show()
    } catch (err) { return `Sign in failed (${scrub(err, '')})` }
    return syncNow(false, true)
  }

  function handle(m: WebviewToExtensionMessage): HubReply | undefined {
    switch (m.type) {
      case 'hub-sync-sign-in': return signIn().then(p => (p ? refuse(p) : true))
      case 'hub-sync-now': return syncNow(false).then(p => (p ? refuse(p) : true))
      case 'hub-sync-off': patchSaved({ on: false }); show(); return true
    }
    return undefined
  }

  function start(context: vscode.ExtensionContext): void {
    show()
    context.subscriptions.push(vscode.commands.registerCommand('agentVisualizer.syncNow', async () => {
      if (!readSaved().on) { const p = await signIn(); if (p) refuse(p); return }
      const p = await syncNow(false); if (p) refuse(p)
    }))
    const first = setTimeout(() => void syncNow(true), 45_000)
    const timer = setInterval(() => void syncNow(true), EVERY_MS)
    context.subscriptions.push({ dispose: () => { clearTimeout(first); clearInterval(timer) } })
  }

  return { handle, start }
}

export const { handle: syncHandle, start: startSync } = syncPanel()
