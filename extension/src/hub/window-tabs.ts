/** One window: every VS Code window as a native macOS tab, and the few tab commands a window may ask another to run. */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { Win } from './dev'

export const TAB_COMMANDS = {
  merge: 'workbench.action.mergeAllWindowTabs',
  split: 'workbench.action.moveWindowTabToNewWindow',
  popout: 'workbench.action.moveWindowTabToNewWindow',
  show: 'workbench.action.focusWindow',
} as const
export type TabOp = keyof typeof TAB_COMMANDS
export const TAB_OPS = Object.keys(TAB_COMMANDS) as TabOp[]

const ALLOWED = new Set<unknown>(Object.values(TAB_COMMANDS))
/** Never any other command: a post from another window runs what passes this. */
export const isTabCommand = (v: unknown): v is string => ALLOWED.has(v)

/** The slice of vscode's WorkspaceConfiguration for "window" this needs; tests pass a fake. */
export type TabConfig = {
  inspect(key: string): { globalValue?: unknown } | undefined
  update(key: string, value: unknown, global: true): Thenable<void> | Promise<void>
}
/** The user's own nativeTabs before One window went on; undefined: it was unset. */
export type TabKept = { nativeTabs: unknown }

/** Writes window.nativeTabs in user settings and answers what to keep for off. nativeTabs forces the native title bar on macOS, so titleBarStyle stays. */
export async function setOneWindow(cfg: TabConfig, on: boolean, kept: TabKept | undefined): Promise<TabKept | undefined> {
  if (on) {
    const prev = kept ?? { nativeTabs: cfg.inspect('nativeTabs')?.globalValue }
    await cfg.update('nativeTabs', true, true)
    return prev
  }
  // Nothing kept: another window already put it back, or it was never on here.
  if (kept) await cfg.update('nativeTabs', kept.nativeTabs, true)
  return undefined
}

// User settings are shared by every window, so what was kept is too.
const KEPT_FILE = path.join(os.homedir(), '.claude', 'switchboard', 'one-window.json')

export function loadKept(file = KEPT_FILE): TabKept | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    return raw && typeof raw === 'object' ? { nativeTabs: raw.nativeTabs } : undefined
  } catch { return undefined }
}

/** undefined removes the file. */
export function saveKept(kept: TabKept | undefined, file = KEPT_FILE): void {
  try {
    if (!kept) { fs.rmSync(file, { force: true }); return }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(kept))
  } catch { /* best effort; off then leaves the setting as is */ }
}

/** here: run it in this window; send: the other windows to post it to. Pop out and Show need the window's workspace. */
export function tabTargets(wins: Win[], self: number, op: TabOp, workspace?: string): { here: boolean; send: Win[] } {
  if (op === 'merge') return { here: true, send: [] }
  if (op === 'split') return { here: true, send: wins.filter(w => w.pid !== self) }
  const hit = workspace ? wins.filter(w => w.workspace === workspace) : []
  return { here: hit.some(w => w.pid === self), send: hit.filter(w => w.pid !== self) }
}
