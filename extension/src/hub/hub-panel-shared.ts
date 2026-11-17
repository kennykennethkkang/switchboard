import * as vscode from 'vscode'

/** What handleHubMessage answers: true, a string for why it was refused, or either later. */
export type HubReply = boolean | string | Promise<boolean | string>

/** Warns on the Mac and returns the problem, so a refusal reads the same everywhere. */
export function refuse(problem: string): string {
  void vscode.window.showWarningMessage(`Switchboard: ${problem}.`)
  return problem
}
