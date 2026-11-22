import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyHub } from './hub-demo'
import { moveToResearch } from './research-offer'
import type { ChatProgress, HubState } from './hub-types'

const hub = (): HubState => {
  const h = emptyHub()
  h.projects = [{ name: 'app', path: '/w/app', isOpen: false }, { name: 'site', path: '/w/site', isOpen: true }] as HubState['projects']
  h.progress = [{ sessionId: 's1', cwd: '/w/app/.claude/worktrees/x', asked: ['first', 'compare the three vector stores'] } as ChatProgress]
  return h
}

test('moveToResearch: the newest ask, from the chat\'s own project', () => {
  assert.deepEqual(moveToResearch(hub(), 's1'), { type: 'hub-new-chat', path: '/w/app', text: 'compare the three vector stores', remote: false, research: true })
})

test('moveToResearch: an unknown cwd falls back to the open project; no ask, no command', () => {
  const h = hub()
  h.progress[0].cwd = '/elsewhere'
  assert.equal(moveToResearch(h, 's1')?.path, '/w/site')
  assert.equal(moveToResearch(h, 'gone'), undefined)
  h.progress[0].asked = []
  assert.equal(moveToResearch(h, 's1'), undefined)
})
