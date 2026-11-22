/**
 * VS Code side of screen.ts: follows every terminal's shell executions into a headless screen and answers the
 * Screen routes for the chats whose terminal this window holds. Needs VS Code's shell integration (1.93 and
 * up); a chat started before this window loaded, or by Codex (no shell around it), has no screen.
 */
import * as vscode from 'vscode'
import { execFile } from 'child_process'
import { agentForeground, parseSize, Screens, setScreenHost, type Host, type Size } from './screen'

const screens = new Screens<vscode.Terminal>()
const run = (cmd: string, args: string[]) => new Promise<string>(done => execFile(cmd, args, { timeout: 2000, windowsHide: true }, (err, out) => done(err ? '' : String(out))))

/** The terminal's tty name (ttys003, pts/3), from its shell's pid. Not on Windows. */
async function ttyOf(t: vscode.Terminal): Promise<string | undefined> {
  const pid = await t.processId
  if (!pid || process.platform === 'win32') return undefined
  const tty = (await run('ps', ['-o', 'tty=', '-p', String(pid)])).trim()
  return /^[\w/]+$/.test(tty) && !tty.startsWith('?') ? tty : undefined
}

/** The size claude draws for: the pty's own, since the API does not report it. */
async function sizeOf(t: vscode.Terminal): Promise<Size | undefined> {
  const tty = await ttyOf(t)
  return tty ? parseSize(await run('stty', [process.platform === 'darwin' ? '-f' : '-F', `/dev/${tty}`, 'size'])) : undefined
}

async function agentIn(t: vscode.Terminal): Promise<boolean> {
  const tty = await ttyOf(t)
  return !!tty && agentForeground(await run('ps', ['-ww', '-t', tty, '-o', 'stat=,args=']))
}

async function follow(e: vscode.TerminalShellExecutionStartEvent): Promise<void> {
  const t = e.terminal
  try {
    // read() first: it only sees what comes after the call.
    const stream = e.execution.read()
    screens.start(t)
    const size = sizeOf(t)
    void size.then(s => { if (s) screens.resize(t, s) })
    let first = true
    for await (const data of stream) {
      // The first write waits for the size, so the opening frame is parsed at the width it was drawn for.
      if (first) { first = false; await size }
      await screens.write(t, data)
    }
  } catch { /* the terminal closed mid-read */ }
  screens.end(t)
}

// When each terminal's size was last read: a window resize changes it, so a viewer's polls re-read every few seconds.
const sized = new WeakMap<vscode.Terminal, number>()
const RESIZE_MS = 3000

const hostFor = (find: (session: string) => vscode.Terminal | undefined): Host => ({
  async snapshot(session, ansi) {
    const t = find(session)
    if (!t || !screens.has(t)) return undefined
    if (Date.now() - (sized.get(t) ?? 0) > RESIZE_MS) {
      sized.set(t, Date.now())
      const s = await sizeOf(t)
      if (s) screens.resize(t, s)
    }
    return screens.snapshot(t, ansi)
  },
  // application scope: a repo's own .vscode/settings.json cannot turn it on.
  typing: () => vscode.workspace.getConfiguration('switchboard').get<boolean>('screenTyping') === true,
  async type(session, bytes) {
    const t = find(session)
    if (!t) return { status: 404, problem: 'that chat has no terminal in this window' }
    if (!(await agentIn(t))) return { status: 409, problem: 'claude or codex is not what runs in that terminal now' }
    t.sendText(bytes, false)
    return { status: 204 }
  },
})

/** find: the terminal tied to a chat (terminals.ts tags). */
export function watchScreens(find: (session: string) => vscode.Terminal | undefined): vscode.Disposable {
  const subs: vscode.Disposable[] = [vscode.window.onDidCloseTerminal(t => screens.drop(t))]
  if (typeof vscode.window.onDidStartTerminalShellExecution === 'function') subs.push(vscode.window.onDidStartTerminalShellExecution(e => { void follow(e) }))
  setScreenHost(hostFor(find))
  return new vscode.Disposable(() => { setScreenHost(undefined); for (const s of subs) s.dispose() })
}
