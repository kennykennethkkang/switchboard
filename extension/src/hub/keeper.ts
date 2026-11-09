/** The launch agent that keeps the browser app on 3131 up across reboots and crashes (macOS). The keeper itself is keeper/app-keeper.mjs. */
import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { copyChanged } from './questions'

export const KEEPER_LABEL = 'com.kenneth.switchboard.app'
const SCRIPT = 'app-keeper.mjs'
const DIR = path.join(os.homedir(), '.claude', 'switchboard')

/** Settings, Keep Switchboard app running: off leaves app.nokeep for the keeper, which then starts nothing. */
export function keepApp(on: boolean, dir = DIR): void {
  const f = path.join(dir, 'app.nokeep')
  if (on) fs.rmSync(f, { force: true })
  else { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, '') }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const read = (f: string) => { try { return fs.readFileSync(f, 'utf8') } catch { return undefined } }

// VS Code's binary runs as node. An update can move it before a window rewrites this, so then any node on PATH.
const SH = 'n="$0"; [ -x "$n" ] || n=$(PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" command -v node); exec "$n" "$1"'

export function keeperPlist(node: string, script: string, dir: string): string {
  const log = esc(path.join(dir, 'app.log'))
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${KEEPER_LABEL}</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>${esc(SH)}</string><string>${esc(node)}</string><string>${esc(script)}</string></array>
  <key>EnvironmentVariables</key><dict><key>ELECTRON_RUN_AS_NODE</key><string>1</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>AbandonProcessGroup</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict></plist>
`
}

const launchctlRun = (args: string[]) => new Promise<boolean>(done => execFile('launchctl', args, { timeout: 10_000 }, err => done(!err)))

type KeeperDeps = { home?: string; node?: string; uid?: number; launchctl?: (args: string[]) => Promise<boolean> }

/** Copies the keeper beside the app and loads its agent; reloads only when the plist or the keeper changed. */
export async function installKeeper(from: string, deps: KeeperDeps = {}): Promise<void> {
  const { home = os.homedir(), node = process.execPath, uid = process.getuid?.() ?? 501, launchctl = launchctlRun } = deps
  const dir = path.join(home, '.claude', 'switchboard')
  const script = path.join(dir, SCRIPT)
  const before = read(script)
  copyChanged(from, dir, [SCRIPT])
  const plist = path.join(home, 'Library', 'LaunchAgents', `${KEEPER_LABEL}.plist`)
  const text = keeperPlist(node, script, dir)
  const domain = `gui/${uid}`, job = `${domain}/${KEEPER_LABEL}`
  if (read(plist) !== text) {
    fs.mkdirSync(path.dirname(plist), { recursive: true })
    fs.writeFileSync(plist, text)
    await launchctl(['bootout', job])
    // bootout can still be finishing.
    if (!(await launchctl(['bootstrap', domain, plist]))) { await new Promise(r => setTimeout(r, 1000)); await launchctl(['bootstrap', domain, plist]) }
    return
  }
  if (!(await launchctl(['print', job]))) await launchctl(['bootstrap', domain, plist])
  else if (before !== read(script)) await launchctl(['kickstart', '-k', job])
}
