/** Every open Switchboard view's sender (editor panel and sidebar), so hub state reaches all of them. */
export class Posters<M> {
  private readonly senders = new Map<(m: M) => void, () => boolean>()
  // The state each view was last sent, as JSON per field, so only what moved is posted.
  private readonly last = new Map<(m: M) => void, Record<string, string>>()
  get size(): number { return this.senders.size }
  /** The views on screen now; a view VS Code keeps alive while hidden is open but not shown. */
  get shown(): number { return [...this.senders.values()].filter(v => v()).length }
  /** Returns the remover; removing one sender leaves the others. visible: whether that view is on screen. */
  add(send: (m: M) => void, visible: () => boolean = () => true): () => void {
    this.senders.set(send, visible)
    return () => { this.senders.delete(send); this.last.delete(send) }
  }
  /** Only to shown views: a hidden one gets the current state when it shows again. */
  send(m: M): void {
    for (const [s, v] of this.senders) if (v()) s(m)
  }
  /** The state to shown views: whole the first time, then the fields that moved since that view's last; nothing when none did. */
  sendState(now: Record<string, string>, whole: () => M, part: (set: string[], del: string[]) => M): void {
    for (const [s, v] of this.senders) {
      if (!v()) continue
      const was = this.last.get(s)
      const set = was && Object.keys(now).filter(k => now[k] !== was[k]), del = was && Object.keys(was).filter(k => !(k in now))
      if (set && del && !set.length && !del.length) continue
      this.last.set(s, now)
      s(set && del ? part(set, del) : whole())
    }
  }
  /** A view lost its state (reloaded): everyone gets the whole one next. */
  forget(): void { this.last.clear() }
}

/**
 * What the 15 s tick reads. Full (plan, git, servers, changes, chats) while a view shows or the standalone app
 * reads /hub/state; otherwise only what handoffs, closing and tools need (the chats), even in a window never opened.
 * A view in a window that is not focused gets the full read once a minute (sinceFull): every open window would repeat the same git, lsof and ps.
 */
export const UNFOCUSED_EVERY_MS = 60_000
export function tickWork(shown: number, appReading: boolean, focused = true, sinceFull = Infinity): 'full' | 'essentials' {
  return appReading || (shown && (focused || sinceFull >= UNFOCUSED_EVERY_MS)) ? 'full' : 'essentials'
}
