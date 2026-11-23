import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SKINS } from './index'

// WCAG relative luminance contrast of two #rrggbb colors.
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

test('contrast math matches the known pairs', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21)
  assert.ok(Math.abs(contrast('#777777', '#ffffff') - 4.48) < 0.01)
})

for (const s of SKINS) test(`${s.id} chrome reads on its plate`, () => {
  const h = s.chrome
  assert.ok(h, 'every theme sets its own chrome')
  for (const k of ['plate', 'edge', 'text', 'mute'] as const) assert.match(h[k], /^#[0-9a-f]{6}$/i, k)
  assert.ok(contrast(h.text, h.plate) >= 4.5, `text ${contrast(h.text, h.plate).toFixed(2)}`)
  assert.ok(contrast(h.mute, h.plate) >= 4.5, `mute ${contrast(h.mute, h.plate).toFixed(2)}`)
  // The edge only has to separate the plate from the board.
  assert.ok(contrast(h.edge, h.plate) >= 3, `edge ${contrast(h.edge, h.plate).toFixed(2)}`)
})

test('lantern belt has a smooth icon per item and the picker', () => {
  const lantern = SKINS.find(s => s.id === 'lantern')!
  for (const id of ['new', 'next', 'todo', 'limits', 'changes', 'mode', 'skin'] as const) {
    const svg = lantern.belt.icons?.[id] ?? ''
    assert.match(svg, /^<svg [^>]*viewBox="0 0 24 24"/, id)
    assert.doesNotMatch(svg, /\$\{|undefined|id="/, id)
  }
  assert.doesNotMatch(lantern.chrome!.font, /Silkscreen/)
})
