/**
 * What the Hub's buttons do in VS Code: open or clone a project, start a chat,
 * run a Remote Control server, sign in to AWS. Each acts only on folders and
 * profiles the hub already lists. Called from hub-panel.ts.
 */
import * as vscode from 'vscode'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as crypto from 'crypto'
import { execFile, spawn } from 'child_process'
import { hub, type Handoff } from './hub-service'
import type { AiId, ChatProfile, ChatRow, NewChatAi } from './types'
import { autoPick } from './picker'
import { presetFor } from './jev-project'
import { AIS, chatTerminal, cliPath, codexFirst, codexPaste, codexReady, saveCodexOwn, shareKitWithHermes } from './ais'
import { quickAsk, withBrief } from './brain'
import { rulesState, withPointer } from './rules'
import { accountsNote, readLinks, readLogins } from './logins'
import { CLI_APPS, cliBinary, cliBusy, deviceUrl, endCli, startCli } from './cli-logins'
import { awsBinary, browserEnv, chromeCall, chromeChoice, deleteAwsProfile, loginError, moveProfile, readAwsConfig, refreshIdentity, rowText, browserFor, profileFor, readPrefs, readSessions, sameLogin, validProfileName, writeOpenChrome, writePrefs, writeSessions } from './aws'
import { SHELL, ask, shellQuote, chainBase, codexArgs, scriptBody, scriptLine, chainVersion, freshPrompt, inWorkspace, labelNote, newChatCommand, nextChainName, projectName, stillRunning } from './projects'
import { insideCwd, libraryInventory, projectInventory, safeFile } from './local'
import { saveGroup } from './split'
import { matchCodexStarts, recordArchive, recordChain, type CodexStart } from './chains'
import { RC_NAME, rcRunning, rcRunningNow, rcServerCommand } from './sessions'
import { titleFor } from './title'
import { heldLabel, moveTodoChat, projectOf, todoEnv, type RunLabel } from './todo'
import { trustFolder, trustedWindowRoots } from './trust'
import { openChatTerminal, tags } from './terminals'
import { KEY_ENV, setupState, setupSteps, type SetupKit } from './setup'
import { FLAGGED, chatSettings, cleanProfile, clearIndefinite, defaultProfile, handoffSettings, indefiniteOn, nameNote, saveProfile, savedProfile, startProfile, syncIndefinite, toolsNote } from './tools'
import { withGoal } from './smart-tools'
import { editor } from '../editor'

// A window opened by `code` from inside a chat inherits Claude's child marker, and a chat started
// under it saves no transcript (no --resume, no handoff). Chat terminals drop it; null unsets.
// SWITCHBOARD_CHAT: the git guard reads it (git-guard.ts); Codex has no marker of its own.
const OWN_CHAT = { CLAUDE_CODE_CHILD_SESSION: null, SWITCHBOARD_CHAT: '1' }
/** A chat terminal's env: no child marker, and the AWS profile picked for its folder (Sign-ins). */
const chatEnv = (cwd: string): Record<string, string | null> => {
  const p = profileFor(hub.get().signIns.projects, cwd), b = browserFor(hub.get().signIns.browsers ?? {}, cwd)
  return { ...OWN_CHAT, ...(p && validProfileName(p) ? { AWS_PROFILE: p } : {}), ...browserEnv(chromeChoice(undefined, b, knownChrome()).dir, writeOpenChrome()) }
}
const HANDOFFS = path.join(os.homedir(), '.claude', 'handoffs')
/** Auto trust, only inside this window's workspace while trusted, or another live trusted window's (trust.ts). */
const trustHere = (dir: string) => trustFolder(dir, { ask: ask.claude, trusted: vscode.workspace.isTrusted, roots: (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath), others: trustedWindowRoots() })
// A Codex chat has no pid to stop: the terminal Switchboard started it in, by session id. A terminal waits in
// codexStarts under the name its row will show (the message's first 60 characters, or a handoff's To: name) until
// bindCodexTerminals ties it to exactly one new rollout. Lost on reload: such a chat is then never closed by Switchboard.
const codexTerminals = new Map<string, vscode.Terminal>()
const codexBorn = new WeakMap<vscode.Terminal, number>()
let codexStarts: (CodexStart & { terminal: vscode.Terminal; group?: string; title?: string; waitOn?: string[] })[] = []
const START_TTL_MS = 60 * 60 * 1000
const TEMP = /^switchboard-[0-9a-f-]{36}\.(txt|sh|ps1)$/
/** Launch files left over a day: a first message is read by its chat's shell at start, a script never ran. */
export function sweepTemp(dir = os.tmpdir(), now = Date.now()): void {
  let names: string[] = []
  try { names = fs.readdirSync(dir) } catch { return }
  for (const n of names) {
    if (!TEMP.test(n)) continue
    const f = path.join(dir, n)
    try { if (now - fs.statSync(f).mtimeMs > 86_400_000) fs.rmSync(f, { force: true }) } catch { /* gone already */ }
  }
}
let swept = false
const tempFile = (ext: string) => {
  if (!swept) { swept = true; sweepTemp() }
  return path.join(os.tmpdir(), `switchboard-${crypto.randomUUID()}.${ext}`)
}
/** The first message in a temp file for newChatCommand's textFile; nothing for an empty one. */
const messageFile = (text: string) => {
  if (!text.trim()) return undefined
  const file = tempFile('txt')
  fs.writeFileSync(file, text.trim())
  return file
}
// The full command goes in a file that removes itself; only a short line is typed (scriptLine).
const typed = (command: string) => {
  const file = tempFile(SHELL === 'posix' ? 'sh' : 'ps1')
  fs.writeFileSync(file, scriptBody(file, command, SHELL))
  return scriptLine(file, SHELL)
}
const rowName = (first: string) => first.replace(/\s+/g, ' ').trim().slice(0, 60)
const waitForCodex = (terminal: vscode.Terminal, cwd: string, name: string | undefined, group?: string, title?: string, waitOn?: string[]) => {
  if (name) codexStarts.push({ key: Math.random().toString(36).slice(2), cwd, name, at: Date.now(), terminal, group, title, waitOn })
}

// A resumed or handed-off to-do chat keeps its todo-band; a handoff opens before moveTodoChat, so the old id holds it.
const heldEnv = (cwd: string, chats: string[]) => { const f = projectOf(cwd); return todoEnv(heldLabel(hub.get().todos?.[f]?.todo, f, chats)) }

/** Codex chats whose Switchboard terminal exited this run; hub-panel.ts archives them once their rollout stops moving. */
export const codexExited = new Set<string>()

/** Ties started Codex terminals to their sessions; hub-panel.ts calls it with each fresh chat list. */
export function bindCodexTerminals(chats: ChatRow[], now = Date.now(), onTied?: (sessionId: string, waitOn: string[]) => void): void {
  for (const [id, t] of codexTerminals) if (t.exitStatus !== undefined) { codexTerminals.delete(id); codexExited.add(id) }
  codexStarts = codexStarts.filter(s => now - s.at < START_TTL_MS && s.terminal.exitStatus === undefined)
  const tied = matchCodexStarts(codexStarts, chats, new Set(codexTerminals.keys()), c => codexFirst.get(c.sessionId) ?? c.name)
  for (const [key, sessionId] of tied) {
    const { terminal: t, group, title, waitOn } = codexStarts.find(s => s.key === key)!
    if (group) saveGroup(sessionId, group)
    if (title) saveCodexOwn(sessionId, title)
    if (waitOn?.length) onTied?.(sessionId, waitOn)
    codexTerminals.set(sessionId, t)
    tags.host(t, sessionId)
  }
  codexStarts = codexStarts.filter(s => !tied.has(s.key))
}

/**
 * A Codex chat runs as its terminal's own process, with no shell around it: when Codex quits the terminal ends,
 * so a message typed into it can never land at a shell prompt. Answers why it could not start.
 */
async function codexTerminal(name: string, cwd: string, args: string[], sessionId?: string, env?: Record<string, string>): Promise<vscode.Terminal | string> {
  const bin = await cliPath('codex')
  if (!bin) return 'codex is not on PATH'
  const t = openChatTerminal({ name, cwd, env: { ...chatEnv(cwd), ...env }, shellPath: bin, shellArgs: codexArgs(args) }, AIS.codex.name, sessionId)
  codexBorn.set(t, Date.now())
  return t
}

/** One terminal per name: running again replaces it, which also stops what it was running. */
function freshTerminal(name: string, cwd: string): vscode.Terminal {
  vscode.window.terminals.find(t => t.name === name)?.dispose()
  const t = vscode.window.createTerminal({ name, cwd })
  tags.own(t)
  t.show(true)
  return t
}

/** Auto becomes claude or codex with the reason; a named AI stays as it is. */
export async function resolveAi(ai: NewChatAi, text: string | undefined, folder: string): Promise<{ ai: AiId; reason?: string }> {
  if (ai !== 'auto') return { ai }
  const p = await autoPick(text ?? '', hub.get().ais, presetFor(folder, 'route'))
  return { ai: p.ai, reason: `Auto: ${p.ai === 'codex' ? 'Codex' : 'Claude'}, because ${p.reason}` }
}

/**
 * A chat in its own terminal, named by a short title made from the goal (the project's name
 * with no goal). Remote Control gets the same title: its name outranks --name. Answers why it could not start.
 * ai: 'auto' picks claude or codex from the task (picker.ts) and says why in a notice.
 * id: the Claude chat's session id, when the caller tracks it (a To-do item).
 * noRemote: Remote Control stays off even when it is on at startup, so a To-do run stays in VS Code.
 * todo: a To-do run's label (runLabel): the chat is named `To-do N: <title>` and gets it as SWITCHBOARD_TODO.
 * group: a split's group id (split.ts), saved once the session id is known.
 */
export async function newChat(folder: string, text: string | undefined, remote: boolean, branch: string | undefined, want: NewChatAi = 'claude', tools?: ChatProfile, id?: string, noRemote = false, todo?: RunLabel, group?: string, waitOn?: string[]): Promise<string | undefined> {
  const project = hub.get().projects.find(p => p.path === folder)
  if (!project) return `${folder} is not in the project list yet; open Switchboard once and try again`
  const { ai, reason } = await resolveAi(want, text, folder)
  if (reason) void vscode.window.showInformationMessage(`Switchboard: ${reason}`)
  const goal = text?.trim()
  const inv = ai === 'claude' && hub.get().installed.length ? await chatInventory(folder) : []
  // Every Claude chat gets its own tool set, never the user's settings.json. Codex keeps its own.
  const named = goal ? await titleFor(goal, quickAsk) : project.name
  // Prefix, not suffix: a handoff's version number has to stay at the end (projects.ts CHAIN).
  const title = todo ? `To-do ${todo.n}: ${named}` : named
  // A profile the panel sent is Kenneth's pick; the default one takes what the first message names.
  const start = startProfile(inv, tools)
  const profile = start && !tools ? withGoal(start, text ?? '', inv) : start
  // Codex has no hook to read the brief from, so it rides in front of the first message.
  // Codex has no --append-system-prompt: Claude's system notes ride in the brief's block, which the row name skips (ais.ts withoutBrief).
  const notes = ai === 'codex' ? [profile ? toolsNote(profile, new Set(inv.filter(i => i.held).map(i => i.name))) : '', myName(), accountsNote(readLogins(), readLinks(), folder, hub.get().signIns.chrome, browserFor(hub.get().signIns.browsers ?? {}, folder)) ?? ''].filter(Boolean).join(' ').replace(/\s*\n\s*/g, ' ') : ''
  const lead = [withBrief(hub.get(), folder, undefined), notes && `Switchboard notes: ${notes}`].filter(Boolean).join('\n')
  const first = withPointer(ai === 'claude' ? '' : [lead, text].filter(Boolean).join('\n\n'), rulesState.ready[ai], rulesState.kit)
  if (ai === 'codex') {
    const t = await codexTerminal(`${AIS.codex.name}: ${title}`, folder, first.trim() ? [first] : [], undefined, todoEnv(todo))
    if (typeof t === 'string') return t
    t.show(true)
    // The row is tied by the message, never the brief in front of it (ais.ts); the title is what it then shows.
    waitForCodex(t, folder, rowName(text ?? '') || undefined, group, title, waitOn)
    return undefined
  }
  if (ai === 'hermes') {
    const t = openChatTerminal({ name: `${AIS.hermes.name}: ${title}`, cwd: folder }, AIS.hermes.name)
    t.show(true)
    t.sendText(typed(AIS.hermes.startCommand({ text: first }, SHELL)))
    return undefined
  }
  let command: string
  const sessionId = id ?? (profile ? crypto.randomUUID() : undefined)
  try {
    const settings = chatSettings(sessionId, profile, noRemote)
    if (sessionId && profile) setChatProfile(sessionId, profile)
    command = newChatCommand({ textFile: messageFile(withPointer(text ?? '', rulesState.ready.claude, rulesState.kit)), name: title, remote: remote ? title : undefined, branch, sessionId, settings, system: [settings && profile ? toolsNote(profile, new Set(inv.filter(i => i.held).map(i => i.name))) : '', myName(), accountsNote(readLogins(), readLinks(), folder, hub.get().signIns.chrome, browserFor(hub.get().signIns.browsers ?? {}, folder)) ?? ''].filter(Boolean).join(' ') || undefined }, SHELL)
  } catch (err) {
    return (err as Error).message
  }
  trustHere(folder)
  if (group && sessionId) saveGroup(sessionId, group)
  const t = openChatTerminal({ name: `${AIS[ai].name}: ${title}`, cwd: folder, env: { ...chatEnv(folder), ...todoEnv(todo) } }, AIS[ai].name, sessionId)
  t.show(true)
  t.sendText(typed(command))
  return undefined
}

const devName = (project: string) => `Dev: ${project}`
const devTerminal = (project: string) => vscode.window.terminals.find(t => t.name === devName(project) && t.exitStatus === undefined)

/**
 * A project's dev server as its terminal's own process, like a Codex chat: Ctrl+C, a crash or Stop ends the
 * terminal too. A second press brings the running one up. False when it was already running.
 * Found by name, so two projects with one folder name share a terminal.
 */
export function startDev(folder: string, project: string, command: string): boolean {
  const open = devTerminal(project)
  if (open) { open.show(true); return false }
  const win = process.platform === 'win32'
  const t = vscode.window.createTerminal({ name: devName(project), cwd: folder, env: chatEnv(folder),
    shellPath: win ? process.env.ComSpec ?? 'cmd.exe' : process.env.SHELL || '/bin/zsh', shellArgs: win ? ['/d', '/c', command] : ['-lc', command] })
  tags.own(t)
  t.show(true)
  return true
}

/** Ends this window's dev terminal for the project; false when it has none. */
export function stopDev(project: string): boolean {
  const t = devTerminal(project)
  t?.dispose()
  return !!t
}

/** The user's plugins and skills plus the project's own skills and design references. */
const chatInventory = async (folder: string | undefined) => [...hub.get().installed, ...(folder ? await projectInventory(folder).catch(() => []) : []), ...await libraryInventory()]

const myName = () => nameNote(hub.get().controls.switchboard.name) ?? ''

const toolsState = () => hub.get().tools ?? { flagged: FLAGGED, pick: null, chats: {} }
/** Shows a chat's saved profile in the panel at once, before the next refresh reads it back. */
export const setChatProfile = (sessionId: string, p: ChatProfile) => hub.set({ tools: { ...toolsState(), chats: { ...toolsState().chats, [sessionId]: p } } })

/** The New chat form's Pick tools: the all-on defaults as chips to toggle before Start; with the folder, its project skills and design references too. */
export async function pickTools(goal: string, folder?: string): Promise<void> {
  const inv = await chatInventory(folder)
  const profile = withGoal(defaultProfile(inv), goal, inv)
  hub.set({ tools: { ...toolsState(), pick: { goal, folder, profile } } })
}

/** A chat's tools changed in the panel: saved now, used when it is resumed. */
export async function saveChatTools(sessionId: string, p: ChatProfile): Promise<string | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return 'Not a chat id'
  // The chat's own folder, so its project skills and design references survive the save.
  const profile = cleanProfile(p, await chatInventory(hub.get().chats.find(c => c.sessionId === sessionId)?.cwd))
  // Run indefinitely is set by its own command; an edit of the tools keeps it as saved.
  const was = savedProfile(sessionId)
  delete profile.indefinite
  if (was?.indefinite) profile.indefinite = was.indefinite
  if (was?.budget) profile.budget = was.budget
  if (was?.checkBack) profile.checkBack = was.checkBack
  saveProfile(sessionId, profile)
  setChatProfile(sessionId, profile)
  return undefined
}

/** Sent to a chat when Run indefinitely goes on; the mod's Stop block and question denials do the rest. */
export const INDEFINITE_TEXT = 'Run indefinitely is on for this chat. Ask every question you need now, in one AskUserQuestion round; after that you will not be able to ask. Then keep building and checking on your own: audit for bugs, errors, user problems and hard-to-use parts, fix them, add components that would help, run the checks, repeat. Never commit. When nothing is left you can improve, end with the line `Run indefinitely: done`.'

/** Run indefinitely on or off for one chat: the flag lives in its saved profile and in indefinite.json. True when it just went on. */
export async function setIndefinite(sessionId: string, on: boolean): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error('Not a chat id')
  if (!on) {
    const rest = clearIndefinite(sessionId)
    if (rest) setChatProfile(sessionId, rest)
    return false
  }
  if (indefiniteOn(sessionId)) return false
  const base = savedProfile(sessionId) ?? (hub.get().installed.length ? defaultProfile(await chatInventory(hub.get().chats.find(c => c.sessionId === sessionId)?.cwd)) : { plugins: {}, skills: {} })
  const profile = { ...base, indefinite: Date.now() }
  saveProfile(sessionId, profile)
  setChatProfile(sessionId, profile)
  syncIndefinite()
  return true
}

/** Sent to a chat by Refine now. */
export const REFINE_TEXT = 'Run the aar skill now on this chat so far, then carry on.'

/** A chat's saved profile, else the all-on defaults. */
async function baseProfile(sessionId: string): Promise<ChatProfile> {
  return savedProfile(sessionId) ?? (hub.get().installed.length ? defaultProfile(await chatInventory(hub.get().chats.find(c => c.sessionId === sessionId)?.cwd)) : { plugins: {}, skills: {} })
}

/** Saves a changed profile: the file, the chat's state and, for a budget, indefinite.json. */
function commit(sessionId: string, profile: ChatProfile): void {
  saveProfile(sessionId, profile)
  setChatProfile(sessionId, profile)
  syncIndefinite()
}

const limit = (v: number | null | undefined, max: number) => (typeof v === 'number' && v > 0 ? Math.min(v, max) : undefined)

/** Run indefinitely limits for one chat: a field null clears it, one left out keeps it. maxHours up to a week, maxCostUsd up to 10000. */
export async function setBudget(sessionId: string, b: { maxHours?: number | null; maxCostUsd?: number | null; gate?: string | null }): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error('Not a chat id')
  const base = await baseProfile(sessionId)
  const next = { ...base.budget }
  if (b.maxHours !== undefined) { const v = limit(b.maxHours, 168); if (v) next.maxHours = v; else delete next.maxHours }
  if (b.maxCostUsd !== undefined) { const v = limit(b.maxCostUsd, 10_000); if (v) next.maxCostUsd = v; else delete next.maxCostUsd }
  if (b.gate !== undefined) { const v = b.gate?.trim().slice(0, 500); if (v) next.gate = v; else delete next.gate }
  // Codex reports no cost, so a cost cap could never apply.
  if (hub.get().chats.find(c => c.sessionId === sessionId)?.ai === 'codex') delete next.maxCostUsd
  const { budget: _, ...rest } = base
  commit(sessionId, Object.keys(next).length ? { ...rest, budget: next } : rest)
}

/** Check-back on at everyMin (the count starts over) or off. */
export async function setCheckBack(sessionId: string, everyMin: 10 | 30 | 60 | null): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error('Not a chat id')
  if (everyMin !== null && ![10, 30, 60].includes(everyMin)) throw new Error('Check back is every 10, 30 or 60 minutes')
  const { checkBack: _, ...rest } = await baseProfile(sessionId)
  commit(sessionId, everyMin ? { ...rest, checkBack: { everyMin, count: 0 } } : rest)
}

/** One check-back went out (step 1), or its send failed (step -1: count back, lastAt kept so it waits a full interval). */
export function noteCheckBack(sessionId: string, now = Date.now(), step: 1 | -1 = 1): void {
  const p = savedProfile(sessionId)
  if (p?.checkBack) commit(sessionId, { ...p, checkBack: { ...p.checkBack, count: Math.max(0, p.checkBack.count + step), lastAt: step > 0 ? now : p.checkBack.lastAt } })
}

/** The mod saw the closing line: the flag goes, here and in the file. */
export function indefiniteDone(sessionId: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return
  const rest = clearIndefinite(sessionId)
  if (rest) setChatProfile(sessionId, rest)
}

/** Ends a Codex chat Switchboard started, by closing the terminal tied to its session; false when none is. Called only once the chat is idle. */
export function closeCodexChat(sessionId: string): boolean {
  const t = codexTerm(sessionId)
  codexTerminals.delete(sessionId)
  t?.dispose()
  return !!t
}

// After a window reload the map is empty; the pid memo in terminals.ts still knows the chat's terminal.
const codexTerm = (sessionId: string) => codexTerminals.get(sessionId) ?? tags.ourOf(sessionId)

/** Whether a live terminal is tied to this Codex chat, so the message box can type into it. */
export const codexTied = (sessionId: string) => { const t = codexTerm(sessionId); return !!t && t.exitStatus === undefined }

/** Types a message into a Codex chat's terminal as Kenneth would; Enter goes a beat later so Codex reads the paste first. */
export async function sendToCodex(chat: ChatRow, text: string): Promise<string | undefined> {
  const paste = codexPaste(text)
  if (!paste) return 'the message has control characters in it, so it was not typed into Codex'
  const t = codexTerm(chat.sessionId)
  const problem = await codexReady({ terminal: t, live: chat.live, startedAt: (t && codexBorn.get(t)) ?? 0, now: Date.now() })
  if (problem || !t) return problem
  t.show(true)
  t.sendText(paste, false)
  setTimeout(() => t.sendText('\r', false), 150)
  return undefined
}

/** Opens one of a chat's changed files against HEAD; only a file in its listed changes, inside its folder. */
export async function openDiff(sessionId: string, file: string): Promise<string | undefined> {
  const c = hub.get().changes
  const f = c?.sessionId === sessionId ? c.files.find(x => x.path === file) : undefined
  if (!c || !f || !insideCwd(c.cwd, file)) return 'That file is not in this chat\'s changes'
  // A deleted file has nothing on disk; any other must be a plain file whose real path stays in the folder (no symlinks).
  const real = f.status === 'deleted' ? path.join(c.cwd, file) : await safeFile(c.cwd, file)
  if (!real) return 'That file is a symlink or leads outside the chat\'s folder, so it is not opened'
  const right = vscode.Uri.file(real)
  if (f.status === 'untracked' || f.status === 'added') { await vscode.window.showTextDocument(right, { preview: true }); return undefined }
  type GitApi = { toGitUri(uri: vscode.Uri, ref: string): vscode.Uri; openRepository?(root: vscode.Uri): Promise<unknown> }
  const ext = vscode.extensions.getExtension<{ getAPI(v: 1): GitApi }>('vscode.git')
  const api = (ext?.isActive ? ext.exports : await ext?.activate())?.getAPI(1)
  if (!api) { if (f.status !== 'deleted') await vscode.window.showTextDocument(right, { preview: true }); return api ? undefined : `${editor.name}'s Git extension is off` }
  await api.openRepository?.(vscode.Uri.file(c.cwd))
  const left = api.toGitUri(right, 'HEAD')
  if (f.status === 'deleted') await vscode.window.showTextDocument(left, { preview: true })
  else await vscode.commands.executeCommand('vscode.diff', left, right, `${file} (HEAD vs working tree)`)
  return undefined
}

/** Opens a closed chat's handoff note in the editor; only a note under ~/.claude/handoffs. */
export function openNote(sessionId: string): string | undefined {
  const note = hub.get().archive.find(a => a.sessionId === sessionId)?.note
  const full = note ? path.resolve(note) : ''
  if (!full.startsWith(HANDOFFS + path.sep) || !fs.existsSync(full)) return 'That chat\'s handoff note is gone'
  void vscode.window.showTextDocument(vscode.Uri.file(full), { preview: true })
  return undefined
}

/** Shows the terminal a chat runs in, found by its name; false when none matches. */
export function focusChat(sessionId: string): boolean {
  // Name matching misses chats not started from Switchboard; match by pid (the chat is a child of the terminal's shell) if that matters.
  const name = hub.get().chats.find(c => c.sessionId === sessionId)?.name
  const t = tags.of(sessionId) ?? (name ? vscode.window.terminals.find(x => x.name.endsWith(`: ${name}`)) : undefined)
  // Only a click (Focus chat, a toast's Show) lands here, so this one takes focus; agent-started terminals use show(true).
  t?.show()
  return !!t
}

/** Types a prompt's answer into the chat's terminal, one key at a time; 300ms apart was checked to land. */
/** claim runs once the terminal is known, before any key goes out, so a refused answer leaves the prompt showing; false: a second tap got there first. */
export async function answerInTerminal(pid: number, keys: string[], claim: () => boolean): Promise<string | undefined> {
  const t = await chatTerminal(pid, vscode.window.terminals)
  if (!t) return `that chat runs outside this ${editor.name} window, so answer it in its terminal`
  if (!claim()) return 'that prompt is already answered or gone'
  for (const [i, k] of keys.entries()) {
    if (i) await new Promise(r => setTimeout(r, 300))
    t.sendText(k, false)
  }
  return undefined
}

/** Reopens a chat by its id in a new terminal in the chat's folder (known, else folder). prompt: a Claude chat's first message. */
export async function resumeChat(sessionId: string, ai: AiId, prompt?: string, folder?: string): Promise<string | undefined> {
  // The id goes into a shell line: only the hex and dashes a session id has.
  if (!/^[0-9a-f-]{8,64}$/i.test(sessionId)) return 'Not a chat id'
  const s = hub.get()
  const cwd = [...s.chats, ...s.starred, ...s.archive].find(c => c.sessionId === sessionId)?.cwd ?? folder
  if (!cwd || !fs.existsSync(cwd)) return 'That chat\'s folder is gone'
  const name = `${AIS[ai].name}: ${projectName(cwd)}`
  if (ai === 'codex') {
    const t = await codexTerminal(name, cwd, ['resume', sessionId], sessionId)
    if (typeof t === 'string') return t
    t.show(true)
    codexTerminals.set(sessionId, t)
    return undefined
  }
  if (ai === 'hermes') {
    const t = openChatTerminal({ name, cwd }, AIS.hermes.name, sessionId)
    t.show(true)
    t.sendText(typed(AIS.hermes.resumeCommand(sessionId)))
    return undefined
  }
  trustHere(cwd)
  const t = openChatTerminal({ name, cwd, env: { ...chatEnv(cwd), ...heldEnv(cwd, [sessionId]) } }, AIS[ai].name, sessionId)
  t.show(true)
  t.sendText(typed(AIS[ai].resumeCommand(sessionId, myName()) + (prompt ? ` ${shellQuote(prompt, SHELL)}` : '')))
  return undefined
}

/** A name git does not have yet: the name, then name-2 up to name-9. */
async function freeBranch(cwd: string, name: string): Promise<string> {
  const taken = (b: string) => new Promise<boolean>(resolve => execFile('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], { cwd }, err => resolve(!err)))
  for (let i = 1; i <= 9; i++) {
    const b = i === 1 ? name : `${name}-${i}`
    if (!(await taken(b))) return b
  }
  return `${name}-${Date.now().toString(36)}`
}

/** The checked-out branch from .git/HEAD, without running git. */
export function headBranch(cwd: string): string | undefined {
  try { return /^ref: refs\/heads\/(.+)$/m.exec(fs.readFileSync(path.join(cwd, '.git', 'HEAD'), 'utf8'))?.[1].trim() } catch { return undefined }
}

/**
 * A full chat's handoff: the note gets a header naming both chats, the old chat is
 * recorded in its chain and archived for History, and a fresh chat named `<origin> vN`
 * starts in the same folder on the note. The old chat is closed by hub-service.ts
 * (Claude) or hub-panel.ts (Codex) once it is safe to.
 */
export async function continueInFreshChat(h: Handoff, workspace: string | undefined): Promise<boolean> {
  if (!inWorkspace(h.cwd, workspace)) return false
  const name = projectName(h.cwd)
  const fresh = nextChainName(h.name, name, h.plan, h.task)
  const base = chainBase(fresh) ?? fresh
  const ai = h.ai ?? 'claude'
  try {
    const note = fs.readFileSync(h.note, 'utf8')
    fs.writeFileSync(h.note, labelNote(stillRunning(note, h.running), {
      n: chainVersion(fresh), base, from: h.name || name, id8: h.sessionId.slice(0, 8), to: fresh,
      branch: h.branch || headBranch(h.cwd) || 'unknown', plan: h.plan ? path.relative(h.cwd, h.plan) : 'none',
    }))
    recordChain(h.sessionId, base)
  } catch (err) { void vscode.window.showWarningMessage(`Switchboard: could not label the handoff note (${(err as Error).message}).`) }
  const text = withPointer(freshPrompt(h.note), rulesState.ready[ai], rulesState.kit)
  const codex = ai === 'codex'
  // The fresh chat keeps the old one's tool set; one started outside Switchboard gets the defaults.
  const carried = codex ? undefined : savedProfile(h.sessionId)
    ?? (hub.get().installed.length ? defaultProfile(await chatInventory(h.cwd)) : undefined)
  // Always an id for a Claude chat, so a To-do item in progress follows it.
  const freshId = codex ? undefined : crypto.randomUUID()
  // A To-do chat stays off Remote Control in every version of it.
  let settings: string | undefined, off = false
  try { if (freshId) ({ settings, off } = handoffSettings(h.sessionId, freshId, carried)) } catch { /* starts with the user's defaults */ }
  // Run indefinitely moves to the fresh chat: its profile holds the flag now, the old one lets go.
  if (carried?.indefinite && freshId) {
    try { setChatProfile(freshId, carried); indefiniteDone(h.sessionId) } catch { /* the flag stays with the old chat */ }
  }
  const system = [settings && carried ? toolsNote(carried) : '', myName()].filter(Boolean).join(' ') || undefined
  const tools = { ...(settings ? { settings } : {}), system }
  const claude = (branch?: string) => newChatCommand({ textFile: messageFile(text), name: fresh, remote: hub.get().rc.atStartup && !off ? fresh : undefined, branch, sessionId: freshId, ...tools }, SHELL)
  let command = ''
  try {
    // Codex has no --name and no hook to read the brief from: the brief rides in front, the name lives in the note.
    if (!codex) {
      const branch = h.branch ? await freeBranch(h.cwd, h.branch) : undefined
      try { command = claude(branch) } catch {
        // A branch the shell line cannot carry: the fresh chat starts on the current branch instead, and says so.
        command = claude()
        void vscode.window.showWarningMessage(`Switchboard: ${fresh} starts on the current branch; "${h.branch}" is not a usable branch name.`)
      }
    }
  } catch (err) {
    void vscode.window.showWarningMessage(`Switchboard: ${(err as Error).message}.`)
    return false
  }
  if (!codex) trustHere(h.cwd)
  const t = codex
    ? await codexTerminal(`Codex: ${fresh}`, h.cwd, [withBrief(hub.get(), h.cwd, text)])
    : openChatTerminal({ name: `Claude: ${fresh}`, cwd: h.cwd, env: { ...chatEnv(h.cwd), ...heldEnv(h.cwd, [h.sessionId]) } }, 'Claude', freshId)
  if (typeof t === 'string') {
    void vscode.window.showWarningMessage(`Switchboard: ${t}.`)
    return false
  }
  t.show(true)
  if (codex) waitForCodex(t, h.cwd, fresh)
  else t.sendText(typed(command))
  // Only now that the fresh chat runs: the old chat moves to History and is closed once the fresh one posts.
  try {
    recordArchive({
      sessionId: h.sessionId, ai, name: h.name || base, origin: base, version: chainVersion(fresh) - 1, cwd: h.cwd, project: name,
      note: h.note, startedAt: hub.get().progress.find(p => p.sessionId === h.sessionId)?.startedAt, archivedAt: Date.now(),
    })
  } catch (err) { void vscode.window.showWarningMessage(`Switchboard: could not move the old chat to History (${(err as Error).message}).`) }
  if (!codex) hub.closeAfterFresh(h.sessionId, h.cwd)
  if (freshId) void moveTodoChat(h.cwd, h.sessionId, freshId).catch(() => {})
  return true
}

/** Refreshes the portable kit from this machine, in a terminal so the result shows. Answers why it could not. */
export function exportKit(root: string): string | undefined {
  const setup = path.join(root, 'claude-mods', 'kit', 'setup.mjs')
  if (!fs.existsSync(setup)) return `no kit at ${setup}`
  freshTerminal('Kit: export', path.dirname(setup)).sendText(`node "${setup}" --export`)
  return undefined
}

/** Set up: asks for the 21st key (empty skips), then runs the missing install steps in a terminal. The key rides in the env only. */
export async function runSetup(ext: string): Promise<void> {
  const key = await vscode.window.showInputBox({ title: 'Switchboard setup', prompt: '21st.dev API key for Magic (from 21st.dev/mcp). Leave empty to skip.', password: true, ignoreFocusOut: true })
  if (key === undefined) return
  const kit = JSON.parse(fs.readFileSync(path.join(ext, 'kit', 'setup.json'), 'utf8')) as SetupKit
  const steps = setupSteps(kit, { ...setupState(os.homedir()), key21st: !!key.trim(), modsDir: path.join(ext, 'kit', 'mods'), skillsDir: path.join(ext, 'kit', 'skills'), keys: hub.get().signIns.keys })
  const plan = path.join(os.tmpdir(), 'switchboard-setup.json')
  fs.writeFileSync(plan, JSON.stringify(steps))
  shareKitWithHermes() // no-op without ~/.hermes
  vscode.window.terminals.find(t => t.name === 'Switchboard setup')?.dispose()
  const t = vscode.window.createTerminal({ name: 'Switchboard setup', cwd: os.homedir(), env: key.trim() ? { [KEY_ENV]: key.trim() } : undefined })
  tags.own(t)
  t.show(true)
  // Same line in sh, cmd and PowerShell.
  t.sendText(`node "${path.join(ext, 'kit', 'setup-run.mjs')}" "${plan}"`)
}

/** Where the one Remote Control server runs: phone chats start here and can work in any repo under it. */
const RC_ROOT = () => path.join(os.homedir(), 'Documents', 'GitHub')
const RC_TERMINAL = `RC ${RC_NAME}`

/** The machine's one Remote Control server, in its own long-lived terminal, unless the kit's LaunchAgent runs it. */
export async function rcServer(folder: string, on: boolean): Promise<string | undefined> {
  if (folder !== RC_ROOT()) return `Remote Control runs only in ${RC_ROOT()}`
  const open = vscode.window.terminals.find(t => t.name === RC_TERMINAL)
  if (!on) {
    if (!open && await rcRunningNow()) return `the Remote Control server was started by the kit's login item (LaunchAgent com.kenneth.switchboard.rc, or switchboard-rc.vbs in the Windows Startup folder), so turn it off there`
    open?.sendText('\x03', false)
    open?.dispose()
    return undefined
  }
  // The kit's LaunchAgent may already run one outside VS Code; a second would clash with it.
  if (open || await rcRunningNow()) return undefined
  if (!fs.existsSync(RC_ROOT())) return `no ${RC_ROOT()} folder`
  trustHere(RC_ROOT())
  freshTerminal(RC_TERMINAL, RC_ROOT()).sendText(rcServerCommand())
  return undefined
}

export const rcServers = () => [{ folder: RC_ROOT(), name: RC_NAME, on: vscode.window.terminals.some(t => t.name === RC_TERMINAL) || rcRunning() }]

const LOGIN_MS = 5 * 60 * 1000

/** A sign-in's failure or fallback note on its row (aws:<profile>, login:<app>:<id>); no text clears it. */
function rowSet(slot: 'errors' | 'notes', key: string, text?: string): void {
  const si = hub.get().signIns
  const next = rowText(si[slot], key, text)
  if (next) hub.set({ signIns: { ...si, [slot]: next } })
}
export const signInError = (key: string, text?: string) => rowSet('errors', key, text)
const signInNote = (key: string, text?: string) => rowSet('notes', key, text)

/** Chrome's profile folders, and the row note when a pick was skipped for being deleted from Chrome. */
const knownChrome = () => hub.get().signIns.chrome.map(c => c.dir)
function goneNote(gone: string[], dir: string): string | undefined {
  if (!gone.length) return undefined
  const to = dir ? `Chrome: ${hub.get().signIns.chrome.find(c => c.dir === dir)?.name ?? dir}` : 'Chrome, last used profile'
  return `Chrome no longer has ${gone.join(' or ')}, so this opened in ${to}.`
}

/**
 * `aws login --profile <p>` with no stdin, opened in Chrome: the profile's own pick (chrome, else the saved one),
 * else the project's browser, else Chrome's last used profile; a pick Chrome no longer lists is skipped, with a note.
 * Python's webbrowser runs BROWSER, a fixed script; the Chrome folder rides in the env. The own pick is kept per
 * profile, a deleted one dropped. done: called when it ends, signed in or not.
 */
export function awsLogin(profile: string, chrome: string | undefined, done: () => void, project?: string, added = false): string | undefined {
  if (!validProfileName(profile)) return 'Not a profile name'
  const prefs = readPrefs()
  const own = chrome ?? prefs.chrome[profile] ?? ''
  const { dir, gone } = chromeChoice(own, project, knownChrome())
  writePrefs({ ...prefs, chrome: { ...prefs.chrome, [profile]: gone.includes(own) ? '' : own } })
  const key = `aws:${profile}`
  signInError(key)
  signInNote(key, goneNote(gone, dir))
  const env: NodeJS.ProcessEnv = { ...process.env }
  // A script that fails (no Chrome) makes webbrowser fall back to the default browser.
  const script = writeOpenChrome()
  if (script) { env.BROWSER = script; env.SWITCHBOARD_CHROME_DIR = dir }
  const child = spawn(awsBinary(), ['login', '--profile', profile], { stdio: ['ignore', 'pipe', 'pipe'], env, windowsHide: true })
  let out = ''
  const keep = (b: Buffer) => { out = (out + b.toString()).slice(-4000) }
  child.stdout.on('data', keep); child.stderr.on('data', keep)
  const timer = setTimeout(() => child.kill(), LOGIN_MS)
  let ended = false
  child.on('error', err => {
    if (ended) return
    ended = true; clearTimeout(timer); signInError(key, `aws login could not start: ${err.message}`); done()
  })
  child.on('close', code => {
    if (ended) return
    ended = true
    clearTimeout(timer)
    if (code === 0) {
      // A just-added profile that signed in as a user already there folds into that one; a re-sign-in only refreshes.
      let kept = profile
      // A throw here (config backup, prefs write) must not skip done(); the sign-in itself worked.
      try {
        const twin = added ? sameLogin(readAwsConfig(), profile) : undefined
        if (twin && !deleteAwsProfile(profile)) kept = twin
        if (kept !== profile) writePrefs(moveProfile(readPrefs(), profile, kept))
        const { [profile]: _gone, ...sessions } = readSessions()
        writeSessions({ ...(kept === profile ? readSessions() : sessions), [kept]: { at: Date.now() } })
      } catch (err) { signInNote(key, `Signed in, but Switchboard could not update its own files: ${(err as Error).message}`) }
      void vscode.window.showInformationMessage(kept === profile ? `Switchboard: signed in to AWS as ${profile}.` : `Switchboard: signed in to AWS as ${kept}; ${profile} was the same login, so it was folded into ${kept}.`)
      // The row's name and email follow whoever just signed in.
      void refreshIdentity(kept).catch(() => undefined).finally(done)
      return
    } else {
      const why = code === null ? `No sign-in within ${LOGIN_MS / 60_000} minutes, so aws login was stopped.` : loginError(out) || `aws login exited with code ${code}.`
      signInError(key, why)
      void vscode.window.showWarningMessage(`Switchboard: aws login --profile ${profile} did not finish: ${why.split('\n').pop()}`)
    }
    done()
  })
  return undefined
}

/** A device sign-in page in the picked Chrome profile, behind the front window (the BROWSER script's -g). */
function openDevice(url: string, dir: string, key: string): void {
  const script = writeOpenChrome()
  const fail = (err: Error | null) => { if (err) signInError(key, `Could not open Chrome: ${err.message}`) }
  if (script) { execFile(script, [url], { timeout: 10_000, env: { ...process.env, SWITCHBOARD_CHROME_DIR: dir } }, fail); return }
  const c = knownChrome().length ? chromeCall(url, dir) : undefined
  if (!c) { void vscode.env.openExternal(vscode.Uri.parse(url)); return }
  execFile(c.cmd, c.args, { timeout: 10_000, windowsHide: true }, fail)
}

/**
 * A CLI web app's login (CLI_APPS, Auth0 now) with no stdin: its device page opens in Chrome as awsLogin picks
 * (own, project, last used). key: the row for notes and errors. done: called when it ends, signed in or not.
 */
export function cliLogin(app: string, own: string | undefined, project: string | undefined, key: string, done: () => void): string | undefined {
  const c = CLI_APPS[app]
  if (!c) return 'that app has no CLI sign-in'
  if (!startCli(app)) { signInNote(key, 'Sign-in already open in Chrome; approve it there or wait for it to time out.'); return undefined }
  const busy = () => hub.set({ signIns: { ...hub.get().signIns, busy: cliBusy() } })
  busy()
  let ended = false
  const finish = () => { if (ended) return; ended = true; endCli(app); busy(); done() }
  const { dir, gone } = chromeChoice(own, project, knownChrome())
  signInError(key)
  signInNote(key, goneNote(gone, dir))
  const script = writeOpenChrome()
  let child: ReturnType<typeof spawn>
  try { child = spawn(cliBinary(c), c.login, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...browserEnv(dir, script) }, windowsHide: true }) } catch (err) { finish(); return `${c.login[0]} could not start: ${(err as Error).message}` }
  let out = '', opened = false
  const keep = (b: Buffer) => {
    out = (out + b.toString()).slice(-8000)
    const url = opened ? undefined : deviceUrl(out)
    if (url) { opened = true; openDevice(url, dir, key) }
  }
  child.stdout?.on('data', keep); child.stderr?.on('data', keep)
  // The kill fires close, which frees the slot.
  const timer = setTimeout(() => child.kill(), LOGIN_MS)
  child.on('error', err => { clearTimeout(timer); signInError(key, `${c.login[0]} could not start: ${err.message}`); finish() })
  child.on('close', code => {
    clearTimeout(timer)
    if (code !== 0) signInError(key, code === null ? `No sign-in within ${LOGIN_MS / 60_000} minutes, so the login was stopped.` : loginError(out) || `login exited with code ${code}.`)
    finish()
  })
  return undefined
}

/** A saved web login's URL in Chrome, picked as awsLogin picks (own, project, last used). key: its row for notes and errors. */
export function openLogin(url: string, own: string | undefined, project: string | undefined, key?: string): string | undefined {
  if (!/^https?:\/\//.test(url)) return 'Not a web address'
  const known = knownChrome()
  const { dir, gone } = chromeChoice(own, project, known)
  const c = known.length ? chromeCall(url, dir) : undefined
  if (!c) { void vscode.env.openExternal(vscode.Uri.parse(url)); return undefined }
  if (key) { signInError(key); signInNote(key, goneNote(gone, dir)) }
  execFile(c.cmd, c.args, { timeout: 10_000, windowsHide: true }, (err, _out, stderr) => {
    if (!err) return
    const why = `Could not open Chrome: ${loginError(String(stderr)) || err.message}`
    if (key) signInError(key, why)
    else void vscode.window.showWarningMessage(`Switchboard: ${why}`)
  })
  return undefined
}
