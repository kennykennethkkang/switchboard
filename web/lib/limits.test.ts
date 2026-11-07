import { test } from 'node:test'
import assert from 'node:assert/strict'
import { limitMeters, resetAt, resetText } from './limits'
import type { Limit, SessionLive } from './hub-types'

// Sat 7 Nov 2026, 12:00 local
const now = new Date(2026, 10, 7, 12, 0).getTime()
const chat = (limits: Limit[], at = now): SessionLive => ({ sessionId: String(Math.random()), cwd: '/w', limits, at })

test('resetAt: ISO, epoch seconds and epoch ms, as strings or numbers', () => {
  const ms = new Date(2026, 10, 7, 15, 40).getTime()
  assert.equal(resetAt(new Date(ms).toISOString()), ms)
  assert.equal(resetAt(ms / 1000), ms)
  assert.equal(resetAt(String(ms / 1000)), ms)
  assert.equal(resetAt(ms), ms)
  assert.equal(resetAt(String(ms)), ms)
  assert.equal(resetAt(undefined), undefined)
  assert.equal(resetAt('soon'), undefined)
})

test('resetText: time today, weekday later', () => {
  assert.equal(resetText(new Date(2026, 10, 7, 15, 40).getTime(), now), '3:40 PM')
  assert.equal(resetText(new Date(2026, 10, 7, 12, 5).getTime(), now), '12:05 PM')
  assert.equal(resetText(new Date(2026, 10, 10, 9, 0).getTime(), now), 'Tue 9 AM')
  assert.equal(resetText(new Date(2026, 10, 8, 0, 30).getTime(), now), 'Sun 12:30 AM')
})

test('limitMeters: both windows, from one chat', () => {
  const r5 = new Date(2026, 10, 7, 15, 40).getTime(), rw = new Date(2026, 10, 10, 9, 0).getTime()
  const m = limitMeters([chat([{ kind: 'five_hour', percentUsed: 42.4, resetsAt: new Date(r5).toISOString() }, { kind: 'seven_day', percentUsed: 18, resetsAt: String(rw / 1000) }])], now)
  assert.deepEqual(m, [
    { kind: 'five_hour', label: '5h', percent: 42, reset: 'resets 3:40 PM' },
    { kind: 'seven_day', label: 'Week', percent: 18, reset: 'resets Tue 9 AM' },
  ])
})

test('limitMeters: a window missing in one chat comes from another; missing everywhere is no data', () => {
  const m = limitMeters([chat([{ kind: 'five_hour', percentUsed: 10 }]), chat([{ kind: 'seven_day', percentUsed: 30 }])], now)
  assert.deepEqual(m.map(x => [x.label, x.percent]), [['5h', 10], ['Week', 30]])
  const none = limitMeters([chat([{ kind: 'five_hour', percentUsed: 10 }])], now)
  assert.deepEqual(none[1], { kind: 'seven_day', label: 'Week', level: 'none' })
  assert.deepEqual(limitMeters([], now).map(x => x.percent), [undefined, undefined])
})

test('limitMeters: highest across chats in the latest window; a past reset reads 0', () => {
  const r = new Date(2026, 10, 7, 15, 40), old = new Date(2026, 10, 7, 10, 0)
  const m = limitMeters([
    chat([{ kind: 'five_hour', percentUsed: 40, resetsAt: r.toISOString() }]),
    chat([{ kind: 'five_hour', percentUsed: 55, resetsAt: String(r.getTime()) }]),
    chat([{ kind: 'five_hour', percentUsed: 99, resetsAt: old.toISOString() }]),
  ], now)
  assert.equal(m[0].percent, 55)
  const stale = limitMeters([chat([{ kind: 'five_hour', percentUsed: 99, resetsAt: old.toISOString() }])], now)
  assert.deepEqual(stale[0], { kind: 'five_hour', label: '5h', percent: 0 })
})

test('limitMeters: level from the raw %, never reads 100% unless it is', () => {
  const at = (p: number) => limitMeters([chat([{ kind: 'five_hour', percentUsed: p }])], now)[0]
  assert.deepEqual([at(99.6).percent, at(99.6).level], [99, 'high'])
  assert.deepEqual([at(79.9).percent, at(79.9).level], [79, undefined])
  assert.deepEqual([at(80).percent, at(80).level], [80, 'high'])
  assert.deepEqual([at(100).percent, at(100).level], [100, 'out'])
})

test('limitMeters: resets a few seconds apart are one window, highest % wins', () => {
  const iso = (min: number, sec: number) => new Date(now + min * 60_000 + sec * 1000).toISOString()
  const m = limitMeters([
    chat([{ kind: 'five_hour', percentUsed: 97, resetsAt: iso(180, 29) }]),
    chat([{ kind: 'five_hour', percentUsed: 40, resetsAt: iso(180, 31) }]),
    chat([{ kind: 'five_hour', percentUsed: 99, resetsAt: iso(120, 0) }]),
  ], now)
  assert.equal(m[0].percent, 97)
})
