/** Skill copies Set up made (Codex's and our own) are brought up to date when a window starts: kit/setup-run.mjs --refresh. */
import type * as vscode from 'vscode'
import { execFile } from 'child_process'
import * as os from 'os'
import * as path from 'path'
import { createLogger } from '../logger'
import { tryLock } from '../fs-utils'

const log = createLogger('SkillRefresh')
// Past the rush of a window start.
const AFTER_MS = 30_000
const RUN_MS = 60_000
// Kept after a run that worked: windows that start together share one run. Longer than RUN_MS, so two runs never overlap.
const LOCK_MS = 2 * 60_000
const LOCK = path.join(os.homedir(), '.claude', 'switchboard', 'skill-refresh.lock')

// Hashes about 28 MB, so in its own process; VS Code's binary runs as plain node.
const node = (script: string) => new Promise<string>((ok, fail) => {
  execFile(process.execPath, [script, '--refresh'], { timeout: RUN_MS, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }, (err, out) => (err ? fail(err) : ok(out)))
})

export async function refreshSkills(ext: string, lock = LOCK, run = node): Promise<void> {
  const release = tryLock(lock, LOCK_MS)
  if (!release) return
  try {
    const out = (await run(path.join(ext, 'kit', 'setup-run.mjs'))).trim()
    if (out) log.info(out)
  } catch (err) { release(); log.warn('Skill refresh failed:', err) }
}

export function startSkillRefresh(context: vscode.ExtensionContext, refresh: (ext: string) => Promise<void> = refreshSkills): void {
  // Loaded here so the tests can import the rest without VS Code.
  const vs: typeof vscode = require('vscode')
  if (context.extensionMode !== vs.ExtensionMode.Production) return
  const timer = setTimeout(() => void refresh(context.extensionPath), AFTER_MS)
  context.subscriptions.push({ dispose: () => clearTimeout(timer) })
}
