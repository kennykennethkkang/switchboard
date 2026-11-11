/** VS Code side of terminal-tags.ts: chat terminals get our icon and this window's color, and the panel lists every terminal by owner. */
import * as vscode from 'vscode'
import { hub } from './hub-service'
import { chatTerminal } from './ais'
import { ANSI, restoredOurs, TerminalTags } from './terminal-tags'
import type { ChatRow } from './types'
import { editor } from '../editor'

const ICON = 'radio-tower'
export const tags = new TerminalTags<vscode.Terminal>()

// Restored chat terminals stay ours; instanceof ThemeIcon failed for them, so Approve left them open.
const ours = (t: vscode.Terminal) => restoredOurs((t.creationOptions as vscode.TerminalOptions).iconPath, t.name, ICON)

/** createTerminal for a chat, tagged switchboard. prefix: the AI's name in front of the chat's. */
export function openChatTerminal(o: vscode.TerminalOptions, prefix: string, sessionId?: string): vscode.Terminal {
  const s = hub.get()
  const color = s.windows?.find(w => w.workspace === s.thisWindow)?.color
  const t = vscode.window.createTerminal({ ...o, iconPath: new vscode.ThemeIcon(ICON), ...(color ? { color: new vscode.ThemeColor(ANSI[color]) } : {}) })
  tags.own(t, prefix, sessionId)
  return t
}

function post(): void {
  const chats = hub.get().chats
  hub.set({
    terminals: tags.rows(vscode.window.terminals, chats),
    noTerminal: tags.missing(chats, hub.get().thisWindow).map(c => ({ sessionId: c.sessionId, name: c.name, ai: c.ai })),
  })
}

export function watchTerminals(): vscode.Disposable {
  for (const t of vscode.window.terminals) tags.seen(t, ours(t))
  post()
  return vscode.Disposable.from(
    vscode.window.onDidOpenTerminal(t => { tags.seen(t, ours(t)); post() }),
    vscode.window.onDidCloseTerminal(t => { tags.gone(t); post() }),
    vscode.window.onDidChangeActiveTerminal(t => { void renameActive(t).then(post) }),
  )
}

// The API cannot rename a terminal and the command renames the active one, so only that one, never shown for it.
async function renameActive(t: vscode.Terminal | undefined, chats: ChatRow[] = hub.get().chats): Promise<void> {
  for (const [term, name] of tags.renamesFor(chats, t)) {
    if (vscode.window.activeTerminal !== term) return
    try { await vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name }) } catch { /* marked anyway, no retry loop */ }
    tags.renamed(term, name)
  }
}

/** With each fresh chat list: tie live chats to terminals by pid, follow renames, post the rows. */
export async function syncTerminals(chats: ChatRow[]): Promise<void> {
  // ponytail: a ps per unbound live chat per refresh; cache misses if it ever shows up.
  await tags.bindLive(chats, pid => chatTerminal(pid, vscode.window.terminals))
  tags.closeEnded(chats, new Map(hub.get().archive.flatMap(a => a.approvedAt ? [[a.sessionId, a.approvedAt] as const] : [])))
  await renameActive(vscode.window.activeTerminal, chats)
  post()
}

/** A row's terminal, shown with focus (only a click lands here). close: ours only, never the user's. */
export function terminalAction(id: number, act: 'show' | 'close'): string | undefined {
  const t = tags.find(id)
  if (!t) return 'that terminal is gone'
  if (act === 'show') { t.show(); return undefined }
  if (tags.ownerOf(t) !== 'switchboard') return `that terminal is yours; close it in ${editor.name}`
  t.dispose()
  return undefined
}

/** Disposes this window's Switchboard terminals for the chat (the approve flow); user terminals are never touched. False when none. */
export const closeChatTerminal = (sessionId: string): boolean => tags.closeChat(sessionId) > 0
