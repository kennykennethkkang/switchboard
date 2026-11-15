/** The Today card: what finished today, what waits on you, what runs, and what today cost. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { needsLines, todayView, tokenText } from './today'
import { demoHub } from './hub-demo'
import { liveChats } from './archive'

test('sorts live chats into done today, needs you (with the question) and working, and sums today', () => {
  const now = Date.UTC(2026, 9, 28, 15)
  const h = demoHub(now)
  const cards = liveChats(h.chats, h.archive).map(chat => ({ chat, progress: h.progress.find(p => p.sessionId === chat.sessionId) }))
  const t = todayView(cards, h.history, h.live, now, h.jev)
  // Waiting on Kenneth's approval is not done.
  assert.deepEqual(t.done, [])
  assert.deepEqual(t.approve, ['Hub AIs and Starred', 'Finished receipt'])
  assert.deepEqual(t.jev, { runs: 2, costUsd: 0.0184 })
  assert.deepEqual(t.needs, [{ name: 'Outfit picker copy', question: "Keep 'Closet' or rename it to 'Wardrobe'?" }, { name: 'Search filters', question: 'Approve this chat as finished?' }])
  assert.deepEqual(t.working, ['Fix login redirect v4', 'Accurate Done state'])
  assert.equal(t.openCostUsd, 1.84)
  const today = h.history[h.history.length - 1]
  assert.equal(t.tokens, today.written + today.io)
})

test('a chat that finished yesterday is not done today; no usage means no numbers', () => {
  const now = Date.UTC(2026, 9, 28, 15)
  const card = { chat: { sessionId: 'a', name: 'Old', cwd: '/u/x' }, progress: { state: 'done' as const, at: now - 2 * 86_400_000 } }
  const t = todayView([card], [], [], now)
  assert.deepEqual(t.done, [])
  assert.deepEqual(t.approve, ['Old'])
  assert.equal(t.openCostUsd, undefined)
  assert.equal(t.tokens, undefined)
  assert.equal(t.jev, undefined)
  const old = todayView([card], [], [], now, [{ items: 3, costUsd: 1, seconds: 1, at: now - 2 * 86_400_000 }])
  assert.equal(old.jev, undefined)
})

test('done today counts chats approved today, from the archive', () => {
  const now = Date.UTC(2026, 9, 28, 15)
  const row = (name: string, approvedAt?: number) => ({ sessionId: name, ai: 'claude' as const, name, origin: name, version: 1, cwd: '/u/x', project: 'x', archivedAt: now - 60e3, ...(approvedAt ? { approvedAt } : {}) })
  const t = todayView([], [], [], now, [], [row('Shipped', now - 60e3), row('Closed'), row('Old', now - 2 * 86_400_000)])
  assert.deepEqual(t.done, ['Shipped'])
})

test('needs you lines lead with what to do', () => {
  const t = { done: [], approve: ['Fix login'], needs: [{ name: 'Copy', question: 'Keep Closet?' }, { name: 'Picker', question: 'Which one?', choices: true as const }, { name: 'Quiet' }], working: [] }
  assert.deepEqual(needsLines(t, 'Reload VS Code'), ['Decide: Which one? (Picker)', 'Answer: Keep Closet? (Copy)', 'Answer: Quiet', 'Approve: Fix login', 'Do: Reload VS Code'])
  assert.deepEqual(needsLines({ ...t, approve: [], needs: [] }), [])
})

test('token text switches to M after rounding, not before', () => {
  assert.equal(tokenText(12_400), '12K')
  assert.equal(tokenText(999_400), '999K')
  assert.equal(tokenText(999_500), '1.0M')
  assert.equal(tokenText(2_450_000), '2.5M')
})
