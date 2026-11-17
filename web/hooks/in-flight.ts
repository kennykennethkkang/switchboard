/** Commands sent and not yet answered, for the busy bar and the pressed button's data-pending. */
type Mark = { setAttribute(k: string, v: string): void; removeAttribute(k: string): void }

export function inFlight(minMs = 300, now = () => Date.now(), later: (f: () => void, ms: number) => unknown = setTimeout) {
  let count = 0, ext = false
  const subs = new Set<() => void>()
  const marks = new Map<Mark, number>()
  // Ends for commands the VS Code bridge never answers; the next hub state settles them.
  const unacked = new Set<() => void>()
  const emit = () => { for (const f of subs) f() }
  return {
    busy: () => count > 0 || ext,
    subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f) } },
    setExt(on: boolean) { if (on !== ext) { ext = on; emit() } },
    /** Counts a command from the tap; the end it answers holds it until at least minMs have passed. */
    start(el?: Mark, noAnswer = false): () => void {
      const at = now()
      count++
      if (el) {
        marks.set(el, (marks.get(el) ?? 0) + 1)
        el.setAttribute('data-pending', '')
        el.setAttribute('aria-busy', 'true')
      }
      emit()
      let done = false
      const end = () => {
        if (done) return
        done = true
        unacked.delete(end)
        later(() => {
          count--
          const left = el ? (marks.get(el) ?? 1) - 1 : 0
          if (el && left) marks.set(el, left)
          else if (el) { marks.delete(el); el.removeAttribute('data-pending'); el.removeAttribute('aria-busy') }
          emit()
        }, Math.max(0, minMs - (now() - at)))
      }
      if (noAnswer) unacked.add(end)
      return end
    },
    endAll() { for (const end of [...unacked]) end() },
  }
}

export const pending = inFlight()
