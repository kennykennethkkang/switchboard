import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTypingTarget, shortcutAction } from './shortcuts'

test('shortcuts open help, start a chat, and jump from the g prefix', () => {
  assert.deepEqual(shortcutAction('?'), { kind: 'help' })
  assert.deepEqual(shortcutAction('n'), { kind: 'new' })
  assert.deepEqual(shortcutAction('gn'), { kind: 'page', page: 'now' })
  assert.deepEqual(shortcutAction('gc'), { kind: 'page', page: 'chats' })
  assert.deepEqual(shortcutAction('gr'), { kind: 'page', page: 'research' })
  assert.deepEqual(shortcutAction('gw'), { kind: 'page', page: 'workbench' })
  assert.deepEqual(shortcutAction('gp'), { kind: 'page', page: 'plan' })
  assert.deepEqual(shortcutAction('gl'), { kind: 'page', page: 'live' })
  assert.deepEqual(shortcutAction('gs'), { kind: 'page', page: 'ship' })
  assert.deepEqual(shortcutAction('gm'), { kind: 'page', page: 'map-board' })
  assert.deepEqual(shortcutAction('gu'), { kind: 'page', page: 'usage' })
  assert.equal(shortcutAction('gx'), null)
})

test('typing targets keep their keystrokes', () => {
  const target = (selector: string) => ({ matches: (query: string) => query.includes(selector) }) as unknown as EventTarget
  assert.equal(isTypingTarget(target('input')), true)
  assert.equal(isTypingTarget(target('textarea')), true)
  assert.equal(isTypingTarget(target('[contenteditable="true"]')), true)
  assert.equal(isTypingTarget({ matches: () => false, closest: () => ({}) } as unknown as EventTarget), true)
  assert.equal(isTypingTarget(target('button')), false)
  assert.equal(isTypingTarget(null), false)
})
