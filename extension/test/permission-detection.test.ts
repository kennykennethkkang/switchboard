import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handlePermissionDetection } from '../src/permission-detection'

// Captures the timer so the test controls when it fires and what Date.now() says.
function run(lastActivity: (start: number) => number, fireAt: (start: number) => number) {
  const realSetTimeout = globalThis.setTimeout
  const realNow = Date.now
  let fire = () => {}
  const start = 1_000_000
  Date.now = () => start
  globalThis.setTimeout = ((fn: () => void) => { fire = fn; return 0 }) as unknown as typeof setTimeout
  const emitted: string[] = []
  try {
    const pending = new Map([['t', { name: 'Edit', args: '', startTime: start - 1 }]])
    handlePermissionDetection(
      { emit: e => emitted.push(e.type), elapsed: () => 0, getLastActivityTime: () => lastActivity(start) },
      'orchestrator', pending, { permissionTimer: null, permissionEmitted: false }, 's', false, true,
    )
    Date.now = () => fireAt(start)
    fire()
  } finally {
    globalThis.setTimeout = realSetTimeout
    Date.now = realNow
  }
  return emitted
}

test('asks for permission when the timer fires a ms early and nothing was written since it started', () => {
  assert.deepEqual(run(s => s, s => s + 4999), ['permission_requested'])
})

test('stays quiet when a file was written after the timer started', () => {
  assert.deepEqual(run(s => s + 10, s => s + 5000), [])
})
