/** Reload gate: a window reloads for an update only after IDLE_MS with no typing, no hold (Commit, Push) and no open ask. */
import type * as vscode from 'vscode'
import { openCount } from './questions'

export const IDLE_MS = 2 * 60_000
// 0: a window nobody has typed in yet counts as idle and reloads at once.
let last = 0
let holds = 0

export const touch = (now = Date.now()) => { last = now }

/** Busy until the returned release runs; for Commit and Push. Releasing twice is a no-op. */
export function hold(): () => void {
  holds++
  let done = false
  return () => { if (!done) { done = true; holds-- } }
}

export const idle = (now = Date.now()) => holds === 0 && now - last >= IDLE_MS && openCount(now) === 0

/** VS Code events that mean someone is at this window. Terminal keystrokes are not observable (onDidWriteTerminalData is proposed API). */
export function watchActivity(vs: typeof vscode): vscode.Disposable[] {
  const on = () => touch()
  const w = vs.window
  return [
    // Focused and in the active editor: an agent writing an open file from elsewhere does not count.
    vs.workspace.onDidChangeTextDocument(e => { if (e.contentChanges.length && w.state.focused && e.document === w.activeTextEditor?.document) on() }),
    // kind is unset when code moved the selection.
    w.onDidChangeTextEditorSelection(e => { if (e.kind) on() }),
    w.onDidChangeWindowState(s => { if (s.focused) on() }),
    w.onDidChangeActiveTerminal(on),
    w.onDidChangeTerminalState(on),
    // 1.93+; engines allow 1.85.
    ...(w.onDidStartTerminalShellExecution ? [w.onDidStartTerminalShellExecution(on)] : []),
  ]
}
