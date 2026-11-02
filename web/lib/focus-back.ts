/** Just enough of an Element for focusBack, so it tests without a DOM. */
type Row = { querySelector(s: string): { focus(): void } | null }
type El = { closest(s: string): Row | null }

/**
 * After an inline Confirm or Rename closes: focus its row's More button, else the row's first button.
 * Looked up after the render, since the button may only come back then. An app's confirm sits in a
 * wrapper row that goes away, so the app or list row is tried first.
 */
export function focusBack(el: El | null, later: (f: () => void) => void = f => requestAnimationFrame(f)): void {
  const row = el?.closest('li, .si-app') ?? el?.closest('.si-row')
  if (row) later(() => (row.querySelector('.hub-more-btn') ?? row.querySelector('button'))?.focus())
}
