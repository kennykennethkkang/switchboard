import { test } from 'node:test'
import assert from 'node:assert/strict'
import { neon, orbit } from '.'
import { KITS } from '../../components/switchboard/art'
import { CAST, NEON, ORBIT, SEA, type Cast } from '../court-cast'

const ROLES = ['lead', 'engineer', 'qa', 'designer', 'researcher', 'ops', 'growth', 'pilgrim']
// Letters sprite() in board.tsx colors without a pal entry.
const BASE = new Set('hsergcpwkf')
const KITS_CAST: Array<[string, Record<string, Cast>, Record<string, string>]> = [
  ['neon', NEON, neon.court.colors],
  ['orbit', ORBIT, orbit.court.colors],
]

test('neon and orbit wear their own cast of eight', () => {
  assert.equal(KITS.neon.cast, NEON)
  assert.equal(KITS.orbit.cast, ORBIT)
  for (const [, set] of KITS_CAST) assert.deepEqual(Object.keys(set).sort(), [...ROLES].sort())
})

test('no character name repeats within a cast or across the Celestial and Dragon casts', () => {
  const taken = new Set([...Object.values(CAST), ...Object.values(SEA)].map(c => c.name))
  const seen = new Set<string>()
  for (const [, set] of KITS_CAST) for (const c of Object.values(set)) {
    assert.ok(!taken.has(c.name), `${c.name} is already in CAST or SEA`)
    assert.ok(!seen.has(c.name), `${c.name} repeats`)
    seen.add(c.name)
  }
})

test('rows are the sprite widths and fit the 12x16 grid', () => {
  for (const [kit, set, colors] of KITS_CAST) {
    const keys = new Set(Object.keys(colors))
    for (const [role, l] of Object.entries(set)) {
      const where = `${kit} ${role}`
      assert.equal(l.body?.length, 11, `${where} body rows`)
      for (const row of l.body ?? []) assert.equal(row.length, 10, `${where} body "${row}"`)
      assert.ok((l.hat ?? []).length <= 2, `${where} hat rows`)
      for (const row of l.hat ?? []) assert.equal(row.length, 10, `${where} hat "${row}"`)
      assert.ok((l.itemY ?? 3) + (l.item ?? []).length <= 14, `${where} item overflows`)
      for (const row of l.item ?? []) assert.ok(row === '' || row.length === 10, `${where} item "${row}"`)
      for (const k of Object.values(l.pal ?? {})) assert.ok(keys.has(k!), `${where} pal ${k}`)
      for (const row of [...(l.body ?? []), ...(l.hat ?? []), ...(l.item ?? [])]) {
        for (const ch of row) assert.ok(ch === '.' || BASE.has(ch) || ch in (l.pal ?? {}), `${where} letter ${ch}`)
      }
    }
  }
})

test('silhouettes differ within each cast', () => {
  for (const [kit, set] of KITS_CAST) {
    const mask = (l: Cast) => {
      const g = Array.from({ length: 14 }, () => Array(10).fill('.'))
      const put = (rows: string[] = [], y0: number) => rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.' && g[y0 + y]) g[y0 + y][x] = '#' }))
      put(l.body, 2); put(l.hat, 0); put(l.item, (l.itemY ?? 3) - 1)
      return g.map(r => r.join('')).join('\n')
    }
    const all = Object.values(set).map(mask)
    assert.equal(new Set(all).size, all.length, kit)
  }
})
