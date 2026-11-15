/** VS Code side of terminal-tags.ts: chat terminals get our icon and this window's color, and the panel lists every terminal by owner. */
import * as vscode from 'vscode'
import { hub } from './hub-service'
import { chatTerminal } from './ais'
import { ANSI, restoredOurs, TerminalTags, type TermMemo } from './terminal-tags'
import type { ChatRow } from './types'
import { editor } from '../editor'

const ICON = 'radio-tower'
export const tags = new TerminalTags<vscode.Terminal>()
// Chat terminals by shell pid, so a reload keeps their chat and age and Approve still closes them.
const MEMO = 'switchboard.terminalMemo'
let store: vscode.Memento | undefined
let restored: Record<string, TermMemo> = {}
let saved = ''
// Saves wait for the revived terminals, or an early sync would write a memo without them.
let ready: Promise<unknown> = Promise.resolve()

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

async function see(t: vscode.Terminal): Promise<void> {
  const mine = ours(t)
  const pid = mine ? await t.processId : undefined
  tags.seen(t, mine, pid ? restored[pid] : undefined)
}

async function saveMemo(): Promise<void> {
  if (!store) return
  await ready
  const all = await Promise.all(tags.memo().map(async ([t, m]) => [await t.processId, m] as const))
  const json = JSON.stringify(Object.fromEntries(all.filter(([pid]) => pid)))
  if (json === saved) return
  saved = json
  await store.update(MEMO, JSON.parse(json))
}

export function watchTerminals(state?: vscode.Memento): vscode.Disposable {
  store = state
  restored = state?.get<Record<string, TermMemo>>(MEMO) ?? {}
  ready = Promise.all(vscode.window.terminals.map(see)).then(post)
  return vscode.Disposable.from(
    vscode.window.onDidOpenTerminal(t => { void see(t).then(post) }),
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
  await Promise.all(vscode.window.terminals.filter(t => tags.ownerOf(t) === 'user' && ours(t)).map(async t => {
    const pid = await t.processId
    tags.claim(t, pid ? restored[pid] : undefined)
  }))
  await tags.bindLive(chats, pid => chatTerminal(pid, vscode.window.terminals))
  tags.closeEnded(chats, new Map(hub.get().archive.flatMap(a => a.approvedAt ? [[a.sessionId, a.approvedAt] as const] : [])))
  await renameActive(vscode.window.activeTerminal, chats)
  post()
  await saveMemo().catch(() => {})
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
