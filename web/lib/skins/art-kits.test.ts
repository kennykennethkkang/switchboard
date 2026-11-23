import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SKINS, abyss, journeyWest, lantern } from '.'
import { KITS, kitOf, withCourt } from '../../components/switchboard/art'
import { court } from '../../components/switchboard/art/court'
import { KEEPERS, type Keeper } from '../../components/switchboard/art/keeper-style'
import { inkStyle } from '../../components/switchboard/art/lantern-ink'

// island, hall and realmShell are whole-piece hooks court leaves unset; figure and friends are optional hooks court leaves unset too.
const OPTIONAL = ['figure', 'badge', 'bubble', 'zzz', 'sparkle', 'smooth', 'cast', 'desk', 'landmark', 'gate', 'placeArt']
const HOOKS = [...Object.keys(court), 'island', 'hall', 'realmShell', ...OPTIONAL].sort()

test('every skin names a registered art kit', () => {
  for (const s of SKINS) assert.ok(KITS[s.art], `${s.id} names art ${s.art}`)
  assert.equal(journeyWest.art, 'court')
  assert.equal(abyss.art, 'abyss')
})

test('kits only override known hooks', () => {
  for (const [id, kit] of Object.entries(KITS)) for (const k of Object.keys(kit)) assert.ok(HOOKS.includes(k), `${id} hook ${k}`)
})

test('a kit that leaves hooks out falls back to court', () => {
  const bare = withCourt({})
  for (const k of Object.keys(court)) assert.equal(bare[k as keyof typeof bare], court[k as keyof typeof court], k)
  assert.equal(kitOf('no-such-kit').ping, court.ping)
  const partial = withCourt({ helm: true, ping: () => {} })
  assert.equal(partial.helm, true)
  assert.equal(partial.drift, court.drift)
  assert.notEqual(partial.ping, court.ping)
})

test('abyss overrides its own hooks and keeps court for the rest', () => {
  const k = kitOf('abyss')
  assert.equal(k.cast?.lead.name, 'Ao Guang')
  assert.equal(court.cast, undefined)
  assert.notEqual(k.backdrop, court.backdrop)
  assert.equal(k.bridgeBase, court.bridgeBase)
  assert.equal(kitOf('court').backdrop, court.backdrop)
})

test('pixel kits bake at art res 2 and stay unsmoothed', () => {
  assert.equal(court.res, 2)
  for (const id of Object.keys(KITS)) {
    const k = kitOf(id)
    if (k.smooth) continue
    assert.equal(k.res, 2, `${id} res`)
    assert.ok(!k.smooth, `${id} smooth`)
  }
})

test('lantern bakes at res 1, smooth, with a figure hook', () => {
  const k = kitOf('lantern')
  assert.equal(k.res, 1)
  assert.equal(k.smooth, true)
  assert.equal(typeof k.figure, 'function')
  for (const h of ['desk', 'landmark', 'gate', 'placeArt', 'confetti'] as const) assert.equal(typeof k[h], 'function', h)
})

// Records the canvas calls a bubble makes; two states with the same calls draw the same mark.
function recorder() {
  const ops: string[] = []
  const gradient = { addColorStop() {} }
  const g = new Proxy({} as Record<string, unknown>, {
    get(t, k) {
      if (typeof k !== 'string') return undefined
      if (!(k in t)) t[k] = (...a: unknown[]) => { ops.push(`${k}(${a.map(v => typeof v === 'number' ? Math.round(v) : '').join(',')})`); return k.startsWith('create') ? gradient : undefined }
      return t[k]
    },
    set(t, k, v) { t[k as string] = v; return true },
  })
  return { g: g as unknown as CanvasRenderingContext2D, ops }
}
const markOf = (st: string) => { const r = recorder(); kitOf('lantern').bubble!(r.g, 50, 50, st as never, 0, lantern.court.colors); return r.ops.join(' ') }

test('lantern draws stuck and needs as different marks, not by hue alone', () => {
  assert.notEqual(markOf('stuck'), markOf('needs'))
  const states = ['working', 'waiting', 'stuck', 'needs', 'done']
  for (const [i, a] of states.entries()) for (const b of states.slice(i + 1)) assert.notEqual(markOf(a), markOf(b), `${a} vs ${b}`)
})

test('court leaves the optional figure, badge, bubble, zzz and sparkle hooks unset', () => {
  for (const h of OPTIONAL) assert.equal(court[h as keyof typeof court], undefined, h)
})

test('neon and orbit give every AI a realm and redraw whole pieces', () => {
  for (const id of ['neon', 'orbit']) {
    const k = KITS[id]
    for (const ai of ['claude', 'codex', 'jev', 'perplexity', 'gemini']) assert.ok(k.realms?.[ai], `${id} realm ${ai}`)
    for (const h of ['island', 'hall', 'realmShell'] as const) assert.equal(typeof k[h], 'function', `${id} ${h}`)
  }
})

test('lantern keepers: each cast role paints its own figure in every state, with no NaN', () => {
  const paint = (role: Keeper, st: string, u: number) => { const r = recorder(); inkStyle.paint(r.g, role, 'claude', st, 0, u, lantern.court.colors, '#ff9f7a'); return r.ops.join(' ') }
  const seen = new Set<string>()
  for (const role of KEEPERS) {
    for (const st of ['idle', 'working', 'waiting', 'needs', 'stuck', 'done']) for (const u of [0, 0.37]) assert.ok(!paint(role, st, u).includes('NaN'), `${role} ${st} ${u}`)
    seen.add(paint(role, 'working', 0.2))
    assert.notEqual(paint(role, 'working', 0), paint(role, 'working', 0.25), `${role} moves while working`)
  }
  assert.equal(seen.size, KEEPERS.length)
})
