/**
 * Pure helpers for reading and rewriting Claude Code settings.json hook entries.
 *
 * Kept free of `vscode` so they can be unit tested. scripts/setup.js and
 * extension/scripts/uninstall.js are plain JS and mirror the matching rules;
 * keep the three in sync (hook-entries.test.ts checks the lists and the URL pattern).
 */

import * as fs from 'fs'
import { ClaudeHookDef, ClaudeHookEntry } from './protocol'
import { HOOK_COMMAND_MARKER } from './discovery'
import { writeJsonAtomic } from './fs-utils'

// Moved to fs-utils so light modules can use it without pulling in discovery and the hub.
export { writeJsonAtomic }

/**
 * Legacy Agent Flow HTTP hooks pointed straight at the hook server's origin
 * (`http://127.0.0.1:<port>`, no path). Other tools also register loopback
 * HTTP hooks, usually with a path, so we must only ever match the bare origin.
 */
const LEGACY_HOOK_URL_RE = /^http:\/\/127\.0\.0\.1:\d+\/?$/

export function isLegacyHookUrl(url: string | undefined): boolean {
  return typeof url === 'string' && LEGACY_HOOK_URL_RE.test(url)
}

function isSwitchboardHookDef(h: ClaudeHookDef): boolean {
  // Normalize backslashes so Windows paths (C:\...\switchboard\hook.js) match.
  return !!h.command?.replace(/\\/g, '/').includes(HOOK_COMMAND_MARKER) ||
    isLegacyHookUrl(h.url)
}

/** Check whether a single hook entry belongs to Switchboard */
export function isSwitchboardHook(entry: ClaudeHookEntry): boolean {
  return !!entry?.hooks?.some(isSwitchboardHookDef)
}

/** The Claude Code events Switchboard registers for; scripts/setup.js keeps the same list. */
export const HOOK_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'SubagentStart', 'SubagentStop', 'Notification', 'PermissionRequest', 'Stop', 'StopFailure', 'SessionEnd',
  'PostCompact', 'TaskCreated', 'TaskCompleted', 'PermissionDenied', 'InstructionsLoaded',
] as const

/** The events Switchboard registers in ~/.codex/hooks.json. Their payloads (session_id, cwd, hook_event_name,
 *  tool_name, tool_input) match Claude's, per codex-rs/hooks/schema. PermissionRequest is left out: the hook
 *  server answers it for Claude, and Codex's reply shape was not checked. */
export const CODEX_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const

export type SettingsReadResult =
  | { ok: true; settings: Record<string, unknown> }
  | { ok: false; error: string }

/**
 * Read a settings file. A missing file reads as `{}`. A file that exists but
 * can't be parsed is reported as an error so callers never overwrite it.
 */
export function readSettingsFile(settingsPath: string): SettingsReadResult {
  let raw: string
  try {
    raw = fs.readFileSync(settingsPath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') { return { ok: true, settings: {} } }
    return { ok: false, error: (err as Error).message }
  }
  if (raw.trim() === '') { return { ok: true, settings: {} } }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'top-level value is not an object' }
    }
    return { ok: true, settings: parsed }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}


/**
 * Replace Switchboard's entries for each event with `hookEntry`, leaving every
 * other tool's hooks untouched. Mutates and returns `settings`.
 */
export function mergeSwitchboardHooks(
  settings: Record<string, unknown>,
  hookEntry: ClaudeHookEntry,
  events: readonly string[],
): Record<string, unknown> {
  const hooks = (settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {}) as Record<string, unknown>
  for (const event of events) {
    const existing = Array.isArray(hooks[event]) ? hooks[event] as ClaudeHookEntry[] : []
    hooks[event] = [...existing.filter(entry => !isSwitchboardHook(entry)), hookEntry]
  }
  settings.hooks = hooks
  return settings
}

/**
 * Remove our entries from every event, dropping events and the hooks key once
 * they are empty. Other tools' hooks stay. Mutates and returns `settings`.
 */
export function removeSwitchboardHooks(settings: Record<string, unknown>): Record<string, unknown> {
  const hooks = settings.hooks
  if (!hooks || typeof hooks !== 'object') { return settings }
  const byEvent = hooks as Record<string, unknown>
  for (const [event, entries] of Object.entries(byEvent)) {
    if (!Array.isArray(entries)) { continue }
    const kept = entries.filter(entry => !isSwitchboardHook(entry as ClaudeHookEntry))
    if (kept.length) { byEvent[event] = kept } else { delete byEvent[event] }
  }
  if (Object.keys(byEvent).length === 0) { delete settings.hooks }
  return settings
}

/** True if any event in `settings` has an Switchboard hook. */
export function hasSwitchboardHook(settings: Record<string, unknown>): boolean {
  const hooks = settings.hooks
  if (!hooks || typeof hooks !== 'object') { return false }
  return Object.values(hooks).some(entries =>
    Array.isArray(entries) && entries.some(entry => isSwitchboardHook(entry as ClaudeHookEntry)),
  )
}

/** The events in `events` that have no Switchboard hook yet, so an older install can get newly added ones. */
export function missingHookEvents(settings: Record<string, unknown>, events: readonly string[]): string[] {
  const hooks = (settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {}) as Record<string, unknown>
  return events.filter(e => !(Array.isArray(hooks[e]) && (hooks[e] as ClaudeHookEntry[]).some(isSwitchboardHook)))
}

/**
 * Rewrite legacy Agent Flow HTTP hooks into command hooks in place.
 * Returns true if anything changed.
 */
export function migrateLegacyHttpHooks(
  settings: Record<string, unknown>,
  hookCommand: string,
  timeoutS: number,
): boolean {
  const hooks = settings.hooks
  if (!hooks || typeof hooks !== 'object') { return false }
  let changed = false
  for (const entries of Object.values(hooks)) {
    if (!Array.isArray(entries)) { continue }
    for (const entry of entries as ClaudeHookEntry[]) {
      for (const h of entry?.hooks ?? []) {
        if (!isLegacyHookUrl(h.url)) { continue }
        delete h.url
        h.type = 'command'
        h.command = hookCommand
        if (h.timeout === undefined) { h.timeout = timeoutS }
        changed = true
      }
    }
  }
  return changed
}
