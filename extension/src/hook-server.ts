import * as http from 'http'
import * as vscode from 'vscode'
import { AgentEvent } from './protocol'
import {
  ORCHESTRATOR_NAME, PREVIEW_MAX, RESULT_MAX,
  SESSION_ID_DISPLAY, FAILED_RESULT_MAX, HOOK_MAX_BODY_SIZE,
  SUBAGENT_ID_SUFFIX_LENGTH, HOOK_SERVER_HOST, HOOK_SERVER_NOT_STARTED,
  generateSubagentFallbackName,
} from './constants'
import { summarizeInput, summarizeResult, extractFilePath, buildDiscovery } from './tool-summarizer'
import { estimateTokenCost } from './token-estimator'
import { createLogger } from './logger'
import { hub } from './hub/hub-service'
import { handleHubRequest, handleUpload, handleVoice, tokenHeader, type HubReply } from './hub/routes'
import { EDIT_TOOLS, editGuard, noteEdit } from './hub/brain'
import { closingGate } from './hub/approve'

const log = createLogger('HookServer')

/**
 * Lightweight HTTP server that receives Claude Code hook events.
 *
 * Claude Code hooks POST JSON payloads for events like PreToolUse, PostToolUse,
 * SubagentStart, SubagentStop, SessionStart, Stop, etc.
 *
 * We transform these into AgentEvent format and emit them.
 */

/** Port 0 = let OS assign a random available port */

interface HookPayload {
  role_run?: string
  /** The Claude chat whose Bash started the role run (its CLAUDE_CODE_SESSION_ID). */
  role_parent?: string
  session_id: string
  transcript_path?: string
  cwd?: string
  hook_event_name: string
  // PreToolUse / PostToolUse
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_use_id?: string
  tool_response?: string | { content: string } | Array<{ text?: string }>
  // SubagentStart / SubagentStop
  agent_id?: string
  agent_type?: string
  agent_transcript_path?: string
  // Notification
  notification_type?: string
  message?: string
  title?: string
  // Generic
  [key: string]: unknown
}

// The Research panel closes a parallel fetch by its URL.
const fetchUrl = (p: HookPayload) => (p.tool_name === 'WebFetch' && typeof p.tool_input?.url === 'string' ? { url: p.tool_input.url } : {})

const PATCH_FILE = /^\*\*\* (?:(?:Update|Add|Delete) File|Move to):\s*(.+?)\s*$/gm

/** The files an edit tool call writes, when it has a cwd to resolve against. Codex's apply_patch names them in the patch text. */
function editedFiles(p: HookPayload): string[] {
  if (!p.cwd) return []
  const input: unknown = p.tool_input
  if (p.tool_name === 'apply_patch') {
    const text = typeof input === 'string' ? input : Object.values(p.tool_input ?? {}).filter(v => typeof v === 'string').join('\n')
    return [...new Set([...text.matchAll(PATCH_FILE)].map(m => m[1]))]
  }
  const file = p.tool_input?.file_path ?? p.tool_input?.notebook_path
  return EDIT_TOOLS.has(p.tool_name ?? '') && typeof file === 'string' && file ? [file] : []
}

// ponytail: no parent id (Bash outside Claude Code) leaves the run's own id, which has no progress row, so it is never warned.
/** Whose edit this is: a role run's edits belong to the chat that started it. */
const editor = (p: HookPayload) => (p.role_run && p.role_parent) || p.session_id

export class HookServer implements vscode.Disposable {
  private server: http.Server | null = null
  private port: number
  /** Per-session state: cleaned up on SessionEnd/Stop to prevent unbounded growth */
  private sessionState = new Map<string, {
    startTime: number
    agentNames: Map<string, string> // agent_id → friendly name
  }>()

  /** Edits the guard stopped, by session and file, so a retry goes through. */
  private tried = new Map<string, number>()
  /** Edits that went through, from every window's chats. */
  private edits = new Map<string, number>()

  private readonly _onEvent = new vscode.EventEmitter<AgentEvent>()

  readonly onEvent = this._onEvent.event

  private readonly _onRaw = new vscode.EventEmitter<{ payload: Record<string, unknown>; mirror: boolean }>()
  /** Every hook payload as Claude Code sent it, for the hub's chat progress. A mirror is a chat another window owns. */
  readonly onRaw = this._onRaw.event

  constructor(port?: number) {
    this.port = port ?? 0
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        // DNS rebinding: a rebound name reaches loopback with its own Host. Every caller sends 127.0.0.1:<port>.
        const host = req.headers.host
        if (host !== undefined && host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) {
          req.resume()
          res.writeHead(403)
          res.end()
          return
        }
        // An upload streams to disk; the string read below caps at 1 MB and is not binary safe.
        if (req.method === 'POST' && req.url?.startsWith('/hub/upload?')) {
          void handleUpload(hub, req.url, req, undefined, tokenHeader(req.headers)).then(r => {
            res.writeHead(r.status, r.contentType ? { 'Content-Type': r.contentType } : undefined)
            // Refused before the end (a bad token, over the cap): drop the rest once the answer is out.
            res.end(r.body, () => { if (!req.readableEnded) req.destroy() })
          }, () => { res.writeHead(500).end() })
          return
        }
        if (req.method === 'POST' && (req.url === '/hub/voice' || req.url?.startsWith('/hub/voice?'))) {
          void handleVoice(hub, req.url, req.headers['content-type'], req, tokenHeader(req.headers)).then(r => {
            res.writeHead(r.status, { 'Content-Type': r.contentType ?? 'text/plain; charset=utf-8' })
            res.end(r.body, () => { if (!req.readableEnded) req.destroy() })
          }, () => { res.writeHead(500).end() })
          return
        }
        if (req.url === '/hub' || req.url?.startsWith('/hub/') || req.url?.startsWith('/hub?')) {
          this.serveHub(req, res)
          return
        }
        // Hooks send the window token and never an Origin; a web page's forged post has neither.
        if (req.method === 'POST' && (req.headers.origin !== undefined || !hub.isToken(req.headers['x-switchboard-token']))) {
          req.resume()
          res.writeHead(403)
          res.end()
          return
        }
        if (req.method === 'POST') {
          const chunks: Buffer[] = []
          let size = 0
          let oversized = false
          req.on('data', (chunk: Buffer) => {
            if (oversized) return
            size += chunk.length
            if (size > HOOK_MAX_BODY_SIZE) {
              oversized = true
              chunks.length = 0
              log.warn('Request body exceeded size limit, discarding')
              return
            }
            chunks.push(chunk)
          })
          req.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8')
            let reply = ''
            if (!oversized) {
              try {
                const parsed: unknown = JSON.parse(body)
                if (!parsed || typeof parsed !== 'object' || !('session_id' in parsed) || !('hook_event_name' in parsed)
                    || typeof (parsed as HookPayload).session_id !== 'string'
                    || typeof (parsed as HookPayload).hook_event_name !== 'string') {
                  log.warn('Invalid hook payload: missing session_id or hook_event_name')
                } else {
                  const mirror = req.headers['x-switchboard-mirror'] === '1'
                  const p = parsed as HookPayload
                  if (!mirror) reply = this.guard(p)
                  if (p.hook_event_name === 'PostToolUse') for (const f of editedFiles(p)) noteEdit(this.edits, editor(p), p.cwd!, f)
                  // A role run is a subagent of a chat, not a chat.
                  if (!(parsed as HookPayload).role_run) this.handleHook(parsed as HookPayload, mirror)
                }
              } catch (e) {
                log.error('Failed to parse payload:', e)
              }
            }
            // Empty body unless the edit guard denies: hook.js prints a body as the hook's output.
            res.writeHead(200)
            res.end(reply)
          })
        } else {
          res.writeHead(200, { 'Content-Type': 'text/plain' })
          res.end('Agent Visualizer Hook Server')
        }
      })

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          // Another instance already owns this port; skip instead of incrementing
          // to a port nobody sends to. The session watcher handles all events via JSONL.
          log.info(`Port ${this.port} in use (another instance owns it); skipping hook server`)
          this.server?.close()
          this.server = null
          resolve(HOOK_SERVER_NOT_STARTED)
        } else {
          reject(err)
        }
      })

      this.server.listen(this.port, HOOK_SERVER_HOST, () => {
        const addr = this.server!.address() as { port: number }
        this.port = addr.port
        log.info(`Listening on http://127.0.0.1:${this.port}`)
        resolve(this.port)
      })
    })
  }

  /** The Hub's feed and inbox; same body cap as the hooks. */
  private serveHub(req: http.IncomingMessage, res: http.ServerResponse): void {
    const chunks: Buffer[] = []
    let size = 0
    let oversized = false
    req.on('data', (chunk: Buffer) => {
      if (oversized) return
      size += chunk.length
      if (size > HOOK_MAX_BODY_SIZE) { oversized = true; chunks.length = 0; return }
      chunks.push(chunk)
    })
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString('utf8')
      let reply: HubReply
      try {
        reply = oversized ? { status: 413, body: '' } : await handleHubRequest(hub, req, body) ?? { status: 404, body: '' }
      } catch {
        reply = { status: 500, body: '' }
      }
      res.writeHead(reply.status, reply.contentType ? { 'Content-Type': reply.contentType } : undefined)
      res.end(reply.bytes ?? reply.body)
    })
  }

  /** A PreToolUse deny for an edit that would land on another open chat's fresh edit, or a closing question asked too early, else ''. */
  private guard(payload: HookPayload): string {
    if (payload.hook_event_name !== 'PreToolUse') return ''
    let why = payload.role_run ? undefined : closingGate(payload)
    if (!why) for (const f of editedFiles(payload)) if ((why = editGuard(hub.get(), this.edits, this.tried, editor(payload), payload.cwd!, f, Date.now(), !!payload.role_run))) break
    return why ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } }) : ''
  }

  getPort(): number {
    return this.port
  }

  private getOrCreateSession(sessionId: string): { startTime: number; agentNames: Map<string, string> } {
    let state = this.sessionState.get(sessionId)
    if (!state) {
      state = { startTime: Date.now(), agentNames: new Map() }
      this.sessionState.set(sessionId, state)
    }
    return state
  }

  private elapsedSeconds(sessionId?: string): number {
    const startTime = sessionId ? (this.sessionState.get(sessionId)?.startTime ?? Date.now()) : Date.now()
    return (Date.now() - startTime) / 1000
  }

  private handleHook(payload: HookPayload, mirror = false): void {
    this._onRaw.fire({ payload: payload as unknown as Record<string, unknown>, mirror })
    // A mirror feeds only the hub's progress; the owning window draws and notifies.
    if (mirror) return
    const eventName = payload.hook_event_name
    log.debug(eventName, payload.tool_name || payload.agent_type || '')

    switch (eventName) {
      case 'SessionStart':
        this.handleSessionStart(payload)
        break
      case 'PreToolUse':
        this.handlePreToolUse(payload)
        break
      case 'PostToolUse':
        this.handlePostToolUse(payload)
        break
      case 'PostToolUseFailure':
        this.handlePostToolUseFailure(payload)
        break
      case 'SubagentStart':
        this.handleSubagentStart(payload)
        break
      case 'SubagentStop':
        this.handleSubagentStop(payload)
        break
      case 'Notification':
        this.handleNotification(payload)
        break
      case 'Stop':
        this.handleStop(payload)
        break
      case 'SessionEnd':
        this.handleSessionEnd(payload)
        break
      default:
        // UserPromptSubmit and other events feed only the progress reducer through onRaw.
        break
    }
  }

  private handleSessionStart(payload: HookPayload): void {
    this.getOrCreateSession(payload.session_id)

    this.emit({
      time: 0,
      type: 'agent_spawn',
      payload: {
        name: ORCHESTRATOR_NAME,
        isMain: true,
        task: `Session ${payload.session_id.slice(0, SESSION_ID_DISPLAY)}`,
      },
    }, payload.session_id)
  }

  private handlePreToolUse(payload: HookPayload): void {
    const agentName = this.resolveAgentName(payload)
    const toolName = payload.tool_name || 'unknown'
    const args = summarizeInput(toolName, payload.tool_input)

    // If this is the first event and no session start was received, auto-spawn
    if (!this.sessionState.has(payload.session_id)) {
      this.handleSessionStart(payload)
    }

    this.emit({
      time: this.elapsedSeconds(payload.session_id),
      type: 'tool_call_start',
      payload: {
        agent: agentName,
        tool: toolName,
        args,
        preview: `${toolName}: ${args}`.slice(0, PREVIEW_MAX),
      },
    }, payload.session_id)
  }

  private handlePostToolUse(payload: HookPayload): void {
    const agentName = this.resolveAgentName(payload)
    const toolName = payload.tool_name || 'unknown'
    const result = payload.tool_response ? summarizeResult(payload.tool_response) : ''
    const tokenCost = estimateTokenCost(toolName, result)

    // Build discovery for file-related tools
    const discovery = buildDiscovery(toolName, extractFilePath(payload.tool_input), result)

    this.emit({
      time: this.elapsedSeconds(payload.session_id),
      type: 'tool_call_end',
      payload: {
        agent: agentName,
        tool: toolName,
        result: result.slice(0, RESULT_MAX),
        tokenCost,
        ...fetchUrl(payload),
        ...(discovery ? { discovery } : {}),
      },
    }, payload.session_id)
  }

  private handlePostToolUseFailure(payload: HookPayload): void {
    const agentName = this.resolveAgentName(payload)
    const toolName = payload.tool_name || 'unknown'

    this.emit({
      time: this.elapsedSeconds(payload.session_id),
      type: 'tool_call_end',
      payload: {
        agent: agentName,
        tool: toolName,
        result: `[FAILED] ${(payload.tool_response ? summarizeResult(payload.tool_response) : '').slice(0, FAILED_RESULT_MAX)}`,
        tokenCost: 0,
        ...fetchUrl(payload),
      },
    }, payload.session_id)
  }

  private handleSubagentStart(payload: HookPayload): void {
    // Track agent_id → name mapping for SubagentStop resolution, but do not
    // emit agent_spawn here.  The transcript parser independently spawns the
    // subagent using its description field (via resolveSubagentChildName),
    // which produces the user-facing name.  Emitting a second spawn from the
    // hook creates a duplicate node with a generic name like
    // "general-purpose-ab75a" alongside the correctly-named node.
    const agentType = payload.agent_type || 'subagent'
    const agentId = payload.agent_id || ''
    const sessionAgents = this.getOrCreateSession(payload.session_id).agentNames
    const childName = agentId ? `${agentType}-${agentId.slice(-SUBAGENT_ID_SUFFIX_LENGTH)}` : generateSubagentFallbackName(String(Date.now()), sessionAgents.size + 1)

    sessionAgents.set(agentId, childName)
  }

  private handleSubagentStop(payload: HookPayload): void {
    const agentId = payload.agent_id || ''
    const sessionAgents = this.sessionState.get(payload.session_id)?.agentNames
    const childName = sessionAgents?.get(agentId) || 'subagent'
    const parentName = this.resolveAgentName(payload)

    this.emit({
      time: this.elapsedSeconds(payload.session_id),
      type: 'subagent_return',
      payload: { child: childName, parent: parentName, summary: `${payload.agent_type} complete` },
    }, payload.session_id)

    this.emit({
      time: this.elapsedSeconds(payload.session_id),
      type: 'agent_complete',
      payload: { name: childName },
    }, payload.session_id)
  }

  private handleNotification(payload: HookPayload): void {
    if (payload.notification_type !== 'permission_prompt') return

    this.emit({
      time: this.elapsedSeconds(payload.session_id),
      type: 'permission_requested',
      payload: {
        agent: ORCHESTRATOR_NAME,
        message: payload.message || 'Permission needed',
        title: payload.title || 'Permission needed',
      },
    }, payload.session_id)
  }

  private handleStop(payload: HookPayload): void {
    this.emit({
      time: this.elapsedSeconds(payload.session_id),
      type: 'agent_complete',
      payload: { name: ORCHESTRATOR_NAME },
    }, payload.session_id)
  }

  private handleSessionEnd(payload: HookPayload): void {
    this.emit({
      time: this.elapsedSeconds(payload.session_id),
      type: 'agent_complete',
      payload: { name: ORCHESTRATOR_NAME, sessionEnd: true },
    }, payload.session_id)

    // Clean up per-session state to prevent unbounded Map growth
    this.sessionState.delete(payload.session_id)
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private resolveAgentName(payload: HookPayload): string {
    // If this event has an agent_id, look it up in the session's agent names.
    if (payload.agent_id) {
      const name = this.sessionState.get(payload.session_id)?.agentNames.get(payload.agent_id)
      if (name) return name
    }
    return ORCHESTRATOR_NAME
  }

  private emit(event: AgentEvent, sessionId?: string): void {
    this._onEvent.fire(sessionId ? { ...event, sessionId } : event)
  }

  dispose(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
    this.sessionState.clear()
    this._onEvent.dispose()
    this._onRaw.dispose()
  }
}
