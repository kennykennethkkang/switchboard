import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { HOOK_TIMEOUT_S } from './constants'
import {
  getHookCommand, ensureHookScript,
  addWorkspaceToManifest,
} from './discovery'
import {
  readSettingsFile, writeJsonAtomic,
  mergeSwitchboardHooks, hasSwitchboardHook, migrateLegacyHttpHooks, missingHookEvents, removeSwitchboardHooks, HOOK_EVENTS, CODEX_HOOK_EVENTS,
} from './hook-entries'
import { createLogger } from './logger'

const log = createLogger('Hooks')

const GLOBAL_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')

/** Read and parse Claude Code's global settings.json. Returns null on failure. */
function readGlobalSettings(): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(GLOBAL_SETTINGS_PATH)) { return null }
    return JSON.parse(fs.readFileSync(GLOBAL_SETTINGS_PATH, 'utf-8'))
  } catch (err) {
    log.debug('Failed to read Claude settings:', err)
    return null
  }
}

// ─── Detection ────────────────────────────────────────────────────────────────

function hooksAlreadyConfigured(): boolean {
  if (hasSwitchboardHooks(GLOBAL_SETTINGS_PATH)) { return true }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (workspaceFolder) {
    const projectPath = path.join(workspaceFolder, '.claude', 'settings.local.json')
    if (hasSwitchboardHooks(projectPath)) {
      // Backfill manifest for workspaces configured before the manifest existed
      addWorkspaceToManifest(workspaceFolder)
      return true
    }
  }

  return false
}

function hasSwitchboardHooks(settingsPath: string): boolean {
  const result = readSettingsFile(settingsPath)
  if (!result.ok) {
    log.debug('Failed to read hooks settings:', result.error)
    return false
  }
  return hasSwitchboardHook(result.settings)
}

// ─── Configure ────────────────────────────────────────────────────────────────

export async function configureClaudeHooks(): Promise<void> {
  ensureHookScript()

  const hookCommand = getHookCommand()
  const hookEntry = { hooks: [{ type: 'command', command: hookCommand, timeout: HOOK_TIMEOUT_S }] }

  const result = readSettingsFile(GLOBAL_SETTINGS_PATH)
  if (!result.ok) {
    // Never overwrite a settings file we couldn't parse: it holds the user's
    // permissions, env and other tools' hooks.
    log.error(`Not configuring hooks, could not parse ${GLOBAL_SETTINGS_PATH}:`, result.error)
    vscode.window.showErrorMessage(
      `Switchboard could not read ${GLOBAL_SETTINGS_PATH} (${result.error}). Fix the file and run "Switchboard: Configure Claude Code Hooks" again.`,
    )
    return
  }

  writeJsonAtomic(GLOBAL_SETTINGS_PATH, mergeSwitchboardHooks(result.settings, hookEntry, HOOK_EVENTS))

  vscode.window.showInformationMessage(
    'Claude Code hooks configured. New sessions will stream events to Switchboard.',
  )
}

// ─── Migration ────────────────────────────────────────────────────────────────

/** Replace legacy Agent Flow HTTP hooks with command hooks. Called once on activation.
 *  Caller must call ensureHookScript() first. */
export function migrateHttpHooks(): void {
  const pathsToCheck: string[] = [GLOBAL_SETTINGS_PATH]
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (workspaceFolder) {
    pathsToCheck.push(path.join(workspaceFolder, '.claude', 'settings.local.json'))
  }

  const hookCommand = getHookCommand()

  for (const settingsPath of pathsToCheck) {
    const result = readSettingsFile(settingsPath)
    if (!result.ok) {
      log.debug(`Skipping hook migration for ${settingsPath}:`, result.error)
      continue
    }
    try {
      if (!migrateLegacyHttpHooks(result.settings, hookCommand, HOOK_TIMEOUT_S)) { continue }
      writeJsonAtomic(settingsPath, result.settings)
      log.info(`Migrated HTTP hooks → command hooks in ${settingsPath}`)
      // Ensure migrated project-level hooks are tracked in the manifest
      if (workspaceFolder && settingsPath.includes(workspaceFolder)) {
        addWorkspaceToManifest(workspaceFolder)
      }
    } catch (err) {
      log.error(`Failed to migrate ${settingsPath}:`, err)
    }
  }
}

// ─── Claude Code Environment ─────────────────────────────────────────────────

/** Check whether CLAUDE_CODE_DISABLE_1M_CONTEXT is set (via env or Claude Code settings). */
export function isDisable1MContext(): boolean {
  if (process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT === '1') { return true }
  const settings = readGlobalSettings()
  return (settings?.env as Record<string, unknown>)?.CLAUDE_CODE_DISABLE_1M_CONTEXT === '1'
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

export async function promptHookSetupIfNeeded(_context: vscode.ExtensionContext): Promise<void> {
  configureCodexHooks()
  if (hooksAlreadyConfigured()) { addNewHookEvents(); return }
  await configureClaudeHooks()
}

/** Our entries in ~/.codex/hooks.json, so Codex chats drive the hub's status too; on false, takes them out.
 *  Skipped with no Codex home or a hooks.json we cannot parse; the user's own entries stay. */
export function configureCodexHooks(on = true): void {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
  if (!fs.existsSync(home)) { return }
  const file = path.join(home, 'hooks.json')
  const result = readSettingsFile(file)
  if (!result.ok) { log.warn(`Not adding Codex hooks, could not parse ${file}:`, result.error); return }
  const entry = { hooks: [{ type: 'command', command: getHookCommand(), timeout: HOOK_TIMEOUT_S }] }
  try {
    if (on) writeJsonAtomic(file, mergeSwitchboardHooks(result.settings, entry, CODEX_HOOK_EVENTS))
    else if (hasSwitchboardHook(result.settings)) writeJsonAtomic(file, removeSwitchboardHooks(result.settings))
  } catch (err) {
    log.error(`Failed to write ${file}:`, err)
  }
}

/** An install from before an event joined HOOK_EVENTS gets our entry for it; every other entry stays as it is. */
function addNewHookEvents(): void {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  const paths = [GLOBAL_SETTINGS_PATH, ...(workspaceFolder ? [path.join(workspaceFolder, '.claude', 'settings.local.json')] : [])]
  const hookEntry = { hooks: [{ type: 'command', command: getHookCommand(), timeout: HOOK_TIMEOUT_S }] }
  for (const settingsPath of paths) {
    const result = readSettingsFile(settingsPath)
    if (!result.ok || !hasSwitchboardHook(result.settings)) { continue }
    const missing = missingHookEvents(result.settings, HOOK_EVENTS)
    if (!missing.length) { continue }
    try {
      writeJsonAtomic(settingsPath, mergeSwitchboardHooks(result.settings, hookEntry, missing))
      log.info(`Added hooks for ${missing.join(', ')} in ${settingsPath}`)
    } catch (err) {
      log.error(`Failed to add hooks to ${settingsPath}:`, err)
    }
  }
}
