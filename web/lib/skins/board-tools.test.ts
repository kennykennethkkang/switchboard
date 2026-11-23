import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { LEGACY_SKIN_KEY, SKINS, SKIN_KEY, abyss, journeyWest, lookOf, orbit, readPick, skinById } from '.'
import { emptyHub } from '../hub-demo'
import type { BeltId } from '.'

registerHooks({ load: (url, ctx, next) => url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, ctx) })
const belt = import('../../components/switchboard/board-tools')

test('every skin names every belt item and has a night', () => {
  const ids: BeltId[] = ['new', 'next', 'todo', 'limits', 'changes', 'mode']
  assert.equal(journeyWest.belt.name, "Pilgrim's pack")
  assert.equal(abyss.belt.name, "Dragon King's treasury")
  for (const s of SKINS) {
    assert.ok(s.night, `${s.id} night`)
    assert.equal(s.court.bands.length, 7, `${s.id} bands`)
    assert.equal(Object.keys(s.court.colors).length, Object.keys(journeyWest.court.colors).length, `${s.id} colors`)
    for (const id of ids) {
      const item = s.belt.items[id]
      assert.ok(item.item, `${s.id} ${id} item`)
      assert.ok(item.hint, `${s.id} ${id} hint`)
    }
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
  assert.deepEqual(readPick('ink', null, false), { id: 'orbit', mode: 'night' })
  assert.deepEqual(readPick('ink', 'day', true), { id: 'orbit', mode: 'day' })
  assert.deepEqual(readPick(null, null, true), { id: 'orbit', mode: 'night' })
  assert.deepEqual(readPick('gone', 'junk', false), { id: 'orbit', mode: 'day' })
})

test('a stored skin is kept; a ?skin= link wins; unknown ids fall back', () => {
  assert.deepEqual(readPick('abyss', 'night', false), { id: 'abyss', mode: 'night' })
  assert.deepEqual(readPick('journey-west', 'day', false, 'abyss'), { id: 'abyss', mode: 'day' })
  assert.deepEqual(readPick('abyss', null, false, 'journey-west'), { id: 'journey-west', mode: 'day' })
  assert.deepEqual(readPick('abyss', null, false, 'nope'), { id: 'abyss', mode: 'day' })
  assert.equal(skinById('nope'), orbit)
  // The old key held journey-west after any day/night flip, never a choice; the theme pick has its own key.
  assert.notEqual(SKIN_KEY, LEGACY_SKIN_KEY)
  assert.equal(skinById('abyss'), abyss)
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
  for (const skin of SKINS) for (const mode of ['day', 'night'] as const) {
    const s = lookOf(skin, mode), c = s.court.colors
    // State and role text on the dark name plates.
    for (const k of ['gold', 'red_lt', 'jade_lt', 'cloud_sh', 'blue_lt', 'peach', 'gold_lt'] as const) assert.ok(ratio(c[k], plate) >= 4.5, `${skin.id} ${mode} ${k} on plate ${ratio(c[k], plate).toFixed(2)}`)
    assert.ok(ratio(s.palette.ink, s.palette.panel) >= 4.5, `${skin.id} ${mode} belt label`)
    assert.ok(ratio('#1a1423', s.palette.trim) >= 4.5, `${skin.id} ${mode} badge`)
    assert.ok(ratio(s.palette.accent, tip) >= 4.5, `${skin.id} ${mode} tip title`)
  }
})

// CIE76 delta E between two sRGB hex colors.
const lab = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116
  const [x, y, z] = [(0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883].map(f)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}
const deltaE = (a: string, b: string) => { const [p, q] = [lab(a), lab(b)]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) }

test('stuck and needs you stay clearly apart in every skin and mode', () => {
  for (const skin of SKINS) for (const mode of ['day', 'night'] as const) {
    const c = lookOf(skin, mode).court.colors, d = deltaE(c.red, c.red_lt)
    assert.ok(d >= 25, `${skin.id} ${mode} stuck vs needs ${d.toFixed(1)}`)
    // Abyss uses orange against magenta; hold it well clear of the old near-twin pinks.
    if (skin.id === 'abyss') assert.ok(d >= 40, `abyss ${mode} ${d.toFixed(1)}`)
    // Stuck is a dot and a timer; Journey West's vermilion sits at 3.9 (graphics AA), Abyss clears text AA.
    assert.ok(ratio(c.red, '#101111') >= (skin.id === 'abyss' ? 4.5 : 3), `${skin.id} ${mode} stuck on plate ${ratio(c.red, '#101111').toFixed(2)}`)
  }
})

test('skin belt sprites are 12x12 in the belt letters', () => {
  for (const s of SKINS) for (const [id, rows] of Object.entries(s.belt.sprites ?? {})) {
    assert.equal(rows!.length, 12, `${s.id} ${id} rows`)
    for (const r of rows!) assert.match(r, /^[.ygGrRwskbBjJpPqulU]{12}$/, `${s.id} ${id} "${r}"`)
  }
})

test('theme picker list marks the current skin and wraps arrow moves', async () => {
  const { themeList, stepTheme } = await belt
  const rows = themeList('lantern')
  assert.deepEqual(rows.map(r => r.id), SKINS.map(s => s.id))
  assert.deepEqual(rows.filter(r => r.current).map(r => r.id), ['lantern'])
  assert.ok(rows.every(r => r.name && r.info && r.swatch.length >= 3))
  assert.equal(themeList('nope').some(r => r.current), false)
  assert.equal(stepTheme(0, -1), SKINS.length - 1)
  assert.equal(stepTheme(SKINS.length - 1, 1), 0)
  assert.equal(stepTheme(1, 1), 2)
})

test('the two Journey to the West looks share one family group; the rest stand alone', async () => {
  const { themeGroups, themeList, stepTheme, skinLabel } = await belt
  assert.equal(journeyWest.family?.preset, 'Pilgrim Road')
  assert.equal(abyss.family?.preset, 'Dragon Palace')
  assert.equal(orbit.family, undefined)
  const groups = themeGroups('lantern')
  assert.deepEqual(groups.map(g => g.rows.map(r => r.id)), [['journey-west', 'abyss'], ['neon'], ['orbit'], ['lantern']])
  assert.deepEqual(groups[0].family, { id: 'journey-west', name: 'Journey to the West' })
  assert.deepEqual(groups[0].rows.map(r => r.name), ['Pilgrim Road', 'Dragon Palace'])
  assert.equal(groups[1].family, undefined)
  // Arrow keys walk the flat list, so every skin is one step away.
  const flat = themeList('lantern')
  let i = 0
  const seen = new Set<string>()
  for (let k = 0; k < SKINS.length; k++) { seen.add(flat[i].id); i = stepTheme(i, 1) }
  assert.equal(seen.size, SKINS.length)
  assert.equal(i, 0)
  // Closed button and tip name a family look as family: preset.
  assert.equal(skinLabel(abyss), 'Journey to the West: Dragon Palace')
  assert.equal(skinLabel(journeyWest), 'Journey to the West: Pilgrim Road')
  assert.equal(skinLabel(orbit), 'Orbital Fleet')
})

test('chrome left out keeps the old board constants', async () => {
  const { chromeOf, DEFAULT_CHROME } = await belt
  assert.deepEqual(DEFAULT_CHROME, { plate: 'rgba(16,17,17,.94)', edge: 'rgba(255,255,255,.14)', text: '#f4f1ea', mute: '#a29cae', font: 'Silkscreen, ui-monospace, monospace', radius: 4 })
  assert.deepEqual(chromeOf({ ...orbit, chrome: undefined }), DEFAULT_CHROME)
  assert.equal(chromeOf({ ...orbit, chrome: { ...DEFAULT_CHROME, radius: 9 } }).radius, 9)
})
