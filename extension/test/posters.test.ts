import { it } from 'node:test'
import assert from 'node:assert/strict'
import { Posters, tickWork } from '../src/hub/posters'

it('sends to every poster, and removing one leaves the others', () => {
  const posters = new Posters<string>()
  const a: string[] = []
  const b: string[] = []
  const offA = posters.add(m => a.push(m))
  posters.add(m => b.push(m))
  posters.send('x')
  offA()
  posters.send('y')
  assert.deepEqual(a, ['x'])
  assert.deepEqual(b, ['x', 'y'])
  assert.equal(posters.size, 1)
})

it('sends only to shown views, and counts them', () => {
  const posters = new Posters<string>()
  const got: string[] = []
  let visible = false
  posters.add(m => got.push(m), () => visible)
  posters.send('hidden')
  assert.equal(posters.shown, 0)
  visible = true
  posters.send('shown')
  assert.equal(posters.shown, 1)
  assert.deepEqual(got, ['shown'])
})

it('skips a view already sent the same state, but not one that was hidden for it', () => {
  const posters = new Posters<string>()
  const a: string[] = []
  const b: string[] = []
  let bShown = false
  const send = (m: string, k: string) => posters.sendState({ k }, () => m, () => m)
  posters.add(m => a.push(m))
  posters.add(m => b.push(m), () => bShown)
  send('s1', 'k1')
  send('s1 again', 'k1')
  bShown = true
  send('s1 shown', 'k1')
  send('s2', 'k2')
  assert.deepEqual(a, ['s1', 's2'])
  assert.deepEqual(b, ['s1 shown', 's2'])
})

it('the 15 s tick: everything while a view shows, else only the chats, which handoffs and asks need in any window', () => {
  assert.equal(tickWork(1, false), 'full')
  assert.equal(tickWork(0, false), 'essentials')
  // The standalone app reading /hub/state counts as a shown view.
  assert.equal(tickWork(0, true), 'full')
})
