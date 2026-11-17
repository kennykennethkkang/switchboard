import type { AiId, ApiKeyName, ChatProfile, Choice, GitOp, HubState, SettingKey, SwitchboardKey } from './hub/types'
import type { MemoryGraph } from './hub/graph'
import type { RunDetail } from './hub/runs'
import type { FlowMap } from './hub/flowmap'
import type { ChatOutputs, ChatTranscript } from './hub/chat-view'
/**
 * Message protocol between VS Code extension host and webview.
 *
 * Extension → Webview: agent events, state updates, connection status
 * Webview → Extension: user commands (inject, connect/disconnect)
 */

// ─── Agent Event Types (from real agent sessions) ────────────────────────────

export type AgentEventType =
  | 'agent_spawn'
  | 'agent_complete'
  | 'agent_idle'
  | 'message'
  | 'context_update'
  | 'model_detected'
  | 'tool_call_start'
  | 'tool_call_end'
  | 'subagent_dispatch'
  | 'subagent_return'
  | 'permission_requested'
  | 'error'

export interface AgentEvent {
  time: number
  type: AgentEventType
  payload: Record<string, unknown>
  sessionId?: string
}

export interface SessionInfo {
  id: string
  label: string
  status: 'active' | 'completed'
  startTime: number
  lastActivityTime: number
}

// ─── Extension → Webview Messages ────────────────────────────────────────────

export type ExtensionToWebviewMessage =
  | { type: 'connection-status'; status: 'connected' | 'disconnected' | 'watching'; source: string }
  | { type: 'agent-event'; event: AgentEvent }
  | { type: 'agent-event-batch'; events: AgentEvent[] }
  | { type: 'reset'; reason: string }
  | { type: 'config'; config: Partial<VisualizerConfig> }
  | { type: 'session-list'; sessions: SessionInfo[] }
  | { type: 'session-started'; session: SessionInfo }
  | { type: 'session-ended'; sessionId: string }
  | { type: 'session-updated'; sessionId: string; label: string }
  | { type: 'hub-state'; hub: HubState }
  /** The mic's level, 0..1, about 12 a second while it listens; kept out of hub-state. */
  | { type: 'hub-voice-level'; level: number }
  /** The asks hub-split found, same reqId; [text] on timeout or error. */
  | { type: 'hub-split-result'; reqId: string; asks: string[] }
  /** The view was hidden or shown: a hidden view stops its animation (VS Code keeps it alive but sets no document.hidden). */
  | { type: 'hub-visible'; visible: boolean }
  /** One 'upload-chunk' is on disk; the webview sends the next only after this. */
  | { type: 'upload-progress'; id: string }
  /** The end of an upload: where it was saved, or why not. Can come early, after any chunk. */
  | { type: 'upload-done'; id: string; path?: string; problem?: string }
  /** The answer to graph-get. */
  | { type: 'graph'; id: string; graph?: MemoryGraph; problem?: string }
  /** The answer to runs-get. */
  | { type: 'runs'; id: string; runs?: RunDetail[]; problem?: string }
  /** The answer to flowmap-get. */
  | { type: 'flowmap'; id: string; map?: FlowMap; problem?: string }
  /** The answer to chat-get: the one asked for, a shot as a data URL; none of them for an unknown chat. */
  | { type: 'chat'; id: string; outputs?: ChatOutputs; transcript?: ChatTranscript; shot?: string; problem?: string }

export interface VisualizerConfig {
  mode: 'live' | 'replay'
  autoPlay: boolean
  showMockData: boolean
  disable1MContext: boolean
}

// ─── Webview → Extension Messages ────────────────────────────────────────────

export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'request-connect' }
  | { type: 'request-disconnect' }
  | { type: 'open-file'; filePath: string; line?: number }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  /** A file attached in the message box, sent in slices that cross as ArrayBuffers (VS Code 1.57+). Not hub-*, so /hub/command never takes them. */
  | { type: 'upload-start'; id: string; cwd: string; name: string; session?: string }
  | { type: 'upload-chunk'; id: string; data: ArrayBuffer | Uint8Array }
  | { type: 'upload-end'; id: string }
  /** The chip was removed: drop the partial file. */
  | { type: 'upload-abort'; id: string }
  /** The Memory view asks for its graph; answered by 'graph' with the same id. */
  | { type: 'graph-get'; id: string }
  /** The node drawer asks for a role's runs in a chat; answered by 'runs' with the same id. */
  | { type: 'runs-get'; id: string; sessionId: string; role: string }
  /** The Flow map asks for cwd's map; answered by 'flowmap' with the same id. */
  | { type: 'flowmap-get'; id: string; cwd: string }
  /** The chat view asks for a chat's outputs, a transcript page or one screenshot; answered by 'chat' with the same id. */
  | { type: 'chat-get'; id: string; sessionId: string; what: 'outputs' | 'transcript' | 'shot'; before?: number; path?: string }
  | { type: 'hub-send'; sessionId: string; text: string }
  | { type: 'hub-answer'; sessionId: string; askId: string; choice: Choice }
  | { type: 'hub-rc'; on: boolean; sessionId?: string }
  | { type: 'hub-open-url'; url: string }
  | { type: 'hub-web'; phone: boolean }
  | { type: 'hub-toggle'; kind: 'mod' | 'plugin' | 'skill'; name: string; enabled: boolean }
  | { type: 'hub-setting'; key: SettingKey; value: boolean | number | string | null }
  | { type: 'hub-switchboard'; key: SwitchboardKey; value: boolean | number | string | null }
  | { type: 'hub-compact'; sessionId: string }
  | { type: 'hub-pause'; action: 'resume' | 'cancel' }
  | { type: 'hub-hand-to'; sessionId: string }
  | { type: 'hub-ai-login'; ai: AiId }
  | { type: 'hub-new-chat'; path: string; text?: string; remote: boolean; branch?: string; ai?: AiId; tools?: ChatProfile; repo?: { create: string; private: boolean } | { clone: string }; waitOn?: string[]; /** Chats started from one split share it. */ group?: string; /** Claude only: start in its own git worktree. */ worktree?: boolean }
  /** Cut a New chat message into its separate asks; answered by hub-split-result with the same reqId. */
  | { type: 'hub-split'; reqId: string; path: string; text: string }
  | { type: 'hub-pick-tools'; text: string; path?: string }
  /** Advanced mode on or off for one project (an absolute path from the project list). */
  | { type: 'hub-advanced'; path: string; on: boolean }
  /** Looks good or Redo on one stage of an Advanced mode run (a folder under <path>/.switchboard/stages). */
  | { type: 'hub-stage'; path: string; run: string; n: number; status: 'done' | 'redo' }
  /** Clears a smart model switch escalation: its model-learn.json rows go. */
  | { type: 'hub-escalation-reset'; project: string; role: string; files: string[] }
  | { type: 'hub-chat-tools'; sessionId: string; tools: ChatProfile }
  /** Run indefinitely on or off for one chat. */
  | { type: 'hub-indefinite'; sessionId: string; on: boolean }
  /** Run indefinitely limits for one chat; a field set to null clears it, one left out keeps it. */
  | { type: 'hub-budget'; sessionId: string; maxHours?: number | null; maxCostUsd?: number | null; gate?: string | null }
  /** Check-back on for one chat at this interval (count starts over), or off. */
  | { type: 'hub-checkback'; sessionId: string; everyMin: 10 | 30 | 60 }
  | { type: 'hub-checkback-clear'; sessionId: string }
  /** Refine now: tells the chat to run the aar skill on itself. */
  | { type: 'hub-refine'; sessionId: string }
  /** Reload HubState.snapshots. */
  | { type: 'hub-snapshots' }
  /** Put a snapshot back; the current files are snapshotted first. */
  | { type: 'hub-snapshot-restore'; id: string }
  /** Check health: fills HubState.health. */
  | { type: 'hub-health' }
  /** Fix safe ones: ids limits it to those results, none fixes every fixable one. */
  | { type: 'hub-health-fix'; ids?: string[] }
  /** Save a stages run (a folder under <path>/.switchboard/stages) as a pipeline; reloads HubState.pipelines. */
  | { type: 'hub-pipeline-save'; path: string; run: string; name: string }
  | { type: 'hub-pipelines' }
  /** Seed <path>/.switchboard/stages/<run> from a saved pipeline, statuses reset to todo. */
  | { type: 'hub-pipeline-seed'; slug: string; path: string; run: string }
  /** Reload HubState.trend. */
  | { type: 'hub-trend' }
  | { type: 'hub-star'; sessionId: string; ai: AiId; on: boolean }
  | { type: 'hub-resume'; sessionId: string; ai: AiId }
  | { type: 'hub-archive'; sessionId: string }
  | { type: 'hub-unarchive'; sessionId: string }
  | { type: 'hub-approve'; sessionId: string }
  | { type: 'hub-open-note'; sessionId: string }
  | { type: 'hub-focus-chat'; sessionId: string }
  | { type: 'hub-terminal'; id: number; act: 'show' | 'close' }
  | { type: 'hub-keep'; onFull?: 'compact' | 'fresh'; freshBranch?: boolean }
  | { type: 'hub-aws-login'; profile: string; chrome?: string }
  | { type: 'hub-aws-rename'; profile: string; to: string }
  | { type: 'hub-aws-label'; profile: string; label: string }
  | { type: 'hub-aws-add'; profile: string; region: string; chrome?: string }
  | { type: 'hub-aws-window'; profile: string | null }
  | { type: 'hub-aws-check' }
  | { type: 'hub-aws-delete'; profile: string }
  | { type: 'hub-login-app-add'; name: string; url: string }
  | { type: 'hub-login-add'; app: string; label: string; url: string; chrome?: string; email?: string }
  | { type: 'hub-login-open'; app: string; id?: string; chrome?: string; folder?: string }
  /** login: a login id; 'off' or null drops the app from the project. */
  | { type: 'hub-login-link'; folder: string; app: string; login: string | null }
  | { type: 'hub-browser'; folder: string; chrome: string | null }
  | { type: 'hub-login-active'; app: string; id: string }
  /** email: '' clears it, none keeps it. */
  | { type: 'hub-login-rename'; app: string; id: string; label: string; email?: string }
  | { type: 'hub-login-delete'; app: string; id: string }
  | { type: 'hub-login-app-delete'; app: string }
  | { type: 'hub-key-save'; name: ApiKeyName; value: string }
  | { type: 'hub-key-test'; name: ApiKeyName }
  | { type: 'hub-key-remove'; name: ApiKeyName }
  | { type: 'hub-env-setup'; folder: string }
  | { type: 'hub-kit-export' }
  | { type: 'hub-setup' }
  | { type: 'hub-rules-sync' }
  | { type: 'hub-role-model'; role: string; model: 'inherit' | 'fable' | 'opus' | 'sonnet' | 'haiku' }
  /** A codex role's -m and reasoning effort flags; 'default' leaves a flag out. */
  | { type: 'hub-role-codex'; role: string; model: 'default' | 'gpt-6-luna' | 'gpt-5.6-terra' | 'gpt-5.6-luna'; effort: 'default' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' }
  | { type: 'hub-rc-server'; folder: string; on: boolean }
  | { type: 'hub-handoff'; sessionId: string }
  /** The SkillSpector sweep: name rescans one tool, none sweeps everything installed. */
  | { type: 'hub-sweep'; name?: string }
  | { type: 'hub-spend'; key: string; mode: 'provider' | 'cap' | 'ask'; monthlyUsd?: number }
  | { type: 'hub-sweep-approve'; name: string }
  /** A Learning ready card: ok applies it, false discards it. */
  | { type: 'hub-learn'; id: string; ok: boolean }
  | { type: 'hub-summary'; sessionId: string; refresh?: boolean }
  | { type: 'hub-sweep-fix'; name: string }
  /** Add a plugin or skill from GitHub: owner/repo or an https://github.com link, swept on the way in. */
  | { type: 'hub-tool-add'; repo: string }
  | { type: 'hub-dev-start'; folder: string }
  | { type: 'hub-dev-stop'; folder: string }
  | { type: 'hub-window-tab'; op: 'merge' | 'split' | 'popout' | 'show'; workspace?: string }
  | { type: 'hub-awake'; on: boolean }
  | { type: 'hub-device'; id: string; allow: boolean }
  /** A stuck item (HubState.stuck) by id: stop its process (re-checked under the chat's claude), or dismiss it for 30 min. */
  | { type: 'hub-stuck-stop'; sessionId: string; id: string }
  | { type: 'hub-stuck-dismiss'; sessionId: string; id: string }
  /** Fix: stop its process when it has one, then tell the chat what happened and what to do next. */
  | { type: 'hub-stuck-fix'; sessionId: string; id: string }
  /** from waits on to: told to call chats_wait and go on once to finishes clean. */
  | { type: 'hub-wait-for'; from: string; to: string }
  | { type: 'hub-unlink'; from: string; to: string }
  | { type: 'hub-changes'; sessionId: string }
  | { type: 'hub-open-diff'; sessionId: string; file: string }
  | { type: 'hub-search'; q: string }
  /** A Jarvis box question; the answer, or a start to confirm with hub-new-chat, lands in HubState.jarvis. */
  | { type: 'hub-jarvis'; q: string; voice?: boolean }
  /** The Jarvis mic: on records the Mac mic, off stops it; the transcript lands in the box as HubState.heard. */
  | { type: 'hub-voice'; on: boolean }
  | { type: 'hub-git'; sessionId: string; op: GitOp; files?: string[]; summary?: string; description?: string; branch?: string; stash?: boolean; confirmed?: boolean }
  | { type: 'hub-harden'; sessionId: string }
  /** One message for every uncommitted change in the chat's repo, into Source Control and RepoView.draft. */
  | { type: 'hub-draft-commit'; sessionId: string }
  | { type: 'hub-todo-add'; path: string; text: string }
  | { type: 'hub-todo-edit'; path: string; id: string; text: string }
  | { type: 'hub-todo-remove'; path: string; id: string }
  /** Puts back an item a chat ticked off. */
  | { type: 'hub-todo-restore'; path: string; id: string }
  /** A suggestion a finished chat left: into the to-do, or gone. */
  | { type: 'hub-todo-accept'; path: string; id: string }
  | { type: 'hub-todo-dismiss'; path: string; id: string }
  | { type: 'hub-todo-move'; path: string; ids: string[] }
  /** Items and their open prerequisites, in a new chat or sent to a running one (to). */
  | { type: 'hub-todo-run'; path: string; ids: string[]; to?: string }
  | { type: 'hub-todo-sync'; path: string; on: boolean }
  | { type: 'hub-todo-pilot'; path: string; on?: boolean; paused?: boolean }
  | { type: 'hub-todo-replace'; path: string; remote: string }

// ─── Transcript Types (from Claude Code JSONL files) ─────────────────────────

export interface TranscriptEntry {
  sessionId: string
  type: string
  uuid?: string
  message: {
    role: string
    model?: string
    content: Array<TranscriptContentBlock> | string
  }
}

export interface ToolUseBlock {
  type: 'tool_use'
  name: string
  id: string
  input: Record<string, unknown>
}

export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string | Array<{ text?: string; type?: string }>
}

export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
}

export interface TextBlock {
  type: 'text'
  text: string
}

export type TranscriptContentBlock =
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock
  | TextBlock
  | { type: string; [key: string]: unknown }

// ─── Shared Helpers ─────────────────────────────────────────────────────────

/** Minimal emitter interface used by {@link emitSubagentSpawn}. */
export interface AgentEventEmitter {
  emit(event: AgentEvent, sessionId?: string): void
  elapsed(sessionId?: string): number
}

/**
 * Emit the paired subagent_dispatch + agent_spawn events.
 *
 * This two-event sequence is required every time a subagent is spawned and was
 * previously duplicated in SessionWatcher and TranscriptParser.
 */
export function emitSubagentSpawn(
  emitter: AgentEventEmitter,
  parent: string,
  child: string,
  task: string,
  sessionId?: string,
): void {
  emitter.emit({
    time: emitter.elapsed(sessionId),
    type: 'subagent_dispatch',
    payload: { parent, child, task },
  }, sessionId)
  emitter.emit({
    time: emitter.elapsed(sessionId),
    type: 'agent_spawn',
    payload: { name: child, parent, task },
  }, sessionId)
}

// ─── Shared Internal Types ───────────────────────────────────────────────────

/** A tool call that has started but not yet received its result */
export interface PendingToolCall {
  name: string
  args: string
  filePath?: string
  startTime: number
}

// ─── Session Types ──────────────────────────────────────────────────────────

export interface SubagentState {
  watcher: import('fs').FSWatcher | null
  fileSize: number
  agentName: string
  pendingToolCalls: Map<string, PendingToolCall>
  seenToolUseIds: Set<string>
  permissionTimer: NodeJS.Timeout | null
  permissionEmitted: boolean
  spawnEmitted: boolean
}

/** State tracked for a single watched Claude Code session */
export interface WatchedSession {
  sessionId: string
  filePath: string
  fileWatcher: import('fs').FSWatcher | null
  pollTimer: NodeJS.Timeout | null
  fileSize: number
  sessionStartTime: number
  pendingToolCalls: Map<string, PendingToolCall>
  seenToolUseIds: Set<string>
  seenMessageHashes: Set<string>
  sessionDetected: boolean
  sessionCompleted: boolean
  lastActivityTime: number
  inactivityTimer: NodeJS.Timeout | null
  subagentWatchers: Map<string, SubagentState>
  /** Names of subagents already spawned (by transcript parser or file watcher); prevents duplicate spawns */
  spawnedSubagents: Set<string>
  /** Subagent names currently receiving inline progress events; file watcher skips these */
  inlineProgressAgents: Set<string>
  subagentsDirWatcher: import('fs').FSWatcher | null
  subagentsDir: string | null
  label: string
  labelSet: boolean
  model: string | null
  /** Maps agent names to their last emitted model ID; re-emits on model change */
  modelDetectedAgents: Map<string, string>
  permissionTimer: NodeJS.Timeout | null
  permissionEmitted: boolean
  contextBreakdown: {
    systemPrompt: number
    userMessages: number
    toolResults: number
    reasoning: number
    subagentResults: number
  }
}

// ─── Claude Settings Types ──────────────────────────────────────────────────

export interface ClaudeHookDef {
  type?: string
  url?: string
  command?: string
  timeout?: number
}

export interface ClaudeHookEntry {
  hooks?: ClaudeHookDef[]
}

