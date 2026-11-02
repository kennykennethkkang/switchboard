import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diagnosis, stuckTone, usage } from './stuck'
import type { StuckItem } from './hub-types'

const MIN = 60_000, NOW = 1_000_000_000
const item: StuckItem = { id: 'job:s:j1', kind: 'job', sessionId: 's', what: 'Background job "run tests": no new output', since: NOW - 125 * MIN, cpu: 97.4, rss: 1.5 * 1024 ** 3, pid: 4242, command: 'pnpm test', last: 'Bash pnpm test' }

test('usage reads CPU and memory short, and nothing when neither is known', () => {
  assert.equal(usage(item), 'CPU 97% · 1.5 GB')
  assert.equal(usage({ ...item, cpu: undefined, rss: 300 * 1024 ** 2 }), '300 MB')
  assert.equal(usage({ ...item, cpu: undefined, rss: undefined }), '')
})

test('diagnosis names the chat, what, since, use, command and last call, one per line', () => {
  const d = diagnosis(item, 'agent-flow v3', NOW)
  assert.equal(d, [
    'Chat: agent-flow v3', 'Stuck: Background job "run tests": no new output', `Since: ${new Date(NOW - 125 * MIN).toTimeString().slice(0, 5)} (2 h)`,
    'Use: CPU 97% · 1.5 GB', 'Process: pid 4242', 'Command: pnpm test', 'Last tool call: Bash pnpm test',
  ].join('\n'))
  assert.equal(diagnosis({ id: 'a', kind: 'agent', sessionId: 's', what: 'qa subagent: no tool call', since: NOW - 12 * MIN }, 'x', NOW), `Chat: x\nStuck: qa subagent: no tool call\nSince: ${new Date(NOW - 12 * MIN).toTimeString().slice(0, 5)} (12 min)`)
})

test('tone: red when a process eats CPU or memory, yellow when something only went quiet, none when nothing is stuck', () => {
  assert.equal(stuckTone([item], 's'), 'red')
  assert.equal(stuckTone([{ ...item, cpu: 3, rss: 1024 }], 's'), 'yellow')
  assert.equal(stuckTone([{ ...item, kind: 'process', cpu: 3, rss: 3 * 1024 ** 3 }], 's'), 'red')
  assert.equal(stuckTone([item], 'other'), undefined)
  assert.equal(stuckTone(undefined, 's'), undefined)
})
