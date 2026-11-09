/**
 * VS Code Bridge: enables the visualizer to communicate with the VS Code extension host.
 *
 * When running standalone (npm run dev), this is a no-op.
 * When running inside a VS Code webview iframe, it forwards messages
 * between the React app and the extension host.
 */

export type { AgentEvent, SessionInfo, ConnectionStatus } from './bridge-types'
import type { AgentEvent, SessionInfo, ConnectionStatus } from './bridge-types'
import type { AiId, ApiKeyName, ChatProfile, Choice, GitOp, HubState, SettingKey, SwitchboardKey } from './hub-types'
import { sendSlices } from './attach'
import type { MemoryGraph } from './memory-graph'
import type { RunDetail } from './runs'
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
  | { type: 'hub-web'; phone: boolean }
  | { type: 'hub-toggle'; kind: 'mod' | 'plugin' | 'skill'; name: string; enabled: boolean }
  | { type: 'hub-setting'; key: SettingKey; value: boolean | number | string | null }
  | { type: 'hub-switchboard'; key: SwitchboardKey; value: boolean | number | string | null }
  | { type: 'hub-compact'; sessionId: string }
  | { type: 'hub-pause'; action: 'resume' | 'cancel' }
  | { type: 'hub-hand-to'; sessionId: string }
  | { type: 'hub-ai-login'; ai: AiId }
  | { type: 'hub-new-chat'; path: string; text?: string; remote: boolean; branch?: string; ai?: AiId; tools?: ChatProfile }
  | { type: 'hub-pick-tools'; text: string; path?: string }
  | { type: 'hub-chat-tools'; sessionId: string; tools: ChatProfile }
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
  | { type: 'hub-aws-default'; profile: string }
  | { type: 'hub-aws-label'; profile: string; label: string }
  | { type: 'hub-aws-add'; profile: string; region: string; chrome?: string }
  | { type: 'hub-aws-window'; profile: string | null }
  | { type: 'hub-aws-check' }
  | { type: 'hub-aws-delete'; profile: string }
  | { type: 'hub-login-app-add'; name: string; url: string }
  | { type: 'hub-login-add'; app: string; label: string; url: string; chrome?: string }
  | { type: 'hub-login-open'; app: string; id?: string; chrome?: string; folder?: string }
  /** login: a login id, null for the app's default, 'off' to drop the app from the project. */
  | { type: 'hub-login-link'; folder: string; app: string; login: string | null }
  | { type: 'hub-browser'; folder: string; chrome: string | null }
  | { type: 'hub-login-active'; app: string; id: string }
  | { type: 'hub-login-rename'; app: string; id: string; label: string }
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
  | { type: 'hub-harden'; sessionId: string }
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
  | { type: 'hub-todo-replace'; path: string; remote: string }

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
  private graphs = new Map<string, (m: { graph?: MemoryGraph; problem?: string }) => void>()
  private runLists = new Map<string, (m: { runs?: RunDetail[]; problem?: string }) => void>()
  private flowMaps = new Map<string, (m: { map?: FlowMap; problem?: string }) => void>()
  private chatReads = new Map<string, (m: ChatAnswer) => void>()
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
        this.lastHub = data.hub
        for (const cb of this.hubListeners) cb(data.hub)
        break
      case 'upload-progress':
      case 'upload-done':
        this.uploads.get(data.id)?.(data)
        break
      case 'graph':
        this.graphs.get(data.id)?.(data)
        break
      case 'runs':
        this.runLists.get(data.id)?.(data)
        break
      case 'flowmap':
        this.flowMaps.get(data.id)?.(data)
        break
      case 'chat':
        this.chatReads.get(data.id)?.(data)
        break
      case 'hub-voice-level':
        for (const cb of this.levelListeners) cb(data.level)
        break
      case 'hub-visible':
        this.shown = data.visible !== false
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

  /** The Memory view's graph from the extension, or why not. */
  graph(): Promise<MemoryGraph | string> {
    const id = Math.random().toString(36).slice(2)
    return new Promise(done => {
      const t = setTimeout(() => { this.graphs.delete(id); done('VS Code did not answer') }, 20_000)
      this.graphs.set(id, m => { clearTimeout(t); this.graphs.delete(id); done(m.graph ?? m.problem ?? 'no graph') })
      this.postToExtension({ type: 'graph-get', id })
    })
  }

  /** cwd's Flow map from the extension, or why not. A big project's first build can take a while. */
  flowMap(cwd: string): Promise<FlowMap | string> {
    const id = Math.random().toString(36).slice(2)
    return new Promise(done => {
      const t = setTimeout(() => { this.flowMaps.delete(id); done('VS Code did not answer') }, 60_000)
      this.flowMaps.set(id, m => { clearTimeout(t); this.flowMaps.delete(id); done(m.map ?? m.problem ?? 'no map') })
      this.postToExtension({ type: 'flowmap-get', id, cwd })
    })
  }

  /** A role's runs in a chat, for the node drawer, or why not. */
  runs(sessionId: string, role: string): Promise<RunDetail[] | string> {
    const id = Math.random().toString(36).slice(2)
    return new Promise(done => {
      const t = setTimeout(() => { this.runLists.delete(id); done('VS Code did not answer') }, 20_000)
      this.runLists.set(id, m => { clearTimeout(t); this.runLists.delete(id); done(m.runs ?? m.problem ?? 'no runs') })
      this.postToExtension({ type: 'runs-get', id, sessionId, role })
    })
  }

  /** A chat's outputs, a transcript page or one screenshot, for the chat view. */
  chat(sessionId: string, what: 'outputs' | 'transcript' | 'shot', ask: ChatAsk = {}): Promise<ChatAnswer> {
    const id = Math.random().toString(36).slice(2)
    return new Promise(done => {
      const t = setTimeout(() => { this.chatReads.delete(id); done({ problem: 'VS Code did not answer' }) }, 30_000)
      this.chatReads.set(id, m => { clearTimeout(t); this.chatReads.delete(id); done(m) })
      this.postToExtension({ type: 'chat-get', id, sessionId, what, ...ask })
    })
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
