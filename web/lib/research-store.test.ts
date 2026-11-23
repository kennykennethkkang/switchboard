import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentEvent } from './bridge-types'
import { clearResearch, feedResearch, researchRun } from './research-store'

let t = 0
const ev = (sessionId: string, type: string, payload: Record<string, unknown>): AgentEvent => ({ time: ++t, type, payload, sessionId })

test('files each event under its own chat, so a later panel sees what came before it', () => {
  clearResearch()
  feedResearch(ev('a', 'tool_call_start', { agent: 'orchestrator', tool: 'WebSearch', args: 'x', inputData: { query: 'tides' } }))
  feedResearch(ev('b', 'tool_call_start', { agent: 'orchestrator', tool: 'WebFetch', args: '', inputData: { url: 'https://example.com/a' } }))
  assert.equal(researchRun('a').feed.length, 1)
  assert.equal(researchRun('a').feed[0].kind, 'search')
  assert.equal(researchRun('b').feed[0].kind, 'source')
  assert.equal(researchRun('c').status, 'waiting')
})
