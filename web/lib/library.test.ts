/** Design library chips: every look browsable, on ones first, the search narrowing them. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { libraryLooks, libraryOrder } from './library'

const lib = (b: string) => `/u/.claude/switchboard/design-md/${b}/DESIGN.md`
const map = { [lib('stripe')]: false, [lib('airbnb')]: false, [lib('raycast')]: true, 'docs/design/raycast-DESIGN.md': true }

test('with nothing on, every look still shows', () => {
  const off = Object.fromEntries(Object.keys(map).map(k => [k, false]))
  assert.deepEqual(libraryLooks(off, ''), [lib('airbnb'), lib('raycast'), lib('stripe')])
})

test('on looks come first, project references stay out', () => {
  assert.deepEqual(libraryLooks(map, ''), [lib('raycast'), lib('airbnb'), lib('stripe')])
})

test('the search narrows by brand', () => {
  assert.deepEqual(libraryLooks(map, ' STR '), [lib('stripe')])
  assert.deepEqual(libraryLooks(map, 'zzz'), [])
})

test('toggling a look keeps the order; a new search sorts on ones first again', () => {
  const first = libraryOrder(undefined, map, '')
  assert.deepEqual(first.keys, [lib('raycast'), lib('airbnb'), lib('stripe')])
  const toggled = { ...map, [lib('stripe')]: true, [lib('raycast')]: false }
  assert.equal(libraryOrder(first, toggled, ''), first)
  assert.deepEqual(libraryOrder(first, toggled, 'r').keys, [lib('stripe'), lib('airbnb'), lib('raycast')])
})

test('a look added or removed sorts the list again', () => {
  const first = libraryOrder(undefined, map, '')
  assert.deepEqual(libraryOrder(first, { ...map, [lib('apple')]: false }, '').keys, [lib('raycast'), lib('airbnb'), lib('apple'), lib('stripe')])
})
