/** The Today card's numbers, from the live chats and the usage history. */
import type { ArchivedChat, ChatState, DayUsage, StuckItem } from './hub-types'
import { chatShown, isBusy } from './chat-state'
import { projectName } from './archive'

type Card = { chat: { sessionId: string; name?: string; cwd: string; project?: string }; progress?: { state: ChatState; at: number; question?: string; waiting?: boolean; limited?: unknown; asks?: unknown[]; ask?: { kind: string; options: string[] } } }
/** done: approved today. approve: finished, waiting on Kenneth's Approve. */
export type Today = { done: string[]; approve: string[]; needs: { name: string; question?: string; choices?: true }[]; working: string[]; tokens?: number }

const dayKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const nameOf = (c: Card) => c.chat.name || projectName(c.chat) || c.chat.sessionId.slice(0, 8)

/** tokens: today's input, output and cache writes from the usage history (cache reads would dwarf them). */
export function todayView(cards: Card[], history: DayUsage[], now = Date.now(), archive: ArchivedChat[] = [], stuck?: StuckItem[]): Today {
  const day = dayKey(now)
  const usage = history.find(d => d.day === day)
  return {
    done: archive.filter(a => a.approvedAt && dayKey(a.approvedAt) === day).map(a => a.name || a.origin),
    approve: cards.filter(c => c.progress?.state === 'done').map(nameOf),
    needs: cards.filter(c => c.progress?.state === 'needs-you').map(c => ({ name: nameOf(c), question: c.progress?.question, ...(c.progress?.ask?.kind === 'question' && c.progress.ask.options.length ? { choices: true as const } : {}) })),
    working: cards.filter(c => isBusy(chatShown(c.progress as Parameters<typeof chatShown>[0], stuck, c.chat.sessionId))).map(nameOf),
    tokens: usage && usage.written + usage.io > 0 ? usage.written + usage.io : undefined,
  }
}

/** 999,500 reads 1.0M, not 1000K: the unit is picked after rounding. */
export function tokenText(n: number): string {
  const k = Math.round(n / 1e3)
  return k >= 1000 ? `${(n / 1e6).toFixed(1)}M` : `${k}K`
}

/** Today's Needs you rows, each led by what to do: choices to pick, questions, approvals, then the top hand step. */
export function needsLines(t: Pick<Today, 'needs' | 'approve'>, you?: string): string[] {
  const ask = (n: Today['needs'][number]) => n.question ? `${n.question} (${n.name})` : n.name
  return [
    ...t.needs.filter(n => n.choices).map(n => `Decide: ${ask(n)}`),
    ...t.needs.filter(n => !n.choices).map(n => `Answer: ${ask(n)}`),
    ...t.approve.map(n => `Approve: ${n}`),
    ...(you ? [`Do: ${you}`] : []),
  ]
}

/** The collapsed Today card's one line: your moves, working and done, each only when there is something to say. */
export function todayLine(t: Today, moves: number): string {
  const parts = [moves && `${moves} your moves`, t.working.length && `${t.working.length} working`, t.done.length && `${t.done.length} done`].filter(Boolean)
  return parts.join(' · ') || 'Nothing moving today'
}
