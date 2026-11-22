/** The demo's stand-in for a chat's terminal, so the Screen tab has something to show without a Mac behind it. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { demoScreen, demoType, NO_TYPING } from './screen-demo'

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

test('demoScreen: plain text is the ANSI copy without its colors, and ANSI only when asked', () => {
  const plain = demoScreen(3, false, NO_TYPING)
  const colour = demoScreen(3, true, NO_TYPING)
  assert.equal(plain.ansi, undefined)
  assert.match(colour.ansi!, /\x1b\[[0-9;]*m/)
  assert.equal(strip(colour.ansi!), plain.text)
  assert.deepEqual([plain.running, plain.typing], [true, true])
})

test('demoScreen: moves on each second and fits its own size', () => {
  const a = demoScreen(0, false, NO_TYPING), b = demoScreen(9, false, NO_TYPING)
  assert.notEqual(a.text, b.text)
  for (const s of [a, b]) {
    const lines = s.text.split('\n')
    assert.ok(lines.length <= s.rows, `${lines.length} rows of ${s.rows}`)
    assert.ok(lines.every(l => [...l].length <= s.cols), 'a row is wider than the screen')
  }
})

test('demoScreen: shows what was typed on the prompt line and what was said before', () => {
  const t = demoType(demoType(NO_TYPING, { text: 'run the tests' }), { key: 'enter' })
  const typed = demoScreen(1, false, demoType(t, { text: 'and fix' }))
  assert.match(typed.text, /> and fix/)
  assert.match(typed.text, /run the tests/)
})

test('demoType: text adds, Enter says it, Esc and Ctrl-C clear the line, arrows and Tab change nothing', () => {
  let s = demoType(NO_TYPING, { text: 'ab' })
  s = demoType(s, { text: 'c' })
  assert.deepEqual(s, { typed: 'abc', said: [] })
  for (const key of ['up', 'down', 'left', 'right', 'tab'] as const) assert.deepEqual(demoType(s, { key }), s, key)
  assert.deepEqual(demoType(s, { key: 'esc' }), { typed: '', said: [] })
  assert.deepEqual(demoType(s, { key: 'ctrl-c' }), { typed: '', said: [] })
  assert.deepEqual(demoType(s, { key: 'enter' }), { typed: '', said: ['abc'] })
  assert.deepEqual(demoType(NO_TYPING, { key: 'enter' }), NO_TYPING)
})

test('demoType: keeps the last three lines said', () => {
  let s = NO_TYPING
  for (const w of ['1', '2', '3', '4']) s = demoType(demoType(s, { text: w }), { key: 'enter' })
  assert.deepEqual(s.said, ['2', '3', '4'])
})
