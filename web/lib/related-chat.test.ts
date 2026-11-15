import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relatedChat, words } from './related-chat'
import type { ChatRow } from './hub-types'

const row = (sessionId: string, name: string, over: Partial<ChatRow> = {}) => ({ pid: 1, sessionId, name, cwd: '/g/app', link: '', live: true, why: [], takes: true, ...over }) as ChatRow
const chats = [
  row('a', 'Fix login redirect on Safari'),
  row('b', 'Outfit picker copy'),
  row('c', 'Dark mode settings'),
]

test('relatedChat: picks the chat on the same thing', () => {
  const r = relatedChat('the login redirect loops forever on safari', chats, 'app')
  assert.equal(r?.sessionId, 'a')
  assert.equal(r?.name, 'Fix login redirect on Safari')
  assert.ok(r!.score >= 0.2)
})

test('relatedChat: none below the threshold', () => {
  assert.equal(relatedChat('write release notes for the billing page', chats, 'app'), undefined)
  assert.equal(relatedChat('', chats, 'app'), undefined)
})

test('relatedChat: task text counts with the name', () => {
  const r = relatedChat('the cookie banner wording is off', [row('x', 'Copy pass'), row('y', 'Search filters')], 'app', { x: 'rewrite the cookie banner wording' })
  assert.equal(r?.sessionId, 'x')
})

test('relatedChat: only live chats that take messages, in the project', () => {
  const t = 'the login redirect loops forever on safari'
  assert.equal(relatedChat(t, [row('a', chats[0].name!, { takes: false })], 'app'), undefined)
  assert.equal(relatedChat(t, [row('a', chats[0].name!, { live: false })], 'app'), undefined)
  assert.equal(relatedChat(t, [row('a', chats[0].name!, { cwd: '/g/other' })], 'app'), undefined)
  assert.equal(relatedChat(t, [row('a', chats[0].name!, { cwd: '/g/app/web' })], '/g/app')?.sessionId, 'a')
  assert.equal(relatedChat(t, [row('a', chats[0].name!, { cwd: '/g/apple' })], '/g/app'), undefined)
})

test('words: drops the to-do header and footer', () => {
  const todo = 'Switchboard to-do, in this order:\n1. fix the login redirect (id 3f2a-9c, needed first for 2)\n2. other thing (id 77aa)\n\nDo prerequisites first. When you find something that must be done before an item, add it to the to-do with the switchboard todo_add tool (before_id: that item\'s id) as a prerequisite, do it, then continue.'
  assert.deepEqual(words(todo), ['fix', 'login', 'redirect'])
})

test('relatedChat: two to-do dispatches do not match on the template', () => {
  const dispatch = (item: string) => `Switchboard to-do, in this order:\n1. ${item} (id abc1)\n\nDo prerequisites first. When you find something that must be done before an item, add it to the to-do with the switchboard todo_add tool (before_id: that item's id) as a prerequisite, do it, then continue. Mark each item done with todo_done (its id) when it is finished.`
  assert.equal(relatedChat(dispatch('rename the billing tab'), [row('t', 'Todo run')], 'app', { t: dispatch('fix the phone keyboard overlap') }), undefined)
})

test('relatedChat: filler, links and the project name do not make a match', () => {
  const a = 'Please check this reel https://www.instagram.com/reel/DfMY/ and make sure the closet page works, ask questions inside app'
  const b = 'Please add these to app, make sure you ask questions first: https://www.instagram.com/reel/Deb3/ for the billing export'
  assert.equal(relatedChat(a, [row('x', 'App tweaks')], '/g/app', { x: b }), undefined)
})
