#!/usr/bin/env node
/**
 * Standalone setup script for the Switchboard browser app.
 *
 * Performs the same hook configuration that the VS Code extension does on
 * activation, so developers can run the webview in dev mode without needing
 * to launch the extension in the debugger first.
 *
 * What it does:
 *   1. Installs the hook forwarding script at ~/.claude/switchboard-app/hook.js
 *   2. Configures Claude Code hooks in ~/.claude/settings.json
 */
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const DISCOVERY_DIR = path.join(os.homedir(), '.claude', 'switchboard-app')
const HOOK_SCRIPT_PATH = path.join(DISCOVERY_DIR, 'hook.js')
const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')

const HOOK_TIMEOUT_S = 2
const HOOK_SAFETY_MARGIN_MS = 500
const HOOK_FORWARD_TIMEOUT_MS = 1000
const HOOK_COMMAND_MARKER = 'switchboard-app/hook.js'
// Written before the rename; still ours, so setup swaps them for the new one.
const LEGACY_COMMAND_MARKERS = ['agent-flow/hook.js']

// ─── Resolve node path ──────────────────────────────────────────────────────

function resolveNodePath() {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'command'
    const args = process.platform === 'win32' ? ['node'] : ['-v', 'node']
    const result = execFileSync(cmd, args, { encoding: 'utf8', timeout: 3000 }).trim()
    const firstLine = result.split(/\r?\n/)[0].trim()
    if (firstLine) return firstLine
  } catch {}
  return 'node'
}

// ─── Hook script content (mirrors extension/src/discovery.ts) ───────────────

function getHookScriptContent() {
  return `#!/usr/bin/env node
// Switchboard hook forwarder v6: installed by the Switchboard setup script.
// v6: SWITCHBOARD_ROLE_RUN tags the event role_run (plus role_parent), so a Codex role run is no chat of its own.
// Claude Code invokes this as a command hook. It reads a discovery directory to
// find live extension instances, checks their PIDs, and forwards the event via
// HTTP POST. Dead instances are cleaned up automatically.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

setTimeout(() => process.exit(0), ${HOOK_TIMEOUT_S * 1000 - HOOK_SAFETY_MARGIN_MS});

const DIR = path.join(os.homedir(), '.claude', 'switchboard-app');
const IS_WIN = process.platform === 'win32';

function normPath(p) {
  let r = path.resolve(p);
  try { r = fs.realpathSync(r); } catch {}
  return r;
}

function isAlive(pid) {
  if (IS_WIN) return true;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', () => {
  let cwd, ev;
  try { ev = JSON.parse(input); cwd = ev.cwd; } catch { process.exit(0); }
  if (!cwd) process.exit(0);
  if (process.env.SWITCHBOARD_ROLE_RUN) {
    ev.role_run = process.env.SWITCHBOARD_ROLE_RUN;
    if (process.env.CLAUDE_CODE_SESSION_ID) ev.role_parent = process.env.CLAUDE_CODE_SESSION_ID;
    input = JSON.stringify(ev);
  }

  const resolvedCwd = normPath(cwd);

  let allFiles;
  try {
    allFiles = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'workspaces.json');
  } catch { process.exit(0); }
  if (!allFiles.length) process.exit(0);

  const matches = [];
  for (const file of allFiles) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8')); } catch { continue; }
    if (!d.workspace || !d.pid || !d.port) continue;

    if (!isAlive(d.pid)) {
      try { fs.unlinkSync(path.join(DIR, file)); } catch {}
      continue;
    }

    const ws = normPath(d.workspace);
    if (resolvedCwd === ws || resolvedCwd.startsWith(ws + path.sep)) {
      matches.push({ d, file, wsLen: ws.length });
    }
  }

  if (!matches.length) process.exit(0);

  matches.sort((a, b) => b.wsLen - a.wsLen);
  const bestLen = matches[0].wsLen;
  const targets = matches.filter(m => m.wsLen === bestLen);

  let pending = targets.length;
  for (const { d } of targets) {
    let settled = false;
    const finish = () => { if (settled) return; settled = true; done(); };
    const req = http.request({
      hostname: '127.0.0.1', port: d.port, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-switchboard-token': String(d.hubToken || '') },
      timeout: ${HOOK_FORWARD_TIMEOUT_MS},
    }, res => { res.resume(); res.on('end', finish); });
    req.on('error', finish);
    req.on('timeout', () => { req.destroy(); });
    req.write(input);
    req.end();
  }

  function done() { if (--pending <= 0) process.exit(0); }
});
`
}

// ─── Install hook script ────────────────────────────────────────────────────

function ensureHookScript() {
  if (!fs.existsSync(DISCOVERY_DIR)) {
    fs.mkdirSync(DISCOVERY_DIR, { recursive: true })
  }

  const script = getHookScriptContent()
  try {
    if (fs.existsSync(HOOK_SCRIPT_PATH) && fs.readFileSync(HOOK_SCRIPT_PATH, 'utf8') === script) {
      return
    }
  } catch {}

  const tmpPath = HOOK_SCRIPT_PATH + `.${process.pid}.tmp`
  fs.writeFileSync(tmpPath, script, { mode: 0o755 })
  fs.renameSync(tmpPath, HOOK_SCRIPT_PATH)
  console.log('Installed hook script:', HOOK_SCRIPT_PATH)
}

// ─── Configure Claude Code hooks ────────────────────────────────────────────

// Legacy Agent Flow HTTP hooks pointed at the bare hook server origin
// (http://127.0.0.1:<port>). Other tools register loopback HTTP hooks too,
// usually with a path, so only the bare origin counts as ours.
// Mirrors extension/src/hook-entries.ts.
const LEGACY_HOOK_URL_RE = /^http:\/\/127\.0\.0\.1:\d+\/?$/

const HOOK_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'SubagentStart', 'SubagentStop', 'Notification', 'PermissionRequest', 'Stop', 'StopFailure', 'SessionEnd',
  'PostCompact', 'TaskCreated', 'TaskCompleted', 'PermissionDenied', 'InstructionsLoaded',
]

// Mirrors CODEX_HOOK_EVENTS in extension/src/hook-entries.ts.
const CODEX_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']
const CODEX_HOOKS_PATH = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'hooks.json')

function hookPath(h) {
  return h.command?.replace(/\\/g, '/') ?? ''
}

function isCurrentHook(entry) {
  return !!entry?.hooks?.some(h => hookPath(h).includes(HOOK_COMMAND_MARKER))
}

function isSwitchboardHook(entry) {
  return !!entry?.hooks?.some(h =>
    [HOOK_COMMAND_MARKER, ...LEGACY_COMMAND_MARKERS].some(m => hookPath(h).includes(m)) ||
    (typeof h.url === 'string' && LEGACY_HOOK_URL_RE.test(h.url)),
  )
}

/**
 * Read a settings file. Missing reads as {}. A file that exists but can't be
 * parsed returns { error } so we never overwrite the user's settings.
 */
function readSettings(settingsPath) {
  let raw
  try {
    raw = fs.readFileSync(settingsPath, 'utf-8')
  } catch (err) {
    if (err.code === 'ENOENT') return { settings: {} }
    return { error: err.message }
  }
  if (raw.trim() === '') return { settings: {} }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'top-level value is not an object' }
    }
    return { settings: parsed }
  } catch (err) {
    return { error: err.message }
  }
}

function writeJsonAtomic(target, value) {
  // Write through a symlink (dotfiles) and keep the mode, or rename replaces both
  let filePath = target
  let mode = 0o644
  try { filePath = fs.realpathSync(target); mode = fs.statSync(filePath).mode & 0o777 } catch { /* new file */ }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2) + '\n', { mode })
  fs.chmodSync(tmpPath, mode)
  fs.renameSync(tmpPath, filePath)
}

/** Returns true if hooks were written, false if the settings file was left alone. */
function configureHooks(settingsPath = SETTINGS_PATH, hookCommand, events = HOOK_EVENTS) {
  if (!hookCommand) hookCommand = `"${resolveNodePath()}" "${HOOK_SCRIPT_PATH}"`
  const hookEntry = { hooks: [{ type: 'command', command: hookCommand, timeout: HOOK_TIMEOUT_S }] }

  const { settings, error } = readSettings(settingsPath)
  if (error) {
    console.error(`Could not parse ${settingsPath} (${error}).`)
    console.error('Leaving it untouched. Fix the file and run setup again to enable live events.')
    return false
  }

  const existingHooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {}
  for (const event of events) {
    const existing = Array.isArray(existingHooks[event]) ? existingHooks[event] : []
    existingHooks[event] = [...existing.filter(entry => !isSwitchboardHook(entry)), hookEntry]
  }
  settings.hooks = existingHooks

  writeJsonAtomic(settingsPath, settings)
  console.log('Configured hooks in:', settingsPath)
  return true
}

/** Same entry in Codex's hooks.json; skipped when Codex has no home folder. */
function configureCodexHooks(hooksPath = CODEX_HOOKS_PATH, hookCommand) {
  if (!fs.existsSync(path.dirname(hooksPath))) return false
  return configureHooks(hooksPath, hookCommand, CODEX_HOOK_EVENTS)
}

// ─── Detection ──────────────────────────────────────────────────────────────

function isAlreadySetup(settingsPath = SETTINGS_PATH, hookScriptPath = HOOK_SCRIPT_PATH) {
  if (!fs.existsSync(hookScriptPath)) return false

  const { settings } = readSettings(settingsPath)
  const hooks = settings?.hooks
  if (!hooks || typeof hooks !== 'object') return false
  return Object.values(hooks).some(entries =>
    Array.isArray(entries) && entries.some(isCurrentHook),
  )
}

// ─── Main ───────────────────────────────────────────────────────────────────

/** Ensure hooks are configured, skip silently if already set up. */
function ensureSetup() {
  // An older hook.js sends no token and every hook gets a 403; ensureHookScript skips when it matches.
  if (isAlreadySetup()) { ensureHookScript(); configureCodexHooks(); return }
  console.log('Setting up agent hooks...')
  ensureHookScript()
  configureHooks()
  configureCodexHooks()
  console.log('')
}

module.exports = { ensureSetup, getHookScriptContent, isSwitchboardHook, configureHooks, configureCodexHooks, isAlreadySetup, CODEX_HOOK_EVENTS }

// Run directly: node scripts/setup.js [--force]
if (require.main === module) {
  const force = process.argv.includes('--force')

  if (!force && isAlreadySetup()) {
    console.log('Switchboard is already set up. Run with --force to reconfigure.')
    process.exit(0)
  }

  console.log('Setting up Switchboard...\n')
  ensureHookScript()
  if (!configureHooks()) process.exit(1)
  configureCodexHooks()
  console.log('\nDone! New sessions will stream events to Switchboard.')
}
