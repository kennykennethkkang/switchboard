/** Who opened each VS Code terminal: Switchboard (a chat's, tagged at creation) or the user. No vscode import, so tests inject terminals. */
import * as path from 'path'
import type { ChatRow, TerminalRow, WindowColor } from './types'

export const ANSI: Record<WindowColor, string> = {
  violet: 'terminal.ansiMagenta', amber: 'terminal.ansiYellow', teal: 'terminal.ansiCyan',
  rose: 'terminal.ansiRed', lime: 'terminal.ansiGreen', cobalt: 'terminal.ansiBlue',
}

type Term = { name: string; exitStatus?: unknown; dispose(): void }
// prefix: the AI's name in front of the chat's ("Claude"); named: the last name we gave it, VS Code may lag.
type Tag = { id: number; owner: 'switchboard' | 'user'; sessionId?: string; prefix?: string; named?: string }

const inside = (cwd: string, root: string) => cwd === root || cwd.startsWith(root + path.sep)

export class TerminalTags<T extends Term> {
  private tags = new Map<T, Tag>()
  private lost = new Set<string>()
  private next = 1

  own(t: T, prefix?: string, sessionId?: string): void {
    this.tags.set(t, { id: this.next++, owner: 'switchboard', prefix, sessionId, named: t.name })
  }

  /** onDidOpenTerminal or a terminal there at startup; ours: it carries our icon (restored after a reload). */
  seen(t: T, ours = false): void {
    if (this.tags.has(t)) return
    if (ours) this.own(t, /^(\w+): /.exec(t.name)?.[1])
    else this.tags.set(t, { id: this.next++, owner: 'user' })
  }

  gone(t: T): void {
    const tag = this.tags.get(t)
    if (tag?.owner === 'switchboard' && tag.sessionId) this.lost.add(tag.sessionId)
    this.tags.delete(t)
  }

  ownerOf(t: T) { return this.tags.get(t)?.owner }
  find(id: number) { return [...this.tags].find(([, tag]) => tag.id === id)?.[0] }
  /** The chat's terminal, ours first. */
  of(sessionId: string) {
    const all = [...this.tags].filter(([, tag]) => tag.sessionId === sessionId)
    return (all.find(([, tag]) => tag.owner === 'switchboard') ?? all[0])?.[0]
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
    for (const c of chats.filter(c => c.live && c.pid && !bound.has(c.sessionId))) {
      const t = await locate(c.pid)
      if (t) this.host(t, c.sessionId)
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
