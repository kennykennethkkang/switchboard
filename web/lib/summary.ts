import type { ChatSummary } from './hub-types'

export type SummaryView = { kind: 'busy' | 'done' | 'error'; text?: string; refreshing?: boolean }

/** What the panel shows; ask: whether opening it should send hub-summary (nothing yet, or the last try failed). */
export function summaryView(s?: ChatSummary): SummaryView & { ask: boolean } {
  if (s?.busy) return s.text ? { kind: 'done', text: s.text, refreshing: true, ask: false } : { kind: 'busy', ask: false }
  if (s?.error) return { kind: 'error', text: s.error, ask: true }
  if (s?.text) return { kind: 'done', text: s.text, ask: false }
  return { kind: 'busy', ask: true }
}
