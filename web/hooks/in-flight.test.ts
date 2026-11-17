import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inFlight } from './in-flight'
import { commandWait } from '../lib/vscode-bridge'

const clock = () => {
  let t = 0
  const due: { at: number; f: () => void }[] = []
  return {
    now: () => t,
    later: (f: () => void, ms: number) => { due.push({ at: t + ms, f }) },
    tick(ms: number) { t += ms; for (const d of due.filter(d => d.at <= t)) { due.splice(due.indexOf(d), 1); d.f() } },
  }
}
const button = () => {
  const attrs = new Map<string, string>()
  return { attrs, setAttribute: (k: string, v: string) => { attrs.set(k, v) }, removeAttribute: (k: string) => { attrs.delete(k) } }
}

test('counts a command from tap until done, held at least minMs', () => {
  const c = clock(), f = inFlight(300, c.now, c.later)
  let seen = 0
  f.subscribe(() => { seen++ })
  const end = f.start()
  assert.equal(f.busy(), true, 'busy on the tap, before any answer')
  c.tick(50)
  end()
  assert.equal(f.busy(), true, 'a fast answer still shows for 300 ms')
  c.tick(249)
  assert.equal(f.busy(), true)
  c.tick(1)
  assert.equal(f.busy(), false)
  assert.equal(seen, 2)
})

test('a slow command ends as soon as it is done', () => {
  const c = clock(), f = inFlight(300, c.now, c.later)
  const end = f.start()
  c.tick(900)
  end()
  c.tick(0)
  assert.equal(f.busy(), false)
})

test('marks the pressed button until its last command ends; ending twice is a no-op', () => {
  const c = clock(), f = inFlight(0, c.now, c.later), b = button()
  const one = f.start(b), two = f.start(b)
  assert.equal(b.attrs.get('data-pending'), '')
  assert.equal(b.attrs.get('aria-busy'), 'true')
  one(); one(); c.tick(0)
  assert.equal(b.attrs.has('data-pending'), true, 'the second is still out')
  assert.equal(f.busy(), true)
  two(); c.tick(0)
  assert.equal(b.attrs.has('data-pending'), false)
  assert.equal(b.attrs.has('aria-busy'), false)
  assert.equal(f.busy(), false)
})

test('the extension saying busy keeps the bar up with nothing in flight', () => {
  const c = clock(), f = inFlight(300, c.now, c.later)
  f.setExt(true)
  assert.equal(f.busy(), true)
  f.setExt(false)
  assert.equal(f.busy(), false)
})

test('endAll settles every command the VS Code bridge cannot answer', () => {
  const c = clock(), f = inFlight(300, c.now, c.later)
  f.start(undefined, true); f.start(undefined, true)
  const own = f.start()
  c.tick(400)
  f.endAll()
  c.tick(0)
  assert.equal(f.busy(), true, 'a command with its own answer waits for it')
  own(); c.tick(0)
  assert.equal(f.busy(), false)
})

test('VS Code fallback: a quick command lets go in ~1.2 s, a known long one waits up to 8 s', () => {
  assert.equal(commandWait({ type: 'hub-focus-chat', sessionId: 's' }), 1200)
  assert.equal(commandWait({ type: 'hub-star', sessionId: 's', ai: 'claude', on: true }), 1200)
  assert.equal(commandWait({ type: 'hub-sweep' }), 8000)
  assert.equal(commandWait({ type: 'hub-git', sessionId: 's', op: 'sync' }), 8000)
})
