/**
 * VS Code Bridge: enables the visualizer to communicate with the VS Code extension host.
 *
 * When running standalone (npm run dev), this is a no-op.
 * When running inside a VS Code webview iframe, it forwards messages
 * between the React app and the extension host.
 */

export type { AgentEvent, SessionInfo, ConnectionStatus } from './bridge-types'
import { demoResearchBody } from './hub-demo'
import type { AgentEvent, SessionInfo, ConnectionStatus } from './bridge-types'
import type { AiId, ApiKeyName, ChatProfile, Choice, GitOp, HubState, SettingKey, SwitchboardKey } from './hub-types'
import { applyDelta } from './hub-share'
import { sendSlices } from './attach'
import type { MemoryGraph } from './memory-graph'
import type { RunDetail } from './runs'
import type { UsageReport } from './usage'
import type { FlowMap } from './flow-map'
import type { ChatAnswer, ChatAsk } from './chat-view'

type InitCallback = () => void
type EventCallback = (event: AgentEvent) => void
type StatusCallback = (status: ConnectionStatus, source: string) => void
type ConfigCallback = (config: Partial<{ mode: string; autoPlay: boolean; showMockData: boolean; disable1MContext: boolean }>) => void
type SessionCallback = (type: 'list' | 'started' | 'ended' | 'updated' | 'reset', data: SessionInfo[] | SessionInfo | string | { sessionId: string; label: string }) => void
type HubCallback = (hub: HubState) => void

/** What the Hub sends back to the extension. */
export type HubCommand =
  | { type: 'hub-send'; sessionId: string; text: string }
  | { type: 'hub-answer'; sessionId: string; askId: string; choice: Choice }
  | { type: 'hub-rc'; on: boolean; sessionId?: string }
  | { type: 'hub-open-url'; url: string }
  | { type: 'hub-mirofish-open'; simId?: string }
  | { type: 'hub-mirofish-report'; simId: string }
  | { type: 'hub-live-dismiss'; kind: 'mirofish' | 'crowd'; id: string }
  | { type: 'hub-research-dismiss'; sessionId: string }
  | { type: 'hub-research-open'; sessionId: string }
  /** Reads a saved research run; research-read comes back with the same reqId. */
  | { type: 'hub-research-read'; reqId: string; id: string }
  /** Marks a saved research run seen, or moves it to the trash. */
  | { type: 'hub-research-seen'; id: string }
  | { type: 'hub-research-delete'; id: string }
  /** Ask more: a research chat digs into text, and its report is added to this saved run. */
  | { type: 'hub-research-ask'; id: string; text: string }
  /** Folders: make, rename, or delete one (its reports go back to unfiled). */
  | { type: 'hub-research-folder'; op: 'add' | 'rename' | 'delete'; name: string; to?: string }
  /** Files runs in a folder (made when new), or unfiles them without one. */
  | { type: 'hub-research-move'; ids: string[]; folder?: string }
  /** Smart organize: files the unfiled runs (all: every run), undoes its last run, or switches filing new runs on and off. */
  | { type: 'hub-research-organize'; op: 'run' | 'all' | 'undo' | 'auto-on' | 'auto-off' }
  /** Workbench: start a chat on these actions of a saved report, undo a logged change, or hide a suggested one. */
  | { type: 'hub-adjust-apply'; report: string; keys: string[] }
  | { type: 'hub-adjust-undo'; id: string; force?: boolean }
  | { type: 'hub-adjust-skip'; report: string; key: string }
  | { type: 'hub-web'; phone: boolean }
  | { type: 'hub-toggle'; kind: 'mod' | 'plugin' | 'skill'; name: string; enabled: boolean }
  | { type: 'hub-setting'; key: SettingKey; value: boolean | number | string | null }
  | { type: 'hub-switchboard'; key: SwitchboardKey; value: boolean | number | string | null }
  | { type: 'hub-advanced'; path: string; on: boolean }
  | { type: 'hub-coder-view'; on: boolean }
  | { type: 'hub-first-run'; dismissed: boolean }
  | { type: 'hub-stage'; path: string; run: string; n: number; status: 'done' | 'redo' }
  | { type: 'hub-escalation-reset'; project: string; role: string; files: string[] }
  | { type: 'hub-compact'; sessionId: string }
  | { type: 'hub-pause'; action: 'resume' | 'cancel' }
  | { type: 'hub-hand-to'; sessionId: string }
  | { type: 'hub-ai-login'; ai: AiId }
  | { type: 'hub-new-chat'; path: string; text?: string; remote: boolean; branch?: string; ai?: AiId; tools?: ChatProfile; repo?: { create: string; private: boolean } | { clone: string }; waitOn?: string[]; /** Chats started from one split share it. */ group?: string; /** Claude only: start in its own git worktree. */ worktree?: boolean; /** Claude only: run in the repo's devcontainer, else Switchboard's default one. */ container?: boolean; /** The run's own picks (picker.ts fills what is unset while auto is not false): Claude model alias, effort level, ultracode (at xhigh it is --effort ultracode), no auto pick, start in the research folder with the research note. */ model?: string; effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; ultracode?: boolean; /** Claude only: --advisor, a model Claude consults mid-task. */ advisor?: string; auto?: boolean; research?: boolean; /** With research: start in the Workbench folder with its note. */ workbench?: boolean; /** Claude only: start in a Goal or Timer loop (loop.ts). */ loop?: { mode: 'turn' | 'goal' | 'timer'; doneWhen?: string; everyMin?: 10 | 30 | 60 | 180 | 1440; text?: string } }
  /** Cut a New chat message into its separate asks; answered by hub-split-result with the same reqId. */
  | { type: 'hub-split'; reqId: string; path: string; text: string }
  | { type: 'hub-pick-tools'; text: string; path?: string }
  | { type: 'hub-chat-tools'; sessionId: string; tools: ChatProfile }
  | { type: 'hub-tool-precedence'; name: string; value: 'always' | 'auto' | 'never' }
  | { type: 'hub-loop'; sessionId: string; loop: { mode: 'turn' | 'goal' | 'timer'; doneWhen?: string; everyMin?: 10 | 30 | 60 | 180 | 1440; text?: string } }
  | { type: 'hub-star'; sessionId: string; ai: AiId; on: boolean }
  | { type: 'hub-resume'; sessionId: string; ai: AiId }
  | { type: 'hub-archive'; sessionId: string }
  | { type: 'hub-unarchive'; sessionId: string }
  | { type: 'hub-approve'; sessionId: string }
  | { type: 'hub-open-note'; sessionId: string }
  | { type: 'hub-focus-chat'; sessionId: string }
  | { type: 'hub-open-chat'; sessionId: string }
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
  | { type: 'hub-sync-sign-in' }
  | { type: 'hub-sync-now' }
  | { type: 'hub-sync-off' }
  | { type: 'hub-update-check' }
  | { type: 'hub-update-reload' }
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
  | { type: 'hub-stuck-stop'; sessionId: string; id: string }
  | { type: 'hub-stuck-dismiss'; sessionId: string; id: string }
  | { type: 'hub-stuck-fix'; sessionId: string; id: string }
  | { type: 'hub-wait-for'; from: string; to: string }
  | { type: 'hub-unlink'; from: string; to: string }
  | { type: 'hub-changes'; sessionId: string }
  | { type: 'hub-open-diff'; sessionId: string; file: string }
  | { type: 'hub-search'; q: string }
  | { type: 'hub-jarvis'; q: string; voice?: boolean }
  | { type: 'hub-voice'; on: boolean }
  | { type: 'hub-git'; sessionId: string; op: GitOp; files?: string[]; summary?: string; description?: string; branch?: string; stash?: boolean; confirmed?: boolean }
  | { type: 'hub-auto-merge'; repo: string; on: boolean }
  | { type: 'hub-harden'; sessionId: string }
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
  | { type: 'hub-todo-run'; path: string; ids: string[]; to?: string; /** The run's own picks (picker.ts fills what is unset while auto is not false): Claude model alias, effort level, ultracode (at xhigh it is --effort ultracode), no auto pick, start in the research folder with the research note. */ model?: string; effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; ultracode?: boolean; /** Claude only: --advisor, a model Claude consults mid-task. */ advisor?: string; auto?: boolean; research?: boolean }
  | { type: 'hub-todo-sync'; path: string; on: boolean }
  | { type: 'hub-todo-replace'; path: string; remote: string }
  /** The project's autopilot: on runs the next item by itself, paused holds new starts. */
  | { type: 'hub-todo-pilot'; path: string; on?: boolean; paused?: boolean }
  | { type: 'hub-budget'; sessionId: string; maxHours?: number | null; maxCostUsd?: number | null; gate?: string | null }
  | { type: 'hub-refine'; sessionId: string }
  | { type: 'hub-snapshots' }
  | { type: 'hub-snapshot-restore'; id: string }
  | { type: 'hub-health' }
  | { type: 'hub-health-fix'; ids?: string[] }
  | { type: 'hub-pipeline-save'; path: string; run: string; name: string }
  | { type: 'hub-pipelines' }
  | { type: 'hub-pipeline-seed'; slug: string; path: string; run: string }
  | { type: 'hub-trend' }

const COMMAND_WAIT: Partial<Record<HubCommand['type'], number>> = {
  'hub-git': 8000, 'hub-sweep': 8000, 'hub-sweep-fix': 8000, 'hub-sweep-approve': 8000, 'hub-jarvis': 8000,
  'hub-voice': 8000, 'hub-harden': 8000, 'hub-key-test': 8000, 'hub-aws-check': 8000, 'hub-setup': 8000,
  'hub-rules-sync': 8000, 'hub-todo-sync': 8000, 'hub-search': 8000, 'hub-changes': 8000, 'hub-kit-export': 8000, 'hub-sync-sign-in': 8000, 'hub-sync-now': 8000, 'hub-sync-off': 8000, 'hub-update-check': 8000,
}
export const commandWait = (command: HubCommand) => COMMAND_WAIT[command.type] ?? 1200

/** An attached file in slices; same shapes as extension/src/protocol.ts. */
export type UploadToExtension =
  | { type: 'upload-start'; id: string; cwd: string; name: string; session?: string }
  | { type: 'upload-chunk'; id: string; data: ArrayBuffer }
  | { type: 'upload-end'; id: string }
  | { type: 'upload-abort'; id: string }
/** upload-progress: one chunk is on disk. upload-done: the end, saved or not, possibly before the last chunk. */
export type UploadAck = { type: 'upload-progress'; id: string } | { type: 'upload-done'; id: string; path?: string; problem?: string }

class VSCodeBridge {
  private _isVSCode = false
  private _status: ConnectionStatus = 'disconnected'
  private _source = ''

  private initListeners: InitCallback[] = []
  private eventListeners: EventCallback[] = []
  private statusListeners: StatusCallback[] = []
  private configListeners: ConfigCallback[] = []
  private sessionListeners: SessionCallback[] = []
  private hubListeners: HubCallback[] = []
  private lastHub: HubState | null = null
  private shownListeners: Array<() => void> = []
  private levelListeners: Array<(level: number) => void> = []
  private uploads = new Map<string, (m: UploadAck) => void>()
  private researchReads = new Map<string, (m: { body?: string; problem?: string }) => void>()
  private graphs = new Map<string, (m: { graph?: MemoryGraph; problem?: string }) => void>()
  private runLists = new Map<string, (m: { runs?: RunDetail[]; problem?: string }) => void>()
  private usageReports = new Map<string, (m: { usage?: UsageReport; problem?: string }) => void>()
  private flowMaps = new Map<string, (m: { map?: FlowMap; problem?: string }) => void>()
  private chatReads = new Map<string, (m: ChatAnswer) => void>()
  private splits = new Map<string, (asks: string[]) => void>()
  /** False while VS Code keeps this view alive but hidden (sidebar collapsed, tab in the background). */
  shown = true

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.handleMessage)
    }
  }

  private handleMessage = (e: MessageEvent) => {
    const data = e.data
    if (!data || typeof data.type !== 'string') { return }

    switch (data.type) {
      case '__vscode-bridge-init':
        this._isVSCode = true
        this.postToExtension({ type: 'ready' })
        for (const cb of this.initListeners) cb()
        this.initListeners = [] // one-shot: no need to keep listeners after init
        break

      case 'agent-event':
        for (const cb of this.eventListeners) {
          cb(data.event)
        }
        break

      case 'agent-event-batch':
        for (const event of data.events) {
          for (const cb of this.eventListeners) {
            cb(event)
          }
        }
        break

      case 'connection-status':
        this._status = data.status
        this._source = data.source || ''
        for (const cb of this.statusListeners) {
          cb(this._status, this._source)
        }
        break

      case 'config':
        for (const cb of this.configListeners) {
          cb(data.config)
        }
        break

      case 'reset':
        for (const cb of this.sessionListeners) {
          cb('reset', data.reason || 'panel-reopened')
        }
        break

      case 'session-list':
        for (const cb of this.sessionListeners) {
          cb('list', data.sessions)
        }
        break

      case 'session-started':
        for (const cb of this.sessionListeners) {
          cb('started', data.session)
        }
        break

      case 'session-ended':
        for (const cb of this.sessionListeners) {
          cb('ended', data.sessionId)
        }
        break

      case 'session-updated':
        for (const cb of this.sessionListeners) {
          cb('updated', { sessionId: data.sessionId, label: data.label })
        }
        break
      case 'hub-state':
        // A delta only fits a state already here; a reloaded page asks for the whole one.
        if ('delta' in data && !this.lastHub) break
        this.lastHub = 'delta' in data ? applyDelta(this.lastHub as HubState, data.delta) : data.hub
        for (const cb of this.hubListeners) cb(this.lastHub as HubState)
        break
      case 'upload-progress':
      case 'upload-done':
        this.uploads.get(data.id)?.(data)
        break
      case 'research-read':
        this.researchReads.get(data.reqId)?.(data)
        break
      case 'graph':
        this.graphs.get(data.id)?.(data)
        break
      case 'runs':
        this.runLists.get(data.id)?.(data)
        break
      case 'usage':
        this.usageReports.get(data.id)?.(data)
        break
      case 'flowmap':
        this.flowMaps.get(data.id)?.(data)
        break
      case 'chat':
        this.chatReads.get(data.id)?.(data)
        break
      case 'hub-split-result':
        this.splits.get(data.reqId)?.(data.asks)
        break
      case 'hub-voice-level':
        for (const cb of this.levelListeners) cb(data.level)
        break
      case 'hub-visible':
        this.shown = data.visible !== false
        // globals.css stops every animation in a hidden view.
        document.documentElement.toggleAttribute('data-away', !this.shown)
        for (const cb of this.shownListeners) cb()
        break
    }
  }

  get isVSCode(): boolean {
    return this._isVSCode
  }

  // ─── Subscribe to events ─────────────────────────────────────────────────

  private subscribe<T>(listeners: T[], callback: T): () => void {
    listeners.push(callback)
    return () => {
      const idx = listeners.indexOf(callback)
      if (idx >= 0) listeners.splice(idx, 1)
    }
  }

  /** Subscribe to bridge init. If already initialized, fires synchronously. */
  onInit(callback: InitCallback): () => void {
    if (this._isVSCode) {
      callback()
      return () => {} // already fired, nothing to unsubscribe
    }
    return this.subscribe(this.initListeners, callback)
  }

  /** The mic's level, 0..1, while hub-voice listens. */
  onVoiceLevel(callback: (level: number) => void): () => void {
    return this.subscribe(this.levelListeners, callback)
  }

  onEvent(callback: EventCallback): () => void {
    return this.subscribe(this.eventListeners, callback)
  }

  onStatus(callback: StatusCallback): () => void {
    return this.subscribe(this.statusListeners, callback)
  }

  onConfig(callback: ConfigCallback): () => void {
    return this.subscribe(this.configListeners, callback)
  }

  onSession(callback: SessionCallback): () => void {
    return this.subscribe(this.sessionListeners, callback)
  }

  /** Subscribe to the Hub's state; a late subscriber gets the last one at once. */
  onHub(callback: HubCallback): () => void {
    if (this.lastHub) callback(this.lastHub)
    return this.subscribe(this.hubListeners, callback)
  }

  /** Called when the view is hidden or shown again; read `shown`. */
  onShown(callback: () => void): () => void {
    return this.subscribe(this.shownListeners, callback)
  }

  // ─── Send commands to extension ──────────────────────────────────────────

  openFile(filePath: string, line?: number): void {
    this.postToExtension({ type: 'open-file', filePath, line })
  }

  sendHub(command: HubCommand): void {
    this.postToExtension(command)
  }

  /** Hands one file to the extension in slices (sendSlices); each crosses as an ArrayBuffer, which VS Code 1.57+ passes as is. */
  upload(file: File, cwd: string, session: string | undefined, onProgress: (f: number) => void, signal?: AbortSignal): Promise<{ path: string } | { problem: string }> {
    const id = Math.random().toString(36).slice(2)
    const listen = (cb: (m: UploadAck) => void) => { this.uploads.set(id, cb); return () => { this.uploads.delete(id) } }
    return sendSlices(file, { id, cwd, session }, m => this.postToExtension(m), listen, onProgress, signal)
  }

  private request<T, M>(pending: Map<string, (message: M) => void>, id: string, timeout: number, fallback: () => T, answer: (message: M) => T): Promise<T> {
    return new Promise(done => {
      const t = setTimeout(() => { pending.delete(id); done(fallback()) }, timeout)
      pending.set(id, message => { clearTimeout(t); pending.delete(id); done(answer(message)) })
    })
  }

  /** A saved research run's markdown. Outside the editor, the demo's bodies. */
  researchRead(id: string): Promise<string> {
    const reqId = Math.random().toString(36).slice(2)
    if (!this.isVSCode) {
      // The browser app's hub answers with the markdown; with no hub (the demo) the bundled bodies.
      const fallback = demoResearchBody(id) ?? 'Not a saved research run'
      return fetch('/hub/command', { method: 'POST', headers: { 'X-Switchboard': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'hub-research-read', reqId, id }), signal: AbortSignal.timeout(20_000) })
        .then(r => (r.ok ? r.text() : fallback), () => fallback)
    }
    const result = this.request(this.researchReads, reqId, 20_000, () => 'The editor did not answer', m => m.body ?? m.problem ?? 'no body')
    this.postToExtension({ type: 'hub-research-read', reqId, id })
    return result
  }

  /** The Memory view's graph from the extension, or why not. */
  graph(): Promise<MemoryGraph | string> {
    const id = Math.random().toString(36).slice(2)
    const result = this.request(this.graphs, id, 20_000, () => 'The editor did not answer', m => m.graph ?? m.problem ?? 'no graph')
    this.postToExtension({ type: 'graph-get', id })
    return result
  }

  /** text cut into its separate asks; [text] when the editor is slow or unsure. */
  split(path: string, text: string): Promise<string[]> {
    const reqId = Math.random().toString(36).slice(2)
    if (!this.isVSCode) {
      // Browser and phone: the hub answers in the reply.
      const ok = (a: unknown) => (Array.isArray(a) && a.length && a.every(x => typeof x === 'string') ? (a as string[]) : [text])
      return fetch('/hub/split', { method: 'POST', headers: { 'X-Switchboard': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ path, text }), signal: AbortSignal.timeout(25_000) })
        .then(r => (r.ok ? r.json() : null)).then(j => ok(j?.asks), () => [text])
    }
    const result = this.request(this.splits, reqId, 25_000, () => [text], asks => Array.isArray(asks) && asks.length ? asks : [text])
    this.sendHub({ type: 'hub-split', reqId, path, text })
    return result
  }

  /** cwd's Flow map from the extension, or why not. A big project's first build can take a while. */
  flowMap(cwd: string): Promise<FlowMap | string> {
    const id = Math.random().toString(36).slice(2)
    const result = this.request(this.flowMaps, id, 60_000, () => 'The editor did not answer', m => m.map ?? m.problem ?? 'no map')
    this.postToExtension({ type: 'flowmap-get', id, cwd })
    return result
  }

  /** A role's runs in a chat, for the node drawer, or why not. */
  runs(sessionId: string, role: string): Promise<RunDetail[] | string> {
    const id = Math.random().toString(36).slice(2)
    const result = this.request(this.runLists, id, 20_000, () => 'The editor did not answer', m => m.runs ?? m.problem ?? 'no runs')
    this.postToExtension({ type: 'runs-get', id, sessionId, role })
    return result
  }

  usage(): Promise<UsageReport | string> {
    const id = Math.random().toString(36).slice(2)
    const result = this.request(this.usageReports, id, 120_000, () => 'The editor did not answer', m => m.usage ?? m.problem ?? 'no usage report')
    this.postToExtension({ type: 'usage-get', id })
    return result
  }

  /** A chat's outputs, a transcript page, one screenshot or its terminal screen, for the chat view. */
  chat(sessionId: string, what: 'outputs' | 'transcript' | 'shot' | 'screen', ask: ChatAsk = {}): Promise<ChatAnswer> {
    const id = Math.random().toString(36).slice(2)
    const result = this.request<ChatAnswer, ChatAnswer>(this.chatReads, id, 30_000, () => ({ problem: 'The editor did not answer' }), m => m)
    this.postToExtension({ type: 'chat-get', id, sessionId, what, ...ask })
    return result
  }

  private postToExtension(message: Record<string, unknown>): void {
    if (this._isVSCode && typeof window !== 'undefined') {
      // When inside VS Code iframe, post to parent (the webview frame)
      window.parent.postMessage(message, '*')
    }
  }

  /** Configure the bridge for direct VS Code webview API (production build). */
  configureWebviewApi(postMessage: (msg: Record<string, unknown>) => void): void {
    this._isVSCode = true
    this.postToExtension = (msg: Record<string, unknown>) => {
      postMessage(msg)
    }
    for (const cb of this.initListeners) cb()
    this.initListeners = []
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', this.handleMessage)
    }
    this.initListeners = []
    this.eventListeners = []
    this.statusListeners = []
    this.configListeners = []
    this.sessionListeners = []
    this.hubListeners = []
    this.shownListeners = []
  }
}

// Singleton, safe to import from anywhere
export const vscodeBridge = typeof window !== 'undefined' ? new VSCodeBridge() : null

/** Someone can see this view: false in a hidden browser tab and in a view VS Code keeps alive but hidden. */
export const onScreen = () => !document.hidden && vscodeBridge?.shown !== false
