/** Chat wait links as the cards and the Orbit arc show them. */
import type { ChatLink, ChatRow } from './hub-types'
import { baseName } from './path'

/** One side of a link. out: this chat waits on id; in: id waits on this chat. file: an auto link's file. */
export type LinkChip = { dir: 'out' | 'in'; id: string; name: string; file?: string }

export function linkChips(links: ChatLink[] = [], chats: ChatRow[], id: string): LinkChip[] {
  const name = (sid: string) => chats.find(c => c.sessionId === sid)?.name ?? sid.slice(0, 8)
  const out = links.filter(l => l.from === id).flatMap(l => l.to.map(to => ({ dir: 'out' as const, id: to, name: name(to), file: l.auto ? baseName(l.reason) : undefined })))
  const inc = links.filter(l => l.from !== id && l.to.includes(id)).map(l => ({ dir: 'in' as const, id: l.from, name: name(l.from) }))
  return [...out, ...inc]
}

export const chipText = (c: LinkChip) => c.dir === 'out' ? `Waiting on ${c.name}${c.file ? ` · ${c.file}` : ''}` : `${c.name} waits on this`

/** Whether `from` waits on `to`, directly or through other links. */
export function waitsOn(links: ChatLink[], from: string, to: string): boolean {
  const seen = new Set<string>(), next = [from]
  while (next.length) {
    const at = next.pop()
    for (const id of links.filter(l => l.from === at).flatMap(l => l.to)) {
      if (id === to) return true
      if (!seen.has(id)) { seen.add(id); next.push(id) }
    }
  }
  return false
}

/** The Wait for picker: the other live chats in this chat's project that it does not wait on yet and that do not wait on it. A Codex chat waits through the switchboard MCP's chats_wait. */
export const waitTargets = (chats: ChatRow[], chat: ChatRow, links: ChatLink[] = []) => {
  const on = new Set(links.filter(l => l.from === chat.sessionId).flatMap(l => l.to))
  return chats.filter(c => c.live && c.sessionId !== chat.sessionId && c.cwd === chat.cwd && !on.has(c.sessionId) && !waitsOn(links, c.sessionId, chat.sessionId))
}
