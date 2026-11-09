#!/usr/bin/env node
/**
 * vscode:uninstall script, runs when the extension is uninstalled.
 * Removes Switchboard hooks from ALL known Claude Code settings files,
 * then deletes the entire ~/.claude/switchboard/ directory.
 *
 * Sources for workspace discovery (checked in order, deduplicated):
 * 1. workspaces.json manifest: persists across crashes/restarts
 * 2. Discovery files ({hash}-{pid}.json): fallback for older versions
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

// switchboard-app is the browser app's own folder (scripts/setup.js).
const HOOK_COMMAND_MARKERS = ['switchboard/hook.js', 'switchboard-app/hook.js'];
// Legacy Agent Flow HTTP hooks used the bare hook server origin. Other tools'
// loopback hooks (with a path) must be left alone. Mirrors src/hook-entries.ts.
const LEGACY_HOOK_URL_RE = /^http:\/\/127\.0\.0\.1:\d+\/?$/;
const DISCOVERY_DIR = path.join(os.homedir(), '.claude', 'switchboard');
const APP_DIR = path.join(os.homedir(), '.claude', 'switchboard-app');
const MANIFEST_PATH = path.join(DISCOVERY_DIR, 'workspaces.json');

// ─── Remove hooks from a settings file ─────────────────────────────────────

function removeHooksFromFile(settingsPath) {
  try {
    if (!fs.existsSync(settingsPath)) { return; }
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const hooks = settings.hooks;
    if (!hooks || typeof hooks !== 'object') { return; }

    let changed = false;
    for (const [event, entries] of Object.entries(hooks)) {
      if (!Array.isArray(entries)) { continue; }
      const filtered = entries.filter(entry => {
        return !entry.hooks?.some(h =>
          HOOK_COMMAND_MARKERS.some(m => h.command?.replace(/\\/g, '/').includes(m)) ||
          (typeof h.url === 'string' && LEGACY_HOOK_URL_RE.test(h.url)),
        );
      });
      if (filtered.length !== entries.length) {
        changed = true;
        if (filtered.length === 0) {
          delete hooks[event];
        } else {
          hooks[event] = filtered;
        }
      }
    }

    if (!changed) { return; }

    if (Object.keys(hooks).length === 0) { delete settings.hooks; }

    if (Object.keys(settings).length === 0) {
      fs.unlinkSync(settingsPath);
    } else {
      const tmpPath = `${settingsPath}.${process.pid}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n');
      fs.renameSync(tmpPath, settingsPath);
    }
  } catch { /* best effort */ }
}

// ─── Collect all known workspace paths ──────────────────────────────────────

function collectWorkspaces() {
  const workspaces = new Set();

  // Source 1: workspaces.json manifest
  try {
    if (fs.existsSync(MANIFEST_PATH)) {
      const data = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
      if (Array.isArray(data)) {
        for (const w of data) { workspaces.add(w); }
      }
    }
  } catch { /* skip */ }

  // Source 2: discovery files (fallback, covers versions before the manifest existed)
  try {
    if (fs.existsSync(DISCOVERY_DIR)) {
      const files = fs.readdirSync(DISCOVERY_DIR).filter(f => f.endsWith('.json') && f !== 'workspaces.json');
      for (const file of files) {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(DISCOVERY_DIR, file), 'utf-8'));
          if (d.workspace) { workspaces.add(d.workspace); }
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }

  return workspaces;
}

// ─── Main ───────────────────────────────────────────────────────────────────

// 1. Global settings
removeHooksFromFile(path.join(os.homedir(), '.claude', 'settings.json'));

// Codex's hooks.json, written by hooks-config.ts configureCodexHooks
removeHooksFromFile(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'hooks.json'));

// 2. All known project-level settings
for (const workspace of collectWorkspaces()) {
  removeHooksFromFile(path.join(workspace, '.claude', 'settings.local.json'));
}

// Git guard hooks (src/hub/git-guard.ts) in the repos the hub lists (REPO_ROOTS). Plain .git dirs only; marker-checked.
const REPOS = path.join(os.homedir(), 'Documents', 'GitHub');
try {
  for (const n of fs.readdirSync(REPOS)) for (const h of ['pre-commit', 'pre-push']) {
    const f = path.join(REPOS, n, '.git', 'hooks', h);
    try { if (fs.readFileSync(f, 'utf8').includes('# switchboard-git-guard')) fs.rmSync(f); } catch { /* none */ }
  }
} catch { /* no repos folder */ }

// 3. Delete our folders (manifest, discovery files, hook scripts)
for (const dir of [DISCOVERY_DIR, APP_DIR]) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}
