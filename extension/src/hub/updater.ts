import type * as vscode from 'vscode'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { createLogger } from '../logger'
import { tryLock, writeJsonAtomic } from '../fs-utils'
import { compareVersions, pickReleaseAssets, shouldPull } from './updater-pure'
import { hub } from './hub-service'

const log = createLogger('Updater')
const API = 'https://api.github.com/repos/kennykennethkkang/switchboard/releases/latest'
const LOCK = path.join(os.homedir(), '.claude', 'switchboard', 'skill-refresh.lock')
const CACHE = path.join(os.homedir(), '.claude', 'switchboard', 'update.json')
const ONE_MINUTE = 60_000
const SIX_HOURS = 6 * 60 * 60_000
const LOCK_STALE = 2 * 60_000

type Release = { tag_name: string; assets: Array<{ name: string; browser_download_url: string }> }

async function get(url: string, headers?: Record<string, string>): Promise<Response> {
  return fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Switchboard', ...headers } })
}

// Release assets live on github.com and redirect to GitHub's download hosts; anything else is refused.
const HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'])
const trusted = (u: string) => { try { const x = new URL(u); return x.protocol === 'https:' && HOSTS.has(x.hostname) } catch { return false } }

async function responseBytes(url: string): Promise<Buffer> {
  if (!trusted(url)) throw new Error(`Refused download from ${url}`)
  const response = await get(url)
  if (!trusted(response.url)) throw new Error(`Refused redirect to ${response.url}`)
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`)
  return Buffer.from(await response.arrayBuffer())
}

async function installRelease(context: vscode.ExtensionContext, release: Release): Promise<void> {
  const version = release.tag_name.replace(/^v/, '')
  const assets = pickReleaseAssets(release.assets, version)
  if (!assets) throw new Error(`Release ${release.tag_name} has no VSIX and checksum pair`)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-update-'))
  const file = path.join(dir, `switchboard-${version}.vsix`)
  const sumFile = `${file}.sha256`
  try {
    const [vsix, checksum] = await Promise.all([responseBytes(assets.vsix), responseBytes(assets.checksum)])
    fs.writeFileSync(file, vsix, { mode: 0o600 })
    fs.writeFileSync(sumFile, checksum, { mode: 0o600 })
    const expected = /^([a-f\d]{64})\b/i.exec(fs.readFileSync(sumFile, 'utf8'))?.[1]?.toLowerCase()
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    if (!expected || actual !== expected) throw new Error(`Checksum mismatch for Switchboard ${version}`)
    await contextVscode(context).commands.executeCommand('workbench.extensions.installExtension', contextVscode(context).Uri.file(file))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

let asked = ''
async function askReload(context: vscode.ExtensionContext, version: string): Promise<void> {
  if (asked === version) return
  asked = version
  const choice = await contextVscode(context).window.showInformationMessage(`Switchboard ${version} is installed`, 'Reload')
  if (choice === 'Reload') await contextVscode(context).commands.executeCommand('workbench.action.reloadWindow')
}

function contextVscode(_context: vscode.ExtensionContext): typeof vscode {
  return require('vscode')
}

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 }).trim()
}

function syncClaudeMods(): void {
  const repo = path.join(os.homedir(), 'Documents', 'GitHub', 'claude-mods')
  if (!fs.existsSync(repo)) return
  try {
    if (git(repo, ['rev-parse', '--is-inside-work-tree']) !== 'true') return
    const clean = !git(repo, ['status', '--porcelain'])
    if (!clean) { log.info('Skipped claude-mods pull: worktree has local changes'); return }
    const branch = git(repo, ['branch', '--show-current'])
    if (!branch) { log.info('Skipped claude-mods pull: detached HEAD'); return }
    let defaultRef: string
    try { defaultRef = git(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']) }
    catch {
      const defaultBranch = git(repo, ['remote', 'show', 'origin']).match(/HEAD branch: (.+)/)?.[1]
      defaultRef = defaultBranch ? `origin/${defaultBranch}` : ''
    }
    if (!shouldPull({ exists: true, isRepo: true, clean, onDefaultBranch: defaultRef === `origin/${branch}`, behind: false })) {
      log.info('Skipped claude-mods pull: current branch is not the default branch'); return
    }
    git(repo, ['fetch', 'origin'])
    const behind = Number(git(repo, ['rev-list', '--count', `HEAD..${defaultRef}`]))
    if (!shouldPull({ exists: true, isRepo: true, clean, onDefaultBranch: true, behind: behind > 0 })) return
    const before = git(repo, ['rev-parse', 'HEAD'])
    git(repo, ['pull', '--ff-only', 'origin', branch])
    const changed = git(repo, ['diff', '--name-only', `${before}..HEAD`]).split('\n')
    const setup = path.join(repo, 'kit', 'setup.mjs')
    if (changed.includes('kit/rules.md')) execFileSync(process.execPath, [setup, '--rules-only'], { cwd: repo, stdio: 'ignore' })
    if (changed.some(file => file.startsWith('kit/agents/'))) execFileSync(process.execPath, [setup, '--agents-only'], { cwd: repo, stdio: 'ignore' })
  } catch (err) { log.warn('claude-mods update failed:', err) }
}

// fromHub: the hub's own button asked; it shows the state and Reload itself, so no VS Code prompts.
async function check(context: vscode.ExtensionContext, manual: boolean, fromHub = false): Promise<void> {
  if (!manual && !contextVscode(context).workspace.getConfiguration('agentVisualizer').get('autoUpdate', true)) return
  const current = context.extension.packageJSON.version as string
  const releaseLock = tryLock(LOCK, LOCK_STALE)
  if (!releaseLock) {
    // Another window is checking; an install it finished shows up in the cache.
    let installed: string | undefined
    try { installed = (JSON.parse(fs.readFileSync(CACHE, 'utf8')) as { installed?: string }).installed } catch {}
    if (installed && compareVersions(installed, current) > 0) hub.set({ update: { current, latest: installed, state: 'installed', checkedAt: Date.now() } })
    else if (manual) hub.set({ update: { ...(hub.get().update ?? { current, state: 'idle' }), note: 'Another window is checking. Try again in a minute.' } })
    return
  }
  const heartbeat = setInterval(() => { try { const now = new Date(); fs.utimesSync(LOCK, now, now) } catch {} }, 30_000)
  hub.set({ update: { current, state: 'checking', latest: hub.get().update?.latest } })
  try {
    const cache = (() => { try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')) as { etag?: string; installed?: string } } catch { return {} as { etag?: string; installed?: string } } })()
    // installed: put in by this or another window; an older window only needs a reload
    const pending = cache.installed && compareVersions(cache.installed, current) > 0 ? cache.installed : undefined
    const headers = cache.etag ? { 'If-None-Match': cache.etag } : undefined
    const response = await get(API, headers)
    if (response.status === 304) {
      if (pending) {
        hub.set({ update: { current, latest: pending, state: 'installed', checkedAt: Date.now() } })
        if (!fromHub) void askReload(context, pending)
      }
      else {
        hub.set({ update: { current, latest: current, state: 'current', checkedAt: Date.now() } })
        if (manual && !fromHub) void contextVscode(context).window.showInformationMessage('Switchboard is up to date')
      }
      syncClaudeMods(); return
    }
    if (!response.ok) throw new Error(`Release check failed (${response.status})`)
    const release = await response.json() as Release
    const latest = release.tag_name.replace(/^v/, '')
    const newer = compareVersions(latest, current) > 0
    if (newer && cache.installed !== latest) {
      hub.set({ update: { current, latest, state: 'available' } })
      await installRelease(context, release)
    }
    if (newer) { if (!fromHub) void askReload(context, latest) }
    else if (manual && !fromHub) void contextVscode(context).window.showInformationMessage(`Switchboard is up to date (${current})`)
    // etag saved only after a good install, so a failed one is retried next time
    writeJsonAtomic(CACHE, { etag: response.headers.get('etag') ?? undefined, checkedAt: new Date().toISOString(), installed: newer ? latest : cache.installed })
    hub.set({ update: { current, latest, state: newer ? 'installed' : 'current', checkedAt: Date.now() } })
    syncClaudeMods()
  } catch (err) {
    const note = (err as Error).message
    hub.set({ update: { current, latest: hub.get().update?.latest, state: 'error', note, checkedAt: Date.now() } })
    log.warn('Update check failed:', err)
  }
  finally { clearInterval(heartbeat); releaseLock() }
}

export function startUpdater(context: vscode.ExtensionContext): void {
  const vs = contextVscode(context)
  const current = context.extension.packageJSON.version as string
  hub.set({ update: { current, state: 'idle' } })
  const first = setTimeout(() => void check(context, false), ONE_MINUTE)
  const repeat = setInterval(() => void check(context, false), SIX_HOURS)
  context.subscriptions.push({ dispose: () => { clearTimeout(first); clearInterval(repeat) } })
  context.subscriptions.push(vs.commands.registerCommand('agentVisualizer.checkForUpdates', (fromHub?: unknown) => check(context, true, fromHub === true)))
}
