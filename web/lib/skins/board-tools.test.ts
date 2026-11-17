import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { journeyWest, lookOf, readPick } from '.'
import { emptyHub } from '../hub-demo'
import type { BeltId } from '.'

registerHooks({ load: (url, ctx, next) => url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, ctx) })
const belt = import('../../components/switchboard/board-tools')

test('journey west names every belt item', () => {
  const ids: BeltId[] = ['new', 'next', 'todo', 'limits', 'changes', 'mode']
  assert.equal(journeyWest.belt.name, "Pilgrim's pack")
  for (const id of ids) {
    const item = journeyWest.belt.items[id]
    assert.ok(item.item, `${journeyWest.id} ${id} item`)
    assert.ok(item.hint, `${journeyWest.id} ${id} hint`)
  }
})

test('belt counts reads needs and the fullest usage window', async () => {
  const { beltCounts } = await belt
  const hub = { ...emptyHub(), progress: [{ sessionId: 'a', cwd: '/x', state: 'needs-you', roles: [], tasks: [], startedAt: 0, at: 0 }, { sessionId: 'b', cwd: '/x', state: 'working', roles: [], tasks: [], startedAt: 0, at: 0 }],
    limitsKept: { at: 0, windows: [{ kind: 'five_hour', percentUsed: 41.6 }, { kind: 'seven_day', percentUsed: 12 }] } } as ReturnType<typeof emptyHub>
  assert.deepEqual(beltCounts(hub), { next: 1, limits: '41%', usage: 'Usage: 5h 41%, week 12%' })
  assert.deepEqual(beltCounts(emptyHub()), { next: 0 })
})

test('old ink pick becomes journey west at night; a stored mode wins; unset follows the system', () => {
  assert.deepEqual(readPick('ink', null, false), { id: 'journey-west', mode: 'night' })
  assert.deepEqual(readPick('ink', 'day', true), { id: 'journey-west', mode: 'day' })
  assert.deepEqual(readPick(null, null, true), { id: 'journey-west', mode: 'night' })
  assert.deepEqual(readPick('gone', 'junk', false), { id: 'journey-west', mode: 'day' })
})

test('night swaps palette and court, keeps copy and belt; no night stays day', () => {
  const jw = journeyWest, n = lookOf(jw, 'night')
  assert.equal(n.court, jw.night!.court)
  assert.equal(n.palette, jw.night!.palette)
  assert.equal(n.belt, jw.belt)
  const plain = { ...jw, night: undefined }
  assert.equal(lookOf(plain, 'night'), plain)
})

test('mode item data names the day and night toggle', () => {
  assert.deepEqual(journeyWest.belt.items.mode, { item: 'Golden crow and jade rabbit', hint: 'The court works day and night' })
  assert.ok(journeyWest.night)
})

// WCAG relative luminance contrast.
const lum = (hex: string) => { const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] }
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

test('labels and badges clear AA in both modes', () => {
  const plate = '#101111', tip = '#120f1f'
  for (const mode of ['day', 'night'] as const) {
    const s = lookOf(journeyWest, mode), c = s.court.colors
    // State and role text on the dark name plates.
    for (const k of ['gold', 'red_lt', 'jade_lt', 'cloud_sh', 'blue_lt', 'peach', 'gold_lt'] as const) assert.ok(ratio(c[k], plate) >= 4.5, `${mode} ${k} on plate ${ratio(c[k], plate).toFixed(2)}`)
    assert.ok(ratio(s.palette.ink, s.palette.panel) >= 4.5, `${mode} belt label`)
    assert.ok(ratio('#1a1423', s.palette.trim) >= 4.5, `${mode} badge`)
    assert.ok(ratio(s.palette.accent, tip) >= 4.5, `${mode} tip title`)
  }
})
