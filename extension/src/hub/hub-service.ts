/**
 * Holds the Hub tab's state and each chat's inbox.
 *
 * Feed posts from the usage mods come through ingest(); what the extension gathers itself comes through set(). Every
 * change fires onChange, which extension.ts throttles into `hub-state`.
 */
import { onMidTurn } from './idle'
import { approvalBlock, closingAnswer, closingPick, stampedChats } from './approve'
import { isTempDir } from './temp'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { TypedEventEmitter } from '../typed-event-emitter'
import { addAsk, dropAsk, finishedJobs, LIMITS, settle, step, TOOLS_MAX } from './progress'
import { chainVersion } from './projects'
import { endedOnLimit, limitReset, pauseDue, resumeOrder } from './limit-pause'
import { phonePause } from './phone'
import { fixDue, snoozed, waitsOnUser, type OwnedStuck } from './stuck'
import { FLAGGED } from './tools'
import { createLogger } from '../logger'
import { recordSentBack } from './chains'
import { foldPathCase, saveMerged } from '../fs-utils'
import { writeJsonAtomic } from '../hook-entries'
import { MirofishPoller } from './mirofish'
import { crowdLive, dismissCrowd } from './crowd-live'
import { sourceChecks } from './source-check'
import type { AiId, Ask, CacheKeep, ChatLink, ChatUnlink, ChatProgress, ChatRow, ChatState, DeviceAsk, HandoffWait, HubState, InboxDraft, InboxItem, JevRun, KeptLimits, Limit, LimitPause, Server, SessionLive, StuckItem } from './types'
import { isTabCommand } from './window-tabs'
import { lastTurn, missedHook, turnOver, type LastTurn } from './true-state'
import { transcriptOf } from './sessions'

const log = createLogger('Hub')

const LIVE_STALE_MS = 10 * 60 * 1000
// A chat's progress row goes on SessionEnd, or after a day with no hook from it.
const PROGRESS_STALE_MS = 24 * 60 * 60 * 1000
const MAX_INBOX = 20
// A chat's mod polls its inbox every 2 seconds; quiet longer than this, a message would sit unread.
/** The folder a session ran in: the first cwd in its transcript, wherever under the projects folder it sits. */
export function cwdFromTranscript(projects: string, sessionId: string): string | undefined {
  if (!/^[\w-]+$/.test(sessionId)) return undefined
  try {
    for (const d of fs.readdirSync(projects)) {
      const file = path.join(projects, d, `${sessionId}.jsonl`)
      if (!fs.existsSync(file)) continue
      const fd = fs.openSync(file, 'r')
      try {
        const buf = Buffer.alloc(65_536)
        for (const line of buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, 0)).split('\n')) {
          const cwd = (() => { try { return (JSON.parse(line) as { cwd?: unknown }).cwd } catch { return undefined } })()
          if (typeof cwd === 'string' && cwd) return cwd
        }
      } finally { fs.closeSync(fd) }
    }
  } catch { /* no transcripts */ }
  return undefined
}

const PENDING_CLOSE_MS = 30 * 60_000
const POLL_GONE_MS = 10_000
// A stopped dev server stays a suggestion this long, or until it is back.
const GONE_MS = 10 * 60 * 1000
// A handoff or close waits on running subagents this long at most; a lost SubagentStop must not keep a full chat forever.
export const WAIT_CAP_MS = 30 * 60 * 1000
// Past this share of the compaction point a held handoff goes anyway, or the auto compaction wins.
const COMPACT_SOON = 0.97
const MAX_JEV = 50
// A jev.py call this recent in a chat is the run the usage mod reports.
const JEV_MATCH_MS = 10 * 60 * 1000
// brain.ts GUARD_MS: an auto link lasts while the target's edit would still be guarded, and 15 minutes at most.
const EDIT_FRESH_MS = 10 * 60 * 1000
const AUTO_LINK_MS = 15 * 60 * 1000
// Kenneth's unlink stays readable this long, so the waiting chat's mod tells it from a link that just went missing.
const UNLINK_MS = 5 * 60 * 1000
// A waiter with no row and no live entry: a reload for this long, from the link or the load, else it closed.
const NO_ROW_MS = 2 * 60 * 1000
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x))
const idList = (v: unknown) => (Array.isArray(v) && v.length && v.length <= 20 && v.every(x => typeof x === 'string' && x) ? [...new Set(v as string[])] : undefined)
// Past cache-keeper's 3h idle cap plus a cache lifetime: a chat that quiet is long cold.
const CACHE_KEPT_MS = 4 * 60 * 60 * 1000
// A limited chat is told to carry on a minute after its reset, or every half hour when none is known.
const RETRY_MS = 30 * 60 * 1000
// The last 64 KB of a transcript, enough for its final entries; empty when unreadable.
const tailOf = (file: unknown): string => {
  if (typeof file !== 'string') return ''
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size, n = Math.min(size, 65_536), b = Buffer.alloc(n)
    fs.readSync(fd, b, 0, n, size - n)
    return b.toString('utf8')
  } catch { return '' } finally { if (fd !== undefined) fs.closeSync(fd) }
}
// SessionEnd reasons that mean the user ended it, not the limit.
const QUITS = new Set(['clear', 'logout', 'prompt_input_exit'])
export const CONTINUE = 'Switchboard: the usage limit reset. Continue where you left off; if you need the user, ask with AskUserQuestion.'
type CutAgent = { id: string; type?: string }
export const PAUSE_CONTINUE = 'Usage limit reset. Continue where you stopped; resume any subagents cut off with SendMessage.'
const agentsNote = (agents: CutAgent[]) =>
  `Subagents cut off by the limit: ${agents.map(a => a.type ? `${a.id} (${a.type})` : a.id).join(', ')}. Before starting new work, resume each with SendMessage to its agent id; it keeps its full history.`
/** The prompt after a pause near the limit, naming any subagents it cut off. */
export const pauseText = (agents?: CutAgent[]) => agents?.length ? `${PAUSE_CONTINUE} ${agentsNote(agents)}` : PAUSE_CONTINUE
/** The continue prompt, naming any subagents the limit cut off. */
export const continueText = (agents?: CutAgent[]) => agents?.length ? `${CONTINUE} ${agentsNote(agents)}` : CONTINUE
// Subagents still running when the lead hit the limit; StopFailure keeps their roles active.
const cutAgents = (p?: ChatProgress): { agents?: CutAgent[] } => {
  const agents = (p?.running ?? []).map(id => { const type = p!.roles.find(r => r.id === id)?.role; return type ? { id, type } : { id } })
  return agents.length ? { agents } : {}
}

export const emptyHub = (): HubState => ({
  live: [], history: [], sessions: [], plan: null,
  servers: [], git: null, aws: [], signIns: { chrome: [], projects: {} }, jev: [], waits: [], installed: [], connections: [], rc: { atStartup: false },
  keep: { autoCompact: true, autoContinue: false, onFull: 'fresh', freshBranch: false },
  projects: [],
  controls: {
    claude: { tui: 'default', statusLine: false, push: false, needInput: false },
    switchboard: { hooks: false, statusBar: true, idleMinutes: 15, brief: true, askBrain: true, syncRules: true, accessNote: true, autoStart: true, autoFix: true, name: '', pauseAt: 99 },
    statusLineReady: false,
  },
  chats: [], rcServers: [], ais: [], starred: [], progress: [], archive: [],
  changes: null, search: null, webUrl: null, phoneUrls: null,
  tools: { flagged: FLAGGED, pick: null, chats: {} },
})

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

/** A full chat handing over to a fresh one: its note, written by the usage feed (or by hub-panel.ts for Codex). */
export type Handoff = { sessionId: string; cwd: string; note: string; branch?: string; task?: string; name?: string; plan?: string; ai?: AiId; /** Subagents still running when the wait cap let it go: `<role> <id>`. */ running?: string[] }
// The feed writes notes only here; anything else is refused before a terminal reads it.
const HANDOFFS = `${os.homedir().replace(/\\/g, '/')}/.claude/handoffs/`
// Forward slashes, no trailing slash, case folded on Windows.
const pathKey = (p: string) => foldPathCase(p.replace(/\\/g, '/').replace(/\/+$/, ''))
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

// resetsAt may arrive as epoch s or ms; kept as a string, the web parses all three.
const resetOf = (v: unknown) => str(v) ?? (num(v) === undefined ? undefined : String(v))
// Same rule as web/lib/limits.ts resetAt: digits under 1e12 are seconds.
export const resetMs = (v = '') => {
  if (!/^\d+(\.\d+)?$/.test(v.trim())) return Date.parse(v)
  const n = Number(v)
  return n < 1e12 ? n * 1000 : n
}
// Codex windows feed the meter only; they never pause chats or reach limits.json.
const isClaudeLimit = (l: Limit) => !l.kind.startsWith('codex_')
const limitsOf = (v: unknown): Limit[] =>
  Array.isArray(v)
    ? v.flatMap(l => (l && typeof l === 'object' && str((l as Limit).kind) && num((l as Limit).percentUsed) !== undefined
      ? [{ kind: (l as Limit).kind, percentUsed: (l as Limit).percentUsed, resetsAt: resetOf((l as Limit).resetsAt) }] : []))
    : []

export class HubService {
  /** Shared with the usage mods through the window's discovery file. */
  readonly token = crypto.randomBytes(16).toString('hex')
  private state: HubState = emptyHub()
  private readonly inboxes = new Map<string, InboxItem[]>()
  private readonly polled = new Map<string, number>()
  // When each limited chat gets its continue prompt, and its folder for a resume; kept in retriesFile so a window reload still sends it.
  private readonly retries = new Map<string, { due: number; cwd?: string; agents?: CutAgent[]; paused?: boolean; at?: number }>()
  private limitsFile?: string
  private codexFile?: string
  // A pause ended by hand: no new one until this reset passes.
  private pauseOff = -Infinity
  private readonly changed = new TypedEventEmitter<HubState>()
  readonly onChange = this.changed.event
  private readonly handoffs = new TypedEventEmitter<Handoff>()
  readonly onHandoff = this.handoffs.event
  private gone: { server: Server; at: number }[] = []
  // A chat that handed off: closed once a new chat posts from the same folder.
  private pendingClose: { sessionId: string; cwd: string; at: number }[] = []
  // Old chats whose fresh chat has posted, closed once no subagent of theirs runs.
  private closing: { sessionId: string; at: number }[] = []
  private readonly closeAtStop = new Set<string>()
  // A prompt answered from Switchboard, by chat: the tap marks the chat working before its PostToolUse lands.
  private readonly answeredHere = new Map<string, string>()
  /** When this window started: a closing answer from before is never read back from a transcript. */
  private readonly since = Date.now()
  // Closing answers already handled, by tool_use_id, and each chat's transcript size when it was last read for one.
  private readonly closings = new Set<string>()
  private readonly closingRead = new Map<string, number>()
  /** Refused Approves, one JSON line each, so the reason survives a reload. Set by keepRetries; none: not kept. */
  approveLog?: string
  // Handoffs held while the full chat still has subagents running.
  private waiting: { h: Handoff; since: number }[] = []
  // Chats Kenneth handed off by hand: no waiting on subagents.
  private readonly forced = new Set<string>()
  // When each chat last ran jev.py, from its own Bash hook.
  private readonly jevAsked = new Map<string, number>()
  private mirofish?: MirofishPoller
  private codexWaits: HandoffWait[] = []
  private readonly closeFailed = new TypedEventEmitter<string>()
  readonly onCloseFailed = this.closeFailed.event
  private readonly closingChat = new TypedEventEmitter<string>()
  /** A handed-off chat was told to exit; hub-panel.ts closes its terminal once it has. */
  readonly onClosing = this.closingChat.event
  private readonly approvedChat = new TypedEventEmitter<string>()
  /** The chat's own closing AskUserQuestion came back Approve; the owning window approves it. */
  readonly onApproved = this.approvedChat.event
  private readonly devAsked = new TypedEventEmitter<{ kind: 'start' | 'stop'; folder: string }>()
  /** Another window passed on a Dev start or stop; hub-panel.ts checks the folder and acts. */
  readonly onDev = this.devAsked.event
  private readonly tabAsked = new TypedEventEmitter<string>()
  /** A tab command another window posted; routes.ts let only isTabCommand ones through. */
  readonly onTab = this.tabAsked.event
  private readonly missedHook = new TypedEventEmitter<{ payload: Record<string, unknown>; mirror: boolean }>()
  /** A hook this window missed, made up by trueUp; claude-runtime.ts takes it as if it had come. */
  readonly onMissed = this.missedHook.event
  private readonly openedChat = new TypedEventEmitter<string>()
  /** A chat opened on a Switchboard page: the window holding its terminal shows it. */
  readonly onOpened = this.openedChat.event
  private readonly promptedChat = new TypedEventEmitter<string>()
  private readonly endedChat = new TypedEventEmitter<ChatProgress>()
  /** A chat this window owns ended (SessionEnd), with its last progress; never one that handed off to a fresh chat. */
  readonly onEnded = this.endedChat.event
  // Chats that handed off; their open tasks carry over to the fresh chat.
  private readonly handedOff = new Set<string>()
  /** A chat took a message sent from Switchboard; the window holding its terminal shows it. */
  readonly onPrompted = this.promptedChat.event
  private readonly indefiniteEnded = new TypedEventEmitter<{ sessionId: string; usage?: string; reason?: string }>()
  /** The mod saw `Run indefinitely: done` in a chat's last answer. */
  readonly onIndefiniteDone = this.indefiniteEnded.event
  /** handleHubMessage, set by startHub; kept as a field so routes.ts needs no vscode. A string is why it was refused. */
  runner?: (c: { type: string }) => boolean | string | Promise<boolean | string>
  /** The sweep tool: rescan name, or start Sweep all without one; answers a line. Never approves. hub-panel.ts sets it. */
  sweep?: (name: string | undefined) => Promise<string>
  /** Whether this window holds the chat's terminal; hub-panel.ts sets it. */
  holds?: (sessionId: string) => Promise<boolean>
  /** A device asking in (or its end, done), from the standalone app; set by startHub. */
  onDevice?: (d: DeviceAsk & { port: number } | { id: string; done: true }) => void
  /** When the standalone app last read /hub/state; hub-panel.ts keeps chats fresh while it is recent. */
  stateReadAt = 0
  /** A phone's clip to text, for POST /hub/voice; hub-panel.ts sets it. */
  voiceClip?: (bytes: Uint8Array) => Promise<string>
  /** The mic's last level, 0..1, for GET /hub/voice. */
  voiceLevel = 0
  // Everything the last sample found, before snoozes; the dismissed ids and when; the ids already notified.
  private stuckAll: StuckItem[] = []
  private readonly snoozes = new Map<string, number>()
  private readonly told = new Set<string>()
  private readonly fixed = new Set<string>()
  /** Chats told they are paused, until they stop waiting. */
  private readonly paused = new Set<string>()
  // Chats whose hooks come here first, not as a mirror: this window notifies for them.
  private readonly owned = new Set<string>()

  private retriesFile?: string
  // The retry keys at this window's last load or save, so a save drops its own removals and another window's.
  private readonly retryKeys = new Set<string>()
  private linksFile?: string
  private keptLinks: unknown[] = []
  private linksAt = 0
  /** One file per workspace, so only this window's own chats load back and no other window sends them. None: memory only. */
  keepRetries(file: string, projects = path.join(os.homedir(), '.claude', 'projects')): void {
    this.retriesFile = file
    try {
      // One overdue by more than a day is for a chat that ended while no window listened.
      // One from an older window (a bare due time, no folder) cannot be resumed, and would hold auto-start: dropped.
      for (const [id, v] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>)) {
        this.retryKeys.add(id)
        const r = (v ?? {}) as { due?: unknown; cwd?: unknown; agents?: unknown; paused?: unknown; at?: unknown }
        const agents = Array.isArray(r.agents) ? (r.agents as CutAgent[]).filter(a => typeof a?.id === 'string') : []
        // A retry saved with no folder gets it from the chat's transcript; with none found it is dropped, and the chat's History row has Resume.
        const cwd = typeof r.cwd === 'string' ? r.cwd : cwdFromTranscript(projects, id)
        if (typeof r.due === 'number' && cwd && Date.now() - r.due < PROGRESS_STALE_MS) this.retries.set(id, { due: r.due, cwd, ...(agents.length ? { agents } : {}), ...(r.paused === true ? { paused: true, at: num(r.at) ?? r.due } : {}) })
      }
    } catch { /* none yet, or broken: start empty */ }
    // Links and Kenneth's unlinks beside it, so a reload does not read as an unlink to a waiting chat.
    this.linksFile = path.join(path.dirname(file), `links-${path.basename(file).replace(/^retries-/, '')}`)
    try {
      const k = JSON.parse(fs.readFileSync(this.linksFile, 'utf8')) as { links?: unknown; unlinks?: unknown }
      const links = Array.isArray(k.links) ? (k.links as ChatLink[]).filter(l => typeof l?.from === 'string' && Array.isArray(l.to) && typeof l.since === 'number') : []
      const unlinks = Array.isArray(k.unlinks) ? (k.unlinks as ChatUnlink[]).filter(u => typeof u?.from === 'string' && typeof u.to === 'string' && typeof u.at === 'number') : []
      this.state = { ...this.state, links, unlinks }
      this.keptLinks = [this.state.links, this.state.unlinks]
    } catch { /* none yet */ }
    this.linksAt = Date.now()
    // limits.json sits beside it, shared by every window.
    this.limitsFile = path.join(path.dirname(file), 'limits.json')
    // Codex limits are account-wide: kept apart from limits.json so they never reach a pause.
    this.codexFile = path.join(path.dirname(file), 'codex-limits.json')
    try { this.state = { ...this.state, codexKept: limitsOf(JSON.parse(fs.readFileSync(this.codexFile, 'utf8')).windows).filter(l => !isClaudeLimit(l)) } } catch { /* none yet */ }
    this.approveLog = path.join(path.dirname(file), 'approve.log')
    try {
      const k = JSON.parse(fs.readFileSync(this.limitsFile, 'utf8')) as { at?: unknown; windows?: unknown; out?: KeptLimits['out']; pause?: LimitPause }
      if (typeof k.at === 'number') this.state = { ...this.state, limitsKept: { at: k.at, windows: limitsOf(k.windows), ...(k.out ? { out: k.out } : {}) } }
      if (k.pause && Array.isArray(k.pause.chats)) this.state = { ...this.state, pause: k.pause }
    } catch { /* none yet */ }
    this.syncOff()
  }

  /** Another window (or this one before a reload) may have resumed: take the newest pauseOff on disk, and drop a pause it ended. */
  private syncOff(): void {
    if (!this.limitsFile) return
    let k: { pauseOff?: unknown; paused?: unknown } = {}
    try { k = JSON.parse(fs.readFileSync(this.limitsFile, 'utf8')) } catch { return }
    const off = num(k.pauseOff)
    if (off === undefined) return
    const news = off > this.pauseOff
    this.pauseOff = Math.max(this.pauseOff, off)
    const p = this.state.pause
    if (!p || !((news && k.paused !== true) || (p.resumeAt ?? Infinity) <= this.pauseOff)) return
    // Ended elsewhere: this window's held chats go on now, same as a resume here.
    const now = Date.now()
    for (const r of this.retries.values()) if (r.paused) r.due = Math.min(r.due, now)
    this.saveRetries()
    this.state = { ...this.state, pause: undefined }
  }

  private saveLimits(): void {
    const k = this.state.limitsKept
    if (!this.limitsFile) return
    this.syncOff()
    // paused: the usage-meter mod reads this and holds every tool call. pauseAt (null off) and pauseOff (resumed by hand up to then) let it hold on its own. phone: the phone-mode mod denies AskUserQuestion for a call.
    const pauseAt = this.state.controls.switchboard.pauseAt === undefined ? 99 : this.state.controls.switchboard.pauseAt
    const off = Number.isFinite(this.pauseOff) ? { pauseOff: this.pauseOff } : {}
    try { writeJsonAtomic(this.limitsFile, { ...k, pauseAt, phone: this.state.controls.switchboard.phone === true, ...off, ...(this.state.pause ? { pause: this.state.pause, paused: true } : {}) }) } catch (err) { log.warn('Limits not kept:', err) }
  }

  /** A chat's own usage hold from the mod: it joins the pause the panel shows, or leaves it. */
  private noteHold(sessionId: string, hold: unknown, now: number): void {
    const p = this.state.pause
    const rest = (p?.chats ?? []).filter(c => c.sessionId !== sessionId)
    const o = hold && typeof hold === 'object' ? (hold as Record<string, unknown>) : undefined
    if (o) {
      this.syncOff()
      // Resumed by hand up to then: a late hold from the mod must not pause again.
      if ((num(o.resetsAt) ?? Infinity) <= this.pauseOff) return
      const name = this.state.chats.find(c => c.sessionId === sessionId)?.name
      // Same minute of grace as startPause, so both paths claim one phone key.
      const reset = num(o.resetsAt), resumeAt = p?.resumeAt ?? (reset === undefined ? undefined : reset + 60_000)
      this.state = { ...this.state, pause: { kind: p?.kind ?? str(o.kind) ?? 'usage', percent: p?.percent ?? Math.floor(num(o.percent) ?? 99), ...(resumeAt !== undefined ? { resumeAt } : {}), chats: [...rest, { sessionId, ...(name ? { name } : {}) }] } }
      if (!p) this.ringPause(false)
    } else if (p?.chats.some(c => c.sessionId === sessionId)) this.state = { ...this.state, pause: rest.length && (p.resumeAt ?? Infinity) > now ? { ...p, chats: rest } : undefined }
    else return
    this.saveLimits()
  }

  /** A feed's codex windows replace the kept ones of the same kind; meter only, never read by a pause. */
  noteCodex(live: Limit[]): void {
    const fed = live.filter(l => !isClaudeLimit(l))
    if (!fed.length) return
    const codexKept = [...(this.state.codexKept ?? []).filter(k => !fed.some(l => l.kind === k.kind)), ...fed]
    if (JSON.stringify(codexKept) === JSON.stringify(this.state.codexKept)) return
    this.state = { ...this.state, codexKept }
    if (this.codexFile) try { writeJsonAtomic(this.codexFile, { windows: codexKept }) } catch (err) { log.warn('Codex limits not kept:', err) }
  }

  noteCodexAccount(account: { windows: Limit[]; daily: { day: string; tokens: number }[]; resets?: number }): void {
    this.noteCodex(account.windows)
    this.set({ codexDaily: account.daily, ...(account.resets === undefined ? {} : { codexResets: account.resets }) })
  }

  /** After a feed: keeps the highest % per window, and pauses this window's running chats at the threshold. */
  private noteLimits(now: number): void {
    const best = new Map<string, Limit>()
    for (const l of this.state.live.flatMap(s => s.limits).filter(isClaudeLimit)) {
      const b = best.get(l.kind)
      if (!b || resetMs(l.resetsAt) > resetMs(b.resetsAt) + 5 * 60_000 || (l.percentUsed > b.percentUsed && !(resetMs(b.resetsAt) > resetMs(l.resetsAt) + 5 * 60_000))) best.set(l.kind, l)
    }
    if (!best.size) return
    const was = this.state.limitsKept
    const windows = [...best.values()]
    // A feed below 100% after the reset ends the out state.
    const out = was?.out && (was.out.resetsAt ?? Infinity) > now && !windows.every(w => w.percentUsed < 100 && resetMs(w.resetsAt) > (was.out!.resetsAt ?? 0)) ? { out: was.out } : {}
    const kept: KeptLimits = { at: now, windows, ...out }
    const changed = JSON.stringify({ ...kept, at: 0 }) !== JSON.stringify({ ...was, at: 0 })
    this.state = { ...this.state, limitsKept: kept }
    this.syncOff()
    const due = !this.state.pause && pauseDue(windows, this.state.controls.switchboard.pauseAt === undefined ? 99 : this.state.controls.switchboard.pauseAt, resetMs, now)
    if (due && (due.resetsAt ?? Infinity) > this.pauseOff) this.startPause(due, now)
    else if (changed || now - (was?.at ?? 0) > 60_000) this.saveLimits()
  }

  private startPause(due: { kind: string; percent: number; resetsAt?: number }, now: number): void {
    const resumeAt = (due.resetsAt ?? now + RETRY_MS) + 60_000
    // Every live chat this window owns; subagents run inside them and get named on resume.
    const chats = this.state.chats.filter(c => c.live && c.ai !== 'codex' && this.owned.has(c.sessionId))
    for (const c of chats) this.retries.set(c.sessionId, { due: resumeAt, cwd: c.cwd, ...cutAgents(this.state.progress.find(p => p.sessionId === c.sessionId)), paused: true, at: now })
    this.saveRetries()
    this.state = { ...this.state, pause: { kind: due.kind, percent: Math.floor(due.percent), resumeAt, chats: chats.map(c => ({ sessionId: c.sessionId, ...(c.name ? { name: c.name } : {}) })) } }
    log.info(`Usage at ${Math.floor(due.percent)}%: paused ${chats.length} chat(s) until ${new Date(resumeAt).toISOString()}`)
    this.saveLimits()
    this.ringPause(false)
  }

  /** The phone notice for the pause, once per machine: every window runs the same pause. */
  private ringPause(resumed: boolean): void {
    if (this.state.pause && this.state.controls.switchboard.phone) phonePause(this.state.pause, resumed, this.limitsFile && path.dirname(this.limitsFile))
  }

  /** Paused chats in resume order. */
  pausedQueue(): { sessionId: string; cwd: string; agents?: CutAgent[] }[] {
    return resumeOrder([...this.retries].filter(([, r]) => r.paused && r.cwd).map(([sessionId, r]) => ({ sessionId, cwd: r.cwd!, at: r.at ?? r.due, ...(r.agents ? { agents: r.agents } : {}) })))
  }

  /** Resume now (true) or cancel: either way the pause lifts and stays off until this reset. */
  endPause(resume: boolean, now = Date.now()): void {
    if (resume) this.ringPause(true)
    this.pauseOff = this.state.pause?.resumeAt ?? now
    for (const [id, r] of this.retries) if (r.paused) { if (resume) r.due = now; else this.retries.delete(id) }
    this.saveRetries()
    this.state = { ...this.state, pause: undefined }
    this.saveLimits()
    this.emit(now)
  }

  /** Lifts the pause once its reset passed; the retries send the prompts. */
  pauseTick(now = Date.now()): void {
    if (this.state.pause && now >= (this.state.pause.resumeAt ?? Infinity)) { this.ringPause(true); this.pauseOff = this.state.pause.resumeAt!; this.state = { ...this.state, pause: undefined }; this.saveLimits(); this.emit(now) }
  }

  private saveLinks(): void {
    if (!this.linksFile || (this.keptLinks[0] === this.state.links && this.keptLinks[1] === this.state.unlinks)) return
    this.keptLinks = [this.state.links, this.state.unlinks]
    try { writeJsonAtomic(this.linksFile, { links: this.state.links ?? [], unlinks: this.state.unlinks ?? [] }) } catch (err) { log.warn('Links not kept:', err) }
  }

  private saveRetries(): void {
    if (!this.retriesFile) return
    try { for (const id of saveMerged(this.retriesFile, Object.fromEntries(this.retries), this.retryKeys)) this.retries.delete(id) } catch (err) { log.warn('Retries not kept:', err) }
  }

  get(): HubState {
    return this.state
  }

  startMirofish(translate?: (text: string) => Promise<string>): void {
    if (this.mirofish) return
    this.mirofish = new MirofishPoller({ translate })
    const poller = this.mirofish
    poller.start(mirofish => this.set({ mirofish, mirofishReports: poller.reports() }))
  }

  /** Hides a stalled MiroFish sim or a stopped crowd-ab run from the Live page. */
  dismissLive(kind: 'mirofish' | 'crowd', id: string): void {
    if (kind === 'mirofish') { this.mirofish?.dismiss(id); this.set({ mirofish: undefined }) } else { dismissCrowd(id); this.set({ crowdAb: undefined }) }
  }

  stopMirofish(): void {
    this.mirofish?.dispose()
    this.mirofish = undefined
    if (this.crowd) clearInterval(this.crowd)
    this.crowd = undefined
    if (this.sources) clearInterval(this.sources)
    this.sources = undefined
  }

  // crowd-ab runs take a minute or two, so the card reads Jev's run files every 2s and only pushes a change.
  private crowd?: ReturnType<typeof setInterval>
  startCrowd(read = () => crowdLive()): void {
    if (this.crowd) return
    let last = ''
    const tick = () => {
      let next
      try { next = read() } catch { return }
      const key = JSON.stringify(next ?? null)
      if (key !== last) { last = key; this.set({ crowdAb: next }) }
    }
    tick()
    this.crowd = setInterval(tick, 2000)
    this.startSourceChecks()
  }

  // Source-check runs are the CLI's --json files; they change in seconds at most, so read every 5s and push only a change.
  private sources?: ReturnType<typeof setInterval>
  startSourceChecks(read = () => sourceChecks()): void {
    if (this.sources) return
    let last = ''
    const tick = () => {
      let next
      try { next = read() } catch { return }
      const key = JSON.stringify(next ?? null)
      if (key !== last) { last = key; this.set({ sourceChecks: next }) }
    }
    tick()
    this.sources = setInterval(tick, 5000)
  }

  /** Sessions a headless learn run reported; the Flow tabs skip them too. */
  private headless = new Set<string>()
  isHeadless(id: string): boolean { return this.headless.has(id) }

  isToken(candidate: unknown): boolean {
    if (typeof candidate !== 'string') return false
    const a = Buffer.from(candidate), b = Buffer.from(this.token)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  }

  /** What the extension gathered itself (history, plan, servers, ...). */
  // doneChecks is rebuilt every 15s; drop a stamp at once when its chat moves on, so it never sits under another prompt.
  private keepStamps(s: HubState): HubState {
    if (!s.doneChecks) return s
    const keep = new Set(stampedChats(s.progress))
    return Object.keys(s.doneChecks).every(id => keep.has(id)) ? s : { ...s, doneChecks: Object.fromEntries(Object.entries(s.doneChecks).filter(([id]) => keep.has(id))) }
  }

  set(part: Partial<HubState>, now = Date.now()): void {
    if (part.servers) {
      const up = new Set(part.servers.map(s => s.port))
      const stopped = this.state.servers.filter(s => !up.has(s.port)).map(server => ({ server, at: now }))
      this.gone = [...this.gone.filter(g => !up.has(g.server.port) && now - g.at < GONE_MS), ...stopped]
    }
    // Temp-folder chats (scratchpads, bench runs) never reach lists, counts, the Board, the map or History.
    for (const k of ['chats', 'live', 'progress', 'starred', 'archive'] as const) {
      const list = part[k] as { cwd: string }[] | undefined
      if (list) part = { ...part, [k]: list.filter(c => !isTempDir(c.cwd)) }
    }
    this.state = this.keepStamps({ ...this.state, ...part })
    if (part.controls) this.saveLimits()
    this.emit(now)
  }

  /**
   * One raw hook payload; the change of state when there is one, for notify.ts. A new chat that is just working is not one.
   * A mirror (a chat another window owns) only updates progress; that window notifies.
   */
  hook(payload: Record<string, unknown>, now = Date.now(), mirror = false): { from?: ChatState; to: ChatProgress } | undefined {
    const id = typeof payload.session_id === 'string' ? payload.session_id : undefined
    // A `claude -p` from outside a project (cwd /) or a payload with no folder is no chat.
    if (!id || typeof payload.cwd !== 'string' || !payload.cwd || payload.cwd === '/' || isTempDir(payload.cwd)) return undefined
    if (payload.headless) { this.headless.add(id); return undefined }
    const was = this.state.progress.find(p => p.sessionId === id)
    if (payload.hook_event_name === 'SessionEnd') this.owned.delete(id)
    else if (!mirror) this.owned.add(id)
    const input = payload.tool_input as Record<string, unknown> | undefined
    if (payload.hook_event_name === 'PreToolUse' && payload.tool_name === 'Bash' && String(input?.command ?? '').includes('jev.py')) this.jevAsked.set(id, now)
    const next = step(was, this.withEnded(payload, was), now)
    const rest = this.state.progress.filter(p => p.sessionId !== id)
    // Only the owning window retries, or each window would send it. A limited chat that ends keeps it (goneDue resumes it),
    // unless cleared or logged out: that process goes on under a new id.
    if (payload.hook_event_name === 'StopFailure' && next?.limited && LIMITS.has(next.limited.error)) this.limitHit(`${str(payload.last_assistant_message) ?? ''} ${str(payload.error_details) ?? ''}`, now)
    if (payload.hook_event_name === 'StopFailure' && next?.limited && LIMITS.has(next.limited.error)) { if (!mirror) { this.retries.set(id, { due: this.resetAt(now), cwd: payload.cwd, ...cutAgents(next) }); this.saveRetries() } }
    else if (!next?.limited && (payload.hook_event_name !== 'SessionEnd' || payload.reason === 'clear' || payload.reason === 'logout') && this.retries.delete(id)) this.saveRetries()
    // Claude Code can exit at the limit with no StopFailure: an end whose transcript stops on the limit error queues it too.
    // A closed tab or /exit is the user's.
    if (payload.hook_event_name === 'SessionEnd' && !mirror && !this.retries.has(id) && !this.handedOff.has(id) && !QUITS.has(String(payload.reason)) && (this.state.pause || this.outNow(now)) && endedOnLimit(tailOf(payload.transcript_path))) {
      const pause = this.state.pause
      this.retries.set(id, { due: pause?.resumeAt ?? this.resetAt(now), cwd: payload.cwd, ...cutAgents(was), ...(pause ? { paused: true, at: now } : {}) })
      this.saveRetries()
    }
    this.state = this.keepStamps({ ...this.state, progress: next ? [next, ...rest] : rest })
    this.emit(now)
    if (payload.hook_event_name === 'SessionEnd' && was && !this.handedOff.delete(id) && !mirror) this.endedChat.fire(was)
    // The closing question is answered mid-turn, so approveChat cannot close it yet; it closes at this turn's Stop.
    if (payload.hook_event_name === 'SessionEnd') this.closeAtStop.delete(id)
    else if (!mirror && payload.hook_event_name === 'Stop' && (next?.state === 'done' || next?.state === 'idle' || next?.waiting) && this.closeAtStop.delete(id)) this.approvedChat.fire(id)
    const tapped = payload.hook_event_name === 'PostToolUse' && typeof payload.tool_use_id === 'string' && this.answeredHere.get(id) === payload.tool_use_id
    if (tapped || payload.hook_event_name === 'SessionEnd') this.answeredHere.delete(id)
    const pick = closingPick(payload)
    if (pick && typeof payload.tool_use_id === 'string') this.closings.add(payload.tool_use_id)
    if (pick && !mirror && this.takeClosing(id, payload, was, now, tapped)) { this.closeAtStop.add(id); this.approvedChat.fire(id) }
    return !mirror && next && next.state !== (was?.state ?? 'working') ? { from: was?.state, to: next } : undefined
  }

  /** Records the answer to a closing question; true when it approves the chat. */
  private takeClosing(id: string, payload: Record<string, unknown>, was: ChatProgress | undefined, now: number, tapped = false): boolean {
    const pick = closingPick(payload)
    // Only the lead closes its chat: a subagent's answer counts for neither.
    if (pick === 'Send back' && !payload.agent_id) try { recordSentBack(id, now, undefined, typeof payload.tool_use_id === 'string' ? payload.tool_use_id : undefined) } catch (err) { log.warn('Send back not recorded:', err) }
    if (pick !== 'Approve') return false
    // The lead's own answer proves the question was open, even if the hub missed it opening: judge the chat as it stood then.
    const why = payload.agent_id ? 'a subagent asked it' : approvalBlock(was && (tapped || typeof payload.tool_use_id === 'string') ? { ...was, state: 'needs-you' } : was, now)
    if (why) this.refusedApprove(id, why, now)
    return !why
  }

  /** A closing answer whose PostToolUse never came, read from the transcript once the turn is over. Not sent through hook(): a late call would mark the ended chat working. */
  private missedClosing(c: ChatRow, p: ChatProgress, now: number): void {
    const id = c.sessionId
    if (!this.owned.has(id) || !turnOver(p, c, now)) return
    const file = transcriptOf(c), size = fs.statSync(file, { throwIfNoEntry: false })?.size
    if (!size || this.closingRead.get(id) === size) return
    this.closingRead.set(id, size)
    const a = closingAnswer(file)
    if (!a || !(a.at >= this.since) || this.closings.has(a.id)) return
    this.closings.add(a.id)
    log.info(`Chat ${id.slice(0, 8)}: closing answer read from its transcript, its hook was missed`)
    if (this.takeClosing(id, a.payload, p, now)) this.approvedChat.fire(id)
  }

  /** Chats that Claude Code's own status says moved on while their hooks got lost. */
  trueUp(now = Date.now(), last: (c: ChatRow) => LastTurn | undefined = c => lastTurn(transcriptOf(c))): void {
    for (const c of this.state.chats) {
      // The Claude panel and a terminal on one session each have a status; a chat waiting on its reset resumes by itself.
      if (this.retries.has(c.sessionId) || this.state.chats.some(x => x !== c && x.live && x.sessionId === c.sessionId)) continue
      const p = this.state.progress.find(x => x.sessionId === c.sessionId)
      const payload = missedHook(p, c, now, () => last(c), this.answeredHere.has(c.sessionId))
      if (!payload) { if (p) this.missedClosing(c, p, now); continue }
      // Nothing known of it yet (a reload): its state only, no notices or boxes filled for a turn long over.
      if (!p) this.hook(payload, now, true)
      else this.missedHook.fire({ payload, mirror: !this.owned.has(c.sessionId) })
    }
  }

  /** The chat now open in a terminal or on a page; false when one opened later is known.
   * at: when it was opened, so posts crossing between windows end on the same chat. */
  open(sessionId: string, at = Date.now()): boolean {
    if ((this.state.openChat?.at ?? 0) > at) return false
    this.set({ openChat: { sessionId, at } })
    return true
  }

  private refusedApprove(id: string, why: string, now: number): void {
    log.warn(`Approve for chat ${id.slice(0, 8)} not taken: ${why}`)
    if (this.approveLog) try {
      fs.appendFileSync(this.approveLog, `${JSON.stringify({ at: now, sessionId: id, why })}\n`)
      // Past 8 KB keep the last 50 lines.
      if (fs.statSync(this.approveLog).size > 8192) fs.writeFileSync(this.approveLog, fs.readFileSync(this.approveLog, 'utf8').trim().split('\n').slice(-50).join('\n') + '\n')
    } catch { /* the warn still has it */ }
  }

  /** Still out of usage: before the told reset, or within RETRY_MS of a limit message with none. */
  private outNow(now: number): boolean {
    const k = this.state.limitsKept
    return !!k?.out && (k.out.resetsAt ?? k.at + RETRY_MS) > now
  }

  /** A limit message: the meter reads out until its reset ("resets 11:50pm (America/Los_Angeles)"). */
  private limitHit(text: string, now: number): void {
    const resetsAt = limitReset(text, now)
    const was = this.state.limitsKept
    this.state = { ...this.state, limitsKept: { at: now, windows: was?.windows ?? [], out: { ...(resetsAt ? { resetsAt } : {}), text: text.trim().slice(0, 200) } } }
    this.saveLimits()
  }

  /** A minute past the latest reset of a used-up limit, else RETRY_MS from now. */
  private resetAt(now: number): number {
    const told = this.state.limitsKept?.out?.resetsAt
    if (told && told > now) return told + 60_000
    const at = this.state.live.flatMap(s => s.limits).filter(l => isClaudeLimit(l) && l.percentUsed >= 100).map(l => resetMs(l.resetsAt)).filter(Number.isFinite)
    return at.length ? Math.max(...at, now) + 60_000 : now + RETRY_MS
  }

  /** On a Stop with background jobs pending, which ones the transcript says ended; no hook fires for that. */
  private withEnded(payload: Record<string, unknown>, was: ChatProgress | undefined): Record<string, unknown> {
    // A subagent's jobs end in its own transcript, read once at its SubagentStop.
    const agent = payload.hook_event_name === 'SubagentStop' && was?.subJobs?.some(j => j.agent === payload.agent_id)
    const file = agent ? payload.agent_transcript_path : payload.transcript_path
    if (!agent && (payload.hook_event_name !== 'Stop' || !(was?.jobs?.length || was?.subJobs?.length))) return payload
    if (typeof file !== 'string') return payload
    // Reads the whole transcript, but only on a Stop with jobs pending (or a SubagentStop with its own); read from an offset if that gets slow.
    try { return { ...payload, bg_finished: finishedJobs(fs.readFileSync(file, 'utf8')) } } catch { return payload }
  }

  /** A post from a chat's usage mod; false when it lacks the token or a known kind. */
  ingest(body: unknown, now = Date.now()): boolean {
    if (!body || typeof body !== 'object') return false
    const b = body as Record<string, unknown>
    if (!this.isToken(b.token)) return false
    switch (b.kind) {
      case 'live': {
        const sessionId = str(b.sessionId)
        if (!sessionId) return false
        const was = this.state.live.find(s => s.sessionId === sessionId)
        const file = str(b.file)?.slice(0, 400) ?? was?.file
        const next: SessionLive = {
          sessionId, cwd: str(b.cwd) ?? '', label: str(b.label), model: str(b.model),
          tokens: num(b.tokens), compactAt: num(b.compactAt), limits: limitsOf(b.limits), costUsd: num(b.costUsd),
          prompt: str(b.prompt)?.slice(0, 200) ?? was?.prompt, file, fileAt: file && file === was?.file ? was.fileAt : file ? now : undefined, at: now,
        }
        if (isTempDir(next.cwd)) return true
        this.state = { ...this.state, live: [next, ...this.state.live.filter(s => s.sessionId !== sessionId)] }
        // Only a session's first post is the fresh chat; one already open in the folder is not.
        // A fresh chat that never posts leaves the old one in the list to close by hand.
        this.pendingClose = this.pendingClose.filter(p => now - p.at < PENDING_CLOSE_MS)
        const ready = was ? [] : this.pendingClose.filter(p => p.sessionId !== sessionId && p.cwd === pathKey(next.cwd) && now > p.at)
        this.closing = [...this.closing, ...ready.map(p => ({ sessionId: p.sessionId, at: now }))]
        if (ready.length) this.pendingClose = this.pendingClose.filter(p => !ready.includes(p))
        this.noteCodex(next.limits)
        this.noteLimits(now)
        break
      }
      case 'cache': {
        const sessionId = str(b.sessionId), state = b.state, warmUntil = num(b.warmUntil)
        if (!sessionId || (state !== 'warm' && state !== 'cold' && state !== 'off') || warmUntil === undefined) return false
        const c: CacheKeep = { sessionId, state, warmUntil, tokens: num(b.tokens) ?? 0, pings: num(b.pings) ?? 0, at: now }
        this.state = { ...this.state, cache: [c, ...(this.state.cache ?? []).filter(x => x.sessionId !== sessionId && now - x.at < CACHE_KEPT_MS)] }
        break
      }
      // Older mods still post these; taken and dropped, since a refusal makes a mod look for the window again.
      case 'diet':
      case 'guard':
      case 'agent':
        return true
      case 'hold': {
        const sessionId = str(b.sessionId)
        if (!sessionId) return false
        this.noteHold(sessionId, b.hold, now)
        break
      }
      case 'link': {
        const from = str(b.from), to = idList(b.to)
        if (!from || !to) return false
        this.link({ from, to, reason: str(b.reason)?.slice(0, 400) ?? '', auto: b.auto === true, since: num(b.since) ?? now }, now)
        return true
      }
      case 'open-chat': {
        const sessionId = str(b.sessionId)
        if (!sessionId) return false
        // A post that arrives late never brings an older chat back up.
        if (this.open(sessionId, num(b.at) ?? now) && b.show === true) this.openedChat.fire(sessionId)
        return true
      }
      case 'link-end': {
        const from = str(b.from), to = idList(b.to)
        if (!from || !to) return false
        this.unlink(from, to, now, true)
        return true
      }
      case 'jev':
        // A credits-only post or a malformed run is taken and dropped, like the old kinds.
        this.jevRun(b, now)
        break
      case 'handoff': {
        const sessionId = str(b.sessionId), cwd = str(b.cwd), note = str(b.note)?.replace(/\\/g, '/')
        if (!sessionId || !cwd || !note || !note.startsWith(HANDOFFS) || note.includes('/../') || !note.endsWith('.md')) return false
        const branch = str(b.branch), task = str(b.task)?.slice(0, 120), plan = str(b.plan)?.replace(/\\/g, '/')
        // Only shown and passed along, but still a plain absolute .md path.
        if (plan !== undefined && (!/^(\/|[A-Za-z]:\/)/.test(plan) || plan.includes('/../') || !plan.endsWith('.md'))) return false
        const name = this.state.chats.find(c => c.sessionId === sessionId)?.name
        // The close is armed by closeAfterFresh once the fresh chat's terminal exists, never here.
        // Held while a subagent of the chat runs; emit passes it on once none does.
        const h: Handoff = { sessionId, cwd, note, ...(branch ? { branch } : {}), ...(task ? { task } : {}), ...(name ? { name } : {}), ...(plan ? { plan } : {}) }
        // force: Kenneth asked for it, maybe in another window.
        if (b.force === true) this.forced.add(sessionId)
        this.waiting = [...this.waiting.filter(w => w.h.sessionId !== sessionId), { h, since: now }]
        break
      }
      case 'indefinite-done': {
        const sessionId = str(b.sessionId)
        if (!sessionId) return false
        const usage = str(b.usage), reason = str(b.reason)
        this.indefiniteEnded.fire({ sessionId, ...(usage ? { usage } : {}), ...(reason ? { reason } : {}) })
        return true
      }
      case 'prompted': {
        const sessionId = str(b.sessionId)
        if (!sessionId) return false
        this.promptedChat.fire(sessionId)
        return true
      }
      case 'dev-start':
      case 'dev-stop': {
        const folder = str(b.folder)
        if (!folder) return false
        this.devAsked.fire({ kind: b.kind === 'dev-start' ? 'start' : 'stop', folder })
        return true
      }
      // Dismissed in another window: every window hides it.
      case 'stuck-snooze': {
        const id = str(b.id)
        if (!id || id.length > 200) return false
        this.snooze(id, now)
        return true
      }
      case 'window-tab': {
        if (!isTabCommand(b.command)) return false
        this.tabAsked.fire(b.command)
        return true
      }
      case 'close-failed': {
        const sessionId = str(b.sessionId)
        if (!sessionId) return false
        this.closeFailed.fire(sessionId)
        return true
      }
      default:
        return false
    }
    this.emit(now)
    return true
  }

  /** A sample's stuck items; the shown list leaves out the snoozed ones. */
  setStuck(items: StuckItem[], now = Date.now()): void {
    this.stuckAll = items
    // An item of a chat that went done or idle since the sample is stale.
    const stuck = snoozed(items, this.snoozes, now).filter(i => { const st = this.state.progress.find(p => p.sessionId === i.sessionId)?.state; return st !== 'done' && st !== 'idle' })
    if (JSON.stringify(stuck) !== JSON.stringify(this.state.stuck ?? [])) this.set({ stuck }, now)
  }

  /** What GET /hub/stuck hands the other windows: the chats this one owns and their items. */
  ownedStuck(): OwnedStuck { return { owned: [...this.owned], stuck: this.stuckAll.filter(i => this.owned.has(i.sessionId)) } }

  owns(sessionId: string): boolean { return this.owned.has(sessionId) }

  /** A live chat this window owns is mid-turn. A reload that takes over a minute (VS Code's terminal reconnect grace) kills it. */
  midTurn(): boolean {
    return this.state.chats.some(c => c.live && this.owned.has(c.sessionId) && this.state.progress.find(p => p.sessionId === c.sessionId)?.state === 'working')
  }

  /** Subagent jobs a transcript says ended leave the chat's progress, so every window drops them on the same fact whatever events it saw. */
  endSubJobs(finished: Set<string>, now = Date.now()): void {
    if (!finished.size || !this.state.progress.some(p => p.subJobs?.some(j => finished.has(j.id)))) return
    const progress = this.state.progress.map(p => { const left = p.subJobs?.filter(j => !finished.has(j.id)); return left?.length === p.subJobs?.length ? p : { ...p, subJobs: left?.length ? left : undefined } })
    this.set({ progress }, now)
  }

  /** Dismiss: hidden for STUCK.snoozeMs. */
  snooze(id: string, now = Date.now()): void {
    this.snoozes.set(id, now)
    this.setStuck(this.stuckAll, now)
  }

  /** Shown items not notified yet, of chats this window owns; each comes back once only. A chat waiting on Kenneth gets dueFix's paused notice instead. */
  unseenStuck(): StuckItem[] {
    const out = (this.state.stuck ?? []).filter(i => this.owned.has(i.sessionId) && !this.told.has(i.id) && !this.waitsOnUser(i.sessionId))
    for (const i of out) this.told.add(i.id)
    // Ids of items gone for good are forgotten once the set grows.
    if (this.told.size > 500) for (const id of this.told) if (!this.stuckAll.some(i => i.id === id)) this.told.delete(id)
    return out
  }

  /** Shown items of owned chats due an auto-fix, each once. A chat waiting on Kenneth gets no fix: it comes back once
   * per wait in paused, with what it waits for, and its items are due again after he answers. */
  dueFix(now = Date.now()): { fix: StuckItem[]; paused: { sessionId: string; why: string }[] } {
    if (this.fixed.size > 500) for (const id of this.fixed) if (!this.stuckAll.some(i => i.id === id)) this.fixed.delete(id)
    const fix: StuckItem[] = [], paused: { sessionId: string; why: string }[] = []
    for (const id of this.paused) if (!this.waitsOnUser(id)) this.paused.delete(id)
    // Held for usage (paused or waiting on a retry): a quiet job there is expected, as in reapChat.
    const held = new Set([...(this.state.pause?.chats ?? []).map(c => c.sessionId), ...this.retries.keys()])
    for (const item of (this.state.stuck ?? []).filter(i => this.owned.has(i.sessionId) && !held.has(i.sessionId))) {
      const why = this.waitsOnUser(item.sessionId)
      // A note with nothing to stop reaches the lead only once its turn ends, so it waits for that and the sample then.
      const p = this.state.progress.find(x => x.sessionId === item.sessionId)
      if (!why && item.pid === undefined && p?.state === 'working' && !p.waiting) continue
      if (!why) fix.push(item)
      else if (!this.paused.has(item.sessionId)) { this.paused.add(item.sessionId); paused.push({ sessionId: item.sessionId, why }) }
    }
    return { fix: fixDue(fix, this.fixed, now), paused }
  }

  /** What a chat waits on Kenneth for, if anything (stuck.ts waitsOnUser). */
  waitsOnUser(sessionId: string): string | undefined {
    return waitsOnUser(this.state.progress.find(p => p.sessionId === sessionId))
  }

  /** How many subagents of a chat still run. */
  busy(sessionId: string): number {
    return this.state.progress.find(p => p.sessionId === sessionId)?.running?.length ?? 0
  }

  /** Codex waits come from hub-panel.ts (an open turn in the rollout); they replace the Codex ones shown. */
  setCodexWaits(waits: HandoffWait[], now = Date.now()): void {
    this.codexWaits = waits
    this.emit(now)
  }

  /**
   * A run from the usage mod, drawn on the chat that ran it: its session id, else the chat that last ran jev.py, else the newest chat.
   * With a posted folder only chats in it count; none there keeps the run (Today) but draws it on no chat.
   */
  private jevRun(b: Record<string, unknown>, now: number): void {
    const items = num(b.items), costUsd = num(b.costUsd), seconds = num(b.seconds)
    if (items === undefined || costUsd === undefined || seconds === undefined) return
    const preset = str(b.preset) && /^[\w.-]{1,40}$/.test(str(b.preset)!) ? str(b.preset) : undefined
    const progress = this.state.progress
    const asked = [...this.jevAsked].filter(([, at]) => now - at < JEV_MATCH_MS).sort((x, y) => y[1] - x[1])[0]?.[0]
    const cwd = str(b.cwd) && pathKey(str(b.cwd)!)
    const here = (p: ChatProgress) => { const c = pathKey(p.cwd); return !cwd || c === cwd || cwd.startsWith(`${c}/`) || c.startsWith(`${cwd}/`) }
    const sessionId = [str(b.sessionId), asked].find(id => id && progress.some(p => p.sessionId === id && here(p)))
      ?? [...progress].filter(here).sort((x, y) => y.at - x.at)[0]?.sessionId
    const run: JevRun = { ...(sessionId ? { sessionId } : {}), ...(preset ? { preset } : {}), items, seconds, costUsd, at: now }
    const cost = `$${costUsd.toFixed(costUsd < 0.01 ? 4 : 2)}`
    this.state = {
      ...this.state,
      jev: [run, ...this.state.jev].slice(0, MAX_JEV),
      progress: progress.map(p => p.sessionId !== sessionId ? p : {
        ...p,
        roles: [...p.roles.filter(r => r.role !== 'jev'), { id: 'jev', role: 'jev', state: 'done', startedAt: now }],
        tools: [...(p.tools ?? []), { tool: preset ?? 'jev', target: `${items} items · ${cost}`, role: 'jev', at: now }].slice(-TOOLS_MAX),
      }),
    }
  }

  /** A question from the ask tool shows on its chat; again after a Stop or a new prompt cleared it. */
  asked(sessionId: string, ask: Ask): void {
    if (this.state.progress.some(p => p.sessionId === sessionId && !(p.asks ?? []).some(a => a.id === ask.id))) this.set({ progress: this.state.progress.map(p => (p.sessionId === sessionId ? addAsk(p, ask) : p)) })
  }

  /** Drops a prompt once answered from here, so a second tap has nothing to send; the next one waiting shows. */
  answered(sessionId: string, askId: string): void {
    this.answeredHere.set(sessionId, askId)
    this.set({ progress: this.state.progress.map(p => (p.sessionId === sessionId ? dropAsk(p, askId) : p)) })
  }

  /** Passes on held handoffs and closes whose chat has no subagent running, or that waited WAIT_CAP_MS. */
  private flush(now: number): void {
    const due = (id: string, since: number, what: string) => {
      // A chat waiting out a usage limit or a pause is never closed; it resumes in place.
      if (what === 'Closing' && this.retries.has(id)) return false
      if (!this.busy(id)) return true
      if (what === 'Handing off' && (this.forced.has(id) || this.compactSoon(id))) return true
      if (now - since < WAIT_CAP_MS) return false
      log.warn(`${what} ${id.slice(0, 8)} after 30 minutes with ${this.busy(id)} subagent(s) still marked running`)
      return true
    }
    const closeNow = this.closing.filter(c => due(c.sessionId, c.at, 'Closing'))
    if (closeNow.length) {
      this.closing = this.closing.filter(c => !closeNow.includes(c))
      for (const c of closeNow) { this.queue(c.sessionId, { kind: 'close' }); this.closingChat.fire(c.sessionId) }
    }
    const go = this.waiting.filter(w => due(w.h.sessionId, w.since, 'Handing off'))
    this.waiting = this.waiting.filter(w => !go.includes(w))
    const waits = [...this.waiting.map(w => {
      const name = this.state.chats.find(c => c.sessionId === w.h.sessionId)?.name ?? w.h.name
      return { sessionId: w.h.sessionId, tasks: this.busy(w.h.sessionId), next: `v${chainVersion(name) + 1}`, since: w.since }
    }), ...this.codexWaits]
    if (JSON.stringify(waits) !== JSON.stringify(this.state.waits)) this.state = { ...this.state, waits }
    for (const w of go) {
      this.forced.delete(w.h.sessionId)
      // Past the cap: the fresh chat gets each one still running, to check its output.
      const p = this.state.progress.find(x => x.sessionId === w.h.sessionId)
      const running = p?.running?.map(id => `${p.roles.find(r => r.id === id)?.role ?? 'agent'} ${id}`)
      this.handoffs.fire(running?.length ? { ...w.h, running } : w.h)
    }
  }

  /** A handoff asked for by hand: queued to the chat, and it skips the wait on subagents. */
  handoffNow(sessionId: string, now = Date.now()): void {
    this.queue(sessionId, { kind: 'handoff' })
    this.forced.add(sessionId)
    this.emit(now)
  }

  private compactSoon(sessionId: string): boolean {
    const s = this.state.live.find(x => x.sessionId === sessionId)
    return !!s?.tokens && !!s.compactAt && s.tokens >= s.compactAt * COMPACT_SOON
  }

  /** Called once the fresh chat's terminal is open: the old chat closes when a new chat first posts from its folder. */
  closeAfterFresh(sessionId: string, cwd: string, now = Date.now()): void {
    this.handedOff.add(sessionId)
    this.pendingClose = [...this.pendingClose.filter(p => p.sessionId !== sessionId), { sessionId, cwd: pathKey(cwd), at: now }]
  }

  queue(sessionId: string, item: InboxDraft & { id?: string }): InboxItem {
    const full: InboxItem = { ...item, id: item.id ?? crypto.randomBytes(6).toString('hex') }
    const list = this.inboxes.get(sessionId) ?? []
    this.inboxes.set(sessionId, [...list, full].slice(-MAX_INBOX))
    return full
  }

  take(sessionId: string, now = Date.now()): InboxItem[] {
    this.polled.set(sessionId, now)
    const list = this.inboxes.get(sessionId) ?? []
    this.inboxes.delete(sessionId)
    const r = this.retries.get(sessionId)
    if (!r || now < r.due) return list
    this.retries.delete(sessionId)
    this.saveRetries()
    // Claude Code's own autoContinueAtUsageLimit sends one already; a second would run the turn twice. It knows nothing of subagents, so those still get a note.
    if (r.paused) return [...list, { kind: 'prompt', text: pauseText(r.agents), id: crypto.randomBytes(6).toString('hex') }]
    const text = this.state.keep.autoContinue ? (r.agents?.length ? `Switchboard: ${agentsNote(r.agents)}` : undefined) : continueText(r.agents)
    return text ? [...list, { kind: 'prompt', text, id: crypto.randomBytes(6).toString('hex') }] : list
  }

  /** Due retries of chats with no live process and a quiet mod: dropped here, so the caller resumes each once. */
  goneDue(live: (sessionId: string) => boolean, now = Date.now()): { sessionId: string; cwd: string; agents?: CutAgent[]; paused?: boolean }[] {
    const out = [...this.retries].filter(([id, r]) => r.cwd && now >= r.due && !live(id) && now - (this.polled.get(id) ?? -Infinity) >= POLL_GONE_MS)
    for (const [id] of out) this.retries.delete(id)
    if (out.length) this.saveRetries()
    return out.map(([sessionId, r]) => ({ sessionId, cwd: r.cwd!, ...(r.agents ? { agents: r.agents } : {}), ...(r.paused ? { paused: true } : {}) }))
  }

  /** A limited chat is waiting on its reset. */
  retrying(): boolean {
    return this.retries.size > 0
  }

  /** Chats waiting on their reset: their to-do items stay theirs, since the resume keeps the id. */
  retryIds(): string[] {
    return [...this.retries.keys()]
  }

  /** Whether the message box reaches this chat: a Codex chat through its tied terminal, a Claude chat through its polling mod. */
  takes(chat: ChatRow, codexTerminal: boolean, now = Date.now()): boolean {
    if (!chat.live) return false
    if (chat.ai === 'codex') return codexTerminal
    return now - (this.polled.get(chat.sessionId) ?? -Infinity) < POLL_GONE_MS
  }

  /** A chat waiting on others; one per waiting chat and target set. */
  link(l: ChatLink, now = Date.now()): void {
    const unlinks = this.state.unlinks?.filter(u => u.from !== l.from || !l.to.includes(u.to))
    this.state = { ...this.state, links: [...(this.state.links ?? []).filter(x => x.from !== l.from || !sameSet(x.to, l.to)), l], unlinks }
    this.emit(now)
  }

  /** exact: the chat's own link-end, for that target set. Otherwise Kenneth's unlink: drops just those targets, and a link with none left, and leaves a tombstone. */
  unlink(from: string, to: string[], now = Date.now(), exact = false): void {
    const links = (this.state.links ?? []).flatMap(x => { const left = x.from !== from ? x.to : exact ? (sameSet(x.to, to) ? [] : x.to) : x.to.filter(t => !to.includes(t)); return left.length ? [left.length === x.to.length ? x : { ...x, to: left }] : [] })
    const unlinks = exact ? this.state.unlinks : [...(this.state.unlinks ?? []).filter(u => u.from !== from || !to.includes(u.to)), ...to.map(t => ({ from, to: t, at: now }))]
    this.state = { ...this.state, links, unlinks }
    this.emit(now)
  }

  /** A chat row says whether it runs; one not listed yet counts while it posts. */
  private alive(id: string): boolean {
    const c = this.state.chats.find(x => x.sessionId === id)
    return c ? c.live : this.state.live.some(s => s.sessionId === id)
  }

  /** A link goes with its waiting chat, not its targets: an ended target's outcome is what the wait reads. No row yet (a reload) keeps it NO_ROW_MS.
   * Auto links never get a link-end: they go with the target's fresh edit of that file. */
  private linkHolds(l: ChatLink, now: number): boolean {
    const from = this.state.chats.find(x => x.sessionId === l.from)
    if (from ? !from.live : !this.alive(l.from) && now - Math.max(l.since, this.linksAt) >= NO_ROW_MS) return false
    if (!l.auto) return true
    if (now - l.since >= AUTO_LINK_MS) return false
    const file = l.reason.replace(/\\/g, '/')
    return l.to.some(id => { const s = this.state.live.find(x => x.sessionId === id); return s?.file?.replace(/\\/g, '/') === file && !!s.fileAt && now - s.fileAt < EDIT_FRESH_MS })
  }

  /** Dev servers that stopped in the last ten minutes. */
  stopped(now = Date.now()): Server[] {
    return this.gone.filter(g => now - g.at < GONE_MS).map(g => g.server)
  }

  private emit(now: number): void {
    const fresh = this.state.live.filter(s => now - s.at < LIVE_STALE_MS)
    if (fresh.length !== this.state.live.length) this.state = { ...this.state, live: fresh }
    const progress = this.state.progress.filter(p => now - p.at < PROGRESS_STALE_MS).map(p => settle(p, now))
    if (progress.some((p, i) => p !== this.state.progress[i]) || progress.length !== this.state.progress.length) this.state = { ...this.state, progress }
    const links = this.state.links?.filter(l => this.linkHolds(l, now))
    if (links && links.length !== this.state.links?.length) this.state = { ...this.state, links }
    const unlinks = this.state.unlinks?.filter(u => now - u.at < UNLINK_MS)
    if (unlinks && unlinks.length !== this.state.unlinks?.length) this.state = { ...this.state, unlinks }
    this.saveLinks()
    this.flush(now)
    this.changed.fire(this.state)
  }
}

/** The window's one hub, read by the hook server, the discovery file and the panel. */
export const hub = new HubService()
onMidTurn(() => hub.midTurn())
