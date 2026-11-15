/**
 * The hook server's /hub routes, as a pure function so tests need no socket.
 *
 * POST /hub         a usage mod's feed post (token in the body)
 * GET  /hub/inbox   a chat collects what the panel queued for it (token in the x-switchboard-token header or the query)
 * GET  /hub/keep    what a full chat does: always continue in a fresh chat (token in the x-switchboard-token header or the query)
 * GET  /hub/brief   the brief for a new chat in ?cwd= (token in the x-switchboard-token header or the query); its own project only
 * GET  /hub/ask     ?cwd=&q=: one paid Haiku answer from that project's board (token in the x-switchboard-token header or the query)
 * GET  /hub/holds   204 when this window holds the chat's terminal, so the app routes its commands here
 * GET  /hub/graph   the Memory view's graph (graph.ts), redacted (token in the x-switchboard-token header or the query)
 * GET  /hub/recall  ?q=&cwd=: what memory knows about q, from that graph (graph.ts recall), free (token in the x-switchboard-token header or the query)
 * GET  /hub/flowmap ?cwd=: that project's Flow map (flowmap.ts), built on demand and cached (token in the x-switchboard-token header or the query)
 * GET  /hub/runs    ?session=&role=: that role's runs in that chat for the node drawer (runs.ts), redacted (token in the x-switchboard-token header or the query)
 * GET  /hub/chat/outputs     ?session=: what that chat produced (chat-view.ts), redacted (token in the x-switchboard-token header or the query)
 * GET  /hub/chat/transcript  ?session=&before=: 50 messages ending before byte before (token in the x-switchboard-token header or the query)
 * GET  /hub/chat/shot        ?session=&path=: an image listed in that chat's outputs, under 10 MB (token in the x-switchboard-token header or the query)
 * GET  /hub/voice   {voice, level, heard}: the mic while it runs, polled by the app (token in the x-switchboard-token header or the query)
 * POST /hub/voice   a phone's audio clip, under 5 MB (handleVoice): answers {text}, or the problem as plain text (token in the x-switchboard-token header or the query)
 * GET  /hub/state   the whole HubState, for the standalone web app's proxy (token in the x-switchboard-token header or the query); no thisWindow, it is no window
 * POST /hub/command a hub-* command, run as the panel's (token in the x-switchboard-token header or the query)
 * POST /hub/device  the standalone app passes on a device asking to sign in, or that it was answered (token in the x-switchboard-token header or the query)
 * POST /hub/question       the ask tool's question {sessionId, id, questions}; GET ?id= holds 25 s for its answer (204: ask again, 410: gone);
 *      /hub/question/done  ?id=: answered in the terminal (token in the x-switchboard-token header or the query)
 * POST /hub/todo    the ask server's todo_add or todo_done {op, cwd, text?, id?, before?, session?}; answers a line for the chat (token in the x-switchboard-token header or the query)
 * POST /hub/tool-on the ask server's tool_on {session, name}: a plugin or skill on for that chat; answers a line for it (token in the x-switchboard-token header or the query)
 * POST /hub/sweep   the ask server's sweep {name?}: rescan one tool, or start Sweep all; answers a line. Never approves: that is hub-sweep-approve, Kenneth's click (token in the x-switchboard-token header or the query)
 * POST /hub/upload  ?cwd=&name=&session=: the body streamed to uploads/ (handleUpload, not handleHub); answers {path} (token in the x-switchboard-token header or the query)
 * Anything outside /hub answers undefined and stays with the hook handler.
 */
import { askBrain, askContext, brief, quickAsk } from './brain'
import { discuss, runCli, type Ai, type Spawn } from './discuss'
import { touch } from './idle'
import type { HubService } from './hub-service'
import type { WebviewToExtensionMessage } from '../protocol'
import type { GitOp, SettingKey, SwitchboardKey } from './types'
import { isAi } from './ais'
import { isRepoAsk } from './projects'
import { isKeyName } from './keys'
import { CODEX_EFFORTS, CODEX_MODELS, ROLE_MODELS } from './roles'
import { questionAsk } from './progress'
import { answerQuestion, closeQuestion, openQuestion, questionOf, waitQuestion } from './questions'
import { phoneAsk } from './phone'
import { todoTool, type TodoCall } from './todo'
import { toolOn } from './tools'
import { projectId, readGraph, recall, recentGraph, type MemoryGraph } from './graph'
import { buildFlowMap, flowChatDirs, flowLabels, flowRoots, withLimits } from './flowmap'
import { readGroups, splitAsks } from './split'
import { readRuns, type RunDetail } from './runs'
import { chatOutputs, chatShot, chatTranscript, progressOutputs, type ChatOutputs, type ChatTranscript } from './chat-view'
import { chatLabel, saveUpload, UploadRefused } from './uploads'
import { isClipType } from './voice'
import { SPEND_KEYS, SPEND_MODES } from './spend'
import { isTabCommand, TAB_OPS } from './window-tabs'

/** bytes: a binary body, sent in place of body. */
export type HubReply = { status: number; body: string; contentType?: string; bytes?: Buffer }
export type ChatReads = { outputs: (session: string) => Promise<ChatOutputs | null>; transcript: (session: string, before?: number) => Promise<ChatTranscript | null> }
const CHAT: ChatReads = { outputs: s => chatOutputs(s), transcript: (s, b) => chatTranscript(s, b) }
const json = (v: unknown): HubReply => ({ status: 200, body: JSON.stringify(v), contentType: 'application/json' })

const text = (body: string): HubReply => ({ status: 200, body, contentType: 'text/plain; charset=utf-8' })

type Check = (v: unknown) => boolean
type HubCommand = Extract<WebviewToExtensionMessage, { type: `hub-${string}` }>
const str: Check = v => typeof v === 'string'
const bool: Check = v => typeof v === 'boolean'
const num: Check = v => typeof v === 'number' && Number.isFinite(v)
const opt = (f: Check): Check => v => v === undefined || f(v)
const oneOf = (...xs: unknown[]): Check => v => xs.includes(v)
const any = (...fs: Check[]): Check => v => fs.some(f => f(v))
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
// One answer per question, at most four: an option index, several for a multiSelect one, or Other text.
// The text goes into a terminal; askKeys cleans and cuts it, this only stops a huge body.
const index = (x: unknown) => Number.isInteger(x) && (x as number) >= 0 && (x as number) < 10
const indexes = (x: unknown) => Array.isArray(x) && x.length <= 10 && x.every(index)
const other = (x: unknown) => obj(x) && typeof x.other === 'string' && x.other.length <= 500 && (x.picks === undefined || indexes(x.picks))
const picks: Check = v => Array.isArray(v) && v.length > 0 && v.length <= 4 && v.every(x => index(x) || indexes(x) || other(x))
const flags = (v: unknown) => obj(v) && Object.values(v).every(bool)
const profile: Check = v => obj(v) && flags(v.plugins) && flags(v.skills) && (v.assets === undefined || flags(v.assets))
const SETTING_KEYS: SettingKey[] = ['autoCompactEnabled', 'autoCompactWindow', 'autoContinueAtUsageLimit', 'remoteControlAtStartup', 'agentPushNotifEnabled', 'inputNeededNotifEnabled', 'model', 'effortLevel', 'tui', 'statusLine']
const GIT_OPS: GitOp[] = ['sync', 'commit', 'commit-push', 'switch', 'create', 'undo', 'discard', 'pr', 'stash', 'pop', 'delete-branch', 'rerun', 'ship', 'push']
// The request body has a size cap too, so the count stays modest; web/lib/ship-card.ts says the same before sending.
const MAX_PATHS = 1000
const SPLIT_MAX = 8000
const paths: Check = v => Array.isArray(v) && v.length <= MAX_PATHS && v.every(x => typeof x === 'string')
// Typed by Kenneth; todo.ts cuts it to 2000 after cleaning, this only stops a huge body.
const todoText: Check = v => typeof v === 'string' && v.length <= 2000
const SWITCHBOARD_KEYS: SwitchboardKey[] = ['hooks', 'statusBar', 'idleMinutes', 'brief', 'askBrain', 'syncRules', 'accessNote', 'autoStart', 'autoFix', 'stopServers', 'name', 'askClaude', 'askCodex', 'keepApp', 'hardenBuild', 'pauseAt', 'learn', 'oneWindow', 'showBrowsers', 'toasts', 'phone', 'smartModelSwitch', 'codexModel', 'codexEffort']

/** Every field of every hub command, as protocol.ts declares it; the runner trusts these types. */
const SHAPES: { [T in HubCommand['type']]: { [K in Exclude<keyof Extract<HubCommand, { type: T }>, 'type'>]-?: Check } } = {
  'hub-send': { sessionId: str, text: str },
  'hub-answer': { sessionId: str, askId: str, choice: picks },
  'hub-rc': { on: bool, sessionId: opt(str) },
  'hub-open-url': { url: str },
  'hub-web': { phone: bool },
  'hub-toggle': { kind: oneOf('mod', 'plugin', 'skill'), name: str, enabled: bool },
  'hub-setting': { key: oneOf(...SETTING_KEYS), value: any(bool, num, str, oneOf(null)) },
  'hub-switchboard': { key: oneOf(...SWITCHBOARD_KEYS), value: any(bool, num, str, oneOf(null)) },
  'hub-compact': { sessionId: str },
  'hub-pause': { action: oneOf('resume', 'cancel') },
  'hub-hand-to': { sessionId: str },
  'hub-ai-login': { ai: isAi },
  'hub-new-chat': { path: str, text: opt(str), remote: bool, branch: opt(str), ai: opt(isAi), tools: opt(profile), repo: opt(isRepoAsk), waitOn: opt(v => Array.isArray(v) && v.length <= 20 && v.every(x => typeof x === 'string')), group: opt(str) },
  'hub-split': { reqId: str, path: str, text: v => typeof v === 'string' && v.length <= SPLIT_MAX },
  'hub-pick-tools': { text: str, path: opt(str) },
  'hub-advanced': { path: str, on: bool },
  'hub-stage': { path: str, run: str, n: num, status: oneOf('done', 'redo') },
  'hub-escalation-reset': { project: str, role: str, files: paths },
  'hub-chat-tools': { sessionId: str, tools: profile },
  'hub-indefinite': { sessionId: str, on: bool },
  'hub-budget': { sessionId: str, maxHours: opt(any(num, oneOf(null))), maxCostUsd: opt(any(num, oneOf(null))), gate: opt(any(v => typeof v === 'string' && v.length <= 500, oneOf(null))) },
  'hub-checkback': { sessionId: str, everyMin: oneOf(10, 30, 60) },
  'hub-checkback-clear': { sessionId: str },
  'hub-refine': { sessionId: str },
  'hub-snapshots': {},
  'hub-snapshot-restore': { id: str },
  'hub-health': {},
  'hub-health-fix': { ids: opt(v => Array.isArray(v) && v.length <= 50 && v.every(x => typeof x === 'string')) },
  'hub-pipeline-save': { path: str, run: str, name: v => typeof v === 'string' && v.length <= 80 },
  'hub-pipelines': {},
  'hub-pipeline-seed': { slug: str, path: str, run: str },
  'hub-trend': {},
  'hub-star': { sessionId: str, ai: isAi, on: bool },
  'hub-resume': { sessionId: str, ai: isAi },
  'hub-archive': { sessionId: str },
  'hub-unarchive': { sessionId: str },
  'hub-approve': { sessionId: str },
  'hub-open-note': { sessionId: str },
  'hub-focus-chat': { sessionId: str },
  'hub-terminal': { id: num, act: oneOf('show', 'close') },
  'hub-keep': { onFull: opt(oneOf('compact', 'fresh')), freshBranch: opt(bool) },
  'hub-aws-login': { profile: str, chrome: opt(str) },
  'hub-aws-rename': { profile: str, to: str },
  'hub-aws-label': { profile: str, label: str },
  'hub-aws-add': { profile: str, region: str, chrome: opt(str) },
  'hub-aws-window': { profile: any(str, oneOf(null)) },
  'hub-aws-check': {},
  'hub-aws-delete': { profile: str },
  'hub-login-app-add': { name: str, url: str },
  'hub-login-add': { app: str, label: str, url: str, chrome: opt(str), email: opt(str) },
  'hub-login-open': { app: str, id: opt(str), chrome: opt(str), folder: opt(str) },
  'hub-login-link': { folder: str, app: str, login: any(str, oneOf(null)) },
  'hub-browser': { folder: str, chrome: any(str, oneOf(null)) },
  'hub-login-active': { app: str, id: str },
  'hub-login-rename': { app: str, id: str, label: str, email: opt(str) },
  'hub-login-delete': { app: str, id: str },
  'hub-login-app-delete': { app: str },
  'hub-key-save': { name: isKeyName, value: v => typeof v === 'string' && v.length <= 512 },
  'hub-key-test': { name: isKeyName },
  'hub-key-remove': { name: isKeyName },
  'hub-env-setup': { folder: str },
  'hub-kit-export': {},
  'hub-setup': {},
  'hub-rules-sync': {},
  'hub-role-model': { role: str, model: oneOf(...ROLE_MODELS) },
  'hub-role-codex': { role: str, model: oneOf('default', ...CODEX_MODELS), effort: oneOf('default', ...CODEX_EFFORTS) },
  'hub-rc-server': { folder: str, on: bool },
  'hub-handoff': { sessionId: str },
  'hub-sweep': { name: opt(str) },
  'hub-spend': { key: oneOf(...SPEND_KEYS), mode: oneOf(...SPEND_MODES), monthlyUsd: opt(num) },
  'hub-sweep-approve': { name: str },
  'hub-learn': { id: str, ok: bool },
  'hub-summary': { sessionId: str, refresh: opt(bool) },
  'hub-sweep-fix': { name: str },
  'hub-tool-add': { repo: v => typeof v === 'string' && v.length <= 200 },
  'hub-changes': { sessionId: str },
  'hub-open-diff': { sessionId: str, file: str },
  'hub-search': { q: str },
  'hub-jarvis': { q: todoText, voice: opt(bool) },
  'hub-voice': { on: bool },
  'hub-dev-start': { folder: str },
  'hub-dev-stop': { folder: str },
  'hub-window-tab': { op: oneOf(...TAB_OPS), workspace: opt(str) },
  'hub-awake': { on: bool },
  'hub-device': { id: str, allow: bool },
  'hub-stuck-stop': { sessionId: str, id: str },
  'hub-stuck-dismiss': { sessionId: str, id: str },
  'hub-stuck-fix': { sessionId: str, id: str },
  'hub-wait-for': { from: str, to: str },
  'hub-unlink': { from: str, to: str },
  'hub-git': { sessionId: str, op: oneOf(...GIT_OPS), files: opt(paths), summary: opt(str), description: opt(str), branch: opt(str), stash: opt(bool), confirmed: opt(bool) },
  'hub-harden': { sessionId: str },
  'hub-draft-commit': { sessionId: str },
  'hub-todo-add': { path: str, text: todoText },
  'hub-todo-edit': { path: str, id: str, text: todoText },
  'hub-todo-remove': { path: str, id: str },
  'hub-todo-restore': { path: str, id: str },
  'hub-todo-accept': { path: str, id: str },
  'hub-todo-dismiss': { path: str, id: str },
  'hub-todo-move': { path: str, ids: v => Array.isArray(v) && v.length > 0 && v.length <= 500 && v.every(x => typeof x === 'string') },
  'hub-todo-run': { path: str, ids: v => Array.isArray(v) && v.length > 0 && v.length <= 50 && v.every(x => typeof x === 'string'), to: opt(str) },
  'hub-todo-sync': { path: str, on: bool },
  'hub-todo-pilot': { path: str, on: opt(bool), paused: opt(bool) },
  'hub-todo-replace': { path: str, remote: v => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v) },
}

/** Why a command is refused, or undefined when every field has its declared type. */
export function commandProblem(c: unknown): string | undefined {
  if (!obj(c) || typeof c.type !== 'string') return 'no type'
  const shape = Object.hasOwn(SHAPES, c.type) ? (SHAPES as Record<string, Record<string, Check>>)[c.type] : undefined
  if (!shape) return `unknown command ${c.type}`
  if (Array.isArray(c.files) && c.files.length > MAX_PATHS) return `More than ${MAX_PATHS} files changed: commit these from a terminal`
  const bad = Object.entries(shape).find(([k, ok]) => !ok(c[k]))
  return bad ? `${c.type}: ${bad[0]} is missing or the wrong type` : undefined
}

// The header keeps the token out of URLs; ?token= stays for older windows and mods. A header, when sent, is the only one read.
const tokenOf = (u: URL, header?: string) => header ?? u.searchParams.get('token')
/** The x-switchboard-token header of a request, when it has one. */
export const tokenHeader = (h: { [k: string]: string | string[] | undefined }) => { const t = h['x-switchboard-token']; return typeof t === 'string' ? t : undefined }
/** handleHub for a live request, token header included. */
export const handleHubRequest = (hub: HubService, req: { method?: string; url?: string; headers: { [k: string]: string | string[] | undefined } }, body: string) =>
  handleHub(hub, req.method, req.url, body, undefined, undefined, undefined, undefined, undefined, tokenHeader(req.headers))

/** The runner's answer as a reply: a string is the reason it refused. */
export const ranReply = (r: boolean | string): HubReply => (typeof r === 'string' ? { status: 400, body: r } : { status: r ? 204 : 400, body: '' })

/** Only /hub/ask, /hub/holds, /hub/graph, /hub/recall and /hub/runs answer later; `ask`, `todo`, `graph` and `runs` are swapped in tests so none spends, writes or reads ~/.claude. */
export function handleHub(hub: HubService, method: string | undefined, url: string | undefined, body: string, ask = askBrain, todo: (c: TodoCall & { cwd: string }) => Promise<string> = todoTool, graph: (s: ReturnType<HubService['get']>) => Promise<MemoryGraph> = readGraph, runs: (session: string, role: string) => Promise<RunDetail[]> = readRuns, chat: ChatReads = CHAT, token?: string, split: (text: string) => Promise<string[]> = t => splitAsks(t, quickAsk), cli: Spawn = runCli): HubReply | Promise<HubReply> | undefined {
  const u = new URL(url ?? '/', 'http://127.0.0.1')
  const sent = tokenOf(u, token)
  if (u.pathname !== '/hub' && !u.pathname.startsWith('/hub/')) return undefined

  if (method === 'POST' && u.pathname === '/hub') {
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      return { status: 400, body: '' }
    }
    // Another window asks this one to run a command: only the tab ones, never anything else.
    if (obj(parsed) && parsed.kind === 'window-tab' && !isTabCommand(parsed.command)) return { status: 400, body: '' }
    return { status: hub.ingest(parsed) ? 204 : 403, body: '' }
  }

  if (method === 'GET' && u.pathname === '/hub/inbox') {
    if (!hub.isToken(sent)) return { status: 403, body: '' }
    const items = hub.take(u.searchParams.get('session') ?? '')
    return { status: 200, body: JSON.stringify(items), contentType: 'application/json' }
  }

  if (method === 'GET' && u.pathname === '/hub/keep') {
    if (!hub.isToken(sent)) return { status: 403, body: '' }
    const { onFull, freshBranch } = hub.get().keep
    return { status: 200, body: JSON.stringify({ onFull, freshBranch }), contentType: 'application/json' }
  }

  if (method === 'GET' && (u.pathname === '/hub/brief' || u.pathname === '/hub/ask')) {
    if (!hub.isToken(sent)) return { status: 403, body: '' }
    const cwd = u.searchParams.get('cwd') ?? ''
    if (!cwd) return { status: 400, body: '' }
    const { brief: on, askBrain: asks } = hub.get().controls.switchboard
    if (u.pathname === '/hub/brief') return text(on ? brief(hub.get(), cwd, u.searchParams.get('session') ?? '') : '')
    const q = u.searchParams.get('q')?.trim()
    if (!asks) return text('Ask the brain is off in Switchboard, Controls.')
    if (!q) return { status: 400, body: '' }
    return ask(q, askContext(hub.get(), cwd, hub.stopped())).then(text)
  }

  // The browser and phone panel's hub-split: the asks come back in the reply.
  if (method === 'POST' && u.pathname === '/hub/split') {
    if (!hub.isToken(sent)) return { status: 403, body: '' }
    let c: unknown
    try { c = JSON.parse(body) } catch { return { status: 400, body: '' } }
    const t = obj(c) ? c.text : undefined
    if (typeof t !== 'string' || !t.trim() || t.length > SPLIT_MAX) return { status: 400, body: '' }
    return split(t).then(asks => ({ status: 200, body: JSON.stringify({ asks }), contentType: 'application/json' }), () => ({ status: 200, body: JSON.stringify({ asks: [t] }), contentType: 'application/json' }))
  }

  if (method === 'GET' && u.pathname === '/hub/holds') {
    if (!hub.isToken(sent)) return { status: 403, body: '' }
    const id = u.searchParams.get('session') ?? ''
    return Promise.resolve(hub.holds?.(id) ?? false).then(yes => ({ status: yes ? 204 : 404, body: '' }))
  }

  if (method === 'GET' && u.pathname === '/hub/graph') {
    if (!hub.isToken(sent)) return { status: 403, body: '' }
    return graph(hub.get()).then(g => ({ status: 200, body: JSON.stringify(g), contentType: 'application/json' }), err => ({ status: 500, body: (err as Error).message }))
  }

  // cwd only breaks ties toward the chat's own project; memory from every project still answers.
  if (method === 'GET' && u.pathname === '/hub/recall') {
    if (!hub.isToken(sent)) return { status: 403, body: '' }
    const q = u.searchParams.get('q')?.trim().slice(0, 500)
    if (!q) return { status: 400, body: '' }
    const cwd = u.searchParams.get('cwd')
    return recentGraph(hub.get(), graph).then(g => text(recall(g, q, 2, cwd ? projectId(hub.get(), cwd) : undefined)), err => ({ status: 500, body: (err as Error).message }))
  }

  if (method === 'GET' && u.pathname === '/hub/flowmap') {
    if (!hub.isToken(sent)) return { status: 403, body: '' }
    const cwd = u.searchParams.get('cwd')
    if (!cwd) return { status: 400, body: 'cwd is needed' }
    return buildFlowMap(cwd, flowLabels(hub.get()), flowRoots(hub.get()), undefined, flowChatDirs(hub.get()), readGroups()).then(m => ({ status: 200, body: JSON.stringify(withLimits(m, hub.get().chats)), contentType: 'application/json' }), err => ({ status: 400, body: (err as Error).message }))
  }

  if (method === 'GET' && u.pathname === '/hub/runs') {
    if (!hub.isToken(sent)) return { status: 403, body: '' }
    const session = u.searchParams.get('session'), role = u.searchParams.get('role')
    if (!session || !role) return { status: 400, body: 'session and role are needed' }
    return runs(session, role).then(r => ({ status: 200, body: JSON.stringify(r), contentType: 'application/json' }), err => ({ status: 400, body: (err as Error).message }))
  }

  if (method === 'GET' && u.pathname.startsWith('/hub/chat/')) {
    if (!hub.isToken(sent)) return { status: 403, body: '' }
    const session = u.searchParams.get('session') ?? ''
    const codex = () => hub.get().progress.find(p => p.sessionId === session)
    const fail = (err: unknown): HubReply => ({ status: 500, body: (err as Error).message })
    if (u.pathname === '/hub/chat/outputs') {
      return chat.outputs(session).then(o => {
        const p = o ? undefined : codex()
        return o ? json(o) : p ? json(progressOutputs(p)) : { status: 404, body: '' }
      }, fail)
    }
    if (u.pathname === '/hub/chat/transcript') {
      const b = u.searchParams.get('before')
      if (b !== null && !/^\d{1,15}$/.test(b)) return { status: 400, body: 'before is a byte offset' }
      return chat.transcript(session, b === null ? undefined : Number(b)).then(t => t ? json(t) : codex() ? json({ messages: [], before: null, transcript: 'unsupported' }) : { status: 404, body: '' }, fail)
    }
    if (u.pathname === '/hub/chat/shot') {
      const file = u.searchParams.get('path') ?? ''
      return chat.outputs(session).then(o => o ? chatShot(o.shots, file) : undefined)
        .then(s => s ? { status: 200, body: '', bytes: s.bytes, contentType: s.type } : { status: 404, body: '' }, () => ({ status: 404, body: '' }))
    }
    return { status: 404, body: '' }
  }

  // The app polls this while the mic is on, instead of the whole state.
  if (method === 'GET' && u.pathname === '/hub/voice') {
    if (!hub.isToken(sent)) return { status: 403, body: '' }
    const s = hub.get()
    return { status: 200, body: JSON.stringify({ voice: s.voice ?? null, level: hub.voiceLevel, heard: s.heard ?? null }), contentType: 'application/json' }
  }

  if (method === 'GET' && u.pathname === '/hub/state') {
    if (!hub.isToken(sent)) return { status: 403, body: '' }
    hub.stateReadAt = Date.now()
    return { status: 200, body: JSON.stringify({ ...hub.get(), phoneUrls: null, thisWindow: undefined, devices: undefined }), contentType: 'application/json' }
  }

  if (method === 'POST' && u.pathname === '/hub/command') {
    if (!hub.isToken(sent)) return { status: 403, body: '' }
    touch()
    if (!hub.runner) return { status: 503, body: '' }
    let c: unknown
    try { c = JSON.parse(body) } catch { return { status: 400, body: '' } }
    const problem = commandProblem(c)
    if (problem) return { status: 400, body: problem }
    try {
      const r = hub.runner(c as { type: string })
      return r instanceof Promise ? r.then(ranReply, err => ({ status: 500, body: (err as Error).message })) : ranReply(r)
    } catch (err) {
      return { status: 500, body: (err as Error).message }
    }
  }

  if (u.pathname === '/hub/question' || u.pathname === '/hub/question/done') {
    if (!hub.isToken(sent)) return { status: 403, body: '' }
    const id = u.searchParams.get('id') ?? ''
    if (method === 'POST' && u.pathname === '/hub/question') {
      let b: unknown
      try { b = JSON.parse(body) } catch { return { status: 400, body: '' } }
      const ask = obj(b) && typeof b.id === 'string' && /^[0-9a-f]{32}$/.test(b.id) && typeof b.sessionId === 'string' ? questionAsk(b.id, b) : undefined
      if (!ask || !obj(b)) return { status: 400, body: '' }
      // sub: the lead's own calls leave it, like a subagent's prompt.
      const hubAsk = { ...ask, tool: 'ask', via: 'hub' as const, sub: true as const }
      openQuestion(hubAsk.id, b.sessionId as string, hubAsk)
      hub.asked(b.sessionId as string, hubAsk)
      // Phone mode: whichever answers first, the call or the terminal, wins.
      if (hub.get().controls.switchboard.phone) void phoneAsk(hubAsk, hub.get().chats.find(c => c.sessionId === b.sessionId)?.name ?? 'a chat').then(c => { if (c) answerQuestion(hubAsk.id, c) })
      return { status: 204, body: '' }
    }
    if (method === 'GET' && u.pathname === '/hub/question') {
      const q = questionOf(id)
      if (!q) return { status: 410, body: '' }
      // Only an unanswered one goes back on the card; one handed over leaves it.
      if (!q.choice) hub.asked(q.sessionId, q.ask)
      return waitQuestion(id, 25_000)!.then(choice => {
        if (!choice) return { status: 204, body: '' }
        hub.answered(q.sessionId, id)
        return { status: 200, body: JSON.stringify({ choice }), contentType: 'application/json' }
      })
    }
    if (method === 'POST' && u.pathname === '/hub/question/done') {
      const sessionId = closeQuestion(id)
      if (sessionId) hub.answered(sessionId, id)
      return { status: 204, body: '' }
    }
  }

  if (method === 'POST' && u.pathname === '/hub/tool-on') {
    if (!hub.isToken(sent)) return { status: 403, body: '' }
    let b: unknown
    try { b = JSON.parse(body) } catch { return { status: 400, body: '' } }
    if (!obj(b) || typeof b.session !== 'string' || typeof b.name !== 'string' || !b.name.trim() || b.name.length > 200) return { status: 400, body: 'session and name only' }
    return toolOn(hub, b.session, b.name).then(text, err => ({ status: 400, body: (err as Error).message }))
  }

  if (method === 'POST' && u.pathname === '/hub/sweep') {
    if (!hub.isToken(sent)) return { status: 403, body: '' }
    if (!hub.sweep) return { status: 503, body: '' }
    let b: unknown
    try { b = JSON.parse(body) } catch { return { status: 400, body: '' } }
    // A chat may rescan, never approve its own gate.
    if (obj(b) && 'approve' in b) return { status: 400, body: 'approve is Kenneth\'s, in Switchboard; this only rescans' }
    if (!obj(b) || Object.keys(b).some(k => k !== 'name') || (b.name !== undefined && (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 200))) return { status: 400, body: 'name only' }
    return hub.sweep(b.name as string | undefined).then(text, err => ({ status: 400, body: (err as Error).message }))
  }

  if (method === 'POST' && u.pathname === '/hub/todo') {
    if (!hub.isToken(sent)) return { status: 403, body: '' }
    let b: unknown
    try { b = JSON.parse(body) } catch { return { status: 400, body: '' } }
    const field = (v: unknown) => v === undefined || (typeof v === 'string' && v.length <= 2000)
    if (!obj(b) || (b.op !== 'add' && b.op !== 'done') || typeof b.cwd !== 'string' || !b.cwd || !['text', 'id', 'before', 'session'].every(k => field(b[k]))) return { status: 400, body: 'op, cwd and string fields only' }
    const c = Object.fromEntries(['op', 'cwd', 'text', 'id', 'before', 'session'].filter(k => b[k] !== undefined).map(k => [k, b[k]])) as TodoCall & { cwd: string }
    return todo(c).then(text, err => ({ status: 400, body: (err as Error).message }))
  }

  // The discussion runs here so the ask server and the Discuss button share it.
  if (method === 'POST' && u.pathname === '/hub/discuss') {
    if (!hub.isToken(sent)) return { status: 403, body: '' }
    let b: unknown
    try { b = JSON.parse(body) } catch { return { status: 400, body: '' } }
    const ai = (v: unknown) => v === 'claude' || v === 'codex'
    if (!obj(b) || typeof b.question !== 'string' || !b.question.trim() || b.question.length > 4000 || typeof b.cwd !== 'string' || !b.cwd
      || !ai(b.from) || (b.with !== undefined && !ai(b.with)) || (b.rounds !== undefined && typeof b.rounds !== 'number')
      || (b.context !== undefined && (typeof b.context !== 'string' || b.context.length > 8000))) return { status: 400, body: 'question, cwd, from (claude or codex), optional with, rounds, context' }
    const input = { question: b.question, cwd: b.cwd, from: b.from as Ai, with: b.with as Ai | undefined, rounds: b.rounds as number | undefined, context: b.context as string | undefined }
    return discuss(input, cli).then(r => ({ status: 200, body: JSON.stringify(r), contentType: 'application/json' }), err => ({ status: 500, body: (err as Error).message }))
  }

  if (method === 'POST' && u.pathname === '/hub/device') {
    if (!hub.isToken(sent)) return { status: 403, body: '' }
    let d: unknown
    try { d = JSON.parse(body) } catch { return { status: 400, body: '' } }
    if (!deviceShape(d)) return { status: 400, body: '' }
    if (!hub.onDevice) return { status: 503, body: '' }
    hub.onDevice(d)
    return { status: 204, body: '' }
  }

  return { status: 404, body: '' }
}

/** POST /hub/upload, kept apart from handleHub so the body streams to disk instead of being read into a string. */
export async function handleUpload(hub: HubService, url: string | undefined, body: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, save = saveUpload, token?: string): Promise<HubReply> {
  const u = new URL(url ?? '/', 'http://127.0.0.1')
  const sent = tokenOf(u, token)
  if (!hub.isToken(sent)) return { status: 403, body: '' }
  const cwd = u.searchParams.get('cwd') ?? '', name = u.searchParams.get('name') ?? ''
  if (!cwd || !name) return { status: 400, body: 'cwd and name are needed' }
  const session = u.searchParams.get('session') ?? undefined
  try {
    const path = await save({ cwd, name, chat: chatLabel(hub.get().chats, session) }, body)
    return { status: 200, body: JSON.stringify({ path }), contentType: 'application/json' }
  } catch (err) {
    return { status: err instanceof UploadRefused ? err.status : 500, body: (err as Error).message }
  }
}

const CLIP_MAX = 5 * 1024 * 1024
/** POST /hub/voice, apart from handleHub since the body is binary. */
export async function handleVoice(hub: HubService, url: string | undefined, type: string | undefined, body: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, token?: string): Promise<HubReply> {
  const sent = tokenOf(new URL(url ?? '/', 'http://127.0.0.1'), token)
  if (!hub.isToken(sent)) return { status: 403, body: '' }
  if (!isClipType(type)) return { status: 415, body: 'Send an audio clip (webm, mp4, ogg, wav, m4a, aac or mpeg).' }
  const parts: Uint8Array[] = []
  let size = 0
  for await (const c of body) {
    size += c.length
    if (size > CLIP_MAX) return { status: 413, body: 'The clip is over 5 MB.' }
    parts.push(c)
  }
  if (!hub.voiceClip) return { status: 503, body: 'Voice is not running in this window.' }
  try {
    return json({ text: await hub.voiceClip(Buffer.concat(parts)) })
  } catch (err) {
    return { status: 500, body: (err as Error).message, contentType: 'text/plain; charset=utf-8' }
  }
}

// Short strings only: they end up in a VS Code prompt.
const short = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 64
function deviceShape(d: unknown): d is Parameters<NonNullable<HubService['onDevice']>>[0] {
  if (!obj(d) || typeof d.id !== 'string' || !/^[0-9a-f]{32}$/.test(d.id)) return false
  if ('done' in d) return d.done === true
  return short(d.ip) && short(d.ua) && (d.network === 'Wi-Fi' || d.network === 'Tailscale') && Number.isInteger(d.port) && (d.port as number) > 0 && (d.port as number) < 65536
}
