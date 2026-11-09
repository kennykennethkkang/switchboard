import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CAST, ICONS, LOOKS, OVERLAYS, badgeOf, castOf } from './court-cast'
import { courtColors } from './skins/journey-west'

const ROLES = ['lead', 'engineer', 'qa', 'designer', 'researcher', 'ops', 'growth']
// Letters sprite() in board.tsx colors without a pal entry.
const BASE = new Set('hsergcpwkf')
const layers = (l: (typeof CAST)[string]) => [...(l.body ?? []), ...(l.hat ?? []), ...(l.item ?? [])]

test('every known role is its own character', () => {
  const names = ROLES.map(r => castOf(r).name)
  assert.equal(new Set(names).size, ROLES.length)
  assert.equal(castOf('lead').name, 'Tang Sanzang')
  assert.equal(castOf('kit:engineer').name, 'Sun Wukong')
  assert.equal(castOf('librarian').name, 'Pilgrim')
  assert.equal(castOf().name, 'Tang Sanzang')
})

test('silhouettes differ', () => {
  const mask = (r: string) => {
    const l = CAST[r], g = Array.from({ length: 14 }, () => Array(10).fill('.'))
    const put = (rows: string[] = [], y0: number) => rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') g[y0 + y][x] = '#' }))
    put(l.body, 2); put(l.hat, 0); put(l.item, (l.itemY ?? 3) - 1)
    return g.map(r => r.join('')).join('\n')
  }
  const all = Object.keys(CAST).map(mask)
  assert.equal(new Set(all).size, all.length)
})

test('grids fit the 12x16 sprite with valid letters', () => {
  const keys = new Set(Object.keys(courtColors))
  for (const [role, l] of Object.entries(CAST)) {
    assert.equal(l.body?.length, 11, `${role} body rows`)
    assert.ok((l.hat ?? []).length <= 2, `${role} hat`)
    assert.ok((l.itemY ?? 3) + (l.item ?? []).length <= 14, `${role} item overflows`)
    for (const k of Object.values(l.pal ?? {})) assert.ok(keys.has(k!), `${role} pal ${k}`)
    for (const row of layers(l)) {
      // 10 art columns plus the 1px outline each side.
      assert.equal(('.' + row.padEnd(10, '.') + '.').length, 12, `${role} row "${row}"`)
      for (const ch of row) assert.ok(ch === '.' || BASE.has(ch) || ch in (l.pal ?? {}), `${role} letter ${ch}`)
    }
    const { name, tag, ...look } = l
    assert.deepEqual(LOOKS[role], look, `${name} (${tag}) look`)
  }
})

test('overlays and icons use real colors', () => {
  const keys = new Set(Object.keys(courtColors))
  for (const ic of [...Object.values(OVERLAYS), ...Object.values(ICONS)]) {
    const w = ic.rows[0].length
    for (const row of ic.rows) {
      assert.equal(row.length, w, ic.name)
      for (const ch of row) assert.ok(ch === '.' || ch in ic.pal, `${ic.name} letter ${ch}`)
    }
    for (const k of Object.values(ic.pal)) assert.ok(keys.has(k!), `${ic.name} pal ${k}`)
  }
})

test('state badges: waiting has none, the rest their overlay', () => {
  assert.equal(badgeOf('needs'), OVERLAYS.needs)
  assert.equal(badgeOf('working'), OVERLAYS.working)
  assert.equal(badgeOf('done'), OVERLAYS.done)
  assert.equal(badgeOf('idle'), OVERLAYS.idle)
  assert.equal(badgeOf('waiting'), undefined)
  assert.equal(badgeOf(undefined), undefined)
})
