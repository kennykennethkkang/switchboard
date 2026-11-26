/**
 * No editor window live: the app's own hub (the relay's hook server answers /hub/*) keeps chats,
 * projects and to-do lists current, and starts new chats in tmux or Terminal.app. Called by server.ts.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { hub } from '../../extension/src/hub/hub-service'
import { AIS, readAis } from '../../extension/src/hub/ais'
import { projectFolders } from '../../extension/src/hub/local'
import { mergeProjects, projectName, shellQuote } from '../../extension/src/hub/projects'
import { loadTodos, todoFolders } from '../../extension/src/hub/todo'
import { ensureHookScript } from '../../extension/src/discovery'

const REPO_ROOTS = [path.join(os.homedir(), 'Documents', 'GitHub')]
const TICK_MS = 3000
const PROJECTS_MS = 60_000

const tmuxBin = () => ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find(p => fs.existsSync(p))

/** argv that runs command in folder without taking focus: a detached tmux session, else a Terminal window. */
export function chatSpawn(folder: string, command: string, tmux: string | undefined, name: string): { cmd: string; args: string[] } {
  if (process.platform === 'win32') return { cmd: 'powershell.exe', args: ['-NoExit', '-Command', `Set-Location -LiteralPath ${shellQuote(folder, 'powershell')}; ${command}`] }
  // -i too: claude and codex are usually put on PATH in .zshrc.
  if (tmux) return { cmd: tmux, args: ['new-session', '-d', '-s', name, '-c', folder, process.env.SHELL || '/bin/zsh', '-lic', command] }
  const as = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  // do script without activate: the window opens behind whatever has focus.
  return { cmd: 'osascript', args: ['-e', `tell application "Terminal" to do script "${as(`cd ${shellQuote(folder, 'posix')} && ${command}`)}"`] }
}

type Run = (cmd: string, args: string[]) => void
const runDetached: Run = (cmd, args) => { execFile(cmd, args, err => { if (err) console.log(`New chat failed: ${err.message}`) }) }

/** hub-new-chat with no editor: true when started, else why not. */
export function newChatHeadless(m: { path: string; text?: string; ai?: string }, run: Run = runDetached, tmux = tmuxBin()): true | string {
  if (!hub.get().projects.some(p => p.path === m.path)) return `${m.path} is not in the project list`
  const ai = m.ai ?? 'claude'
  if (ai !== 'claude' && ai !== 'codex') return `Open an editor window to start a ${ai} chat.`
  const name = projectName(m.path)
  const command = AIS[ai].startCommand({ text: m.text, name }, process.platform === 'win32' ? 'powershell' : 'posix')
  const s = chatSpawn(m.path, command, tmux, `sb-${name.replace(/[^\w-]/g, '-')}-${Date.now().toString(36)}`)
  run(s.cmd, s.args)
  return true
}

/** Polls while no editor window is live; returns the stopper. */
export function startHeadless(workspace: string, editorLive: () => Promise<boolean>): () => void {
  // The installed hook.js may predate the app fallback; an editor rewrites it the same way.
  try { ensureHookScript() } catch (err) { console.log(`Hook script not updated: ${(err as Error).message}`) }
  let projectsAt = 0
  const refreshProjects = async () => {
    projectsAt = Date.now()
    const { repos, claude } = await projectFolders(REPO_ROOTS)
    hub.set({ projects: mergeProjects(repos, claude, workspace) })
  }
  hub.runner = async c => {
    if (c.type !== 'hub-new-chat') return 'Open an editor window with Switchboard for that.'
    const m = c as unknown as { path: string; text?: string; ai?: string }
    // Before the first scan lands, or a repo made since.
    if (!hub.get().projects.some(p => p.path === m.path)) await refreshProjects()
    return newChatHeadless(m)
  }
  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      if (await editorLive()) return
      const { chats, ais } = await readAis()
      hub.set({ chats: chats.map(c => ({ ...c, project: projectName(c.cwd), takes: hub.takes(c, false) })), ais })
      if (Date.now() - projectsAt >= PROJECTS_MS) await refreshProjects()
      await loadTodos(todoFolders(workspace))
    } catch (err) {
      console.log(`Hub refresh failed: ${(err as Error).message}`)
    } finally { busy = false }
  }
  void tick()
  const t = setInterval(() => void tick(), TICK_MS)
  return () => clearInterval(t)
}
