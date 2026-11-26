/** Chats idle for hours: one VS Code notice per window offers to suspend or close the ones it runs. */
import { approvalBlock, staysOpenOnApprove } from './approve'
import type { ChatProgress, ChatRow, TodoItem } from './types'

export const IDLE_CHAT_MS = 3 * 60 * 60_000

/** holds: chats that must stay (a retry, a check-back, a run, a server it started). ours: this window runs its terminal. */
export type IdleDeps = { chats: ChatRow[]; progress: ChatProgress[]; todos: TodoItem[]; holds: (id: string) => boolean; ours: (id: string) => boolean; now?: number }

/** Nothing running, nothing asked, nothing owed, for IDLE_CHAT_MS. A Done chat waits for Approve and stays; unsure means it stays. Pure. */
export function idleChats(d: IdleDeps): ChatRow[] {
  const now = d.now ?? Date.now()
  return d.chats.filter(c => {
    if ((c.ai ?? 'claude') !== 'claude' || !c.live || !c.pid || c.status !== 'idle' || c.updatedAt === undefined || now - c.updatedAt < IDLE_CHAT_MS) return false
    const p = d.progress.find(x => x.sessionId === c.sessionId)
    if (p?.state !== 'idle' || now - p.at < IDLE_CHAT_MS || p.limited || p.waiting || p.ask || p.asks?.length || p.jobs?.length || p.subJobs?.length || staysOpenOnApprove(p) || approvalBlock(p, now)) return false
    return d.ours(c.sessionId) && !d.holds(c.sessionId) && !d.todos.some(t => t.chat === c.sessionId)
  })
}

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`

/** rss: what each pid holds now, in bytes. */
export function idleText(chats: ChatRow[], rss: Map<number, number>): string {
  const held = chats.reduce((n, c) => n + (rss.get(c.pid) ?? 0), 0)
  const names = chats.slice(0, 3).map(c => c.name || 'a chat').join(', ') + (chats.length > 3 ? ` and ${chats.length - 3} more` : '')
  return `${chats.length === 1 ? '1 chat has' : `${chats.length} chats have`} sat idle for 3 hours or more${held ? ` and ${chats.length === 1 ? 'holds' : 'hold'} ${gb(held)}` : ''}: ${names}.`
}

/** One offer at a time; Not now, or closing the notice, waits another IDLE_CHAT_MS. The picks are checked again when a button is pressed. */
export function idleOffer(d: { list: () => ChatRow[] | Promise<ChatRow[]>; rss: (pids: number[]) => Promise<Map<number, number>>; ask: (text: string) => PromiseLike<string | undefined>; suspend: (id: string) => void; close: (id: string) => void; now?: () => number }) {
  let open = false, quietTill = 0
  const now = d.now ?? Date.now
  return async (): Promise<void> => {
    if (open || now() < quietTill) return
    open = true
    try {
      const found = await d.list()
      if (!found.length) return
      const pick = await d.ask(idleText(found, await d.rss(found.map(c => c.pid))))
      const act = pick === 'Suspend' ? d.suspend : pick === 'Close' ? d.close : undefined
      if (!act) { quietTill = now() + IDLE_CHAT_MS; return }
      const still = new Set((await d.list()).map(c => c.sessionId))
      for (const c of found) if (still.has(c.sessionId)) act(c.sessionId)
    } finally { open = false }
  }
}
