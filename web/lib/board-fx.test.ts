import { test } from 'node:test'
import assert from 'node:assert/strict'
import { endedRopes, heldChats, nextPause, pauseLine, ropeAwake, ropesBusy, ropesOf, thawAt } from './board-fx'
import type { ChatLink, LimitPause } from './hub-types'

const L = (from: string, to: string[], reason = 'r', auto = false): ChatLink => ({ from, to, reason, auto, since: 1 })

test('ropesOf: one rope per pair either way round, file from auto links', () => {
  const r = ropesOf([L('a', ['b', 'c']), L('b', ['a'], 'src/x/hub.ts', true), L('d', ['c'], 'src/y.ts', true), L('e', ['e'])])
  assert.deepEqual(r.map(x => [x.key, x.from, x.to, x.file]), [['a|b', 'a', 'b', undefined], ['a|c', 'a', 'c', undefined], ['c|d', 'd', 'c', 'y.ts']])
  assert.deepEqual(ropesOf(undefined), [])
})

test('endedRopes: the pairs that dropped out', () => {
  const was = ropesOf([L('a', ['b']), L('c', ['d'])])
  assert.deepEqual(endedRopes(was, ropesOf([L('b', ['a'])])).map(r => r.key), ['c|d'])
  assert.deepEqual(endedRopes(was, was), [])
})

test('ropeAwake: zoom 1 or either chat hot', () => {
  const [r] = ropesOf([L('a', ['b'])])
  assert.equal(ropeAwake(r, 0.5, []), false)
  assert.equal(ropeAwake(r, 1, []), true)
  assert.equal(ropeAwake(r, 0.5, [undefined, 'b']), true)
  assert.equal(ropeAwake(r, 0.5, ['c']), false)
})

test('heldChats and nextPause: thaw starts once when the pause clears', () => {
  const p: LimitPause = { kind: 'five_hour', percent: 96, chats: [{ sessionId: 'a' }, { sessionId: 'b' }] }
  assert.deepEqual([...heldChats(p)], ['a', 'b'])
  assert.equal(heldChats(undefined).size, 0)
  let s = nextPause({}, p, 10)
  assert.deepEqual(s, { pause: p, thaw: undefined })
  s = nextPause(s, undefined, 20)
  assert.deepEqual(s, { pause: p, thaw: 20 })
  assert.deepEqual(nextPause(s, undefined, 30), s)
  assert.deepEqual(nextPause({}, undefined, 30), {})
})

test('thawAt: cracks then melts; reduced motion only fades', () => {
  assert.deepEqual(thawAt(0, false), { ice: 1, crack: 0, jump: 0, basket: 0, banner: 1, frozen: true })
  const mid = thawAt(0.5, false)
  assert.equal(mid.ice, 1); assert.equal(mid.crack, 1); assert.ok(mid.jump > 0 && mid.jump < 1); assert.equal(mid.frozen, true)
  const end = thawAt(1, false)
  assert.equal(end.ice, 0); assert.equal(end.banner, 0); assert.equal(end.jump, 1); assert.equal(end.frozen, false)
  const r = thawAt(0.5, true)
  assert.equal(r.ice, 0.5); assert.equal(r.crack, 0); assert.equal(r.jump, 0); assert.equal(r.basket, 0)
})

test('pauseLine: counts held chats on the board; resuming once resumeAt passes', () => {
  const p: LimitPause = { kind: 'five_hour', percent: 96, resumeAt: 10_000, chats: [{ sessionId: 'a' }, { sessionId: 'gone' }] }
  const on = (id: string) => id === 'a', f = (ms: number) => `${ms / 1000}s`
  assert.equal(pauseLine(p, on, 4000, false, f), '1 chat held · resumes in 6s')
  assert.equal(pauseLine(p, on, 10_000, false, f), '1 chat held · resuming')
  assert.equal(pauseLine(p, () => true, 4000, true, f), '2 chats held · resuming')
  assert.equal(pauseLine({ ...p, resumeAt: undefined }, on, 4000, false, f), '1 chat held · resumes soon')
})

test('ropesBusy: only an awake rope keeps the board drawing', () => {
  const r = ropesOf([L('a', ['b'])])
  assert.equal(ropesBusy(r, 0.5, []), false)
  assert.equal(ropesBusy(r, 0.5, ['a']), true)
  assert.equal(ropesBusy(r, 1.2, []), true)
  assert.equal(ropesBusy([], 2, ['a']), false)
})

test('arrivals: desks of new courtyards only, none on the first court', async () => {
  const { arrivals } = await import('./board-fx')
  const a = { nodes: [{ id: 'yard:a', kind: 'courtyard' }, { id: 'd1', kind: 'desk', parent: 'yard:a' }] }
  const b = { nodes: [...a.nodes, { id: 'yard:b', kind: 'courtyard' }, { id: 'd2', kind: 'desk', parent: 'yard:b' }, { id: 'd3', kind: 'desk', parent: 'yard:b' }] }
  assert.deepEqual(arrivals(a, b), ['d2', 'd3'])
  assert.deepEqual(arrivals(b, b), [])
  assert.deepEqual(arrivals(undefined, b), [])
  assert.deepEqual(arrivals({ nodes: [] }, b), [])
})
