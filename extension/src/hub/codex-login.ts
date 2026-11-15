/** Sign in to an AI: its loginCommand in a background terminal at the project folder; the sign-in state is read again once it closes. */
import * as vscode from 'vscode'
import { AIS, forgetLogin } from './ais'
import type { AiId } from './types'

export function signInTerminal(ai: AiId, refresh: () => void): boolean {
  const cmd = AIS[ai]?.loginCommand
  if (!cmd) return false
  const t = vscode.window.createTerminal({ name: `${AIS[ai].name}: sign in`, cwd: vscode.workspace.workspaceFolders?.[0]?.uri })
  t.show(true)
  t.sendText(cmd)
  const done = vscode.window.onDidCloseTerminal(c => { if (c !== t) return; done.dispose(); forgetLogin(ai); refresh() })
  return true
}
