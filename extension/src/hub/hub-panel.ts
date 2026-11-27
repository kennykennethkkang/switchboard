/**
 * Connects the hub to every open view (editor panel and sidebar): `hub-state` pushes (at most one per 250 ms),
 * the panel's hub messages, and the Claude Code settings Controls may change. Gatherers (history,
 * plan, servers, ...) register with addRefresher and run on refreshHub().
 */
import * as vscode from 'vscode'
import * as os from 'os'
import { loadKept, saveKept, setOneWindow, tabTargets, TAB_COMMANDS, type TabKept } from './window-tabs'
import * as path from 'path'
import { cwdFromTranscript, hub } from './hub-service'
import { editor, shortEditor } from '../editor'
import { usageHistory } from './history'
import { readSpend, setSpend } from './spend'
import { applyPatch, codeModeOn, controlPatch, readControls } from './controls'
import type { ChatRow, DeviceAsk, GitOp, JarvisReply, RepoView, SwitchboardKey, WindowColor } from './types'
import { SHADES, titleBar, titleBarColors, windowColors } from './colors'
import { FLAGGED, PROFILES, cleanName, readProfiles, withLibrary } from './tools'
import { globalOff, readPrecedence, readSmart, setPrecedence, watchTools } from './smart-tools'
import { connections, ensureWeb, gitState, keepWebRetrying, installed, libraryInventory, listServers, newestPlan, phoneUrls, projectFolders, readChanges, readListeners, run, syncLibrary, webUrl } from './local'
import { kitDir } from '../constants'
import { newPanelState } from './hub-panel-state'
import { refuse } from './hub-panel-shared'
import { sweepPanel } from './hub-panel-sweep'
import { signInsPanel } from './hub-panel-signins'
import { syncHandle } from './sync'
import { codexPanel } from './hub-panel-codex'
import { devPanel } from './hub-panel-dev'
import { awsLogin, answerInTerminal, openLogin, stopDev, closeCodexChat, codexTied, sendToCodex, sendToContainer, continueInFreshChat, exportKit, runSetup, focusChat, newChat, openDiff, openNote, pickTools, rcServer, rcServers, resumeChat, saveChatTools, indefiniteDone, REFINE_TEXT, setBudget, setLoop, loopPrompt, type RunOpts } from './actions'
import { dropEffortGuard, keepEffortDefault } from './picks'
import { buildSmart, logLoop } from './smart-select'
import { approvedFields, closeApprovedRetry, idleResearch, staysOpenOnApprove } from './approve'
import { openChat, tags, terminalAction, watchTerminals } from './terminals'
import { signInTerminal } from './codex-login'
import { AIS, chatTerminal, closeChatTerminal } from './ais'
import { readCodexAccount } from './codex-account'
import { touch } from './idle'
import { archiveRow, goneRow, readArchive, readChains, recordArchive, removeArchive, searchNotes } from './chains'
import { newestNotes, readStarred, starredRows, toggleStar, writeStarred } from './starred'
import { rcTargets, readChats } from './sessions'
import { ask, crossNote, mergeProjects, projectName, repoPlan, repoTop, type RepoAsk } from './projects'
import { RESEARCH_ROOT, dismissOffer, isResearch } from './research'
import { LIBRARY, addResearchAsk, cancelResearchAsk, deleteResearch, listResearch, markSeen } from './research-library'
import { addFolder, beginOrganizeResearch, deleteFolder, FAILED_ORGANIZE, finishOrganizeResearch, moveResearch, organizePrompt, organizeResearch, parseOrganizeReply, researchState, renameFolder, setAutoResearch, undoOrganize } from './research-folders'
import { openResearch } from './research-window'
import { ADJUSTMENTS, applyStarts, readAdjust, runUndo, skipAction } from './adjustments'
import { AWS_SESSION_MS, awsProfiles, browserEnv, cacheTimes, chromeChoice, OPEN_CHROME, openChromeScript, browserFor, dueHeadsUps, parseAwsConfig, readAwsConfig, readChrome, readPrefs, readSessions, trackSessions, validProfileName, writeOpenChrome, writeSessions } from './aws'
import { execFile } from 'child_process'
import * as fs from 'fs'
import { hasSwitchboardHook, readSettingsFile, removeSwitchboardHooks, writeJsonAtomic } from '../hook-entries'
import { configureClaudeHooks, configureCodexHooks } from '../hooks-config'
import { askKeys } from './progress'
import { answerQuestion, choiceProblem, installAsk } from './questions'
import { claudeCall } from './setup'
import { tryHarden } from './harden'
import { quickAsk, waitsOn } from './brain'
import { MOVED, promptText, routeProject } from './route-project'
import { splitAsks } from './split'
import { escalationsByProject, excludeSwitchboard, keepSwitchboardDir, readStages, resetEscalations, setStageStatus, writeCompany } from './advanced'
import { firstRunOf } from './first-run'
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../protocol'
import { createLogger } from '../logger'
import { forgetAccessNote, syncAccessNote } from './access-note'
import { Posters, tickWork } from './posters'
import { fieldsJson } from './state-json'
import { kitHash, rulesState, syncRules, type SyncResult } from './rules'
import { applyAgentBrowsers, NOTICE_KINDS, NOTICE_SPOTS, noticeSpot, type NoticeSpot } from './background'
import { CLI_APPS, mergeTenants, readTenants } from './cli-logins'
import { LOGINS, pruneLinks, readLinks, readLogins, writeLogins } from './logins'
import { CODEX_EFFORTS, CODEX_MODELS, setRoleCodex, setRoleModel } from './roles'
import { installGuard } from './git-guard'
import { keyStatus, reconcileKeys } from './keys'
import { autoMergeOn, ghPath, git, gitOp, inWorktree, liveIn, mainOf, mergeBusy, mergeOnEnd, readRepo, realOf, repoReadKey, repoRoot, setAutoMerge, worktreeFolder } from './git'
import { readShip, shipFolder } from './ship'
import { idleChats, idleOffer } from './idle-chats'
import { startedServer } from './reap'
import { jevProject } from './jev-project'
import { mirofishPage, savedReports } from './mirofish'
import { toEnglish } from './translate'
import { decideLearn } from './learn'
import { showSummary } from './summary'
import { draftCommit } from './commit-draft'
import { jarvis } from './jarvis'
import { installVoice, macVoice, voiceBox } from './voice'
import { installKeeper, keepApp } from './keeper'
import { acceptSuggestion, addTodo, chatApproved, changeTodo, START_GRACE_MS, dismissSuggestion, editTodo, finishItem, loadLocalTodos, loadTodos, extraTodoFolders, moveTodo, replaceRemoteTodo, restoreTicked, runMessage, runOrder, projectOf, setPilot, setTodoSync, startTodo, todoFolders } from './todo'
import { randomUUID } from 'crypto'
import { dailyTrend, fillDraft, notifyIndefiniteDone, notifyAwsExpiry, notifyPaused, notifyStuck } from './notify'
import { listSnapshots, restoreSnapshot } from './snapshots'
import { checkHealth, fixHealth } from './health'
import { listPipelines, savePipeline, seedPipeline, takeSeeded } from './pipelines'
import { sendPush } from './web-push'
import { STUCK, byOwner, fixText, loops, sampleDue, type OwnedStuck } from './stuck'
import { psCost, sampleStuck, stopStuck } from './stuck-sampler'
import { readUploads, uploadEvents } from './uploads'
import { devRows, knownDev, needsWindow, postLocal, postWindow, readDev, readFocused, readOwnedStuck, readWindows, sendHome, serve, setAwake, writeFocused } from './dev'

const log = createLogger('Hub')
// Off stops updates; the note stays.
const keepAccessNote = () => { if (hub.get().controls.switchboard.accessNote) void syncAccessNote(hub.get().phoneUrls ?? null).catch(err => log.warn('Access note failed:', err)) }
const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')
const PUSH_MS = 250
// After the first full read a rescan only reads appended lines, so this stays cheap.
const HISTORY_EVERY_MS = 5 * 60 * 1000
const LIVE_EVERY_MS = 15 * 1000
const WATCHED_MS = 30 * 1000
const AWS_EVERY_MS = 10 * 60 * 1000
// Probing for the standalone app's page: at most once a minute, and on a manual refresh.
const WEB_EVERY_MS = 60 * 1000
const REPOS_EVERY_MS = 60 * 1000
// An idle chat's uncommitted changes are read again at most once a minute; a busy chat's on every tick.
const CHANGES_IDLE_MS = 60 * 1000
const REPO_ROOTS = [path.join(os.homedir(), 'Documents', 'GitHub')]
// startHub fills it; New chat awaits it after making a repo.
let refreshProjects = async () => {}
// This checkout, under its old name until the folder is moved.
const APP_REPO = ['switchboard', 'agent-flow'].map(n => path.join(REPO_ROOTS[0], n)).find(p => fs.existsSync(p)) ?? path.join(REPO_ROOTS[0], 'switchboard')
// The kit's one-row status line; the Controls switch writes this command.
const STATUS_LINE = path.join(kitDir(), 'statusline.mjs')
const statusLineCommand = () => (fs.existsSync(STATUS_LINE) ? `node "${STATUS_LINE.replace(/\\/g, '/')}"` : undefined)

// Mutable state of this window's hub; startHub makes a fresh one.
let S = newPanelState()
const posters = new Posters<ExtensionToWebviewMessage>()
// Set in startHub; the bundled browser app lives under it.
let extensionPath = ''
let voice: ReturnType<typeof voiceBox> | undefined

/** A box question, typed or spoken; undefined when a newer one replaced it. */
function askJarvis(q: string): Promise<JarvisReply | undefined> {
  const at = Date.now()
  hub.set({ jarvis: { q, at, busy: true } })
  // A newer question wins; a slow brain answer for an older one is dropped.
  return jarvis(hub.get(), q, hub.stopped()).then(r => {
    if (hub.get().jarvis?.at !== at) return undefined
    hub.set({ jarvis: { ...r, at } })
    return r
  })
}
let extensionVersion = '', installedBuild = true
// Kept across windows and restarts: the fresh-chat branch choice and Switchboard's own switches.
let store: vscode.Memento | undefined
const KEEP_KEY = 'switchboard.keep'
const CONTROLS_KEY = 'switchboard.controls'
// The user's own window.nativeTabs from before One window went on.
const TABS_KEY = 'switchboard.oneWindow'
// Codex chats Switchboard already handed off, so a full chat starts one fresh chat, not one per refresh.
const HANDED_KEY = 'switchboard.codexHandedOff'
// The kit hash last synced and what that sync found, so activation writes once per kit change.
const RULES_KEY = 'switchboard.rulesSync'
// Handed-off Codex chats still open: each is closed once it is idle. Not kept across reloads: such a chat stays open (but in History) after one.
// When each full Codex chat was first seen mid-turn; its handoff waits on the turn for at most 30 minutes.
let envs: vscode.GlobalEnvironmentVariableCollection | undefined
let statusBar: vscode.StatusBarItem | undefined
// This window's colored folder name, left of the Switchboard button; the title bar keys Switchboard wrote, per workspace.
let windowItem: vscode.StatusBarItem | undefined
let windowStore: vscode.Memento | undefined
const TITLE_KEY = 'switchboard.titleBar'
const workspace = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
// openExternal lands in Chrome's last used profile, not the folder's pick.
const openPage = (url: string) => openLogin(url, undefined, browserFor(readPrefs().browsers, workspace() ?? ''))
const { keys, handle: signInsHandle } = signInsPanel({ refreshAws: f => refreshAws(f), refreshCli: f => refreshCli(f), projectBrowser: () => projectBrowser(), readSignIns: () => readSignIns(), workspace })
const { served, devFolders, refreshDev, runDev, handle: devHandle } = devPanel(() => refreshHub())
const { sweepState, sweepCall, handle: sweepHandle } = sweepPanel(() => refreshHub(), workspace)
const refreshers: Array<(again?: boolean) => Promise<void>> = []
let onShown = () => {}

/** fn, one run at a time: a call mid-run shares that run, and with again one more run follows it, so a change made mid-run is read. */
function single(fn: () => void | Promise<void>): (again?: boolean) => Promise<void> {
  let run: Promise<void> | undefined, rerun = false
  const go = (again = false): Promise<void> => {
    if (run) { rerun ||= again; return run }
    run = Promise.resolve().then(fn).finally(() => {
      run = undefined
      if (rerun) { rerun = false; go().catch(err => log.warn('A hub refresh failed:', err)) }
    })
    return run
  }
  return go
}

/** Returns fn as refreshHub runs it, so other callers share its one run. */
export function addRefresher(fn: () => void | Promise<void>): (again?: boolean) => Promise<void> {
  const once = single(fn)
  refreshers.push(once)
  return once
}

export function refreshHub(): void {
  for (const fn of refreshers) fn(true).catch(err => log.warn('A hub refresh failed:', err))
}

const postState = () => {
  const h = hub.get(), fields = h as unknown as Record<string, unknown>
  posters.sendState(fieldsJson(h), () => ({ type: 'hub-state', hub: h }), (set, del) => ({ type: 'hub-state', delta: { set: Object.fromEntries(set.map(k => [k, fields[k]])), del } }))
}

/** Adds an open view's sender (editor panel or sidebar), sends it the current state at once and refreshes. Returns the remover. visible: whether it is on screen. */
export function addHubPoster(send: (m: ExtensionToWebviewMessage) => void, visible?: () => boolean): () => void {
  const remove = posters.add(send, visible)
  send({ type: 'hub-state', hub: hub.get() })
  refreshHub()
  return remove
}

/** A reloaded webview lost its state; posters skip unchanged state, so send it directly. */
export function resendHubState(send: (m: ExtensionToWebviewMessage) => void): void {
  posters.forget()
  send({ type: 'hub-state', hub: hub.get() })
}

/** A hidden view was shown again: it gets the current state now, and fresh reads unless the last ones are under 15 s old. */
export function hubViewShown(): void {
  postState()
  onShown()
}

/** After an update, our running browser app still serves the old copy: restart it on the new one; a stopped app is started.
 * claude-runtime.ts calls it too when it sees a rebuild on disk, before this window reloads. */
export function refreshWeb(): void {
  void keepWebRetrying(APP_REPO, { bundle: path.join(extensionPath, 'dist', 'app', 'app.js'), version: extensionVersion, rebuilds: installedBuild, installed: installedBuild })
    .then(r => { if ('problem' in r) log.warn(`Browser app not refreshed: ${r.problem}`) })
}

export function startHub(context: vscode.ExtensionContext): void {
  S = newPanelState()
  editor.name = shortEditor(vscode.env.appName)
  hub.set({ editor: editor.name })
  hub.startMirofish(toEnglish)
  void usageHistory.moveOldCache()
  hub.startCrowd()
  context.subscriptions.push({ dispose: () => hub.stopMirofish() })
  store = context.globalState
  for (const id of store.get<string[]>(HANDED_KEY) ?? []) S.handedOff.add(id)
  hub.runner = c => handleHubMessage(c as WebviewToExtensionMessage)
  hub.sweep = sweepCall
  hub.voiceClip = b => voice ? voice.clip(b) : Promise.reject(new Error('Voice is not running in this window.'))
  hub.onDevice = d => {
    if ('done' in d) asking.delete(d.id)
    else { asking.set(d.id, { ...d, at: Date.now() }); setTimeout(listDevices, ASK_MS) }
    listDevices()
    promptDevices()
  }
  context.subscriptions.push(vscode.window.onDidChangeWindowState(s => { if (s.focused) { promptDevices(); focused(); if (posters.shown) onShown() } }))
  if (vscode.window.state.focused) focused()
  // A stored onFull 'compact' from an older Switchboard is ignored: a full chat always continues fresh.
  const kept = store.get<{ freshBranch?: boolean }>(KEEP_KEY) ?? {}
  hub.set({ keep: { ...hub.get().keep, onFull: 'fresh', freshBranch: kept.freshBranch === true } })
  const controls = hub.get().controls
  hub.set({ controls: { ...controls, switchboard: { ...controls.switchboard, ...store.get(CONTROLS_KEY) } } })
  saveCompany()
  applyAsk()
  applyNoticeSpot()
  // A pick from VS Code's own bell menu sticks, so the next window does not move it back.
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (!e.affectsConfiguration('workbench.notifications.position')) return
    const v = vscode.workspace.getConfiguration('workbench.notifications').inspect('position')?.globalValue
    if (v === undefined || v === noticeSpot(hub.get().controls.switchboard)) return
    // Only the window Kenneth used saves it; the rest just follow, so a stale window never writes its old controls back.
    if (vscode.window.state.focused) void setSwitchboard('noticeSpot', v as string)
    else { const c = hub.get().controls; hub.set({ controls: { ...c, switchboard: { ...c.switchboard, noticeSpot: v as NoticeSpot } } }) }
  }))
  applyStatusBar()
  try { const why = applyAgentBrowsers(hub.get().controls.switchboard.showBrowsers); if (why) log.warn(`Agent browsers: ${why}`) } catch (e) { log.warn(`Agent browsers: ${e}`) }
  windowStore = context.workspaceState
  windowItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1)
  windowItem.command = 'agentVisualizer.open'
  context.subscriptions.push(windowItem,
    vscode.window.onDidChangeActiveColorTheme(() => refreshWindows()),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('switchboard.colorTitleBar')) refreshWindows() }))
  refreshWindows()
  readSettings()
  rulesState.kit = path.join(context.extensionPath, 'kit')
  extensionPath = context.extensionPath
  extensionVersion = context.extension.packageJSON.version
  installedBuild = context.extensionMode === vscode.ExtensionMode.Production
  refreshWeb()
  // Installed build only: a dev host would take turns rewriting the agent.
  if (process.platform === 'darwin' && installedBuild) installKeeper(path.join(extensionPath, 'keeper')).catch(err => log.warn('App keeper not installed:', err))
  syncKit()
  setupAsk(context.extensionPath)
  try { installVoice(path.join(extensionPath, 'voice')) } catch (err) { log.warn('Voice scripts not copied:', err) }
  voice = voiceBox(macVoice({ log: m => log.info(m) }), {
    show: (v, problem) => hub.set({ voice: v, ...(problem ? { jarvis: { q: 'Voice', at: Date.now(), answer: problem } } : {}) }),
    heard: text => hub.set({ heard: { text, at: Date.now() } }),
    // Straight to the views, not through hub-state: about 12 a second.
    level: level => { hub.voiceLevel = level; posters.send({ type: 'hub-voice-level', level }) },
  })
  context.subscriptions.push({ dispose: () => voice?.dispose() })
  syncLibrary(path.join(extensionPath, 'kit', 'design-md')).then(c => { if (c) log.info('Design library copied') }, err => log.warn(`Design library: could not copy (${(err as Error).message})`))
  envs = context.environmentVariableCollection
  try { reconcileKeys(keys) } catch (err) { log.warn(`API keys: could not read the store (${(err as Error).message})`) }
  readSignIns()
  let codexAccountAt = 0, codexAccountFailed = false
  addRefresher(async () => {
    if (Date.now() - codexAccountAt < 10 * 60_000) return
    codexAccountAt = Date.now()
    const status = await AIS.codex.detect()
    if (!status.installed || !status.signedIn) return
    try { hub.noteCodexAccount(await readCodexAccount()); codexAccountFailed = false }
    catch (err) { if (!codexAccountFailed) log.warn('Codex account read failed:', err); codexAccountFailed = true }
  })
  addRefresher(async () => { await usageHistory.moveOldCache(); hub.set(await usageHistory.scan()) })
  const uploadsOnce = addRefresher(async () => hub.set({ uploads: await readUploads() }))
  const onUpload = () => { uploadsOnce(true).catch(err => log.warn('Uploads: could not read INDEX.md:', err)) }
  uploadEvents.on('saved', onUpload)
  context.subscriptions.push({ dispose: () => uploadEvents.off('saved', onUpload) })
  onUpload()
  const nearOnce = addRefresher(refreshNear)
  // Tools only, no connections: the watchers below call it on every settings, profile or skills change.
  const refreshTools = single(async () => {
    const [inv, lib] = [await installed(), await libraryInventory()]
    const s = hub.get()
    const ids = [...s.chats, ...s.starred].filter(c => (c.ai ?? 'claude') === 'claude').map(c => c.sessionId)
    const chats = Object.fromEntries(Object.entries(readProfiles(ids)).map(([id, p]) => [id, withLibrary(p, lib)]))
    hub.set({ installed: inv, tools: { flagged: FLAGGED, pick: s.tools?.pick ?? null, chats: { ...s.tools?.chats, ...chats }, smart: { ...s.tools?.smart, ...readSmart(ids) }, globalOff: globalOff(), precedence: readPrecedence() }, sweep: sweepState(), spend: readSpend() })
  })
  const refreshInstalled = addRefresher(async () => {
    hub.set({ connections: await connections(REPO_ROOTS) })
    await refreshTools()
  })
  const home = path.join(os.homedir(), '.claude')
  context.subscriptions.push({ dispose: watchTools([path.join(home, 'settings.json'), PROFILES, path.join(home, 'skills')], () => { refreshTools().catch(err => log.warn('Tools refresh failed:', err)) }) })
  const guarded = new Set<string>()
  refreshProjects = async () => {
    const { repos, claude } = await projectFolders(REPO_ROOTS)
    hub.set({ projects: mergeProjects(repos, claude, workspace()) })
    // Once per repo per window; a hook failure never touches the list.
    for (const r of repos) if (!guarded.has(r)) { guarded.add(r); try { excludeSwitchboard(r) } catch (err) { log.warn('Exclude failed:', r, err) } installGuard(r).catch(err => log.warn('Git guard failed:', r, err)) }
  }
  addRefresher(refreshProjects)
  // Smart select: reads the ledger and rewrites smart-learned.json at most every HISTORY_EVERY_MS.
  let smartAt = 0
  addRefresher(async () => {
    if (Date.now() - smartAt < HISTORY_EVERY_MS) return
    smartAt = Date.now()
    try { hub.set({ smart: buildSmart(undefined, id => hub.get().chats.find(c => c.sessionId === id)?.name) }) } catch (err) { log.warn('Smart select failed:', err) }
  })
  // Once now as well, so New chat from the app or the phone works before the panel is ever opened.
  refreshProjects().catch(err => log.warn('Projects failed:', err))
  addRefresher(() => refreshAws())
  async function refreshNear() {
    S.nearAt = Date.now()
    readSettings()
    refreshWindows()
    const ws = workspace()
    const stars = readStarred()
    const webDue = Date.now() - S.webAt >= WEB_EVERY_MS
    if (webDue) S.webAt = Date.now()
    const [plan, git, servers, notes, web] = await Promise.all([
      newestPlan(ws), gitState(ws), listServers(), newestNotes(stars.map(s => s.sessionId)), webDue ? webUrl() : hub.get().webUrl, refreshChats(),
    ])
    hub.set({ plan, git, servers, rcServers: rcServers(), archive: readArchive(), webUrl: web, phoneUrls: await phoneUrls(web) })
    keepAccessNote()
    await refreshDev(servers)
    hub.set({ starred: starredRows(stars, hub.get(), notes, readChains()) })
    // Ship and the other projects' lists are several git runs per repo and worktree; Ship's own buttons read it at once.
    if (Date.now() - S.shipAt >= REPOS_EVERY_MS) await refreshShip().catch(err => log.warn('Ship list failed:', err))
    await refreshChanges(true)
    await loadTodos(todoFolders(ws)).catch(err => log.warn('To-do lists failed:', err))
    if (Date.now() - S.extraAt >= REPOS_EVERY_MS) {
      S.extraAt = Date.now()
      await loadLocalTodos(extraTodoFolders(ws)).catch(err => log.warn('Other projects to-do lists failed:', err))
    }
    hub.set({ jevProjects: Object.fromEntries(todoFolders(ws).map(f => [f, jevProject(f)])) })
  }
  const near = () => nearOnce().catch(err => log.warn('Plan, git or servers failed:', err))
  onShown = () => { if (Date.now() - S.nearAt >= LIVE_EVERY_MS) void near() }
  const slow = setInterval(() => { if (posters.shown) refreshHub() }, HISTORY_EVERY_MS)
  // Also while the standalone app reads /hub/state with no panel shown, so its chats stay current.
  // Otherwise only the chats, even with no view open, so handoffs, closing and holds still work.
  const fast = setInterval(() => {
    const work = tickWork(posters.shown, Date.now() - hub.stateReadAt < WATCHED_MS, vscode.window.state.focused, Date.now() - S.nearAt)
    if (work === 'full') void near()
    else refreshChats().catch(err => log.warn('Chats failed:', err))
  }, LIVE_EVERY_MS)
  // ps has no -o on Windows; the stuck check runs on macOS and Linux only.
  const stuck = process.platform === 'win32' ? undefined : setInterval(() => { void checkStuck() }, STUCK.sampleMs)
  const heads = setInterval(awsHeadsUp, 5 * 60 * 1000)
  // Research chats need no Approve: the Research window, which holds their terminals, closes each one left idle.
  // Per chat, the idle spell already closed; a follow-up starts a new one that closes again.
  const closed = new Map<string, number | undefined>()
  const research = setInterval(() => {
    if (!isResearch(ownWorkspace())) return
    const chats = hub.get().chats
    for (const id of closed.keys()) if (!chats.some(c => c.sessionId === id && c.live)) closed.delete(id)
    for (const id of idleResearch(chats, hub.get().progress)) {
      const at = chats.find(c => c.sessionId === id)?.updatedAt
      if (closed.has(id) && closed.get(id) === at) continue
      closed.set(id, at)
      approveChat(id)
    }
  }, 60_000)
  const offer = idleOffer({
    list: async () => {
      // The waits come first: the chats are judged with nothing awaited after.
      // This window listens too, so a list without it is cut short.
      if (process.platform !== 'win32' && !(await readListeners(true)).split('\n').includes(`p${process.pid}`)) return []
      const servers = await listServers()
      const state = hub.get(), todos = Object.values(state.todos ?? {}).flatMap(list => list.todo)
      return idleChats({
        chats: state.chats, progress: state.progress, todos,
        ours: id => !!tags.ourOf(id),
        holds: id => {
          const current = hub.get()
          if (hub.retryIds().includes(id) || [...pendingWaits].some(([from, w]) => from === id || w.on.includes(id)) || current.waits.some(w => w.sessionId === id) || current.links?.some(l => l.from === id || l.to.includes(id)) || mergeOnEnd.has(id) || startedServer(id, servers)) return true
          // An ended worktree chat's folder is merged and removed, so it could not be resumed.
          if (inWorktree(state.chats.find(c => c.sessionId === id)?.cwd ?? '')) return true
          const profile = readProfiles([id])[id]
          return !!(profile?.checkBack || profile?.indefinite)
        },
      })
    },
    rss: async pids => {
      try {
        const out = await run('ps', ['-o', 'pid=,rss=', '-p', pids.join(',')])
        const rows = out.trim().split('\n').filter(Boolean).map(row => row.trim().split(/\s+/).map(Number))
        return new Map(rows.filter(([pid, kb]) => pid > 0 && Number.isFinite(kb)).map(([pid, kb]) => [pid, kb * 1024]))
      } catch { return new Map() }
    },
    ask: text => vscode.window.showInformationMessage(text, 'Suspend', 'Close', 'Not now'),
    suspend: suspendIdleChat,
    close: approveChat,
  })
  const idle = setInterval(() => { void offer().catch(err => log.warn('Idle chat check failed:', err)) }, 5 * 60_000)
  context.subscriptions.push({ dispose: () => { clearInterval(slow); clearInterval(fast); clearInterval(heads); clearInterval(research); clearInterval(idle); if (stuck) clearInterval(stuck) } })
  const sub = hub.onChange(() => {
    syncFirstRun()
    if (S.pending || !posters.shown) return
    S.pending = setTimeout(() => {
      S.pending = undefined
      postState()
    }, PUSH_MS)
  })
  context.subscriptions.push({ dispose: () => { sub.dispose(); if (S.pending) clearTimeout(S.pending) } })
  // Runs with or without a panel open: the hook server takes the feed either way.
  context.subscriptions.push(hub.onHandoff(h => { void continueInFreshChat(h, workspace()) }))
  context.subscriptions.push(hub.onIndefiniteDone(d => { indefiniteDone(d.sessionId); notifyIndefiniteDone(d.sessionId, d.usage, d.reason) }))
  // A handed-off Claude chat runs exit; its terminal's shell would stay behind, so close that too.
  // A session can run in two processes at once (the Claude panel and a terminal), so every live one is tried.
  const livePids = (id: string) => hub.get().chats.filter(c => c.sessionId === id && c.live && c.pid).map(c => c.pid)
  hub.holds = async id => codexTied(id) || (await Promise.all(livePids(id).map(pid => chatTerminal(pid, vscode.window.terminals)))).some(Boolean)
  context.subscriptions.push(hub.onApproved(id => { approveChat(id) }))
  context.subscriptions.push(hub.onClosing(id => {
    for (const pid of livePids(id)) void closeChatTerminal(pid, vscode.window.terminals)
  }))
  // A message sent from Switchboard (panel, browser or phone): this window brings up the chat's terminal if it holds it, keeping focus where it is.
  context.subscriptions.push(hub.onPrompted(async id => {
    for (const pid of livePids(id)) (await chatTerminal(pid, vscode.window.terminals))?.show(true)
  }))
  // The chat could not run exit itself: end its process, but only while it is idle, never mid-turn.
  // nativeTabs is read once when VS Code starts, so this window's start value is what the tab buttons can do.
  hub.set({ windowTabs: { mac: process.platform === 'darwin', live: process.platform === 'darwin' && vscode.workspace.getConfiguration('window').get('nativeTabs') === true } })
  context.subscriptions.push(hub.onTab(c => { void vscode.commands.executeCommand(c) }))
  // Read fresh: the cached row may be minutes old, and its pid reused.
  // Another window asked this one to start or stop a dev server; the folder is checked again here.
  context.subscriptions.push(hub.onDev(async d => {
    await refreshChats().catch(() => {})
    const row = knownDev(devRows(devFolders(), readDev, [], null), d.folder)
    if (!row) return
    if (d.kind === 'start') runDev(row)
    else stopDev(row.project)
  }))
  context.subscriptions.push(watchTerminals(context.workspaceState))
  context.subscriptions.push(vscode.window.onDidCloseTerminal(t => {
    const s = served.get(t.name)
    if (!s) return
    served.delete(t.name)
    void serve(s.port, s.https, false).then(refreshHub)
  }))
  context.subscriptions.push(hub.onCloseFailed(async id => {
    const known = hub.get().chats.find(c => c.sessionId === id)
    const chat = (await readChats().catch(() => [])).find(c => c.sessionId === id)
    if (!known || !chat?.live || !chat.pid || chat.status !== 'idle' || chat.pid !== known.pid) return
    try { process.kill(chat.pid, 'SIGTERM') } catch { /* already gone */ }
    setTimeout(refreshHub, 800)
  }))
  // Chats and plugins once now too: handoff names, closing the old terminal, tool_on and holds need them with no panel open.
  refreshChats().then(() => refreshInstalled()).catch(err => log.warn('Chats or plugins failed:', err))
}

let stuckBusy = false, stuckAt: number | undefined
/** A stuck sample every 30 s while some chat works, every 5 min while all are idle; process hogs of idle chats stay listed. */
// Every open window samples every chat, one ps each; a chat's items then come from the window that owns it, so all panels agree.
async function checkStuck(force = false): Promise<void> {
  const now = Date.now()
  if (stuckBusy || !(force || sampleDue(stuckAt, hub.get().progress.some(p => p.state === 'working'), now))) return
  stuckBusy = true
  stuckAt = now
  try {
    // The window that owns a chat decides its stuck items; the rest are read from it.
    const [mine, others] = await Promise.all([sampleStuck(), Promise.all(readWindows().filter(w => w.pid !== process.pid).map(w => readOwnedStuck(w)))])
    hub.setStuck(byOwner(mine, id => hub.owns(id), others.filter((o): o is OwnedStuck => !!o)))
    if (psCost.runs === 1 || psCost.runs % 120 === 0) log.info(`Stuck check: ps took ${psCost.lastMs.toFixed(0)} ms (mean ${(psCost.ms / psCost.runs).toFixed(0)} ms over ${psCost.runs})`)
    for (const i of hub.unseenStuck()) notifyStuck(i)
    const due = hub.dueFix()
    // Waiting on Kenneth: no message to the chat, one notice per wait.
    for (const { sessionId, why } of due.paused) notifyPaused(sessionId, why)
    if (hub.get().controls.switchboard.autoFix !== false) for (const i of due.fix) {
      void fixStuck(i.sessionId, i.id, true).then(r => { if (r === true) notifyStuck(i, Date.now(), 'fixed'); else log.warn(`Auto-fix of ${i.id} failed: ${r}`) })
    }
  } catch (err) { log.warn('Stuck check failed:', err) } finally { stuckBusy = false }
}

/** The ask tool's server into ~/.claude/switchboard/ask, registered with claude once; never blocks activation. */
function setupAsk(ext: string): void {
  try {
    installAsk(path.join(ext, 'ask'), os.homedir(), server => {
      const c = claudeCall(['mcp', 'add', '--scope', 'user', 'switchboard', '--', 'node', server])
      execFile(c.cmd, c.args, { timeout: 30_000, shell: c.shell, windowsHide: true, windowsVerbatimArguments: c.windowsVerbatimArguments }, err => {
        if (err) log.warn('Ask tool not registered:', err.message)
        else log.info(`Ask tool registered: ${server}`)
      })
    })
  } catch (err) {
    log.warn('Ask tool not installed:', err)
  }
}

/** Bundled rules and roles into ~/.claude and ~/.codex. force (Re-sync now) writes even with the switch off. */
function syncKit(force = false): void {
  const on = hub.get().controls.switchboard.syncRules
  const write = on || force
  let note: string
  try {
    const hash = kitHash(rulesState.kit)
    const last = store?.get<SyncResult & { hash: string }>(RULES_KEY)
    const r = !force && on && last?.hash === hash ? last : syncRules({ home: os.homedir(), kit: rulesState.kit, write })
    if (write) void store?.update(RULES_KEY, { hash, note: r.note, ready: r.ready, changed: [] })
    rulesState.ready = r.ready
    note = write ? r.note : 'Rules and roles: sync off'
    if (write && r.changed.length) log.info(r.note)
  } catch (err) {
    note = `Rules and roles: could not sync (${(err as Error).message})`
    log.warn(note)
  }
  hub.set({ controls: { ...hub.get().controls, rulesNote: note } })
}

/** AWS statuses at most every ten minutes (each is an STS call), unless forced after a change; Chrome profiles and picks every time. */
async function refreshAws(force = false): Promise<void> {
  readSignIns()
  if (!force && Date.now() - S.awsAt < AWS_EVERY_MS) return
  S.awsAt = Date.now()
  const rows = await awsProfiles()
  const was = readSessions(), s = trackSessions(was, rows, Date.now(), cacheTimes(parseAwsConfig(readAwsConfig())))
  if (JSON.stringify(s) !== JSON.stringify(was)) writeSessions(s)
  hub.set({ aws: rows.map(r => (s[r.name] ? { ...r, expiresAt: s[r.name].at + AWS_SESSION_MS } : r)) })
  void refreshCli()
}

let cliAt = 0
/** CLI tenants (Auth0) into the saved logins, on AWS's cadence or forced after a sign-in. Merged onto a fresh read, so edits made meanwhile stay. */
async function refreshCli(force = false): Promise<void> {
  if (!force && Date.now() - cliAt < AWS_EVERY_MS) return
  cliAt = Date.now()
  for (const id of Object.keys(CLI_APPS)) {
    const got = await readTenants(id)
    if (!got) continue
    const apps = readLogins(), links = readLinks(LOGINS, apps)
    const next = apps.map(a => (a.id === id ? mergeTenants(a, got.domains, got.status) : a))
    if (JSON.stringify(next) === JSON.stringify(apps)) continue
    writeLogins(next, LOGINS, links)
    hub.set({ signIns: { ...hub.get().signIns, apps: next, links: pruneLinks(links, next) } })
  }
}

/** This window's project browser, the fallback for sign-ins with no Chrome pick of their own. */
const projectBrowser = () => browserFor(readPrefs().browsers, workspace() ?? '')

/** One heads-up per AWS session, about 30 min before it ends, with Sign in again. The file stamp keeps other windows quiet. */
function awsHeadsUp(): void {
  const s = readSessions(), now = Date.now()
  const due = dueHeadsUps(s, now).filter(n => { const r = hub.get().aws.find(a => a.name === n); return !r || r.status === 'signed-in' })
  if (!due.length) return
  writeSessions({ ...s, ...Object.fromEntries(due.map(n => [n, { ...s[n], warned: s[n].at }])) })
  for (const name of due) notifyAwsExpiry(name, s[name].at + AWS_SESSION_MS - now, () => {
    const why = validProfileName(name) ? awsLogin(name, undefined, () => { void refreshAws(true) }, projectBrowser()) : 'Not a profile name'
    if (why) void vscode.window.showWarningMessage(`Could not sign in to ${name}: ${why}`)
  })
}

/** Every live window with its color, and this window's status bar item and title bar in its color. */
function ownWorkspace(): string | undefined {
  const ws = workspace()
  try { return ws && fs.realpathSync(ws) } catch { return ws /* keep the path as VS Code has it */ }
}

function refreshWindows(): void {
  const own = ownWorkspace()
  const live = [...new Set([...readWindows().map(w => w.workspace), ...(own ? [own] : [])])]
  const colors = windowColors(live)
  const last = readFocused()
  hub.set({ windows: live.map(w => ({ workspace: w, name: path.basename(w), color: colors[w] })), thisWindow: own, lastWindow: last && live.includes(last) ? last : undefined })
  if (own) paintWindow(own, colors[own])
}

function focused(): void {
  void checkGh()
  const own = ownWorkspace()
  if (own) { writeFocused(own); refreshWindows() }
}

function paintWindow(own: string, color: WindowColor): void {
  if (windowItem) {
    const light = [vscode.ColorThemeKind.Light, vscode.ColorThemeKind.HighContrastLight].includes(vscode.window.activeColorTheme.kind)
    windowItem.text = `$(circle-filled) ${path.basename(own)}`
    windowItem.color = SHADES[color][light ? 'light' : 'dark']
    windowItem.tooltip = `${path.basename(own)} window: open Switchboard`
    windowItem.show()
  }
  if (!windowStore) return
  // Merged into the workspace's colorCustomizations; a key set by hand is never touched (colors.ts titleBar).
  const on = vscode.workspace.getConfiguration('switchboard').get('colorTitleBar', true)
  const config = vscode.workspace.getConfiguration('workbench')
  const r = titleBar(config.inspect<Record<string, unknown>>('colorCustomizations')?.workspaceValue, windowStore.get<Record<string, string>>(TITLE_KEY) ?? {}, on ? titleBarColors(color) : {})
  if (!r) return
  config.update('colorCustomizations', Object.keys(r.next).length ? r.next : undefined, vscode.ConfigurationTarget.Workspace).then(
    () => windowStore?.update(TITLE_KEY, r.wrote),
    err => log.warn('Could not color the title bar:', err))
}

/** Chrome profiles, the profile picked per project, and this window's AWS_PROFILE for its terminals. */
function readSignIns(): void {
  const { projects, browsers } = readPrefs()
  const { errors, notes, busy } = hub.get().signIns ?? {}
  hub.set({ signIns: { chrome: readChrome(), projects, browsers, ...(workspace() ? { window: workspace() } : {}), apps: readLogins(), links: readLinks(), keys: keyStatus(), ...(errors ? { errors } : {}), ...(notes ? { notes } : {}), ...(busy?.length ? { busy } : {}) } })
  applyWindowAws(projects, browsers)
}

/** Each workspace folder's terminals get AWS_PROFILE for the profile picked for it; Use default takes it away. */
function applyWindowAws(projects: Record<string, string>, browsers: Record<string, string>): void {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const scoped = envs?.getScoped({ workspaceFolder: folder })
    const p = projects[folder.uri.fsPath]
    if (!scoped) continue
    // CLI sign-ins (aws login, gh auth, vercel login) open in Chrome through BROWSER: the project's profile, else the last used.
    const b = chromeChoice(undefined, browserFor(browsers, folder.uri.fsPath), hub.get().signIns.chrome.map(c => c.dir)).dir
    if (openChromeScript() && (scoped.get('BROWSER')?.value !== OPEN_CHROME || scoped.get('SWITCHBOARD_CHROME_DIR')?.value !== b)) {
      for (const [k, v] of Object.entries(browserEnv(b, writeOpenChrome()))) scoped.replace(k, v)
    }
    if (p && validProfileName(p)) {
      scoped.description = `Switchboard: AWS profile ${p} for this window`
      if (scoped.get('AWS_PROFILE')?.value !== p) scoped.replace('AWS_PROFILE', p)
    } else if (scoped.get('AWS_PROFILE')) scoped.delete('AWS_PROFILE')
  }
}


// The chat, or the Ship repo or worktree, whose changes a panel asked for: one for all views, the last asked wins. Make it per view if two views ever disagree.
let watched: string | undefined

const underDir = (dir: string, cwd?: string) => !!cwd && (cwd === dir || cwd.startsWith(dir + path.sep))

/** Where a chat's, or a listed repo's or worktree's, git commands run. Anything else from the page: undefined. */
const gitFolder = (id: string): string | undefined => hub.get().chats.find(c => c.sessionId === id)?.cwd ?? shipFolder(hub.get().ship, id)

/** Ship's list: every known project's repo and every chat's, with their worktrees. */
async function refreshShip(): Promise<void> {
  const h = hub.get()
  // Before the projects are listed the read is only the chats' repos, so it does not count.
  if (h.projects.length) S.shipAt = Date.now()
  const roots = [...h.projects.map(p => p.path), ...h.chats.flatMap(c => repoTop(c.cwd) ?? [])]
  const queued = new Set([...mergeOnEnd.values()].flatMap(c => { const wt = worktreeFolder(c); return wt ? [realOf(wt)] : [] }))
  const list = await readShip(roots, liveIn(h.chats, codexTied))
  hub.set({ ship: list.map(r => ({ ...r, trees: r.trees.map(t => (queued.has(realOf(t.id)) ? { ...t, queued: true } : t)) })) })
}

/** The watched chat's uncommitted changes, read again with each near refresh (onTick); an idle chat's (or repo's) at most once a minute. */
async function refreshChanges(onTick = false): Promise<void> {
  const id = watched
  const chat = id ? hub.get().chats.find(c => c.sessionId === id) : undefined
  const cwd = id ? gitFolder(id) : undefined
  if (!id || (!chat && !cwd)) { if (hub.get().changes) hub.set({ changes: null }); return }
  if (!cwd || !fs.existsSync(cwd)) {
    const problem = cwd ? `The ${chat ? 'chat\'s ' : ''}folder is gone.` : 'This chat has no folder.'
    if (hub.get().changes?.sessionId !== id || hub.get().changes?.problem !== problem) hub.set({ changes: { sessionId: id, cwd: cwd ?? '', files: [], at: Date.now(), problem } })
    return
  }
  const idle = chat ? !chat.live || chat.status === 'idle' : !hub.get().chats.some(c => c.live && c.status !== 'idle' && underDir(cwd, c.cwd))
  if (onTick && idle && hub.get().changes?.sessionId === id && Date.now() - S.changesAt < CHANGES_IDLE_MS) return
  S.changesAt = Date.now()
  const root = await repoRoot(cwd)
  let problem: string | undefined
  const repo = root ? await readRepo(root, await ghPath()) : undefined
  const key = root ? repoReadKey(root) : undefined
  const fileCache = changesByCwd.get(cwd)
  let files = key && fileCache?.key === key ? fileCache.files : undefined
  if (!files) {
    try {
      files = await readChanges(cwd)
      if (key) { changesByCwd.delete(cwd); changesByCwd.set(cwd, { key, files }); if (changesByCwd.size > 3) changesByCwd.delete([...changesByCwd.keys()][0]) }
    } catch (err) {
      problem = `Git could not read the changes: ${err instanceof Error ? err.message : String(err)}`
      files = []
    }
  }
  if (watched !== id) return
  const was = hub.get().repo
  const keep = was?.sessionId === id ? { busy: was.busy, result: was.result } : {}
  shownRoot = root
  // A commit made anywhere since the draft took its changes.
  if (root && repo && drafts.has(root) && !drafts.get(root)!.busy && draftHead.get(root) !== (repo.log[0]?.hash ?? '')) drafts.delete(root)
  const draft = root ? drafts.get(root) : undefined
  hub.set({ changes: { sessionId: id, cwd, files, at: Date.now(), ...(problem ? { problem } : {}) }, repo: repo ? { ...repo, sessionId: id, ...keep, ...(draft ? { draft } : {}) } : null })
}

const changesByCwd = new Map<string, { key: string; files: Awaited<ReturnType<typeof readChanges>> }>()

// One git op per repo at a time.
const gitBusy = new Set<string>()

// What may run while a worktree merges into the checkout: the rest would move files under its checks or its undo.
const MERGE_SAFE: ReadonlySet<GitOp> = new Set<GitOp>(['push', 'pr', 'rerun', 'merge-back', 'merge-all'])

/** A Git panel button: the repo comes from the chat's own folder or the Ship list, never from the page. */
async function runGit(m: Extract<WebviewToExtensionMessage, { type: 'hub-git' }>): Promise<boolean | string> {
  const cwd = gitFolder(m.sessionId)
  const root = cwd && fs.existsSync(cwd) ? await repoRoot(cwd) : undefined
  if (!cwd || !root) return refuse('that folder is not in a git repo')
  // A worktree merged from its repo's Ship page shows the outcome there.
  const main = worktreeFolder(cwd) ? mainOf(worktreeFolder(cwd)!) : undefined
  const mark = (patch: object) => { const r = hub.get().repo; if (r && (r.sessionId === m.sessionId || r.sessionId === main)) hub.set({ repo: { ...r, ...patch } }) }
  const chat = hub.get().chats.find(c => c.sessionId === m.sessionId) ?? hub.get().chats.find(c => c.live && inWorktree(cwd) && underDir(cwd, c.cwd))
  if (m.op === 'merge-back' && m.confirmed && chat?.live && inWorktree(chat.cwd)) {
    mergeOnEnd.set(chat.sessionId, chat.cwd)
    mark({ result: { text: 'Merges as soon as its chat ends', ok: true, at: Date.now() } })
    void refreshShip().catch(err => log.warn('Ship list failed:', err))
    return true
  }
  if (gitBusy.has(root)) return refuse('another git command is still running in this repo')
  if (!MERGE_SAFE.has(m.op) && mergeBusy(root)) {
    mark({ result: { text: 'A worktree is merging here; wait for its checks to finish', ok: false, at: Date.now() } })
    return refuse('a worktree is merging into this repo; wait for its checks to finish')
  }
  gitBusy.add(root)
  mark({ busy: m.op })
  try {
    const { sessionId: _s, type: _t, ...cmd } = m
    const r = await gitOp(root, cmd, await ghPath(), hub.get().chats.some(c => c.live && underDir(root, c.cwd)), wt => liveIn(hub.get().chats, codexTied)(wt))
    if (r.open) openPage(r.open)
    mark({ busy: undefined, result: { text: r.text, ok: r.ok, at: Date.now() } })
    return r.ok || refuse(r.text)
  } catch (err) {
    mark({ busy: undefined, result: { text: (err as Error).message, ok: false, at: Date.now() } })
    return refuse((err as Error).message)
  } finally {
    gitBusy.delete(root)
    // Pressed on Ship: the repo's page stays, and takes over from a worktree that is gone. A chat's page keeps its chat.
    const onShip = main && m.sessionId === cwd && shipFolder(hub.get().ship, main)
    watched = onShip && (watched === main || !fs.existsSync(cwd)) ? main : m.sessionId
    void refreshShip().catch(err => log.warn('Ship list failed:', err))
    void refreshChanges().catch(err => log.warn('Changes failed:', err))
    refreshHub()
  }
}

// One Write commit message per repo at a time; it reads git only, so it never waits on gitBusy.
const drafting = new Set<string>()
// Per repo root, so every chat in the repo shows it; shownRoot: the repo hub.repo holds now.
const drafts = new Map<string, NonNullable<RepoView['draft']>>()
const draftHead = new Map<string, string>()
let shownRoot: string | undefined

/** Write commit message: Haiku over the repo's whole git status and the finished chats' messages, into Source Control and RepoView.draft. */
async function runDraft(sessionId: string): Promise<boolean | string> {
  const cwd = gitFolder(sessionId)
  const root = cwd && fs.existsSync(cwd) ? await repoRoot(cwd) : undefined
  if (!root) return refuse('that folder is not in a git repo')
  if (drafting.has(root)) return true
  drafting.add(root)
  const mark = (draft: NonNullable<RepoView['draft']>) => {
    drafts.set(root, draft)
    const r = hub.get().repo
    if (r && shownRoot === root) hub.set({ repo: { ...r, draft } })
  }
  mark({ busy: true, at: Date.now() })
  draftHead.set(root, (await git(root, ['log', '-1', '--format=%h'])).out.trim())
  try {
    const d = await draftCommit(root)
    mark({ ...d, ...(d.text ? { box: fillDraft(root, d.text) } : {}), at: Date.now() })
  } finally { drafting.delete(root) }
  return true
}

// One harden check per repo at a time, sharing gitBusy so neither runs over the other.
async function runHarden(sessionId: string): Promise<boolean | string> {
  if (!hub.get().controls.switchboard.hardenBuild) return refuse('Harden build check is off in settings')
  const cwd = gitFolder(sessionId)
  const root = cwd && fs.existsSync(cwd) ? await repoRoot(cwd) : undefined
  if (!root) return refuse('that folder is not in a git repo')
  if (gitBusy.has(root)) return refuse('another command is still running in this repo')
  gitBusy.add(root)
  const mark = (patch: object) => { const r = hub.get().repo; if (r?.sessionId === sessionId) hub.set({ repo: { ...r, ...patch } }) }
  mark({ busy: 'harden' })
  try {
    const r = await tryHarden(root, { enabled: true })
    mark({ busy: undefined, result: { text: r.text, ok: r.ok, at: Date.now() } })
    return r.ok || refuse(r.text)
  } catch (err) {
    mark({ busy: undefined, result: { text: (err as Error).message, ok: false, at: Date.now() } })
    return refuse((err as Error).message)
  } finally {
    gitBusy.delete(root)
    refreshHub()
  }
}

/** A to-do change, only for a project the panel lists; run starts a chat on the items or sends them to one. */
async function todoCommand(m: Extract<WebviewToExtensionMessage, { type: `hub-todo-${string}` }>): Promise<boolean | string> {
  if (m.type === 'hub-todo-run' && !m.to && await inHome(m.path, m)) return true
  const list = hub.get().todos?.[m.path]
  // The panel offers an empty list before a chat's project has loaded one; the first item starts it.
  if (!list && m.type === 'hub-todo-add' && todoFolders(workspace()).includes(projectOf(m.path))) {
    try { await changeTodo(projectOf(m.path), d => addTodo(d, m.text)); return true } catch (err) { return refuse(`could not change the to-do list (${(err as Error).message})`) }
  }
  if (!list) return refuse('that project has no to-do list here')
  try {
    if (m.type === 'hub-todo-add') await changeTodo(m.path, d => addTodo(d, m.text))
    else if (m.type === 'hub-todo-edit') await changeTodo(m.path, d => editTodo(d, m.id, m.text))
    else if (m.type === 'hub-todo-remove') await changeTodo(m.path, d => finishItem(d, m.id))
    else if (m.type === 'hub-todo-restore') await changeTodo(m.path, d => restoreTicked(d, m.id))
    else if (m.type === 'hub-todo-accept') await changeTodo(m.path, d => acceptSuggestion(d, m.id))
    else if (m.type === 'hub-todo-dismiss') await changeTodo(m.path, d => dismissSuggestion(d, m.id))
    else if (m.type === 'hub-todo-move') await changeTodo(m.path, d => moveTodo(d, m.ids))
    else if (m.type === 'hub-todo-sync') await setTodoSync(m.path, m.on)
    else if (m.type === 'hub-todo-pilot') await changeTodo(m.path, d => setPilot(d, m))
    else if (m.type === 'hub-todo-replace') {
      const why = await replaceRemoteTodo(m.path, m.remote)
      if (why) return refuse(`could not replace the remote list (${why})`)
    }
    else {
      const items = runOrder(list.todo, m.ids)
      if (!items.length) return refuse('those to-do items are gone')
      const text = runMessage(items)
      const mark = (chat: string | undefined) => changeTodo(m.path, d => items.reduce((out, t) => startTodo(out, t.id, chat), d))
      if (m.to) {
        if (text.length > 4000) return refuse('too many items for one message; run them in a new chat')
        const sent = await sendToChat(m.to, text)
        if (sent !== true) return sent
        await mark(m.to)
        return true
      }
      if (!await runInNewChat(m.path, items, true, runOpts(m))) return refuse('those to-do items are already running in a chat')
    }
    return true
  } catch (err) {
    return refuse(`could not change the to-do list (${(err as Error).message})`)
  }
}

/** Everything the Hub shows from Claude Code's settings; also run on refresh, so edits made elsewhere show up. */
function readSettings(): void {
  const read = readSettingsFile(SETTINGS_PATH)
  if (!read.ok) return
  const s = read.settings
  const controls = hub.get().controls
  hub.set({
    rc: { ...hub.get().rc, atStartup: s.remoteControlAtStartup === true && !codeModeOn(s) },
    keep: { ...hub.get().keep, autoCompact: s.autoCompactEnabled !== false, window: typeof s.autoCompactWindow === 'number' ? s.autoCompactWindow : undefined, autoContinue: s.autoContinueAtUsageLimit === true },
    controls: { ...controls, claude: readControls(s), switchboard: { ...controls.switchboard, hooks: hasSwitchboardHook(s) }, statusLineReady: statusLineCommand() !== undefined },
  })
}

/** One whitelisted change to Claude Code's settings, written whole and atomically. */
function writeSetting(key: string, value: unknown): void {
  const patch = controlPatch(key, value, statusLineCommand())
  const read = readSettingsFile(SETTINGS_PATH)
  if (!patch || !read.ok) return
  if (key === 'effortLevel') dropEffortGuard()
  writeJsonAtomic(SETTINGS_PATH, applyPatch(read.settings, patch))
  readSettings()
}

/** extension.ts hands over its status bar button; the Controls switch shows or hides it. */
export function bindStatusBar(item: vscode.StatusBarItem): void {
  statusBar = item
  applyStatusBar()
}

/** Moves VS Code toasts to Kenneth's pick (top right by default); writes user settings only when it differs. */
function applyNoticeSpot(): void {
  const cfg = vscode.workspace.getConfiguration('workbench.notifications')
  const want = noticeSpot(hub.get().controls.switchboard)
  if (cfg.inspect('position')?.globalValue !== want) void Promise.resolve(cfg.update('position', want, true)).catch(e => log.warn(`Notice position: ${e}`))
}

function applyStatusBar(): void {
  if (hub.get().controls.switchboard.statusBar) statusBar?.show()
  else statusBar?.hide()
}

/** Ask before actions, for the command builders; keepApp lives in app.nokeep, which the keeper reads. */
function applyAsk(): void {
  const sb = hub.get().controls.switchboard
  const mode = sb.claudeMode ?? (sb.askClaude ? 'ask' : 'bypass')
  Object.assign(ask, { claude: mode === 'ask', auto: mode === 'auto', codex: !!sb.askCodex, codexModel: sb.codexModel, codexEffort: sb.codexEffort })
}

const COMPANY_FILE = path.join(os.homedir(), '.claude', 'switchboard', 'company.json')
const LEARN_FILE = path.join(path.dirname(COMPANY_FILE), 'model-learn.json')

/** usage-meter reads smart model switch and Advanced mode from company.json. */
function saveCompany(): void {
  const sb = hub.get().controls.switchboard
  try { writeCompany(COMPANY_FILE, { smartModelSwitch: sb.smartModelSwitch !== false, advancedMode: sb.advancedMode ?? {}, coderView: sb.coderView, codexFirst: sb.codexFirst !== false }) } catch (err) { log.warn('company.json not written:', err) }
}

/** Coder view for every window: globalState like the other switches, and company.json. */
function setCoderView(on: boolean): void {
  const controls = hub.get().controls
  const switchboard = { ...controls.switchboard, coderView: on }
  const { hooks: _fromSettings, ...kept } = switchboard
  void store?.update(CONTROLS_KEY, kept)
  hub.set({ controls: { ...controls, switchboard } })
  saveCompany()
}

const FIRST_RUN_KEY = 'switchboard.firstRunDismissed'
let ghSignedIn = false
/** gh auth status, rechecked on focus until it passes. */
async function checkGh(): Promise<void> {
  if (ghSignedIn) return
  const gh = await ghPath()
  if (!gh) return
  ghSignedIn = await new Promise<boolean>(r => execFile(gh, ['auth', 'status'], { timeout: 10_000, windowsHide: true }, err => r(!err)))
  syncFirstRun()
}
/** Recomputed on every state change; set only when a step flips, so it never loops. */
function syncFirstRun(): void {
  const s = hub.get()
  const next = firstRunOf(s, ghSignedIn, store?.get<boolean>(FIRST_RUN_KEY) === true)
  if (JSON.stringify(next) !== JSON.stringify(s.firstRun)) hub.set({ firstRun: next })
}

/** Advanced mode for one project: on makes its .switchboard folder, kept out of git. */
function setAdvanced(folder: string, on: boolean): string | undefined {
  if (!hub.get().projects.some(p => p.path === folder)) return `${folder} is not in the project list`
  if (on) { try { keepSwitchboardDir(folder) } catch (err) { return `could not make ${folder}/.switchboard (${(err as Error).message})` } }
  const controls = hub.get().controls
  const { [folder]: _was, ...rest } = controls.switchboard.advancedMode ?? {}
  const switchboard = { ...controls.switchboard, advancedMode: on ? { ...rest, [folder]: true } : rest }
  const { hooks: _fromSettings, ...kept } = switchboard
  void store?.update(CONTROLS_KEY, kept)
  hub.set({ controls: { ...controls, switchboard } })
  saveCompany()
  refreshStages(hub.get().chats)
  return undefined
}

/** Stage runs for Advanced mode projects, and model-learn escalations, into hub state. */
function refreshStages(chats: ChatRow[]): void {
  const on = Object.entries(hub.get().controls.switchboard.advancedMode ?? {}).filter(([, v]) => v).map(([p]) => p)
  const stages = Object.fromEntries(on.map(p => [p, readStages(p, chats.filter(c => c.cwd === p || c.cwd.startsWith(p + path.sep)).map(c => c.sessionId))]))
  hub.set({ stages, escalations: escalationsByProject(LEARN_FILE) })
}

/** Switchboard's own switches. Hooks live in Claude Code's settings; the rest in globalState. */
async function setSwitchboard(key: SwitchboardKey, value: boolean | number | string | null | undefined): Promise<void> {
  if (key === 'hooks') {
    configureCodexHooks(value === true)
    if (value === true) await configureClaudeHooks()
    else {
      const read = readSettingsFile(SETTINGS_PATH)
      if (read.ok) writeJsonAtomic(SETTINGS_PATH, removeSwitchboardHooks(read.settings))
    }
    readSettings()
    return
  }
  if (key === 'name') value = cleanName(value)
  const valid = key === 'idleMinutes' ? value === null || [5, 15, 30, 60].includes(value as number) : key === 'pauseAt' ? value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 50 && value <= 100) : key === 'codexModel' ? value === null || (CODEX_MODELS as readonly unknown[]).includes(value) : key === 'codexEffort' ? value === null || (CODEX_EFFORTS as readonly unknown[]).includes(value) : key === 'notices' ? (NOTICE_KINDS as readonly unknown[]).includes(value) : key === 'noticeSpot' ? (NOTICE_SPOTS as readonly unknown[]).includes(value) : key === 'claudeMode' ? value === 'bypass' || value === 'ask' || value === 'auto' : key === 'name' || typeof value === 'boolean'
  if (!valid) return
  if ((key === 'codexModel' || key === 'codexEffort') && value === null) value = undefined
  if (key === 'oneWindow') {
    if (process.platform !== 'darwin') return
    // Before one-window.json the kept value lived in this window's globalState; read it once, then drop it.
    saveKept(await setOneWindow(vscode.workspace.getConfiguration('window'), value === true, loadKept() ?? store?.get<TabKept>(TABS_KEY)))
    void store?.update(TABS_KEY, undefined)
    void vscode.window.showInformationMessage(`One window is ${value ? 'on' : 'off'}. Quit and reopen ${editor.name} for it to take effect.`)
  }
  const controls = hub.get().controls
  const switchboard = { ...controls.switchboard, [key]: value }
  const { hooks: _fromSettings, ...kept } = switchboard
  void store?.update(CONTROLS_KEY, kept)
  hub.set({ controls: { ...controls, switchboard } })
  if (key === 'statusBar') applyStatusBar()
  if (key === 'noticeSpot') applyNoticeSpot()
  if (key === 'smartModelSwitch' || key === 'codexFirst') saveCompany()
  if (key === 'askClaude' || key === 'claudeMode' || key === 'askCodex' || key === 'codexModel' || key === 'codexEffort') applyAsk()
  if (key === 'keepApp') keepApp(value !== false)
  if (key === 'syncRules') syncKit()
  if (key === 'showBrowsers') { const why = applyAgentBrowsers(value === true); if (why) log.warn(`Agent browsers: ${why}`) }
  // Turning it back on rewrites the note, so one deleted by hand comes back.
  if (key === 'accessNote' && value) { forgetAccessNote(); keepAccessNote() }
}

/** Writes remoteControlAtStartup; on, connects every live chat that is not connected yet. Off leaves connected chats alone. */
export function setRemoteControl(on: boolean): string | undefined {
  const read = readSettingsFile(SETTINGS_PATH)
  if (!read.ok) return `could not read ${SETTINGS_PATH} (${read.error}), so it was left alone`
  if (on && codeModeOn(read.settings)) return 'Remote Control does not work in Code Mode; take CLAUDE_CODE_EXPERIMENTAL_CODE_MODE out of ~/.claude/settings.json first'
  writeJsonAtomic(SETTINGS_PATH, { ...read.settings, remoteControlAtStartup: on })
  const targets = on ? rcTargets(hub.get().chats) : []
  for (const id of targets) hub.queue(id, { kind: 'rc' })
  hub.set({ rc: { atStartup: on, requestedAt: on ? Date.now() : undefined } })
  log.info(`Remote Control at startup ${on ? 'on' : 'off'}; connecting ${targets.length} chat(s)`)
  return undefined
}

/** Shows a refusal on the Mac and hands it back, so /hub/command answers 400 with it. */
/** Approve: History gets it with an approved stamp and its commit, then an idle chat exits and its Switchboard terminal closes. */
function approveChat(id: string): true | string {
  const s = hub.get(), chat = s.chats.find(c => c.sessionId === id), p = s.progress.find(x => x.sessionId === id)
  if (!chat && !p) return refuse('that chat is not listed')
  recordArchive({ ...archiveRow(chat ?? p!, p?.startedAt), ...approvedFields(id, p?.commit) })
  hub.set({ archive: readArchive() })
  // The worktree's work goes into the checkout's branch once the chat ends (hub-panel-codex runs the queue), unless Ship turned that off for the repo.
  const cwd = (chat ?? p!).cwd, wt = worktreeFolder(cwd)
  if (wt && autoMergeOn(mainOf(wt))) mergeOnEnd.set(id, cwd)
  void chatApproved(id, (chat ?? p!).cwd).catch(err => log.warn('Clearing the approved chat\'s missed rows failed:', err))
  // Mid-turn it keeps running; it shows in History and is closed by hand. A needs-you chat with a prompt waiting keeps running too; one with none closes.
  // waiting: the lead's turn ended and only background jobs or subagents keep it marked working.
  if (staysOpenOnApprove(p)) return true
  if (chat?.ai === 'codex') { closeCodexChat(id); return true }
  const pids = s.chats.filter(c => c.sessionId === id && c.live && c.pid).map(c => c.pid)
  closeChatTerminals(id, pids, 'Could not close the approved chat; close its terminal by hand.')
  return true
}

function suspendIdleChat(id: string): void {
  const s = hub.get(), chat = s.chats.find(c => c.sessionId === id)
  if (!chat) return
  const p = s.progress.find(x => x.sessionId === id)
  recordArchive(archiveRow(chat, p?.startedAt, true))
  hub.set({ archive: readArchive() })
  closeChatTerminals(id, s.chats.filter(c => c.sessionId === id && c.live && c.pid).map(c => c.pid), 'Could not close the suspended chat; close its terminal by hand.')
}

function closeChatTerminals(id: string, pids: number[], warning: string): void {
  if (!pids.length) return
  hub.queue(id, { kind: 'close' })
  void closeApprovedRetry(pids, vscode.window.terminals, undefined, t => tags.ownerOf(t) === 'switchboard')
    .then(ok => { if (!ok) void vscode.window.showWarningMessage(warning) })
    .catch(err => log.warn('Closing the chat failed:', err))
}

function snoozeEverywhere(id: string): void {
  hub.snooze(id)
  for (const w of readWindows()) if (w.pid !== process.pid) void postWindow(w, { kind: 'stuck-snooze', id })
}

/** Fix: a job or process is stopped first (stopStuck's checks), then the chat is told what happened and what to do. A string is why not. */
async function fixStuck(sessionId: string, id: string, auto = false): Promise<true | string> {
  const item = hub.get().stuck?.find(i => i.id === id && i.sessionId === sessionId)
  if (!item) return auto ? 'that item is gone' : refuse('that item is gone')
  const waits = hub.waitsOnUser(sessionId)
  if (waits) return auto ? `it waits on you for ${waits}` : refuse(`that chat waits on you for ${waits}; answer it first`)
  const stop = item.kind !== 'agent' && item.pid !== undefined
  if (stop) {
    const problem = await stopStuck(sessionId, id)
    if (problem) return auto ? problem : refuse(problem)
    setTimeout(() => { void checkStuck(true) }, STUCK.stopWaitMs + 1000)
  }
  const sent = await sendToChat(sessionId, fixText(item, Date.now(), stop, loops(hub.get().progress.find(p => p.sessionId === sessionId))))
  if (sent !== true) return sent
  // Nothing was stopped, so the item would sit there until the chat acts.
  if (!stop) snoozeEverywhere(id)
  log.info(`${auto ? 'Auto-fixed' : 'Fixed'} ${id}${stop ? ' (stopped)' : ''}`)
  return true
}

/** A prompt for a running chat: queued for its usage mod, or typed into Codex. */
function sendToChat(sessionId: string, message: string): true | string | Promise<true | string> {
  const text = message.trim().slice(0, 4000)
  const chat = hub.get().chats.find(c => c.sessionId === sessionId)
  if (!text || !chat) return refuse(text ? 'that chat is not running' : 'the message is empty')
  if (!chat.live) return refuse('that chat is not running')
  if (chat.ai === 'codex') return sendToCodex(chat, text).then(problem => (problem ? refuse(problem) : true))
  if (chat.container) { const problem = sendToContainer(chat, text); return problem ? refuse(problem) : true }
  if (!hub.takes(chat, false)) return refuse('that chat is not collecting messages (it is not running, or has no usage-meter mod); type in its terminal')
  hub.queue(chat.sessionId, { kind: 'prompt', text })
  return true
}

const CARD_LINK = 'Kenneth linked these in Switchboard'

// New chats from New chat that wait on others: sent once the chat runs and takes messages, which waitFor needs.
const pendingWaits = new Map<string, { on: string[]; at: number }>()
/** The run's own picks a hub-new-chat or hub-todo-run carries. */
const runOpts = (m: { model?: string; effort?: RunOpts['effort']; ultracode?: boolean; advisor?: string; auto?: boolean; research?: boolean; workbench?: boolean; container?: boolean }): RunOpts => ({ model: m.model, effort: m.effort, ultracode: m.ultracode, advisor: m.advisor, auto: m.auto, research: m.research, workbench: m.workbench, container: m.container })
/** newChat for a hub-new-chat: a Claude chat's id is picked here so its waits and group can find it; a new Codex chat's id is only known once it runs, so it cannot wait yet. */
async function startChat(folder: string, m: Extract<WebviewToExtensionMessage, { type: 'hub-new-chat' }>): Promise<string | undefined> {
  const claude = (m.ai ?? 'claude') === 'claude', waits = m.waitOn ?? []
  // A loop needs the id up front too, and so does the loop pick's ledger row; New chat offers loops to Claude chats only.
  const loop = claude && m.loop?.mode !== 'turn' ? m.loop : undefined
  const id = claude && (waits.length || m.group || loop || m.smartLoop) ? randomUUID() : undefined
  // A Codex chat has no id yet: its waits are applied once bindCodexTerminals ties it.
  const text = [m.text, takeSeeded(folder), loop?.mode === 'goal' ? loopPrompt(true, loop.doneWhen) : ''].filter(Boolean).join('\n\n') || m.text
  const problem = await newChat(folder, text, m.remote, m.branch, m.ai, m.tools, id, false, undefined, m.group, claude ? undefined : waits, claude && m.worktree === true, runOpts(m))
  if (!problem && id && waits.length) pendingWaits.set(id, { on: waits, at: Date.now() })
  if (!problem && id && m.smartLoop) logLoop(id, folder, m.smartLoop)
  // The goal text rode in the first prompt, so setLoop's own text is not sent.
  if (!problem && id && loop) void setLoop(id, loop).catch(err => log.warn(`Loop not set for ${id.slice(0, 8)}: ${(err as Error).message}`))
  return problem
}
function startWaits(now = Date.now()): void {
  for (const [id, w] of pendingWaits) {
    if (now - w.at > START_GRACE_MS) { pendingWaits.delete(id); log.warn(`Chat ${id.slice(0, 8)} never started, so its waits were dropped`); continue }
    if (!hub.get().chats.some(c => c.sessionId === id && c.live && c.takes)) continue
    pendingWaits.delete(id)
    for (const to of w.on) void Promise.resolve(waitFor(id, to)).then(r => { if (r !== true) log.warn(`Chat ${id.slice(0, 8)} could not wait on ${to.slice(0, 8)}: ${r}`) })
  }
}

/** A link made on the cards: recorded once the waiting chat has the message. */
function waitFor(from: string, to: string): true | string | Promise<true | string> {
  const target = hub.get().chats.find(c => c.sessionId === to)
  if (from === to) return refuse('a chat cannot wait on itself')
  if (!target?.live) return refuse('that chat is not running')
  const who = target.name ?? to
  if (waitsOn(hub.get().links, to, from)) return refuse(`${who} already waits on this chat, so both would wait forever`)
  // The id, not the name: two chats can share a name.
  const text = `Switchboard: Kenneth wants you to wait for ${who}. Call chats_wait with chats ["${to}"] and reason "${CARD_LINK}". When it finishes clean, continue on your own; otherwise stop and ask Kenneth.`
  const record = (r: true | string) => { if (r === true) hub.link({ from, to: [to], reason: CARD_LINK, auto: false, since: Date.now() }); return r }
  const sent = sendToChat(from, text)
  return typeof sent === 'object' ? sent.then(record) : record(sent)
}

/** Handles the panel's hub messages; false for anything else, a string for why it was refused. */
export function handleHubMessage(m: WebviewToExtensionMessage): boolean | string | Promise<boolean | string> {
  const taken = sweepHandle(m) ?? devHandle(m) ?? signInsHandle(m) ?? syncHandle(m)
  if (taken !== undefined) return taken
  switch (m.type) {
    case 'hub-send':
      touch()
      // Claude Code saves a chat's /effort as the default for new chats; this one is for the chat only.
      if (m.text.startsWith('/effort ')) keepEffortDefault(SETTINGS_PATH)
      return sendToChat(m.sessionId, m.text)
    case 'hub-answer': {
      const chat = hub.get().chats.find(c => c.sessionId === m.sessionId)
      const ask = hub.get().progress.find(p => p.sessionId === m.sessionId)?.ask
      // The ask tool's question takes its answer over the hub, wherever the chat runs.
      if (ask?.via === 'hub' && ask.id === m.askId) {
        const problem = choiceProblem(ask, m.choice)
        if (problem) return refuse(problem)
        if (!answerQuestion(ask.id, m.choice)) return refuse('that prompt is already answered or gone')
        hub.answered(m.sessionId, ask.id)
        return true
      }
      if (!chat?.live || chat.ai === 'codex') return refuse('answer that chat in its terminal')
      if (!ask || ask.id !== m.askId) return refuse('that prompt is already answered or gone')
      const keys = askKeys(ask, m.choice)
      if (typeof keys === 'string') return refuse(keys)
      const claim = () => {
        if (hub.get().progress.find(p => p.sessionId === chat.sessionId)?.ask?.id !== ask.id) return false
        hub.answered(chat.sessionId, ask.id)
        return true
      }
      return answerInTerminal(chat.pid, keys, claim).then(problem => (problem ? refuse(problem) : true))
    }
    case 'hub-rc': {
      if (m.sessionId) {
        // The chat's rc command toggles, so a chat already in the asked state is left alone.
        const row = hub.get().chats.find(x => x.sessionId === m.sessionId)
        if (!(row && !!row.bridgeId === m.on)) hub.queue(m.sessionId, { kind: 'rc' })
        return true
      }
      const problem = setRemoteControl(m.on)
      return problem ? refuse(`Remote Control ${problem}`) : true
    }
    case 'hub-rc-server': {
      return rcServer(m.folder, m.on).then(problem => {
        setTimeout(refreshHub, 800)
        return problem ? refuse(problem) : true
      })
    }
    case 'hub-open-url':
      openPage(m.url)
      return true
    case 'hub-update-check':
      void vscode.commands.executeCommand('agentVisualizer.checkForUpdates', true)
      return true
    case 'hub-update-reload':
      if (hub.get().update?.state !== 'installed') return refuse('Check for and install an update before reloading.')
      void vscode.commands.executeCommand('workbench.action.reloadWindow')
      return true
    case 'hub-mirofish-report': {
      // A saved report opens as a Markdown preview; the id names a file in the reports folder only.
      const file = savedReports().find(r => r.simId === m.simId)?.file
      if (!file) return refuse('That MiroFish report is not saved.')
      void vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(file))
      return true
    }
    case 'hub-live-dismiss':
      hub.dismissLive(m.kind, m.id)
      return true
    case 'hub-research-dismiss':
      dismissOffer(hub, m.sessionId)
      return true
    case 'hub-research-open':
      openResearch(m.sessionId)
      return true
    case 'hub-research-ask': {
      const question = m.text.trim()
      if (!question || question.length > 2000) return refuse('Ask more needs a question under 2000 characters')
      try {
        const item = listResearch(LIBRARY).find(x => x.id === m.id)
        if (!item) return refuse('that report is not saved')
        addResearchAsk(LIBRARY, m.id, question)
        const text = `/deep-research ${question}\n[adds to research: ${m.id}]\nThis follows up the saved report at ${path.join(LIBRARY, m.id)}, titled "${item.question}". Read it first; do not repeat what it covers. Report only what is new, with its own Sources section. If something changes an earlier statement, say so on a line starting "Changes the earlier report:". Do not edit the file; Switchboard adds the report to it.`
        const chat = { type: 'hub-new-chat', path: RESEARCH_ROOT, text, remote: hub.get().rc.atStartup, research: true } as const
        void (hub.get().projects.some(p => p.path === RESEARCH_ROOT) ? Promise.resolve() : refreshProjects().catch(() => undefined)).then(() => inHome(RESEARCH_ROOT, chat)).then(sent => sent ? undefined : startChat(RESEARCH_ROOT, chat as Extract<WebviewToExtensionMessage, { type: 'hub-new-chat' }>)).then(problem => { if (problem) { cancelResearchAsk(LIBRARY, m.id, question); refuse(problem) } }).catch(err => { cancelResearchAsk(LIBRARY, m.id, question); refuse((err as Error).message) })
      } catch (err) { return refuse((err as Error).message) }
      return true
    }
    case 'hub-research-folder':
      try {
        if (m.op === 'add') addFolder(LIBRARY, m.name)
        else if (m.op === 'rename') renameFolder(LIBRARY, m.name, m.to ?? '')
        else deleteFolder(LIBRARY, m.name)
        hub.set(researchState(LIBRARY))
      } catch (err) { return refuse((err as Error).message) }
      return true
    case 'hub-research-move':
      try { moveResearch(LIBRARY, m.ids, m.folder); hub.set(researchState(LIBRARY)) } catch (err) { return refuse((err as Error).message) }
      return true
    case 'hub-research-organize': {
      if (m.op === 'auto-on' || m.op === 'auto-off') { setAutoResearch(LIBRARY, m.op === 'auto-on'); hub.set(researchState(LIBRARY)); return true }
      if (m.op === 'undo') { undoOrganize(LIBRARY); hub.set(researchState(LIBRARY)); return true }
      if (!beginOrganizeResearch(LIBRARY)) return true
      hub.set(researchState(LIBRARY))
      void (async () => {
        try {
          const state = researchState(LIBRARY), rows = state.research.filter(x => m.op === 'all' || !x.folder)
          if (!rows.length) {
            finishOrganizeResearch(LIBRARY)
            hub.set(researchState(LIBRARY))
            return
          }
          const raw = await quickAsk(organizePrompt(state, rows), 60_000)
          const { assignments, created } = parseOrganizeReply(raw, rows, state.researchFolders.names)
          if (!Object.keys(assignments).length) {
            finishOrganizeResearch(LIBRARY, FAILED_ORGANIZE)
            hub.set(researchState(LIBRARY))
            return
          }
          const moved = organizeResearch(LIBRARY, assignments, created)
          finishOrganizeResearch(LIBRARY, moved ? undefined : FAILED_ORGANIZE)
          hub.set(researchState(LIBRARY))
        } catch {
          finishOrganizeResearch(LIBRARY, FAILED_ORGANIZE)
          hub.set(researchState(LIBRARY))
        }
      })()
      return true
    }
    case 'hub-research-seen':
    case 'hub-research-delete': {
      try {
        if (m.type === 'hub-research-seen') markSeen(LIBRARY, m.id)
        else deleteResearch(LIBRARY, m.id)
        hub.set(researchState(LIBRARY))
      } catch (err) { return refuse((err as Error).message) }
      return true
    }
    case 'hub-adjust-apply':
      try {
        for (const start of applyStarts(m.report, m.keys, hub.get().projects.map(p => p.path))) void handleHubMessage(start)
      } catch (err) { return refuse((err as Error).message) }
      return true
    case 'hub-adjust-undo':
      return runUndo(m.id, m.force).then(async problem => {
        hub.set({ adjust: { ...await readAdjust(), said: problem ? { id: m.id, text: problem } : undefined } })
        return problem ? refuse(problem) : true
      })
    case 'hub-adjust-skip':
      try { skipAction(ADJUSTMENTS, m.report, m.key) } catch (err) { return refuse((err as Error).message) }
      void readAdjust().then(a => hub.set({ adjust: { ...a, said: hub.get().adjust?.said } }))
      return true
    case 'hub-mirofish-open':
      void mirofishPage(m.simId).then(r => 'url' in r ? openPage(r.url) : refuse(r.problem), err => refuse(`Could not open MiroFish: ${(err as Error).message}`))
      return true
    case 'hub-web':
      // Starts the browser app (the vsix's copy, else the switchboard checkout's) when it is not running, with --lan for Phone; phone only wants the QR link.
      void ensureWeb(APP_REPO, m.phone === true, { bundle: path.join(extensionPath, 'dist', 'app', 'app.js'), version: extensionVersion, rebuilds: installedBuild }).then(async r => {
        if ('problem' in r) return void refuse(r.problem)
        hub.set({ webUrl: r.url, phoneUrls: await phoneUrls(r.url) })
        keepAccessNote()
        if (!m.phone) openPage(r.url)
      })
      return true
    case 'hub-setting':
      writeSetting(m.key, m.value)
      return true
    case 'hub-switchboard':
      void setSwitchboard(m.key, m.value)
      return true
    case 'hub-advanced': {
      const problem = setAdvanced(m.path, m.on)
      return problem ? refuse(problem) : true
    }
    case 'hub-coder-view':
      setCoderView(m.on)
      return true
    case 'hub-first-run':
      void store?.update(FIRST_RUN_KEY, m.dismissed).then(syncFirstRun)
      return true
    case 'hub-stage': {
      if (!hub.get().projects.some(p => p.path === m.path)) return refuse(`${m.path} is not in the project list`)
      if (hub.get().controls.switchboard.advancedMode?.[m.path] !== true) return refuse(`Advanced mode is off for ${m.path}`)
      let problem: string | undefined
      try { problem = setStageStatus(m.path, m.run, m.n, m.status) } catch (err) { problem = `stage not saved (${(err as Error).message})` }
      if (problem) return refuse(problem)
      refreshStages(hub.get().chats)
      return true
    }
    case 'hub-escalation-reset':
      try { resetEscalations(LEARN_FILE, m.project, m.role, m.files) } catch (err) { return refuse(`model-learn.json not written (${(err as Error).message})`) }
      refreshStages(hub.get().chats)
      return true
    case 'hub-compact':
      hub.queue(m.sessionId, { kind: 'compact' })
      return true
    case 'hub-pause':
      hub.endPause(m.action === 'resume')
      return true
    case 'hub-keep': {
      // onFull is taken from older clients and ignored: a full chat always continues fresh.
      if (m.freshBranch === undefined) return true
      void store?.update(KEEP_KEY, { freshBranch: m.freshBranch })
      hub.set({ keep: { ...hub.get().keep, freshBranch: m.freshBranch } })
      return true
    }
    case 'hub-new-chat':
      if (m.repo) { void startInNewRepo(m.repo, m).then(problem => { if (problem) refuse(problem) }); return true }
      // Naming the chat waits on a quick model call, so a refusal shows on the Mac but the route has already answered.
      // A window opened for a new repo can get this before its own project scan lists the folder.
      // Research chats start in the Research folder's own window, so its watcher follows them and its tab sits beside the projects.
      void (hub.get().projects.some(p => p.path === m.path) ? Promise.resolve() : refreshProjects().catch(() => undefined)).then(() => inHome(m.research ? RESEARCH_ROOT : m.path, m)).then(sent => {
        if (sent) return
        // A Claude chat's id is picked here so its waits and group can find it; a new Codex chat's id is only known once it runs.
        void startChat(m.path, m).then(problem => { if (problem) refuse(problem) })
      })
      return true
    case 'hub-split':
      void splitAsks(m.text, quickAsk).then(asks => posters.send({ type: 'hub-split-result', reqId: m.reqId, asks }))
      return true
    case 'hub-pick-tools': {
      if (m.path && !hub.get().projects.some(p => p.path === m.path)) return refuse(`${m.path} is not in the project list`)
      // The set no longer depends on the goal, so an empty one is fine.
      void pickTools(m.text.trim().slice(0, 2000), m.path).catch(err => log.warn('Tool list failed:', err))
      return true
    }
    case 'hub-tool-precedence': {
      const precedence = setPrecedence(m.name, m.value)
      const tools = hub.get().tools
      if (tools) hub.set({ tools: { ...tools, precedence } })
      return true
    }
    case 'hub-chat-tools':
      void saveChatTools(m.sessionId, m.tools).catch(err => `could not save the chat's tools (${(err as Error).message})`).then(problem => { if (problem) refuse(problem) })
      return true
    case 'hub-loop': {
      const chat = hub.get().chats.find(c => c.sessionId === m.sessionId)
      void setLoop(m.sessionId, m.loop).then(text => {
        if (!text || !chat) return
        // Codex has no mod to queue through: type it into the terminal, if this window holds it.
        if (chat.ai === 'codex') { if (codexTied(chat.sessionId)) void sendToCodex(chat, text).then(p => { if (p) refuse(p) }); else refuse('the goal loop is on, but its text was not sent: this window does not hold the Codex terminal') }
        else if (chat.live && hub.takes(chat, false)) hub.queue(chat.sessionId, { kind: 'prompt', text })
        else refuse('the goal loop is on, but its text was not sent: the chat is not running in this window')
      }).catch(err => { refuse(`could not change the loop (${(err as Error).message})`) })
      return true
    }
    case 'hub-budget':
      void setBudget(m.sessionId, m).catch(err => refuse(`could not set the budget (${(err as Error).message})`))
      return true
    case 'hub-refine':
      return sendToChat(m.sessionId, REFINE_TEXT)
    case 'hub-snapshots':
    case 'hub-snapshot-restore':
      try {
        const undone = m.type === 'hub-snapshot-restore' ? restoreSnapshot(m.id) : undefined
        const skipped = undone?.skipped ?? []
        // The undo's own "before" snapshot carries the skipped paths so the list can say so inline.
        hub.set({ snapshots: listSnapshots().map(s => (undone && skipped.length && s.id === undone.id ? { ...s, skipped } : s)) })
        if (skipped.length) return refuse(`Undo skipped ${skipped.length} file${skipped.length === 1 ? '' : 's'} outside your home folder: ${skipped.map(p => p.replace(/ \(outside home\)$/, '')).join(', ')}`)
      } catch (err) { return refuse((err as Error).message) }
      return true
    case 'hub-health':
    case 'hub-health-fix': {
      const was = hub.get().health
      hub.set({ health: { busy: true, results: was?.results ?? [], ...(was?.at ? { at: was.at } : {}) } })
      void (m.type === 'hub-health' ? checkHealth() : fixHealth(m.ids ?? [])).then(results => hub.set({ health: { busy: false, at: Date.now(), results } }))
        .catch(err => { hub.set({ health: { busy: false, results: was?.results ?? [] } }); refuse((err as Error).message) })
      return true
    }
    case 'hub-pipeline-save':
    case 'hub-pipelines':
    case 'hub-pipeline-seed':
      if (m.type !== 'hub-pipelines' && !hub.get().projects.some(p => p.path === m.path)) return refuse(`${m.path} is not in the project list`)
      try {
        if (m.type === 'hub-pipeline-save') savePipeline(m.path, m.run, m.name)
        else if (m.type === 'hub-pipeline-seed') seedPipeline(m.slug, m.path, m.run)
        hub.set({ pipelines: listPipelines() })
      } catch (err) { return refuse((err as Error).message) }
      return true
    case 'hub-trend':
      try { hub.set({ trend: dailyTrend() }) } catch (err) { return refuse((err as Error).message) }
      return true
    case 'hub-focus-chat': {
      if (focusChat(m.sessionId)) return true
      const s = hub.get(), chat = s.chats.find(c => c.sessionId === m.sessionId && c.live) ?? s.chats.find(c => c.sessionId === m.sessionId)
      const gone = () => {
        // No process (killed with no SessionEnd), never listed or deleted: an ended row takes it off the board; resuming it brings it back.
        const row = goneRow(s, m.sessionId)
        if (row) recordArchive(row)
        hub.set({ archive: readArchive() })
        return refuse('that chat is no longer running, so it moved to History')
      }
      // Running, or a Codex chat (live only means its rollout moved lately): a terminal here by pid, else the window that holds its folder.
      if (!chat?.live && chat?.ai !== 'codex') return gone()
      return (chat.pid ? chatTerminal(chat.pid, vscode.window.terminals) : Promise.resolve(undefined)).then(async t => {
        if (t) { t.show(); return true }
        if (await sendHome(chat.cwd, m)) return true
        // A quiet Codex rollout may still sit open in an unmatched terminal, with no pid to prove it ended: warn, never archive.
        return chat.pid ? refuse(`that chat runs outside this ${editor.name} window`) : refuse('no terminal here holds that Codex chat; archive it from its menu if it has ended')
      })
    }
    case 'hub-open-chat':
      openChat(m.sessionId, true)
      return true
    case 'hub-terminal': {
      const problem = terminalAction(m.id, m.act)
      if (problem) refuse(problem)
      return true
    }
    case 'hub-star': {
      const s = hub.get()
      const chat = s.chats.find(c => c.sessionId === m.sessionId) ?? s.starred.find(c => c.sessionId === m.sessionId)
      writeStarred(toggleStar(readStarred(), { sessionId: m.sessionId, ai: m.ai, name: chat?.name ?? m.sessionId.slice(0, 8), cwd: chat?.cwd ?? '' }, m.on))
      refreshHub()
      return true
    }
    case 'hub-open-note': {
      const problem = openNote(m.sessionId)
      return problem ? refuse(problem) : true
    }
    case 'hub-resume': {
      const s = hub.get()
      // A reload can drop a cut-off chat from every list; its transcript still names the folder.
      const cwd = [...s.chats, ...s.starred, ...s.archive].find(c => c.sessionId === m.sessionId)?.cwd ?? cwdFromTranscript(path.join(os.homedir(), '.claude', 'projects'), m.sessionId)
      return inHome(cwd, m).then(sent => sent ? undefined : resumeChat(m.sessionId, m.ai, undefined, cwd)).then(problem => {
        if (problem) return refuse(problem)
        // Back among the live chats: History stops hiding it. The home window may have done it already.
        removeArchive(m.sessionId)
        hub.set({ archive: readArchive() })
        return true
      })
    }
    case 'hub-archive': {
      const s = hub.get(), chat = s.chats.find(c => c.sessionId === m.sessionId)
      if (!chat) return refuse('that chat is not listed')
      recordArchive(archiveRow(chat, s.progress.find(p => p.sessionId === m.sessionId)?.startedAt))
      hub.set({ archive: readArchive() })
      return true
    }
    case 'hub-approve':
      return approveChat(m.sessionId)
    case 'hub-unarchive':
      removeArchive(m.sessionId)
      hub.set({ archive: readArchive() })
      return true
    case 'hub-changes':
      watched = m.sessionId
      void refreshChanges().catch(err => log.warn('Changes failed:', err))
      return true
    case 'hub-git':
      return runGit(m)
    case 'hub-auto-merge':
      if (!hub.get().ship?.some(r => r.id === m.repo)) return refuse('that repo is not listed')
      try { setAutoMerge(m.repo, m.on) } catch (err) { return refuse(`could not save the switch (${(err as Error).message})`) }
      hub.set({ ship: hub.get().ship!.map(r => (r.id === m.repo ? { ...r, auto: m.on } : r)) })
      return true
    case 'hub-harden':
      return runHarden(m.sessionId)
    case 'hub-draft-commit':
      return runDraft(m.sessionId)
    case 'hub-open-diff':
      void openDiff(m.sessionId, m.file).then(problem => { if (problem) refuse(problem) })
      return true
    case 'hub-search': {
      const q = m.q.trim().slice(0, 100)
      hub.set({ search: q ? { q, hits: searchNotes(hub.get().archive, q) } : null })
      return true
    }
    case 'hub-jarvis': {
      const q = m.q.trim()
      if (!q) { hub.set({ jarvis: null }); return true }
      const reply = askJarvis(q)
      if (m.voice) voice?.answer(reply)
      return true
    }
    case 'hub-voice':
      voice?.toggle(m.on)
      return true
    case 'hub-kit-export': {
      const problem = exportKit(REPO_ROOTS[0])
      return problem ? refuse(problem) : true
    }
    case 'hub-setup':
      syncKit(true)
      void runSetup(extensionPath).catch(err => refuse(`Set up failed (${(err as Error).message})`))
      return true
    case 'hub-rules-sync':
      syncKit(true)
      return true
    case 'hub-role-model': {
      const problem = setRoleModel(path.join(os.homedir(), '.claude', 'agents'), m.role, m.model)
      if (problem) return refuse(problem)
      void installed().then(i => hub.set({ installed: i })).catch(err => log.warn('Roles failed:', err))
      return true
    }
    case 'hub-role-codex': {
      const problem = setRoleCodex(path.join(os.homedir(), '.claude', 'agents'), m.role, m.model, m.effort)
      if (problem) return refuse(problem)
      void installed().then(i => hub.set({ installed: i })).catch(err => log.warn('Roles failed:', err))
      return true
    }
    case 'hub-hand-to': {
      const s = hub.get()
      const chat = s.chats.find(c => c.sessionId === m.sessionId)
      if (!chat) return refuse('That chat is no longer in the list')
      // newChat wants a listed project; a chat in a subfolder goes to the deepest one holding it.
      const proj = s.projects.filter(p => chat.cwd === p.path || chat.cwd.startsWith(p.path + path.sep)).sort((a, b) => b.path.length - a.path.length)[0]
      if (!proj) return refuse(`${chat.cwd} is not in the project list`)
      const from = chat.ai ?? 'claude'
      const p = s.progress.find(x => x.sessionId === m.sessionId)
      const note = crossNote({ from, project: proj.name, cwd: chat.cwd, asked: p?.asked ?? (chat.name ? [chat.name] : undefined), done: p?.report?.done, tools: p?.tools })
      void newChat(proj.path, note, false, undefined, from === 'claude' ? 'codex' : 'claude').then(problem => { if (problem) refuse(problem) })
      return true
    }
    case 'hub-ai-login':
      if (!signInTerminal(m.ai, refreshHub)) refuse(`${AIS[m.ai]?.name ?? m.ai} has no sign-in command`)
      return true
    case 'hub-handoff':
      hub.handoffNow(m.sessionId)
      return true
    case 'hub-spend':
      try { setSpend(m.key, m.mode, m.monthlyUsd); hub.set({ spend: readSpend() }) } catch (err) { refuse((err as Error).message) }
      return true
    case 'hub-learn':
      void decideLearn(m.id, m.ok).then(problem => { if (problem) refuse(problem) }).catch(err => refuse((err as Error).message))
      return true
    case 'hub-summary':
      void showSummary(m.sessionId, m.refresh)
      return true
    case 'hub-window-tab': {
      if (!hub.get().windowTabs?.live) return refuse(`One window is off: turn it on in Settings, then quit and reopen ${editor.name}`)
      const t = tabTargets(readWindows(), process.pid, m.op, m.workspace)
      if (!t.here && !t.send.length) return refuse(`No open window for ${m.workspace ?? 'that'}`)
      if (t.here) void vscode.commands.executeCommand(TAB_COMMANDS[m.op])
      for (const w of t.send) void postWindow(w, { kind: 'window-tab', command: TAB_COMMANDS[m.op] })
      return true
    }
    case 'hub-awake':
      return setAwake(m.on).then(problem => {
        if (problem) return refuse(problem)
        hub.set({ awake: m.on })
        return true
      })
    case 'hub-device':
      return answerDevice(m.id, m.allow)
    case 'hub-stuck-stop':
      return stopStuck(m.sessionId, m.id).then(problem => {
        if (problem) return refuse(problem)
        // Past the SIGKILL step, so the item goes once its process has.
        setTimeout(() => { void checkStuck(true) }, STUCK.stopWaitMs + 1000)
        return true
      })
    case 'hub-stuck-dismiss':
      snoozeEverywhere(m.id)
      return true
    case 'hub-stuck-fix':
      return fixStuck(m.sessionId, m.id)
    case 'hub-wait-for':
      return waitFor(m.from, m.to)
    case 'hub-unlink':
      hub.unlink(m.from, [m.to])
      return true
    case 'hub-todo-add':
    case 'hub-todo-edit':
    case 'hub-todo-remove':
    case 'hub-todo-restore':
    case 'hub-todo-accept':
    case 'hub-todo-dismiss':
    case 'hub-todo-move':
    case 'hub-todo-run':
    case 'hub-todo-sync':
    case 'hub-todo-pilot':
    case 'hub-todo-replace':
      return todoCommand(m)
    default:
      return false
  }
}

// Devices asking in through the browser app's sign-in page. Every window lists them in its panel;
// the prompt shows in the focused window, or in the next one to get focus, so a background window stays quiet.
const ASK_MS = 2 * 60_000
const asking = new Map<string, DeviceAsk & { port: number; at: number; shown?: boolean }>()

function listDevices(): void {
  for (const [id, d] of asking) if (Date.now() - d.at >= ASK_MS) asking.delete(id)
  hub.set({ devices: [...asking.values()].map(({ id, ip, ua, network }) => ({ id, ip, ua, network })) })
}

function promptDevices(): void {
  if (!vscode.window.state.focused) return
  listDevices()
  for (const d of asking.values()) {
    if (d.shown) continue
    d.shown = true
    void vscode.window.showInformationMessage(`A device wants to open Switchboard: ${d.ua} at ${d.ip} (${d.network})`, 'Allow', 'Deny')
      .then(pick => { if (pick) void answerDevice(d.id, pick === 'Allow') })
  }
}

/** Tells the browser app on loopback; it checks the token against the window files. */
async function answerDevice(id: string, allow: boolean): Promise<boolean | string> {
  const d = asking.get(id)
  if (!d) return refuse('that device was already answered, or gave up')
  asking.delete(id)
  listDevices()
  try {
    const r = await postLocal(d.port, '/device/answer', { id, allow, token: hub.token }, 3000)
    return r.ok || refuse(r.status === 409 ? 'that device was already answered, or gave up' : 'the browser app did not take the answer')
  } catch { return refuse('the browser app is not answering') }
}

// Dev terminals this window started and the tailscale serve each got, by terminal name; turned off when either ends.

/** A chat opens in the window that has its folder open, so each project's chats stay in its own window.
 * False when that is this window, no window holds the folder, or it did not take the command. */
const inHome = async (folder: string | undefined, m: { type: string }) => {
  let sent = folder ? await sendHome(folder, m) : false
  // No window has the project: open one for it rather than start the chat in this other project's window.
  // Listed projects only: a resume of a chat in /tmp or home stays here.
  if (!sent && folder && hub.get().projects.some(p => p.path === folder) && needsWindow(readWindows(), folder)) {
    void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folder), { forceNewWindow: true })
    sent = await sendHome(folder, m, process.pid, undefined, 500, NEW_WINDOW_MS)
  }
  if (sent) vscode.window.setStatusBarMessage(`Switchboard: opened in the ${projectName(folder!)} window`, 5000)
  return sent
}

// SessionStart ids not yet prompted, in the window that owns the chat (hooks never mirror here).
const unprompted = new Set<string>()

/** Smart switch: a chat typed in one project's window whose first prompt is about another listed project starts there instead. */
export async function smartSwitch(payload: Record<string, unknown>): Promise<void> {
  const id = String(payload.session_id ?? ''), cwd = String(payload.cwd ?? '')
  if (!id || !cwd || payload.agent_id) return
  if (payload.hook_event_name === 'SessionStart') { if (payload.source === 'startup') unprompted.add(id); return }
  if (payload.hook_event_name === 'SessionEnd') { unprompted.delete(id); return }
  if (payload.hook_event_name !== 'UserPromptSubmit' || !unprompted.delete(id)) return
  await refreshChats().catch(() => undefined)
  const rows = hub.get().chats.filter(c => c.sessionId === id && c.live)
  // A named chat was started by Switchboard (new chat, handoff, To-do) in a project picked on purpose.
  if (!rows.length || rows.some(c => c.name || (c.ai ?? 'claude') !== 'claude')) return
  // Only chats in this window's terminals: one in the Claude panel or another app stays put.
  const terms = await Promise.all(rows.map(c => chatTerminal(c.pid, vscode.window.terminals)))
  if (terms.some(t => !t)) return
  const prompt = promptText(String(payload.prompt ?? ''))
  const to = await routeProject(prompt, cwd, hub.get().projects, quickAsk)
  if (!to) return
  // Close the wrong chat first so it stops working in the wrong folder. Another window can take the move and still
  // fail to start it, so the prompt goes on the clipboard first and is never lost.
  await vscode.env.clipboard.writeText(prompt).then(undefined, () => undefined)
  for (const t of terms) t!.dispose()
  const from = projectName(cwd), text = `${MOVED} ${from}.\n\n${prompt}`, remote = hub.get().rc.atStartup
  const m = { type: 'hub-new-chat', path: to, text, remote }
  if (!await inHome(to, m)) {
    const problem = await newChat(to, text, remote, undefined)
    if (problem) {
      void vscode.window.showWarningMessage(`that chat was about ${projectName(to)} but could not start there (${problem}). Your prompt is on the clipboard.`)
      return log.warn(`Smart switch to ${to} failed: ${problem}`)
    }
  }
  void vscode.window.showInformationMessage(`that chat was about ${projectName(to)}, so it moved there from ${from}. Your prompt is also on the clipboard.`)
}


/** New chat in a repo made first: gh repo create or git clone under ~/Documents/GitHub. A string is why not. */
async function startInNewRepo(repo: RepoAsk, m: Extract<WebviewToExtensionMessage, { type: 'hub-new-chat' }>): Promise<string | undefined> {
  const plan = repoPlan(repo, REPO_ROOTS[0], 'create' in repo ? await ghPath() : undefined)
  if (typeof plan === 'string') return plan
  const failed = await new Promise<string | undefined>(done => execFile(plan.file, plan.args, { cwd: plan.cwd, timeout: 10 * 60_000 }, (err, _out, stderr) =>
    done(err ? `${'create' in repo ? 'gh repo create (the empty GitHub repo may exist now)' : 'git clone'} failed: ${String(stderr).trim().split('\n').pop() || err.message}` : undefined)))
  if (failed) {
    // The dialog closed and the draft is gone when this runs, so the phone gets the message back too.
    void sendPush('Switchboard', `${failed}. Your message: ${(m.text ?? '').slice(0, 300)}`)
    return failed
  }
  await refreshProjects().catch(err => log.warn('Projects failed:', err))
  // Its own window, like every project's chats; Kenneth pressed Start, so it may come to the front.
  // A window that never lists itself (restricted mode, slow start) leaves the chat here.
  const { repo: _made, ...start } = m
  void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(plan.folder), { forceNewWindow: true })
  const there: typeof start = { ...start, path: plan.folder }
  if (await sendHome(plan.folder, there, process.pid, undefined, 500, NEW_WINDOW_MS)) return undefined
  return startChat(plan.folder, m)
}
const NEW_WINDOW_MS = 60_000

// After every function it takes, so the consts it reads are set when it is built.
const { refreshChats, runInNewChat } = codexPanel({
  state: () => S, store: () => store, workspace, pendingWaits, refuse, sendToChat, startWaits, refreshStages, controlsKey: CONTROLS_KEY, handedKey: HANDED_KEY,
})
