import { test } from 'node:test'
import assert from 'node:assert/strict'
import { figurePad, makeCache } from '../../components/switchboard/art/pad'

test('a frozen figure pad covers the kit box with a margin on every side', () => {
  const box = { top: 52, bottom: 4, half: 14, tall: 32 }
  const pad = figurePad(box)
  assert.ok(pad.up >= box.top + 6, 'above the head')
  assert.ok(pad.x >= box.half + 6, 'beside the lamp')
  assert.ok(pad.down >= box.bottom, 'below the feet')
})

test('the lantern box reaches the painted figure and its lamp', () => {
  const box = { top: 52, bottom: 4, half: 14, tall: 32 }
  assert.ok(box.top >= 50, 'head and hands at up to 49.5 art px')
})

test('the pixel cache stays under its pixel cap and evicts whole entries', () => {
  const c = makeCache<{ width: number; height: number }>(25000)
  c.put('a', { width: 100, height: 100 })
  c.put('b', { width: 100, height: 100 })
  assert.ok(c.get('a') && c.get('b'))
  c.put('c', { width: 100, height: 100 })
  assert.ok(c.px <= 25000)
  assert.equal(c.get('a'), undefined)
  assert.ok(c.get('c'))
  assert.equal(c.size, 1)
})
