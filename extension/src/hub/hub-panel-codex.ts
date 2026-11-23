import type { ChatRow, TodoItem } from './types'
import type { PanelState } from './hub-panel-state'
import { createLogger } from '../logger'
import * as vscode from 'vscode'
import * as os from 'os'
import * as path from 'path'
import { continueText, hub, pauseText, resetMs } from './hub-service'
import { indefiniteOn, readProfiles } from './tools'
import { newestPlanFile } from './local'
import { bindCodexTerminals, codexExited, closeCodexChat, codexTied, sendToCodex, continueInFreshChat, headBranch, newChat, resumeChat, indefiniteDone, setCheckBack, noteCheckBack, type RunOpts } from './actions'
import { readDoneCheck, stampedChats } from './approve'
import { syncTerminals } from './terminals'
import { codexFiles, endedCodex, lastCodexPrompt, lastCodexTurn, readAis, rolloutLines } from './ais'
import { budgetEnd, codexRound, goalCheck, goalFor, goalHandoffLine, roundText, runGate, usageLine, type GateExec } from './indefinite'
import { archiveRow, backAgain, dueForHandoff, fullCodex, idleHandedOff, readArchive, recordArchive, removeArchive } from './chains'
import { chainVersion, codexNote, handoffFile, planLabel, projectName } from './projects'
import { execFile } from 'child_process'
import * as fs from 'fs'
import { readGroups } from './split'
import { cleanWorktree, endedMerges, endedWorktrees, gitOp, liveIn, mergeDue, mergeOnEnd, sweepChats, worktreeDirs, type MergeClock } from './git'
import { learnTick, usageOk } from './learn'
import { rememberChats } from './reap'
import { autoStartPlan, changeTodo, claimTodo, holdReason, holdShown, START_GRACE_MS, clearGoneChats, loadTodos, runLabel, runMessage, projectOf, startTodo } from './todo'
import { follow, outcomeIn } from '../../ask/chats.mjs'
import { randomUUID } from 'crypto'
import { notifyIndefiniteDone, notifyMerged } from './notify'
import { CHECK_BACK_TEXT, dueCheckBacks, hasOpenWork } from './checkback'

const log = createLogger('Hub')

/** The chats (every AI) and what follows from them: Codex terminals, indefinite rounds, check-backs, keep going and Codex handoffs. */
export function codexPanel(d: {
  state: () => PanelState; store: () => vscode.Memento | undefined; workspace: () => string | undefined
  pendingWaits: Map<string, { on: string[]; at: number }>; refuse: (problem: string) => string
  sendToChat: (sessionId: string, message: string) => true | string | Promise<true | string>
  startWaits: () => void; refreshStages: (chats: ChatRow[]) => void; controlsKey: string; handedKey: string
}) {
  const { workspace, pendingWaits, refuse, sendToChat, startWaits, refreshStages } = d
  /** The chats (every AI), and what follows from them: Codex terminals, closing handed-off Codex chats, Codex handoffs. */
  async function refreshChats(): Promise<void> {
    const { chats, ais } = await readAis()
    bindCodexTerminals(chats, Date.now(), (id, on) => pendingWaits.set(id, { on, at: Date.now() }))
    void rememberChats(chats).catch(err => log.warn('Chat processes failed:', err))
    const doneChecks = Object.fromEntries(stampedChats(hub.get().progress).flatMap(id => { const d = readDoneCheck(id); return d ? [[id, d]] : [] }))
    const groups = readGroups()
    const now = Date.now(), profiles = hub.get().tools?.chats ?? {}
    hub.set({ chats: chats.map(c => {
      const p = hub.get().progress.find(x => x.sessionId === c.sessionId), cost = hub.get().live.find(x => x.sessionId === c.sessionId)?.costUsd, prof = profiles[c.sessionId]
      return { ...c, project: projectName(c.cwd), takes: hub.takes(c, codexTied(c.sessionId)), ...(groups[c.sessionId] ? { group: groups[c.sessionId] } : {}),
        ...(p ? { elapsedMs: Math.max(0, now - p.startedAt) } : {}), ...(cost === undefined ? {} : { costUsd: cost }), ...(prof?.budget ? { budget: prof.budget } : {}), ...(prof?.checkBack ? { checkBack: prof.checkBack } : {}) }
    }), ais, doneChecks })
    startWaits()
    // Every known repo is scanned, a chat or not; a worktree whose chat ended (SessionEnd) goes at once, others after 10 idle minutes.
    const fast: string[] = []
    const roots = hub.get().projects.map(p => p.path)
    for (const w of [...endedWorktrees(wtSeen, sweepChats(chats, hub.get().progress), Date.now(), worktreeDirs(chats.map(c => c.cwd), roots), fast), ...fast]) {
      void cleanWorktree(w).then(gone => { if (gone) log.info(`Removed merged worktree ${w}`) }).catch(err => log.warn('Worktree cleanup failed:', err))
    }
    for (const [id, wt] of endedMerges(mergeOnEnd, liveIn(chats, codexTied))) {
      void gitOp(wt, { op: 'merge-back', confirmed: true }, undefined, false, w => liveIn(hub.get().chats, codexTied)(w))
        .then(m => {
          // Another merge holds the repo: try again next tick.
          if (/^A merge is already running/.test(m.text)) { mergeOnEnd.set(id, wt); return }
          log.info(`Merge back of ${wt}: ${m.text}`); notifyMerged(projectName(wt), m.text)
        })
        .catch(err => log.warn('Merge back failed:', err))
    }
    if (hub.get().controls.switchboard.autoMerge !== false) {
      for (const r of mergeDue(mergeClock, chats, roots)) {
        void gitOp(r, { op: 'merge-all', confirmed: true }, undefined, false, wt => liveIn(hub.get().chats, codexTied)(wt))
          .then(m => { log.info(`Auto merge in ${r}: ${m.text}`); if (m.ok || !/^(No worktrees|Every worktree|A merge is already running)/.test(m.text)) notifyMerged(projectName(r), m.text) })
          .catch(err => log.warn('Auto merge failed:', err))
      }
    }
    refreshStages(chats)
    void syncTerminals(chats).catch(err => log.warn('Terminal list failed:', err))
    const ended = endedCodex(chats, codexTied, codexExited).filter(c => !hub.get().archive.some(a => a.sessionId === c.sessionId))
    for (const c of ended) {
      try { recordArchive(archiveRow(c, undefined, true)) } catch (err) { log.warn('Archive failed:', err) }
      codexExited.delete(c.sessionId)
    }
    if (ended.length) hub.set({ archive: readArchive() })
    const back = backAgain(hub.get().archive, chats)
    if (back.length) { for (const id of back) removeArchive(id); hub.set({ archive: readArchive() }) }
    void clearGoneChats([...hub.retryIds(), ...resumedIds()]).then(keepGoing).catch(err => log.warn('To-do lists failed:', err))
    for (const c of idleHandedOff(chats, d.state().closingCodex)) {
      d.state().closingCodex.delete(c.sessionId)
      if (!closeCodexChat(c.sessionId)) log.info(`No terminal is tied to the handed-off Codex chat ${c.sessionId.slice(0, 8)}; it stays open`)
    }
    void indefiniteRounds(chats).catch(err => log.warn('Run indefinitely failed:', err))
    void checkBacks().catch(err => log.warn('Check-back failed:', err))
    await codexHandoffs(chats)
  }

  // Run indefinitely for Codex chats this window holds: the usage-meter mod does it for Claude (Stop block), Codex has no such hook.
  const roundSent = new Map<string, number>()
  async function indefiniteRounds(chats: ChatRow[]): Promise<void> {
    for (const c of chats) {
      if (c.ai !== 'codex' || c.status !== 'idle' || !codexTied(c.sessionId)) continue
      const on = indefiniteOn(c.sessionId)
      if (on === undefined) continue
      const file = codexFiles.get(c.sessionId)
      const turn = file && c.updatedAt !== undefined ? lastCodexTurn(await rolloutLines(file, c.updatedAt)) : { aborted: false, answer: undefined }
      const held = d.state().closingCodex.has(c.sessionId) || !!hub.get().pause || hub.get().archive.some(a => a.sessionId === c.sessionId)
      const act = codexRound(c, hub.get().progress.find(p => p.sessionId === c.sessionId), { on, held, ...turn }, roundSent)
      // A goal Check must pass too: the done line alone sends it through the gate.
      const goalGate = act === 'done' && !readProfiles([c.sessionId])[c.sessionId]?.budget?.gate && goalCheck(goalFor(c.cwd, c.sessionId)?.text ?? '')
      if (act === 'done' && !goalGate) finishCodexRun(c, on)
      else if (act === 'send' || goalGate) {
        roundSent.set(c.sessionId, c.updatedAt!)
        void codexNextRound(c, on)
      }
    }
  }

  // Ends a Codex run through the same path the mod's finish uses: the flag off, then the notice with the usage line.
  function finishCodexRun(c: ChatRow, on: number, reason?: string): void {
    indefiniteDone(c.sessionId)
    notifyIndefiniteDone(c.sessionId, usageLine(on, Date.now(), c.costUsd), reason)
  }

  const sh: GateExec = (cmd, cwd, timeout) => new Promise(resolve =>
    execFile('/bin/sh', ['-c', cmd], { cwd, timeout, maxBuffer: 4_000_000, windowsHide: true }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0
      resolve({ code, out: `${stdout}\n${stderr}${err && code === 1 && !stdout && !stderr ? err.message : ''}` })
    }))

  // The gate runs async, one at a time per chat; a pass or a spent budget ends the run, a failure rides into the next round.
  const gating = new Set<string>()
  async function codexNextRound(c: ChatRow, on: number): Promise<void> {
    // Mid-gate: forget the send so a later poll tries this turn again.
    if (gating.has(c.sessionId)) { roundSent.delete(c.sessionId); return }
    gating.add(c.sessionId)
    try {
      const budget = readProfiles([c.sessionId])[c.sessionId]?.budget
      let failed = ''
      const goal = goalFor(c.cwd, c.sessionId)
      const check = budget?.gate ? undefined : goal && goalCheck(goal.text)
      const gate = budget?.gate ?? check
      if (gate) {
        const g = await runGate(gate, check ? goal!.dir : c.cwd, sh)
        if (g.ok) { finishCodexRun(c, on, `gate passed: ${gate}`); return }
        failed = g.out
      }
      if (budget?.maxCostUsd !== undefined && c.costUsd === undefined) log.info(`Run indefinitely: no cost known for ${c.sessionId.slice(0, 8)}, cost cap skipped`)
      const end = budgetEnd(budget, on, Date.now(), c.costUsd)
      if (end) { finishCodexRun(c, on, end); return }
      const problem = await sendToCodex(c, roundText(gate, failed, goal?.file))
      if (problem) { roundSent.delete(c.sessionId); log.warn(`Run indefinitely round not sent to ${c.sessionId.slice(0, 8)}: ${problem}`) }
    } catch (err) {
      roundSent.delete(c.sessionId)
      log.warn(`Run indefinitely round failed for ${c.sessionId.slice(0, 8)}: ${(err as Error).message}`)
    } finally { gating.delete(c.sessionId) }
  }

  // Check-back: one owner per chat, the window whose hub takes its messages (hub.takes), so no two windows both send.
  // The profile on disk holds the setting and count; noteCheckBack writes before the send, so a slow send is not repeated.
  async function checkBacks(): Promise<void> {
    const s = hub.get(), mine = s.chats.filter(c => c.takes)
    const settings = readProfiles(mine.map(c => c.sessionId))
    const cb = Object.fromEntries(Object.entries(settings).flatMap(([id, p]) => (p.checkBack ? [[id, p.checkBack]] : [])))
    const view = mine.map(c => ({ sessionId: c.sessionId, status: c.status, updatedAt: c.updatedAt, takes: c.takes, open: hasOpenWork(s.progress.find(p => p.sessionId === c.sessionId)), stopped: s.archive.some(a => a.sessionId === c.sessionId) }))
    for (const id of dueCheckBacks(Date.now(), view, cb)) {
      noteCheckBack(id)
      const sent = await sendToChat(id, CHECK_BACK_TEXT)
      if (sent !== true) { noteCheckBack(id, Date.now(), -1); log.warn(`Check-back not sent to ${id.slice(0, 8)}: ${sent}`) }
    }
    // Approved or ended chats drop the setting.
    for (const c of mine) if (cb[c.sessionId] && s.archive.some(a => a.sessionId === c.sessionId)) void setCheckBack(c.sessionId, null).catch(() => undefined)
  }

  // Worktree folders with a live chat, so one that ends is cleaned up.
  const wtSeen = new Map<string, number | undefined>()
  // Merge all on its own after 15 quiet minutes per repo (mergeDue).
  const mergeClock: MergeClock = { seen: new Set(), since: new Map(), fired: new Map() }

  // To-do items started in this window (auto or Run), never auto-started again: a chat that keeps failing to start would loop.
  const autoTried = new Set<string>()
  let autoBusy = false
  // Chats resumed after a usage limit, by session id: their project counts as busy, and their items stay theirs, until live or past the grace.
  const resumed = new Map<string, { at: number; folder: string }>()
  // When a folder's last auto claim failed (offline, origin rejecting, taken): autoStartPlan waits SYNC_MS, a success clears it.
  const claimFailed = new Map<string, number>()
  const resumedIds = (now = Date.now()) => {
    for (const [id, r] of resumed) if (now - r.at > START_GRACE_MS) resumed.delete(id)
    return [...resumed.keys()]
  }

  /** The inputs autoStartPlan and holdReason share for one folder. resumed, failed and tried starts belong to this window, so only its own folder gets them. */
  function gateFor(folder: string, on: boolean, own: boolean) {
    const s = hub.get(), now = Date.now(), chats = s.chats
    const windows = s.live.flatMap(l => l.limits), pauseAt = s.controls.switchboard.pauseAt
    const cap = pauseAt === null ? 100 : pauseAt ?? 99
    const resets = windows.filter(w => !w.kind?.startsWith('codex_') && w.percentUsed >= cap).map(w => resetMs(w.resetsAt)).filter(r => r > now)
    const started = own ? [...resumed.values()].filter(r => r.folder === folder).map(r => r.at) : []
    return {
      // The project's own pilot wins over the global switch; other chats in the project no longer hold it.
      on, pilot: s.todos?.[folder]?.pilot, folder, todo: s.todos?.[folder]?.todo ?? [], tried: own ? autoTried : new Set<string>(), now,
      live: new Set(chats.filter(c => c.live).map(c => c.sessionId)),
      // Same hold as Learn: a pause, a retry, or at pauseAt; a window with no chats of its own must not start one mid-pause.
      limited: !usageOk({ windows, pauseAt, paused: !!s.pause, retrying: hub.retrying() }),
      resumed: started.length ? Math.max(...started) : undefined,
      failedAt: own ? claimFailed.get(folder) : undefined,
      resetAt: resets.length ? Math.max(...resets) : undefined,
      links: s.links, label: (id: string) => chats.find(c => c.sessionId === id)?.name ?? id.slice(0, 8),
      // A wait on a finished chat is dropped; a handoff is followed to the chat that took over.
      open: (id: string) => { const t = follow(s, id); return outcomeIn(s, t, now).finished ? undefined : t },
    }
  }

  /** Every folder's hold from the shared state, so windows that see the same state show the same text; set only when it changed. */
  function showHolds(on: boolean, own?: string): void {
    for (const folder of Object.keys(hub.get().todos ?? {})) {
      const hold = holdReason(gateFor(folder, on, folder === own)) ?? null
      if (JSON.stringify(hub.get().todos?.[folder]?.plan?.hold ?? null) !== JSON.stringify(hold)) holdShown(folder, hold)
    }
  }

  /** Chats that ended on a usage limit come back once it resets; with Auto-start on, an idle project starts its next to-do item. */
  async function keepGoing(): Promise<void> {
    const s = hub.get()
    const live = (id: string) => s.chats.some(c => c.sessionId === id && c.live)
    hub.pauseTick()
    void learnTick()
    for (const r of hub.goneDue(live)) {
      resumed.set(r.sessionId, { at: Date.now(), folder: projectOf(r.cwd) })
      void resumeChat(r.sessionId, 'claude', (r.paused ? pauseText : continueText)(r.agents), r.cwd).then(problem => { if (problem) log.warn(`Could not resume ${r.sessionId.slice(0, 8)} after its usage limit: ${problem}`) })
    }
    // Read fresh: another window may have turned it off since this one started.
    const on = d.store()?.get<{ autoStart?: boolean }>(d.controlsKey)?.autoStart !== false
    if (on !== s.controls.switchboard.autoStart) hub.set({ controls: { ...s.controls, switchboard: { ...s.controls.switchboard, autoStart: on } } })
    const ws = workspace()
    // Holds show for every folder, with or without a window of its own; only the own folder auto-starts.
    const own = ws ? projectOf(ws) : undefined
    showHolds(on, own)
    if (autoBusy || !ws || !own) return
    const folder = own
    // newChat refuses a folder the project list does not have yet; wait for it rather than burn the item.
    if (folder === os.homedir() || folder === path.parse(folder).root || !s.projects.some(p => p.path === folder)) return
    autoBusy = true
    try {
      if (!s.todos?.[folder]) await loadTodos([folder])
      const plan = autoStartPlan({ ...gateFor(folder, on, true), busy: false })
      if (!plan) return
      log.info(`Auto-start in ${folder}: ${plan.items.map(t => t.id).join(', ')}`)
      if (await runInNewChat(plan.folder, plan.items)) claimFailed.delete(folder)
      else claimFailed.set(folder, Date.now())
    } finally { autoBusy = false }
  }

  /**
   * Claims the items for a fresh chat id on the stored list before it starts, so two windows or taps cannot both start
   * them; false when they were taken meanwhile. manual: the Run button (claimItems). A chat that cannot start frees them.
   * run: the Start button's own model, effort, ultracode, auto and research; an auto start has none.
   */
  async function runInNewChat(folder: string, items: TodoItem[], manual = false, run?: RunOpts): Promise<boolean> {
    const sessionId = randomUUID()
    const live = new Set(hub.get().chats.filter(c => c.live).map(c => c.sessionId))
    if (!await claimTodo(folder, items.map(t => t.id), sessionId, live, manual, undefined, autoTried)) return false
    const unmark = () => changeTodo(folder, d => items.reduce((out, t) => (d.todo.find(x => x.id === t.id)?.chat === sessionId ? startTodo(out, t.id, undefined) : out), d))
    // The claim gave them a run number; read them back for the chat's label.
    const fresh = hub.get().todos?.[folder]?.todo ?? []
    const label = runLabel(items.map(t => fresh.find(x => x.id === t.id) ?? t), folder)
    void newChat(folder, runMessage(items), false, undefined, 'claude', undefined, sessionId, true, label, undefined, undefined, false, run).then(problem => {
      if (!problem) return
      refuse(problem)
      void unmark().catch(() => {})
    })
    return true
  }

  /**
   * A full Codex chat has no usage mod to write its note: Switchboard writes one (folder,
   * branch, plan, last prompt) and starts the next Codex chat on it, once per chat.
   */
  async function codexHandoffs(chats: ChatRow[]): Promise<void> {
    const ws = workspace()
    const due = dueForHandoff(chats, d.state().handedOff, ws, Date.now(), d.state().codexBusySince)
    const held = fullCodex(chats, d.state().handedOff, ws).filter(c => !due.includes(c))
    hub.setCodexWaits(held.map(c => ({ sessionId: c.sessionId, tasks: 1, next: `v${chainVersion(c.name) + 1}`, since: d.state().codexBusySince.get(c.sessionId) ?? Date.now() })))
    for (const c of due) {
      d.state().codexBusySince.delete(c.sessionId)
      d.state().handedOff.add(c.sessionId)
      void d.store()?.update(d.handedKey, [...d.state().handedOff].slice(-200))
      const project = projectName(c.cwd)
      const plan = await newestPlanFile(c.cwd)
      const file = codexFiles.get(c.sessionId)
      const prompt = file ? lastCodexPrompt(await rolloutLines(file)) : undefined
      const note = path.join(os.homedir(), '.claude', 'handoffs', project, handoffFile(project, planLabel(plan), c.sessionId))
      try {
        await fs.promises.mkdir(path.dirname(note), { recursive: true })
        const goal = goalFor(c.cwd, c.sessionId)
        await fs.promises.writeFile(note, codexNote({ project, cwd: c.cwd, branch: headBranch(c.cwd) ?? 'unknown', plan, prompt }) + (goal ? `\n${goalHandoffLine(goal)}\n` : ''))
      } catch (err) {
        // Unmarked, so the next refresh tries again.
        d.state().handedOff.delete(c.sessionId)
        log.warn('A Codex handoff note could not be written:', err)
        continue
      }
      if (await continueInFreshChat({ sessionId: c.sessionId, cwd: c.cwd, note, plan, name: c.name, ai: 'codex' }, ws)) d.state().closingCodex.add(c.sessionId)
    }
  }
  return { refreshChats, runInNewChat }
}
