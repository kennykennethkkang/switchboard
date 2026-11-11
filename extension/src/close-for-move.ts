// A folder move asks here: ~/.claude/close-window-for-move holds a folder path, and the
// window open on it closes so the move can run without quitting every other window.
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'

const FLAG = path.join(os.homedir(), '.claude', 'close-window-for-move')

export function watchCloseForMove(context: vscode.ExtensionContext) {
  const t = setInterval(() => {
    let want: string
    try { want = fs.readFileSync(FLAG, 'utf8').trim() } catch { return }
    if (want && vscode.workspace.workspaceFolders?.some(f => f.uri.fsPath === want)) {
      clearInterval(t)
      void vscode.commands.executeCommand('workbench.action.closeWindow')
    }
  }, 5000)
  context.subscriptions.push({ dispose: () => clearInterval(t) })
}
