import * as vscode from 'vscode'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { execFile } from 'child_process'
import { hub } from './hub-service'
import { createLogger } from '../logger'
import { claudeBinary, claudeCall } from './setup'
import { cliCall } from './windows'
import { newChat } from './actions'
import { addRepo, confirmApprove, fixBrief, held, line, needsApprove, readSweep, rescan, sweepAll } from './sweep'
import type { WebviewToExtensionMessage } from '../protocol'
import { refuse, type HubReply } from './hub-panel-shared'

const log = createLogger('Hub')

/** The panel's sweep jobs and the tool switches; refresh is the panel's refreshHub. */
export function sweepPanel(refresh: () => void, workspace: () => string | undefined) {
  let sweeping = false
  const sweepState = (note?: string) => ({ busy: sweeping, tools: readSweep(), note: note ?? hub.get().sweep?.note })
  const runClaude = (args: string[]) => new Promise<boolean>(resolve => {
    const c = claudeCall(args)
    execFile(c.cmd, c.args, { timeout: 180_000, shell: c.shell, windowsHide: true, windowsVerbatimArguments: c.windowsVerbatimArguments }, err => resolve(!err))
  })

  /** One sweep job at a time: a rescan, Sweep all or an add; the panel shows busy until it ends, then its note. */
  async function sweepJob(job: () => Promise<string>): Promise<string> {
    if (sweeping) throw new Error('a sweep is already running')
    sweeping = true
    hub.set({ sweep: sweepState() })
    let note = ''
    try { note = await job(); return note } catch (err) { note = (err as Error).message; throw err } finally {
      sweeping = false
      hub.set({ sweep: sweepState(note) })
      refresh()
    }
  }

  const sweepOneTool = (name: string) => sweepJob(async () => line(name, await rescan(name, hub.get().installed)))
  const sweepEverything = () => sweepJob(async () => {
    // Records and badges only; nothing installed is turned off. Async scans, so the panel keeps working meanwhile.
    const all = await sweepAll(hub.get().installed, { onEach: (done, total) => hub.set({ sweep: { ...sweepState(), progress: { done, total } } }) })
    const n = Object.values(all).filter(held).length
    return `Swept ${Object.keys(all).length} plugins and skills; ${n} need${n === 1 ? 's' : ''} review.`
  })
  const askApprove = async (q: string) => (await vscode.window.showWarningMessage(q, { modal: true }, 'Approve')) === 'Approve'
  const approveOne = (name: string) => sweepJob(async () => (await confirmApprove(name, hub.get().installed, askApprove, (kind, n) => toggle(kind, n, true))) ? `${name} approved and on.` : `${name} left off.`)

  /** The sweep tool's call: rescan one, or start Sweep all and answer at once. Approve is only the panel's button. */
  function sweepCall(name: string | undefined): Promise<string> {
    if (name) return sweepOneTool(name)
    if (sweeping) return Promise.reject(new Error('a sweep is already running'))
    void sweepEverything().catch(err => log.warn('Sweep failed:', err))
    return Promise.resolve('Sweep all started. Results show in Switchboard, Settings, Installed, and in ~/.claude/switchboard/sweep.json.')
  }

  /** Fix in a chat: a new chat in this window's project (else the first one) with the skill-inspector brief. */
  async function sweepFix(name: string): Promise<string | undefined> {
    const projects = hub.get().projects
    const folder = projects.find(p => p.path === workspace())?.path ?? projects[0]?.path
    if (!folder) return 'no project to start the chat in'
    return newChat(folder, fixBrief(name, readSweep()[name]), false, undefined)
  }

  /** Plugins and mods through the claude CLI; skills by moving their folder in or out of the archive. */
  async function toggle(kind: 'mod' | 'plugin' | 'skill', name: string, enabled: boolean): Promise<void> {
    if (kind === 'skill') {
      const claude = path.join(os.homedir(), '.claude')
      const [from, to] = enabled ? ['skills-archive', 'skills'] : ['skills', 'skills-archive']
      if (!/^[\w.-]+$/.test(name)) return
      try {
        await fs.promises.mkdir(path.join(claude, to), { recursive: true })
        await fs.promises.rename(path.join(claude, from, name), path.join(claude, to, name))
      } catch (err) { void vscode.window.showWarningMessage(`Could not move ${name} (${(err as Error).message}).`) }
    } else {
      if (!/^[\w.@-]+$/.test(name)) return
      const call = cliCall(claudeBinary(), ['plugin', enabled ? 'enable' : 'disable', name])
      await new Promise<void>(resolve => execFile(call.cmd, call.args, { windowsVerbatimArguments: call.windowsVerbatimArguments, timeout: 30000, windowsHide: true }, err => {
        if (err) void vscode.window.showWarningMessage(`claude plugin ${enabled ? 'enable' : 'disable'} ${name} failed.`)
        resolve()
      }))
    }
    refresh()
  }
  /** Its share of the hub messages; undefined for any other type. */
  function handle(m: WebviewToExtensionMessage): HubReply | undefined {
    switch (m.type) {
      case 'hub-toggle':
        // A held tool turns on only through Approve's modal.
        if (needsApprove(m.kind, m.name, m.enabled, readSweep(), hub.get().installed)) void approveOne(m.name).catch(err => refuse((err as Error).message))
        else void toggle(m.kind, m.name, m.enabled)
        return true
      case 'hub-sweep':
        void (m.name ? sweepOneTool(m.name) : sweepEverything()).catch(err => refuse((err as Error).message))
        return true
      case 'hub-sweep-approve':
        // An unknown name is ignored: no modal for something not installed.
        if (!hub.get().installed.some(i => i.name === m.name && (i.kind === 'plugin' || i.kind === 'skill'))) return true
        void approveOne(m.name).catch(err => refuse((err as Error).message))
        return true
      case 'hub-sweep-fix':
        void sweepFix(m.name).then(problem => { if (problem) refuse(problem) })
        return true
      case 'hub-tool-add':
        void sweepJob(() => addRepo(m.repo, { claude: runClaude })).then(note => void vscode.window.showInformationMessage(`${note.replace(/\n/g, '; ')}`), err => refuse((err as Error).message))
        return true
      default:
        return undefined
    }
  }
  return { sweepState, runClaude, sweepJob, sweepOneTool, sweepEverything, approveOne, sweepCall, sweepFix, toggle, handle }
}
