import { test } from 'node:test'
import assert from 'node:assert/strict'
import { replyAge, waiting } from './rail'
import type { ChatProgress } from './hub-types'

const p = (state: ChatProgress['state'], more: Partial<ChatProgress> = {}) => ({ sessionId: 's', cwd: '/p', state, roles: [], tasks: [], startedAt: 0, at: 0, ...more }) as ChatProgress

const on = (name: string, file?: string) => ({ dir: 'out' as const, id: name, name, file })
const by = { dir: 'in' as const, id: 'x', name: 'x' }

test('a chat that waits on another never reads idle', () => {
  assert.equal(waiting(p('idle'), [on('Fix login')]), true)
  assert.equal(waiting(undefined, [on('Fix login')]), true)
  assert.equal(waiting(p('idle'), [by]), false)
  assert.equal(waiting(p('idle'), []), false)
  assert.equal(waiting(p('needs-you'), [on('A')]), false)
  assert.equal(waiting(p('done'), [on('A')]), false)
  assert.equal(waiting(p('working'), [on('A')]), true)
})

test('row age says active now or how long since the last reply', () => {
  const now = 100 * 3600e3
  assert.equal(replyAge(now - 20e3, now), 'active now')
  assert.equal(replyAge(now - 21 * 60e3, now), 'last reply 21 min ago')
  assert.equal(replyAge(now - 3 * 3600e3, now), 'last reply 3 h ago')
  assert.equal(replyAge(now - 3 * 86400e3, now), 'last reply 3 d ago')
})
