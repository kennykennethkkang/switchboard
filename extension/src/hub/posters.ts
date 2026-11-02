/** Every open Switchboard view's sender (editor panel and sidebar), so hub state reaches all of them. */
export class Posters<M> {
  private readonly senders = new Map<(m: M) => void, () => boolean>()
  // The key each view was last sent, so an unchanged state is not posted again.
  private readonly last = new Map<(m: M) => void, string>()
  get size(): number { return this.senders.size }
  /** The views on screen now; a view VS Code keeps alive while hidden is open but not shown. */
  get shown(): number { return [...this.senders.values()].filter(v => v()).length }
  /** Returns the remover; removing one sender leaves the others. visible: whether that view is on screen. */
  add(send: (m: M) => void, visible: () => boolean = () => true): () => void {
    this.senders.set(send, visible)
    return () => { this.senders.delete(send); this.last.delete(send) }
  }
  /** Only to shown views: a hidden one gets the current state when it shows again. With key (m serialized), a view last sent that key is skipped. */
  send(m: M, key?: string): void {
    for (const [s, v] of this.senders) {
      if (!v() || (key !== undefined && this.last.get(s) === key)) continue
      if (key !== undefined) this.last.set(s, key)
      s(m)
    }
  }
}

/**
 * What the 15 s tick reads. Full (plan, git, servers, changes, chats) while a view shows or the standalone app
 * reads /hub/state; otherwise only what handoffs, closing and tools need (the chats), even in a window never opened.
 */
export function tickWork(shown: number, appReading: boolean): 'full' | 'essentials' {
  return shown || appReading ? 'full' : 'essentials'
}
