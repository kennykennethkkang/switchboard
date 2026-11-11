/**
 * Claude Code runtime.
 *
 * Wires together the two event sources for a Claude Code session:
 *   1. Hook server: receives live events via a stdin-piped hook script
 *      configured in Claude's settings.json
 *   2. Session watcher: tails Claude Code's JSONL transcripts at
 *      ~/.claude/projects/<encoded>/<session>.jsonl
 *
 * Both sources can be active simultaneously; this runtime routes hook
 * events around the watcher when the watcher is already parsing that
 * session's transcript, to avoid duplicate events with divergent names
 * (hooks use agent_type+id; transcripts use description).
 */

import * as vscode from 'vscode'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { HookServer } from './hook-server'
import { SessionWatcher } from './session-watcher'
import { VisualizerPanel } from './webview-provider'
import { AgentEvent } from './protocol'
import {
  ORCHESTRATOR_NAME, HOOK_SERVER_NOT_STARTED,
} from './constants'
import { migrateHttpHooks } from './hooks-config'
import {
  writeDiscoveryFile, removeDiscoveryFile, ensureHookScript, hashWorkspace,
} from './discovery'
import { createLogger } from './logger'
import { hub } from './hub/hub-service'
import { archiveRow, readArchive, recordArchive } from './hub/chains'
import { dailySummary, fillBoxes, notify } from './hub/notify'
import { onSwitchboard, pendingReload, readBuild, RECHECK_MS } from './hub/self-update'
import { idle, watchActivity } from './hub/idle'
import { keepQuestions } from './hub/questions'
import { refreshWeb } from './hub/hub-panel'
import { checkAsked } from './hub/coverage'
import { markReloading, postLocal, readWindows } from './hub/dev'
import { chatEnded, chatFinished, chatMissed, chatResumed } from './hub/todo'
import { queueAar } from './hub/learn'
import { stopChatServers } from './hub/reap'
import type { ChatProgress, ChatState } from './hub/types'
import { wireWatcherToPanel } from './session-runtime'
import { smartHook } from './hub/smart-tools'
import type { AgentRuntime } from './session-runtime'

const log = createLogger('ClaudeRuntime')

/** Events the session watcher already owns end-to-end via the transcript parser.
 *  Letting hooks re-emit these would create duplicate nodes with divergent names
 *  (hook = agent_type-id, transcript = description). */
const SUBAGENT_LIFECYCLE_EVENTS = new Set<AgentEvent['type']>([
  'agent_spawn', 'subagent_dispatch', 'subagent_return', 'agent_complete',
])

/** Convert orchestrator agent_complete to agent_idle unless it's a session end.
 *  Prevents premature "completed" state during long API calls. */
function filterOrchestratorCompletion(event: AgentEvent): AgentEvent | null {
  if (event.type !== 'agent_complete') return event
  const agentName = event.payload?.agent ?? event.payload?.name
  const isOrchestrator = agentName === ORCHESTRATOR_NAME || !agentName
  if (!isOrchestrator) return event
  if (event.payload?.sessionEnd) return event
  return { ...event, type: 'agent_idle' }
}

export async function startClaudeRuntime(
  context: vscode.ExtensionContext,
): Promise<AgentRuntime> {
  // ─── Hook server ───────────────────────────────────────────────────────────
  const hookServer = new HookServer()
  context.subscriptions.push(hookServer)

  let hookPort: number
  try {
    hookPort = await hookServer.start()
  } catch (err) {
    log.error('Failed to start hook server:', err)
    hookPort = HOOK_SERVER_NOT_STARTED
  }

  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath

  if (hookPort === HOOK_SERVER_NOT_STARTED) {
    log.info('Hook server skipped (another instance owns the port), using session watcher only')
  } else {
    log.info(`Hook server running on port ${hookPort}`)

    // Write discovery file so the hook script can find us.
    // The hook script reads this at invocation time; no port in settings.json.
    if (workspace) {
      ensureHookScript()
      writeDiscoveryFile(hookPort, workspace, vscode.workspace.isTrusted)
      context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => writeDiscoveryFile(hookPort, workspace, true)))
      hub.keepRetries(path.join(os.homedir(), '.claude', 'switchboard', `retries-${hashWorkspace(workspace)}.json`))
      keepQuestions(path.join(os.homedir(), '.claude', 'switchboard', `questions-${hashWorkspace(workspace)}.json`))
      migrateHttpHooks()
    }
  }

  // ─── Session watcher ───────────────────────────────────────────────────────
  const watcher = new SessionWatcher()
  context.subscriptions.push(watcher)

  const summary = setInterval(() => dailySummary(), 10 * 60_000)
  const running = { version: context.extension.packageJSON.version as string, build: readBuild(context.extensionPath) }
  context.subscriptions.push(...watchActivity(vscode))
  const reload = setInterval(() => reloadIfUpdated(context, running), RECHECK_MS)
  context.subscriptions.push({ dispose: () => { clearInterval(summary); clearInterval(reload) } })

  // Route hook events → panel, but filter out events the watcher already owns
  if (hookPort !== HOOK_SERVER_NOT_STARTED) {
    context.subscriptions.push(hub.onEnded(p => {
      // An ended chat goes to the archive, so it can be resumed from there; never over a handoff row, nor one waiting out a usage limit.
      if (!p.limited && !hub.get().archive.some(a => a.sessionId === p.sessionId)) try { recordArchive(archiveRow(hub.get().chats.find(c => c.sessionId === p.sessionId) ?? p, p.startedAt, true)); hub.set({ archive: readArchive() }) } catch (err) { log.warn('Archive failed:', err) }
      chatEnded(p).catch(err => log.warn('To-do update failed:', err))
      queueAar(p)
      stopChatServers(p).catch(err => log.warn('Stopping chat servers failed:', err))
    }))
    hookServer.onRaw(({ payload, mirror }) => {
      const change = hub.hook(payload, Date.now(), mirror)
      if (!mirror) smartHook(hub, payload).catch(err => log.warn('Smart toggle failed:', err))
      // Every window, mirror or not: each fills the Source Control boxes of the repos it has open.
      fillBoxes(hub.get().progress.find(p => p.sessionId === payload.session_id))
      if (!change) return
      // Only the owning window gets a change, so one window updates the project's To-do and Left lists.
      if (change.to.state === 'done' && change.from !== 'done') chatFinished(change.to).catch(err => log.warn('To-do update failed:', err))
      else if (change.from === 'done') chatResumed(change.to).catch(err => log.warn('To-do update failed:', err))
      // A first Done waits for Jev's verdict on Kenneth's requests, so one notification says it all.
      if (change.to.state === 'done' && change.from !== 'done' && change.to.asked?.length) void withCoverage(change)
      else notify(change)
    })
    hookServer.onEvent((event) => {
      if (event.sessionId && hub.isHeadless(event.sessionId)) return
      const panels = VisualizerPanel.ready()
      if (panels.length === 0) return
      const panel = { sendEvent: (e: AgentEvent) => { for (const p of panels) p.sendEvent(e) } }

      const eventSessionId = event.sessionId
      const watcherHandlesThis = eventSessionId
        ? watcher.isSessionActive(eventSessionId)
        : watcher.isActive()

      if (watcherHandlesThis) {
        const agentName = event.payload?.agent ?? event.payload?.name
        const isOrchestrator = agentName === ORCHESTRATOR_NAME || !agentName

        if (isOrchestrator) {
          const filtered = filterOrchestratorCompletion(event)
          if (filtered) panel.sendEvent(filtered)
          return
        }

        // Subagent lifecycle events: let the watcher handle these (it has
        // the correct display name from transcript/meta files)
        if (SUBAGENT_LIFECYCLE_EVENTS.has(event.type)) return

        // Subagent tool/message events: pass through
        panel.sendEvent(event)
        return
      }

      panel.sendEvent(event)
      for (const p of panels) p.setConnectionStatus('watching', `Claude Code hooks (:${hookPort})`)
    })
  }

  // Route watcher events + lifecycle → panel (with orchestrator completion filter)
  const wiring = wireWatcherToPanel(watcher, {
    sessionLabelPrefix: 'Claude',
    transformEvent: filterOrchestratorCompletion,
  })

  watcher.start()

  const connectionStatus = (): string => {
    if (hookPort > 0) return `Hooks :${hookPort} + session watcher`
    return 'Session watcher'
  }

  const dispose = (): void => {
    // Remove our discovery file so the hook script won't forward to a dead port.
    // Hook entries in settings.json are left intact; the command is stable
    // (node ~/.claude/switchboard/hook.js) and the script handles dead instances
    // gracefully via PID checks. This avoids breaking multi-window setups and
    // means hooks survive VS Code restarts without reconfiguration.
    if (workspace) { removeDiscoveryFile(workspace) }
    wiring.dispose()
    hookServer.dispose()
    watcher.dispose()
  }

  return { mode: 'claude', watcher, connectionStatus, dispose }
}

/** Scores the chat's requests with Jev, shares them with every window, then notifies once. */
async function withCoverage(change: { from?: ChatState; to: ChatProgress }): Promise<void> {
  const p = change.to
  const scores = await checkAsked(p).catch(() => undefined)
  if (scores) {
    const ev = { session_id: p.sessionId, cwd: p.cwd, hook_event_name: 'SwitchboardCovered', scores }
    hub.hook(ev)
    for (const w of readWindows().filter(w => w.pid !== process.pid)) {
      void postLocal(w.port, '/', ev, 2000, { 'x-switchboard-mirror': '1' }).catch(() => undefined)
    }
  }
  const scored = hub.get().progress.find(x => x.sessionId === p.sessionId) ?? p
  if (scores) chatMissed(scored).catch(err => log.warn('To-do update failed:', err))
  notify({ ...change, to: scored })
}

let refreshedFor: string | undefined

/** A newer Switchboard installed, or in a window on the Switchboard checkout any rebuild of it: reload the window once it is idle
 * (idle.ts), else look again next tick. Terminal chats and unsaved files outlive a reload. Once per version (or build) per window,
 * so a copy that will not load cannot loop. */
function reloadIfUpdated(context: vscode.ExtensionContext, running: { version: string; build?: string }): void {
  const roots = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath)
  // Not in a dev host: its build is the checkout's, never the installed one.
  const rebuilds = context.extensionMode === vscode.ExtensionMode.Production && onSwitchboard(roots)
  const key = pendingReload(path.dirname(context.extensionPath), running, rebuilds)
  if (!key || context.workspaceState.get('reloadedFor') === key) return
  // The browser app and its pages need not wait for this window.
  if (rebuilds && refreshedFor !== key) { refreshedFor = key; refreshWeb() }
  if (!idle()) return
  log.info(`Reloading for Switchboard ${key}`)
  markReloading()
  void context.workspaceState.update('reloadedFor', key).then(() => vscode.commands.executeCommand('workbench.action.reloadWindow'))
}
