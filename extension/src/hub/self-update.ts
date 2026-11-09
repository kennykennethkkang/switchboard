/**
 * Keeps Switchboard on the newest kit build: offers a newer switchboard-X.Y.Z.vsix from the kit,
 * installs it on a yes, then reloads the window once the user is not in it.
 */
import type * as vscode from 'vscode'
import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createLogger } from '../logger'
import { tryLock } from '../fs-utils'

const log = createLogger('SelfUpdate')
const EVERY_MS = 5 * 60 * 1000
// One window pulls and installs at a time; the others skip that round.
const LOCK = path.join(os.homedir(), '.claude', 'switchboard', 'self-update.lock')
const VSIX = /^switchboard-(\d+\.\d+\.\d+)\.vsix$/

/** a > b, part by part as numbers; a missing b counts as older. */
export function newerVersion(a: string, b: string | undefined): boolean {
  if (!b) return true
  const x = a.split('.').map(Number), y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  }
  return false
}

export function newestVsix(names: string[]): { file: string; version: string } | undefined {
  let best: { file: string; version: string } | undefined
  for (const file of names) {
    const version = VSIX.exec(file)?.[1]
    if (version && (!best || newerVersion(version, best.version))) best = { file, version }
  }
  return best
}

/** Our registered version in the extensions folder's extensions.json; old folders sit in .obsolete. */
export function diskVersion(json: string, id: string): string | undefined {
  try {
    const rows = JSON.parse(json) as Array<{ identifier?: { id?: string }; version?: string }>
    return rows.find(r => r.identifier?.id?.toLowerCase() === id.toLowerCase())?.version
  } catch { return undefined }
}

const FOLDER = /^kennykennethkkang\.switchboard-(\d+\.\d+\.\d+)$/
/** dist/build.txt, the stamp esbuild.js writes; undefined for a copy without one. */
export const readBuild = (folder: string) => { try { return fs.readFileSync(path.join(folder, 'dist', 'build.txt'), 'utf8').trim() || undefined } catch { return undefined } }

/** What this window should reload for, from the extensions folder dir: a newer version, or with rebuilds a
 * same-version reinstall with another stamp. The key is the version, or version+build with rebuilds. */
export function pendingReload(dir: string, running: { version: string; build?: string }, rebuilds: boolean): string | undefined {
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return undefined }
  let obsolete: Record<string, unknown> = {}
  try { obsolete = JSON.parse(fs.readFileSync(path.join(dir, '.obsolete'), 'utf8')) } catch { /* none */ }
  let best: string | undefined
  for (const n of names) {
    const v = FOLDER.exec(n)?.[1]
    if (v && !obsolete[n] && !newerVersion(best ?? running.version, v)) best = v
  }
  if (!best) return undefined
  if (!rebuilds) return newerVersion(best, running.version) ? best : undefined
  const build = readBuild(path.join(dir, `kennykennethkkang.switchboard-${best}`))
  if (newerVersion(best, running.version)) return `${best}+${build ?? ''}`
  return build && build !== running.build ? `${best}+${build}` : undefined
}

/** A window with the Switchboard checkout open, at its root or a folder inside it. */
export function onSwitchboard(folders: string[]): boolean {
  return folders.some(f => {
    for (let d = path.resolve(f); ; d = path.dirname(d)) {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(d, 'extension', 'package.json'), 'utf8')) as { name?: string; publisher?: string }
        if (p.name === 'switchboard' && p.publisher === 'kennykennethkkang') return true
      } catch { /* not here */ }
      if (path.dirname(d) === d) return false
    }
  })
}

/** git in dir, no shell; rejects on a non-zero exit or after the timeout. */
export const gitIn = (dir: string) => (args: string[]) => new Promise<string>((ok, fail) => {
  execFile('git', args, { cwd: dir, timeout: 60_000, windowsHide: true }, (err, out) => (err ? fail(err) : ok(String(out))))
})

/** Fast-forwards the kit's repo when its branch tracks an upstream; one pull at a time, failures logged. */
export function gitPuller(run: (args: string[]) => Promise<string>): () => Promise<void> {
  let inFlight: Promise<void> | undefined
  return () => inFlight ??= (async () => {
    // Fails outside a repo and on a branch without an upstream: nothing to pull then.
    try { await run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']) } catch { return }
    try { await run(['pull', '--ff-only', '--quiet']) } catch (err) { log.warn('Kit pull failed:', err) }
  })().finally(() => { inFlight = undefined })
}

/** A status bar "Reload ready" item: a new build waits for the user's click, never reloads under them. One per window (per vscode module, for the tests). */
const items = new WeakMap<object, vscode.StatusBarItem>()
export function reloadReady(vs: typeof vscode, why: string): void {
  const item = items.get(vs) ?? vs.window.createStatusBarItem(vs.StatusBarAlignment.Left, 100)
  items.set(vs, item)
  item.text = '$(refresh) Reload ready'
  item.tooltip = `${why}. Click to reload this window.`
  item.command = 'workbench.action.reloadWindow'
  item.show()
}

export function startSelfUpdate(context: vscode.ExtensionContext, kitDir: string, pull = gitPuller(gitIn(path.dirname(kitDir))), lock = LOCK): Promise<void> {
  // Loaded here so the tests can import the helpers above without VS Code.
  const vs: typeof vscode = require('vscode')
  if (context.extensionMode !== vs.ExtensionMode.Production) return Promise.resolve()
  const running = context.extension.packageJSON.version as string
  const id = context.extension.id
  const listing = path.join(path.dirname(context.extensionPath), 'extensions.json')
  // In globalState, like TRIED: a row that stays ahead of the running version reloads once, not on every start.
  const PROMPTED = 'selfUpdate.prompted'
  let prompted = context.globalState.get<string>(PROMPTED)
  const reload = () => vs.commands.executeCommand('workbench.action.reloadWindow')

  // now: the user just pressed Install. Otherwise another window or an agent put it there: offer, never reload.
  const askReload = (version: string, now: boolean) => {
    if (prompted === version) return
    prompted = version
    void context.globalState.update(PROMPTED, version)
    if (now) { void reload(); return }
    reloadReady(vs, `Switchboard ${version} is installed`)
  }

  const readDisk = async () => diskVersion(await fs.promises.readFile(listing, 'utf8').catch(() => '[]'), id)
  // One install per kit version, across activations: set once the install command went through.
  const TRIED = 'selfUpdate.tried'
  const ASKED = 'selfUpdate.asked'

  const check = async () => {
    let installed = false
    try {
      // No row means a dev host or a folder we do not manage: never install or reload there.
      let disk = await readDisk()
      if (!disk) return
      const release = tryLock(lock, EVERY_MS)
      if (release) {
        try {
          // Another computer pushed a newer vsix: fetch it first.
          await pull()
          const names = await fs.promises.readdir(kitDir).catch(() => [] as string[])
          const kit = newestVsix(names)
          if (kit && kit.version !== context.globalState.get(TRIED) && kit.version !== context.globalState.get(ASKED) && newerVersion(kit.version, disk)) {
            // A pulled vsix is unsigned code: install only on a yes, and ask once per version.
            await context.globalState.update(ASKED, kit.version)
            const pick = await vs.window.showInformationMessage(`Switchboard ${kit.version} is in the kit. Install it?`, 'Install')
            if (pick === 'Install') {
              log.info(`Installing ${kit.file} from the kit`)
              try {
                await vs.commands.executeCommand('workbench.extensions.installExtension', vs.Uri.file(path.join(kitDir, kit.file)))
              } catch (err) {
                // Ask again next round.
                await context.globalState.update(ASKED, undefined)
                throw err
              }
              await context.globalState.update(TRIED, kit.version)
              installed = true
              // Trust the row, not the command: a failed install leaves it as it was.
              disk = await readDisk()
            }
          }
        } finally { release() }
      }
      if (disk && newerVersion(disk, running)) askReload(disk, installed)
    } catch (err) {
      log.warn('Self update failed:', err)
    }
  }

  const first = check()
  // Jitter, so windows opened together do not all check at once.
  const timer = setInterval(() => void check(), EVERY_MS + Math.floor(Math.random() * 60_000))
  context.subscriptions.push({ dispose: () => clearInterval(timer) })
  // The first check, so the tests can wait on it; check never rejects.
  return first
}
