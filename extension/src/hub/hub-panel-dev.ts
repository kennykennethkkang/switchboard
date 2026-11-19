import * as vscode from 'vscode'
import * as path from 'path'
import { hub } from './hub-service'
import { listServers } from './local'
import { startDev, stopDev } from './actions'
import { projectName } from './projects'
import { awakePid, devHome, devRows, knownDev, needsWindow, postWindow, readDev, readWindows, sendHome, serve, tailnet } from './dev'
import type { WebviewToExtensionMessage } from '../protocol'
import { refuse, type HubReply } from './hub-panel-shared'

/** Dev servers: the rows, starting one and stopping one. */
export function devPanel(refresh: () => void) {
  // Lost on reload, so an entry outlives a reload until the same port is served again.
  const served = new Map<string, { port: number; https: boolean }>()
  const DEV_WAIT_MS = 60_000
  const devFolders = () => [...readWindows().map(w => w.workspace), ...hub.get().chats.map(c => c.cwd)]

  /** Dev rows for every device, Keep awake, and serve entries whose server has stopped turned off. */
  async function refreshDev(servers: Awaited<ReturnType<typeof listServers>>): Promise<void> {
    for (const [name, s] of served) if (!servers.some(x => x.port === s.port)) { served.delete(name); await serve(s.port, s.https, false) }
    const [ts, awake] = await Promise.all([tailnet(), awakePid()])
    hub.set({ dev: devRows(devFolders(), readDev, servers, ts), tailscale: !!ts, awake: !!awake })
  }

  /** Starts the terminal here, then serves its port on the tailnet once it listens (within a minute). */
  function runDev(row: { folder: string; project: string; command: string }): void {
    if (!startDev(row.folder, row.project, row.command)) return
    const name = `Dev: ${row.project}`
    const until = Date.now() + DEV_WAIT_MS
    const look = async () => {
      const terminal = vscode.window.terminals.find(t => t.name === name && t.exitStatus === undefined)
      if (!terminal || Date.now() > until) return
      const port = devRows([row.folder], () => row, await listServers(), null)[0]?.port
      if (!port) return void setTimeout(look, 2000)
      const ts = await tailnet()
      if (ts) { await serve(port, ts.https, true); served.set(name, { port, https: ts.https }) }
      refresh()
    }
    setTimeout(look, 2000)
  }

  /** The folder of a dev command a request names: only a listed project's. */
  const devRequest = (folder: string) => knownDev(hub.get().dev, folder) ?? knownDev(devRows(devFolders(), readDev, [], null), folder)

  async function stopServer(pid: number): Promise<void> {
    const server = hub.get().servers.find(s => s.pid === pid)
    if (!server) return
    const pick = await vscode.window.showWarningMessage(`Stop ${server.command} on :${server.port}${server.folder ? ` (${server.folder})` : ''}?`, { modal: true }, 'Stop it')
    if (pick !== 'Stop it') return
    try { process.kill(pid) } catch (err) { void vscode.window.showWarningMessage(`Could not stop it (${(err as Error).message}).`) }
    setTimeout(refresh, 800)
  }
  /** Its share of the hub messages; undefined for any other type. */
  function handle(m: WebviewToExtensionMessage): HubReply | undefined {
    switch (m.type) {
      case 'hub-dev-start': {
        const row = devRequest(m.folder)
        if (!row) return refuse('that folder is not a project with a dev script')
        const home = devHome(readWindows(), row.folder, process.pid)
        // The window holding the project runs it; when that window does not answer, this one does.
        if (home) void postWindow(home, { kind: 'dev-start', folder: row.folder }).then(ok => { if (!ok) runDev(row) })
        else runDev(row)
        return true
      }
      case 'hub-dev-stop': {
        const row = devRequest(m.folder)
        if (!row) return refuse('that folder is not a project with a dev script')
        stopDev(row.project)
        for (const w of readWindows()) if (w.pid !== process.pid) void postWindow(w, { kind: 'dev-stop', folder: row.folder })
        // A server started by hand has no terminal anywhere: once the terminals had their chance, stop it by pid (the Mac asks first).
        setTimeout(async () => {
          const port = devRows([row.folder], () => row, await listServers(), null)[0]?.port
          const pid = hub.get().servers.find(s => s.port === port)?.pid
          if (pid) void stopServer(pid)
          else refresh()
        }, 3000)
        return true
      }
      default:
        return undefined
    }
  }
  return { served, devFolders, refreshDev, runDev, devRequest, stopServer, handle }
}
