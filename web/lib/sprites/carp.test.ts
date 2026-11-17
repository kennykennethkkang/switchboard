import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BASKET, CARP, CARP_PAL, pixGrid, pixSvg } from './carp'

test('pixGrid: pads by one and rings the art in ink', () => {
  const g = pixGrid(['.a.'], { a: '#f00' }, '#000')
  assert.deepEqual(g, [[undefined, undefined, '#000', undefined, undefined], [undefined, '#000', '#f00', '#000', undefined], [undefined, undefined, '#000', undefined, undefined]])
})

test('carp and basket rows are rectangles; svg draws every pixel', () => {
  for (const rows of [CARP, BASKET]) assert.ok(rows.every(r => r.length === rows[0].length))
  const svg = pixSvg(CARP, CARP_PAL, 3)
  assert.match(svg, /^<svg [^>]*width="48" height="33"/)
  const g = pixGrid(CARP, CARP_PAL)
  assert.equal((svg.match(/<rect /g) ?? []).length, g.flat().filter(Boolean).length)
  assert.match(pixSvg(['a'], { a: '#fff' }), /shape-rendering="crispEdges"/)
})
