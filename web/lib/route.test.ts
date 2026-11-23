/** Page routing: the URL hash picks the shell's page. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isMap, pageOf, pageTitle, PAGES } from './route'

test('pageOf: each page by its hash, with or without the #', () => {
  for (const p of PAGES) { assert.equal(pageOf(`#${p}`), p); assert.equal(pageOf(p), p) }
})

test('pageOf: empty or unknown hash goes to now', () => {
  assert.equal(pageOf(''), 'now')
  assert.equal(pageOf('#'), 'now')
  assert.equal(pageOf('#nope'), 'now')
  assert.equal(pageOf('#map'), 'now')
  assert.equal(pageOf('#NOW'), 'now')
})

test('pageOf: legacy ?board opens map-board unless a hash names a page', () => {
  assert.equal(pageOf('', '?board'), 'map-board')
  assert.equal(pageOf('', '?x=1&board'), 'map-board')
  assert.equal(pageOf('#junk', '?board'), 'map-board')
  assert.equal(pageOf('#ship', '?board'), 'ship')
  assert.equal(pageOf('', '?boarding=1'), 'now')
})

test('isMap: the three map modes only', () => {
  assert.deepEqual(PAGES.filter(isMap), ['map-board', 'map-flow', 'map-memory'])
})

test('pageTitle: the header word for each page', () => {
  assert.deepEqual(PAGES.map(pageTitle), ['Now', 'Chats', 'Plan', 'Live', 'Ship', 'Map', 'Map', 'Map', 'Settings', 'Research'])
})
