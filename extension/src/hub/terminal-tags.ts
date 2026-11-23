/** Who opened each VS Code terminal: Switchboard (a chat's, tagged at creation) or the user. No vscode import, so tests inject terminals. */
import * as path from 'path'
import type { ChatRow, TerminalRow, WindowColor } from './types'

export const ANSI: Record<WindowColor, string> = {
  violet: 'terminal.ansiMagenta', amber: 'terminal.ansiYellow', teal: 'terminal.ansiCyan',
  rose: 'terminal.ansiRed', lime: 'terminal.ansiGreen', cobalt: 'terminal.ansiBlue', slate: 'terminal.ansiWhite',
}

type Term = { name: string; exitStatus?: unknown; dispose(): void }
// prefix: the AI's name in front of the chat's ("Claude"); named: the last name we gave it, VS Code may lag.
// at: when this window first saw it, so a chat resumed after its approval keeps the new terminal.
type Tag = { id: number; owner: 'switchboard' | 'user'; sessionId?: string; prefix?: string; named?: string; at: number }
/** What a chat terminal needs to survive a window reload, saved by its shell pid (the pty outlives the extension host). */
export type TermMemo = { sessionId: string; at: number }

// Chat terminals are named `<AI>: <chat>` (actions.ts); AIS names include "Claude Code".
export const CHAT_PREFIX = /^(Claude Code|Claude|Codex|Hermes): /
/** A terminal VS Code revived after a reload: the icon comes back as a plain { id }, so match the id, or the chat name if the icon was dropped. */
export const restoredOurs = (icon: unknown, name: string, iconId = 'radio-tower') => (icon as { id?: unknown } | undefined)?.id === iconId || CHAT_PREFIX.test(name)

const inside = (cwd: string, root: string) => cwd === root || cwd.startsWith(root + path.sep)

export class TerminalTags<T extends Term> {
  private tags = new Map<T, Tag>()
  private lost = new Set<string>()
  private next = 1
  constructor(private now: () => number = Date.now) {}

  own(t: T, prefix?: string, sessionId?: string, at = this.now()): void {
    this.tags.set(t, { id: this.next++, owner: 'switchboard', prefix, sessionId, named: t.name, at })
  }

  /** onDidOpenTerminal or a terminal there at startup; ours: it carries our icon (restored after a reload).
   * memo: its chat and first-seen time from before the reload, else Approve skips it as opened after the approval. */
  seen(t: T, ours = false, memo?: TermMemo): void {
    if (this.tags.has(t)) return
    if (ours) this.own(t, CHAT_PREFIX.exec(t.name)?.[1], memo?.sessionId, memo?.at)
    else this.tags.set(t, { id: this.next++, owner: 'user', at: this.now() })
  }

  /** A revived terminal tagged user because its name and icon came back after the open event (the warning-icon ones). */
  claim(t: T, memo?: TermMemo): void {
    const tag = this.tags.get(t)
    if (tag?.owner !== 'user') return
    tag.owner = 'switchboard'
    tag.prefix = CHAT_PREFIX.exec(t.name)?.[1]
    tag.named = t.name
    if (memo && (!tag.sessionId || tag.sessionId === memo.sessionId)) { tag.sessionId = memo.sessionId; tag.at = memo.at }
  }

  gone(t: T): void {
    const tag = this.tags.get(t)
    if (tag?.owner === 'switchboard' && tag.sessionId) this.lost.add(tag.sessionId)
    this.tags.delete(t)
  }

  /** Our terminals tied to a chat, to save across a reload. */
  memo(): [T, TermMemo][] {
    return [...this.tags].flatMap(([t, tag]) => tag.owner === 'switchboard' && tag.sessionId ? [[t, { sessionId: tag.sessionId, at: tag.at }] as [T, TermMemo]] : [])
  }

  ownerOf(t: T) { return this.tags.get(t)?.owner }
  find(id: number) { return [...this.tags].find(([, tag]) => tag.id === id)?.[0] }
  /** The chat's terminal, ours first. */
  of(sessionId: string) {
    const all = [...this.tags].filter(([, tag]) => tag.sessionId === sessionId)
    return (all.find(([, tag]) => tag.owner === 'switchboard') ?? all[0])?.[0]
  }

  /** The chat's Switchboard terminal only; after a reload the memo is all that ties a Codex chat to one. */
  ourOf(sessionId: string) {
    return [...this.tags].find(([, tag]) => tag.owner === 'switchboard' && tag.sessionId === sessionId)?.[0]
  }

  /** Ties an unbound terminal to its chat. A user terminal only shows which chat runs in it; it stays the user's. */
  host(t: T, sessionId: string): void {
    const tag = this.tags.get(t)
    if (tag && !tag.sessionId) tag.sessionId = sessionId
    this.lost.delete(sessionId)
  }

  /** Live chats found in a terminal by pid (ais.chatTerminal). */
  async bindLive(chats: ChatRow[], locate: (pid: number) => Promise<T | undefined>): Promise<void> {
    const bound = new Set([...this.tags.values()].map(t => t.sessionId))
    const live = new Set(chats.filter(c => c.live).map(c => c.sessionId))
    for (const c of chats.filter(c => c.live && c.pid && !bound.has(c.sessionId))) {
      const t = await locate(c.pid)
      if (!t) continue
      // A new chat started in a terminal whose old one ended (a reload memo keeps the old tie): it is the new chat's now.
      const tag = this.tags.get(t)
      if (tag?.sessionId && !live.has(tag.sessionId)) { tag.sessionId = undefined; tag.at = this.now() }
      this.host(t, c.sessionId)
    }
  }

  /** Our terminals whose chat has a new name. */
  renames(chats: ChatRow[]): [T, string][] {
    const names = new Map(chats.map(c => [c.sessionId, c.name]))
    const out: [T, string][] = []
    for (const [t, tag] of this.tags) {
      const name = tag.owner === 'switchboard' && tag.sessionId ? names.get(tag.sessionId) : undefined
      const want = name && (tag.prefix ? `${tag.prefix}: ${name}` : name)
      if (want && want !== tag.named && t.exitStatus === undefined) out.push([t, want])
    }
    return out
  }

  /** The rename command acts on the active terminal, so only that one; the rest wait their turn. */
  renamesFor(chats: ChatRow[], active: T | undefined): [T, string][] {
    return active ? this.renames(chats).filter(([t]) => t === active) : []
  }

  renamed(t: T, name: string): void {
    const tag = this.tags.get(t)
    if (tag) tag.named = name
  }

  /** Disposes the chat's Switchboard terminals, never a user's. The count closed. */
  closeChat(sessionId: string): number {
    let n = 0
    for (const [t, tag] of this.tags) {
      if (tag.owner !== 'switchboard' || tag.sessionId !== sessionId) continue
      t.dispose()
      n++
    }
    return n
  }

  /** Approved chats that ended: their Switchboard terminals close, however long the last turn ran. The count closed.
   * Ended = the terminal's process exited, or the chat is listed as not live; a chat missing from the list is not
   * enough, a failed read lists none. */
  closeEnded(chats: ChatRow[], approved: ReadonlyMap<string, number>): number {
    const ended = new Set(chats.filter(c => !c.live).map(c => c.sessionId))
    let n = 0
    for (const [t, tag] of this.tags) {
      const at = tag.sessionId ? approved.get(tag.sessionId) : undefined
      if (tag.owner !== 'switchboard' || at === undefined || tag.at > at) continue
      if (t.exitStatus === undefined && !ended.has(tag.sessionId!)) continue
      t.dispose()
      n++
    }
    return n
  }

  rows(terminals: readonly T[], chats: ChatRow[]): TerminalRow[] {
    const byId = new Map(chats.map(c => [c.sessionId, c]))
    return terminals.flatMap(t => {
      const tag = this.tags.get(t)
      if (!tag) return []
      const c = tag.sessionId ? byId.get(tag.sessionId) : undefined
      const state = t.exitStatus !== undefined ? 'exited' as const : tag.owner === 'switchboard' && tag.sessionId && !c?.live ? 'ended' as const : 'running' as const
      return [{ id: tag.id, owner: tag.owner, name: tag.named ?? t.name, state, ...(tag.sessionId ? { sessionId: tag.sessionId } : {}), ...(c?.name ? { chat: c.name } : {}) }]
    })
  }

  /** Chats in this window's folder with no terminal: live ones started elsewhere, or ones whose tagged terminal was closed. */
  missing(chats: ChatRow[], root: string | undefined): ChatRow[] {
    if (!root) return []
    const held = new Set([...this.tags.values()].map(t => t.sessionId))
    return chats.filter(c => inside(c.cwd, root) && !held.has(c.sessionId) && (c.live || this.lost.has(c.sessionId)))
  }
}
