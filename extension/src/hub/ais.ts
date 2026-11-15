/**
 * The AIs the hub connects: each one detects its CLI, lists its chats, and
 * gives the commands that start and resume a chat. Claude wraps sessions.ts and
 * projects.ts; Codex reads its rollout files. Adding an AI is one entry in AIS
 * and one member of AiId. Called from hub-panel.ts, actions.ts and starred.ts.
 */
import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { recentSessionDirs } from '../codex-session-watcher'
import { readChains, withChains } from './chains'
import { codexArgs, newChatCommand, noteTo, shellQuote, type Shell } from './projects'
import { readChats } from './sessions'
import { resumeSettingsArg } from './tools'
import type { AiId, AiStatus, ChatRow } from './types'
import { createLogger } from '../logger'

const log = createLogger('Ais')


/** A message typed into a Codex terminal as one paste, so its newlines do not submit; undefined when it holds a control character other than LF or TAB. */
// eslint-disable-next-line no-control-regex
export const codexPaste = (text: string) => (/[\x00-\x08\x0b-\x1f\x7f]/.test(text) ? undefined : `\x1b[200~${text}\x1b[201~`)

/** A `ps` command line that is Codex itself: the binary, or node running its npm launcher. Never a shell, whatever its arguments say. */
export const isCodexCommand = (cmd: string) => {
  const [first = '', second = ''] = cmd.trim().split(/\s+/).map(w => w.split('/').pop() ?? '')
  return /^codex(\.js)?$/.test(first) || (first === 'node' && /^codex(\.js)?$/.test(second))
}

// Text typed before Codex's screen is up can be lost.
const CODEX_BOOT_MS = 3_000
type CodexTerm = { processId: Thenable<number | undefined>; exitStatus: unknown }
const psCommand = (pid: number) => new Promise<string>(done => execFile('ps', ['-o', 'command=', '-p', String(pid)], (err, out) => done(err ? '' : String(out))))

/** Why a message must not be typed into this Codex terminal now; undefined when the terminal's own process is a running Codex. */
export async function codexReady(o: { terminal: CodexTerm | undefined; live: boolean; startedAt: number; now: number }, readCommand: (pid: number) => Promise<string> = psCommand): Promise<string | undefined> {
  const t = o.terminal
  if (!o.live) return 'that chat is not running'
  if (!t || t.exitStatus !== undefined) return 'that Codex chat was not started or resumed from Switchboard in this window, or has quit, so it cannot take messages; type in its terminal'
  if (o.now - o.startedAt < CODEX_BOOT_MS) return 'Codex is still starting; send again in a moment'
  const pid = await t.processId
  if (!pid || !isCodexCommand(await readCommand(pid))) return 'that terminal is not running Codex, so the message was not typed into it'
  return undefined
}

const psParent = (pid: number) => new Promise<number>(done => execFile('ps', ['-o', 'ppid=', '-p', String(pid)], (err, out) => done(err ? 0 : Number(String(out).trim()) || 0)))
const pidAlive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
type ClosableTerm = { processId: Thenable<number | undefined>; dispose(): void }

/** The terminal whose shell started a chat, found by the chat process's parent; undefined for a chat started some other way. */
export async function chatTerminal<T extends { processId: Thenable<number | undefined> }>(pid: number, terminals: readonly T[], parent = psParent): Promise<T | undefined> {
  const ppid = await parent(pid)
  if (!ppid) return undefined
  const ids = await Promise.all(terminals.map(t => t.processId))
  return terminals[ids.indexOf(ppid)]
}

/** Disposes the terminal whose shell started a closing chat, once the chat has exited; false when none did or it is still running after waitMs. */
export async function closeChatTerminal(pid: number, terminals: readonly ClosableTerm[], o = { parent: psParent, alive: pidAlive, waitMs: 60_000, stepMs: 1_000 }): Promise<boolean> {
  const t = await chatTerminal(pid, terminals, o.parent)
  if (!t) return false
  for (let waited = 0; o.alive(pid); waited += o.stepMs) {
    if (waited >= o.waitMs) return false
    await new Promise(r => setTimeout(r, o.stepMs))
  }
  t.dispose()
  return true
}

/** Where a CLI lives on PATH, for a terminal that runs it with no shell around it. */
/** which's first line; Windows' where also lists npm's extensionless sh shim, which cannot run there. */
export const pickCli = (out: string, platform: NodeJS.Platform = process.platform) => {
  const l = out.split(/\r?\n/).map(x => x.trim()).filter(Boolean)
  return (platform === 'win32' ? l.find(x => /\.(exe|cmd)$/i.test(x)) : undefined) ?? l[0]
}
export const cliPath = (cli: string) => new Promise<string | undefined>(done => execFile(process.platform === 'win32' ? 'where' : 'which', [cli], { windowsHide: true }, (err, out) => done(err ? undefined : pickCli(String(out)))))

export type Ai = {
  name: string
  detect: () => Promise<{ installed: boolean; detail?: string; signedIn?: boolean }>
  /** Run in a terminal to sign in. */
  loginCommand: string
  chats: () => Promise<ChatRow[]>
  startCommand: (o: { text?: string; name?: string }, shell: Shell) => string
  /** extra: a system note for this resume (the name note); starred digests leave it out. */
  resumeCommand: (sessionId: string, extra?: string) => string
  /** Left out of the hub entirely until its CLI is on PATH. */
  optional?: true
}

const LIVE_MS = 10 * 60 * 1000
// An ended Codex row leaves the board after this much rollout silence with no terminal running for it.
export const CODEX_GONE_MS = 2 * 60 * 60 * 1000
const HEAD_BYTES = 512 * 1024
const TAIL_BYTES = 256 * 1024
const CODEX_FILES = 20
// Looked up at most every five minutes per CLI; the chats tick asks every 15 s.
const PATH_MS = 5 * 60 * 1000
const pathSeen = new Map<string, { at: number; on: Promise<boolean> }>()
/** Signed in per the AI's own status command; undefined when the output says neither. */
export function signedIn(ai: AiId, out: string): boolean | undefined {
  if (ai === 'codex') return /not logged in/i.test(out) ? false : /logged in/i.test(out) ? true : undefined
  try { const j = JSON.parse(out); return typeof j?.loggedIn === 'boolean' ? j.loggedIn : undefined } catch { return undefined }
}

// The status command is a process per call, so it shares the PATH cache's minute.
const loginSeen = new Map<AiId, { at: number; on: Promise<boolean | undefined> }>()
const loginState = (ai: AiId, args: string[]) => {
  const was = loginSeen.get(ai)
  if (was && Date.now() - was.at < PATH_MS) return was.on
  const on = cliPath(ai).then(bin => bin ? new Promise<boolean | undefined>(done =>
    execFile(bin, args, { timeout: 5000 }, (_e, out, err) => done(signedIn(ai, `${out}${err}`)))) : undefined)
  loginSeen.set(ai, { at: Date.now(), on })
  return on
}

/** Drops the cached sign-in state, so the next refresh asks the CLI again. */
export const forgetLogin = (ai: AiId) => { loginSeen.delete(ai) }

const onPath = (cli: string) => {
  const was = pathSeen.get(cli)
  if (was && Date.now() - was.at < PATH_MS) return was.on
  const on = cliPath(cli).then(Boolean)
  pathSeen.set(cli, { at: Date.now(), on })
  return on
}

type Line = { type?: string; payload?: { id?: string; cwd?: string; type?: string; message?: string; role?: string; content?: { text?: string }[]; info?: { last_token_usage?: { input_tokens?: number }; model_context_window?: number } } }
const parse = (line: string): Line | undefined => { try { return JSON.parse(line) } catch { return undefined } }
const HANDOFFS = path.join(os.homedir(), '.claude', 'handoffs')
const CONTINUE = /Continue from (.+?\.md): read it first/
const TURN_END = new Set(['task_complete', 'turn_complete', 'turn_aborted'])
// Switchboard puts its brief (brain.ts, one block with no blank line) in front of a Codex chat's first message;
// every Codex chat in a project would share a name made from it, so the name comes from what follows.
const withoutBrief = (m: string) => {
  if (!/^Switchboard (brief for |notes: )/.test(m)) return m
  const at = m.indexOf('\n\n')
  return at < 0 ? '' : m.slice(at + 2)
}

// Context Codex injects as user messages ahead of the real prompt.
const INJECTED = /^\s*(# AGENTS\.md instructions|<environment_context>|<INSTRUCTIONS>|<user_instructions>|<permissions)/

const OWN_TITLES = path.join(os.homedir(), '.claude', 'switchboard', 'codex-titles.json')

/** The titles Switchboard gave the Codex chats it started, by session id. */
export function readCodexOwn(file = OWN_TITLES): Map<string, string> {
  try {
    const o = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    return new Map(Object.entries(o).filter((e): e is [string, string] => typeof e[1] === 'string'))
  } catch { return new Map() }
}

export function saveCodexOwn(id: string, title: string, file = OWN_TITLES): void {
  const all = Object.fromEntries(readCodexOwn(file))
  all[id] = title
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(all)) } catch { /* the row falls back to its first message */ }
}

/** Each Codex row's first-message name, which a started terminal is tied by (the display name may be a title). */
export const codexFirst = new Map<string, string>()

/** ~/.codex/session_index.jsonl thread names by session id; read once per refresh. */
export function codexTitles(): Map<string, string> {
  const titles = new Map<string, string>()
  try {
    const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
    for (const line of fs.readFileSync(path.join(home, 'session_index.jsonl'), 'utf8').split('\n')) {
      const r = parse(line) as { id?: string; thread_name?: string } | undefined
      if (typeof r?.id === 'string' && r.thread_name) titles.set(r.id, r.thread_name)
    }
  } catch { /* no index */ }
  return titles
}

/** A handoff note's text; only notes under ~/.claude/handoffs are read. */
function readHandoff(p: string): string | undefined {
  const full = path.resolve(p)
  if (!full.startsWith(HANDOFFS + path.sep)) return undefined
  try { return fs.readFileSync(full, 'utf8').slice(0, 2000) } catch { return undefined }
}

/**
 * One Codex rollout as a chat row: session_meta gives the id and folder, the first user
 * message the name (a handoff's note names it by its To: line), the last token count the fill.
 */
export function codexRow(lines: string[], mtime: number, now = Date.now(), read = readHandoff, titles?: Map<string, string>, own?: Map<string, string>): ChatRow | undefined {
  let id: string | undefined, cwd = '', first: string | undefined, responded: string | undefined, fill: number | undefined, status: string | undefined
  for (const line of lines) {
    const r = parse(line)
    if (r?.type === 'session_meta' && typeof r.payload?.id === 'string') { id = r.payload.id; cwd = r.payload.cwd ?? '' }
    if (first === undefined && r?.type === 'event_msg' && r.payload?.type === 'user_message' && r.payload.message) first = withoutBrief(r.payload.message)
    if (responded === undefined && r?.type === 'response_item' && r.payload?.type === 'message' && r.payload.role === 'user') {
      const text = (r.payload.content ?? []).map(c => c.text ?? '').join('\n')
      if (text.trim() && !INJECTED.test(text)) responded = withoutBrief(text)
    }
    // The turn's own end marks: only these say a chat is idle; a quiet rollout may be mid-turn.
    if (r?.type === 'event_msg' && TURN_END.has(r.payload?.type ?? '')) status = 'idle'
    if (r?.type === 'event_msg' && r.payload?.type === 'task_started') status = 'busy'
    const info = r?.type === 'event_msg' && r.payload?.type === 'token_count' ? r.payload.info : undefined
    const used = info?.last_token_usage?.input_tokens, max = info?.model_context_window
    if (typeof used === 'number' && typeof max === 'number' && max > 0) fill = Math.min(1, used / max)
  }
  if (!id) return undefined
  const text = first || responded
  const note = text && CONTINUE.exec(text)?.[1]
  const short = (t?: string) => t?.replace(/\s+/g, ' ').trim().slice(0, 60) || undefined
  // A handoff's To: name, the title Switchboard gave a chat it started, the first message, then the thread title.
  const name = (note && noteTo(read(note) ?? '')) || short(own?.get(id)) || short(text) || short(titles?.get(id))
  const live = now - mtime < LIVE_MS
  return { pid: 0, sessionId: id, name, cwd, updatedAt: mtime, link: '', live, why: [], ai: 'codex', ...(fill === undefined ? {} : { fill }), ...(status ? { status } : {}) }
}

/**
 * Codex rows to archive: no longer live and no running terminal for them, and either their Switchboard
 * terminal exited or the rollout has been silent past CODEX_GONE_MS. A quiet chat whose terminal runs stays.
 */
export const endedCodex = (chats: ChatRow[], tied: (id: string) => boolean, exited: ReadonlySet<string>, now = Date.now()) =>
  chats.filter(c => c.ai === 'codex' && !c.live && !tied(c.sessionId) && (exited.has(c.sessionId) || now - (c.updatedAt ?? now) > CODEX_GONE_MS))

/** How a Codex chat's last turn ended: its last answer and whether it was interrupted. */
export function lastCodexTurn(lines: string[]): { answer?: string; aborted: boolean } {
  let answer: string | undefined, aborted = false
  for (const line of lines) {
    const r = parse(line) as { type?: string; payload?: { type?: string; message?: string; last_agent_message?: string } } | undefined
    if (r?.type !== 'event_msg') continue
    if (r.payload?.type === 'agent_message' && r.payload.message) answer = r.payload.message
    if (r.payload?.type === 'task_started') aborted = false
    if (TURN_END.has(r.payload?.type ?? '')) { aborted = r.payload?.type === 'turn_aborted'; if (r.payload?.last_agent_message) answer = r.payload.last_agent_message }
  }
  return { answer, aborted }
}

/** The last thing typed in a Codex chat. */
export function lastCodexPrompt(lines: string[]): string | undefined {
  let last: string | undefined
  for (const line of lines) {
    const r = parse(line)
    if (r?.type === 'event_msg' && r.payload?.type === 'user_message' && r.payload.message) last = r.payload.message
  }
  return last
}

// Each rollout's last read lines by its mtime, so an idle chat's unchanged file is not read again every refresh.
const readLines = new Map<string, { mtime: number; lines: string[] }>()

/** A rollout's head (session_meta, first message) and tail (last token count, last prompt) as lines. With mtime, an unchanged file's last read is reused. */
export async function rolloutLines(file: string, mtime?: number): Promise<string[]> {
  const hit = readLines.get(file)
  if (mtime !== undefined && hit?.mtime === mtime) return hit.lines
  const lines = await readRollout(file)
  if (mtime !== undefined) readLines.set(file, { mtime, lines })
  return lines
}

async function readRollout(file: string): Promise<string[]> {
  const fd = await fs.promises.open(file, 'r').catch(() => undefined)
  if (!fd) return []
  try {
    const { size } = await fd.stat()
    const head = await fd.read(Buffer.alloc(HEAD_BYTES), 0, HEAD_BYTES, 0)
    const lines = head.buffer.subarray(0, head.bytesRead).toString('utf8').split('\n')
    if (size <= HEAD_BYTES) return lines
    const start = Math.max(HEAD_BYTES, size - TAIL_BYTES)
    const tail = await fd.read(Buffer.alloc(size - start), 0, size - start, start)
    return [...lines, ...tail.buffer.subarray(0, tail.bytesRead).toString('utf8').split('\n')]
  } finally { await fd.close() }
}

/** Each Codex chat's rollout file by session id, for the auto handoff in hub-panel.ts. */
export const codexFiles = new Map<string, string>()

async function codexChats(): Promise<ChatRow[]> {
  const files: { file: string; mtime: number }[] = []
  for (const dir of recentSessionDirs(new Date())) {
    for (const n of await fs.promises.readdir(dir).catch(() => [] as string[])) {
      if (!n.endsWith('.jsonl')) continue
      const file = path.join(dir, n)
      const st = await fs.promises.stat(file).catch(() => undefined)
      if (st) files.push({ file, mtime: st.mtimeMs })
    }
  }
  files.sort((a, b) => b.mtime - a.mtime)
  const titles = codexTitles(), own = readCodexOwn()
  const rows: ChatRow[] = []
  const recent = files.slice(0, CODEX_FILES)
  for (const f of readLines.keys()) if (!recent.some(r => r.file === f)) readLines.delete(f)
  for (const { file, mtime } of recent) {
    const lines = await rolloutLines(file, mtime)
    const row = codexRow(lines, mtime, Date.now(), undefined, titles, own)
    if (!row) continue
    codexFirst.set(row.sessionId, (titles.has(row.sessionId) || own.has(row.sessionId) ? codexRow(lines, mtime)?.name : row.name) ?? '')
    codexFiles.set(row.sessionId, file)
    rows.push(row)
  }
  return rows
}

export const AIS: Record<AiId, Ai> = {
  claude: {
    name: 'Claude Code',
    detect: async () => (await onPath('claude')) ? { installed: true, signedIn: await loginState('claude', ['auth', 'status']) } : { installed: false },
    loginCommand: 'claude auth login',
    chats: async () => (await readChats()).map(c => ({ ...c, ai: 'claude' as const })),
    startCommand: (o, shell) => newChatCommand(o, shell),
    // A chat with a tool profile resumes with it: --settings applies on resume too.
    resumeCommand: (id, extra) => `claude --resume ${id}${resumeSettingsArg(id, undefined, extra)}`,
  },
  codex: {
    name: 'Codex',
    detect: async () => {
      if (await onPath('codex')) return { installed: true, signedIn: await loginState('codex', ['login', 'status']) }
      const home = fs.existsSync(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'))
      return { installed: false, detail: home ? 'CLI not installed: npm i -g @openai/codex' : 'Not set up' }
    },
    // One command so PowerShell 5.1 runs it; the Sign in button's tooltip names --device-auth for a remote machine.
    loginCommand: 'codex login',
    chats: codexChats,
    startCommand: (o, shell) => (o.text?.trim() ? `codex ${shellQuote(o.text, shell)}` : 'codex'),
    resumeCommand: id => ['codex', ...codexArgs(['resume', id])].join(' '),
  },
  // Nous Research's hermes-agent: any model (OpenRouter, local endpoint), cron, phone gateway. Started and resumed in a plain terminal.
  // ponytail: no chat rows yet, its sessions sit in ~/.hermes/state.db (sqlite); read them when Hermes chats need the board.
  hermes: {
    name: 'Hermes',
    optional: true,
    detect: async () => ({ installed: await onPath('hermes') }),
    loginCommand: 'hermes setup',
    chats: async () => [],
    startCommand: (o, shell) => (o.text?.trim() ? `hermes -q ${shellQuote(o.text, shell)}` : 'hermes'),
    resumeCommand: id => `hermes --resume ${id}`,
  },
}

const HERMES_ASK = 'switchboard-ask'

/** config.yaml with the Switchboard ask server under mcp_servers, at the indent the file already uses; unchanged
 *  when it is there. undefined when mcp_servers is a flow map, a list, an anchor or anything else not a plain block. */
export function hermesMcp(yaml: string, server: string): string | undefined {
  const entry = (i: string) => `${i}${HERMES_ASK}:\n${i}${i}command: node\n${i}${i}args: [${JSON.stringify(server)}]\n`
  const m = /^mcp_servers:([^\n]*)\n?/m.exec(yaml)
  if (!m) return `${yaml}${yaml && !yaml.endsWith('\n') ? '\n' : ''}mcp_servers:\n${entry('  ')}`
  const rest = m[1].replace(/(^|\s)#.*$/, '').trim()
  if (rest && !/^\{\s*\}$/.test(rest)) return undefined
  const after = yaml.slice(m.index + m[0].length)
  const indent = rest ? '  ' : /^(?:[ \t]*(?:#.*)?\r?\n)*( +)[^\s#]/.exec(after)?.[1] ?? '  '
  if (!rest && new RegExp(`^${indent}${HERMES_ASK}:`, 'm').test(after)) return yaml
  return `${yaml.slice(0, m.index)}mcp_servers:\n${entry(indent)}${after}`
}

/**
 * When Hermes is set up (~/.hermes): copies each ~/.claude/skills folder with a SKILL.md into ~/.hermes/skills/claude-kit
 * (a copy, since Hermes rewrites skills it uses) and adds the ask server to its config.yaml. False when there is no ~/.hermes.
 */
export function shareKitWithHermes(home = os.homedir()): boolean {
  const hermes = path.join(home, '.hermes'), from = path.join(home, '.claude', 'skills')
  if (!fs.existsSync(hermes)) return false
  const to = path.join(hermes, 'skills', 'claude-kit')
  for (const n of fs.existsSync(from) ? fs.readdirSync(from) : []) {
    if (fs.existsSync(path.join(from, n, 'SKILL.md'))) fs.cpSync(path.join(from, n), path.join(to, n), { recursive: true, dereference: true })
  }
  const config = path.join(hermes, 'config.yaml')
  const was = fs.existsSync(config) ? fs.readFileSync(config, 'utf8') : ''
  const now = hermesMcp(was, path.join(home, '.claude', 'switchboard', 'ask', 'ask-server.mjs'))
  if (now === undefined) log.warn(`Left ${config} alone: its mcp_servers is not a plain block, add ${HERMES_ASK} by hand`)
  else if (now !== was) {
    // One backup, from before Switchboard first touched the file.
    if (was && !fs.existsSync(`${config}.switchboard-bak`)) fs.writeFileSync(`${config}.switchboard-bak`, was)
    fs.writeFileSync(config, now)
  }
  return true
}

export const isAi = (v: unknown): v is AiId => typeof v === 'string' && Object.hasOwn(AIS, v)

/** Every AI's chats, each in its handoff chain, and a status row per AI. */
export async function readAis(): Promise<{ chats: ChatRow[]; ais: AiStatus[] }> {
  const ids = Object.keys(AIS) as AiId[]
  const all = await Promise.all(ids.map(async id => ({ id, d: await AIS[id].detect(), chats: await AIS[id].chats().catch(() => []) })))
  const found = all.filter(f => f.d.installed || !AIS[f.id].optional)
  return {
    chats: withChains(found.flatMap(f => f.chats), readChains()),
    ais: found.map(f => ({ id: f.id, name: AIS[f.id].name, installed: f.d.installed, detail: f.d.detail, signedIn: f.d.signedIn, chats: f.chats.filter(c => c.live).length })),
  }
}
