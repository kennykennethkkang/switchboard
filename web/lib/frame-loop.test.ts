import { test } from 'node:test'
import assert from 'node:assert/strict'
import { frameLoop } from './frame-loop'

test('wake draws once, loops while run holds, sleeps after', () => {
  const q: Array<(t: number) => void> = []
  const g = globalThis as any
  g.requestAnimationFrame = (f: (t: number) => void) => q.push(f)
  g.cancelAnimationFrame = () => { q.length = 0 }
  const seen: number[] = []
  let on = true
  const l = frameLoop((_n, dt) => seen.push(dt), () => on)
  l.wake()
  assert.deepEqual(seen, [16]); assert.ok(l.running())
  l.wake(); assert.equal(seen.length, 1)
  q.shift()!(performance.now() + 20); assert.equal(seen.length, 2); assert.ok(l.running())
  on = false
  q.shift()!(performance.now() + 40); assert.equal(seen.length, 3); assert.ok(!l.running())
  on = true; l.wake(); assert.equal(seen.length, 4)
  l.stop(); assert.ok(!l.running())
})
