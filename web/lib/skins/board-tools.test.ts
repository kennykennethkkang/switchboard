import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SKINS, lookOf, readPick, skinOf, type Skin } from '.'
import { emptyHub } from '../hub-demo'

// The component imports its stylesheet; node has nothing to do with it.
registerHooks({ load: (url, ctx, next) => url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, ctx) })
const belt = import('../../components/switchboard/board-tools')

const all = { new: () => {}, next: () => {}, todo: () => {}, limits: () => {}, changes: () => {}, mode: () => {} }
const html = async (id: string, counts = {}, on: Partial<typeof all> = all, skin: Skin = skinOf(id), night = false) => renderToStaticMarkup(createElement((await belt).BoardTools, { skin, on, counts, night }))

test('every skin names every belt item', () => {
  for (const s of SKINS) for (const id of Object.keys(all)) assert.ok(s.belt.items[id as keyof typeof all]?.item, `${s.id} ${id}`)
})

test('journey west: themed names in the label, plain label first, real buttons', async () => {
  const out = await html('journey-west', { next: 2, todo: 5, limits: '92%' })
  assert.equal(out.match(/<button type="button"/g)?.length, 6)
  assert.match(out, /aria-label="New chat, Golden-banded staff"/)
  assert.match(out, /aria-label="Next chat that needs you, Somersault cloud, 2 waiting"/)
  assert.match(out, /aria-label="Usage and limits, Purple-gold gourd, 92% used"/)
  assert.match(out, /data-id="limits" data-hot="true"/)
  assert.match(out, /role="group" aria-label="Pilgrim&#x27;s pack"/)
})

test('items without a callback are left out; none at all renders nothing', async () => {
  assert.equal((await html('journey-west', {}, { todo: all.todo })).match(/<button/g)?.length, 1)
  assert.equal(await html('journey-west', {}, {}), '')
})

test('beltCounts reads needs and the fullest usage window', async () => {
  const { beltCounts } = await belt
  const hub = { ...emptyHub(), progress: [{ sessionId: 'a', cwd: '/x', state: 'needs-you', roles: [], tasks: [], startedAt: 0, at: 0 }, { sessionId: 'b', cwd: '/x', state: 'working', roles: [], tasks: [], startedAt: 0, at: 0 }],
    limitsKept: { at: 0, windows: [{ kind: 'five_hour', percentUsed: 41.6 }, { kind: 'seven_day', percentUsed: 12 }] } } as ReturnType<typeof emptyHub>
  assert.deepEqual(beltCounts(hub), { next: 1, limits: '41%' })
  assert.deepEqual(beltCounts(emptyHub()), { next: 0 })
})

test('old ink pick becomes journey west at night; a stored mode wins; unset follows the system', () => {
  assert.deepEqual(readPick('ink', null, false), { id: 'journey-west', mode: 'night' })
  assert.deepEqual(readPick('ink', 'day', true), { id: 'journey-west', mode: 'day' })
  assert.deepEqual(readPick(null, null, true), { id: 'journey-west', mode: 'night' })
  assert.deepEqual(readPick('gone', 'junk', false), { id: 'journey-west', mode: 'day' })
  assert.equal(SKINS.some(s => s.id === 'ink'), false)
})

test('night swaps palette and court, keeps copy and belt; no night stays day', () => {
  const jw = skinOf('journey-west'), n = lookOf(jw, 'night')
  assert.equal(n.court, jw.night!.court)
  assert.equal(n.palette, jw.night!.palette)
  assert.equal(n.belt, jw.belt)
  const plain = { ...jw, night: undefined }
  assert.equal(lookOf(plain, 'night'), plain)
})

test('mode toggle: pressed state and moon at night, hidden without a night look', async () => {
  const jw = skinOf('journey-west')
  const day = await html('journey-west')
  assert.match(day, /data-id="mode" aria-pressed="false" aria-label="Night mode, Golden crow and jade rabbit"/)
  const night = await html('journey-west', {}, all, lookOf(jw, 'night'), true)
  assert.match(night, /data-id="mode" aria-pressed="true"/)
  assert.match(night, />Night</)
  assert.doesNotMatch(await html('journey-west', {}, all, { ...jw, night: undefined }), /data-id="mode"/)
})

// WCAG relative luminance contrast.
const lum = (hex: string) => { const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] }
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

test('labels and badges clear AA in both modes', () => {
  const plate = '#101111', tip = '#120f1f'
  for (const mode of ['day', 'night'] as const) {
    const s = lookOf(skinOf('journey-west'), mode), c = s.court.colors
    // State and role text on the dark name plates.
    for (const k of ['gold', 'red_lt', 'jade_lt', 'cloud_sh', 'blue_lt', 'peach', 'gold_lt'] as const) assert.ok(ratio(c[k], plate) >= 4.5, `${mode} ${k} on plate ${ratio(c[k], plate).toFixed(2)}`)
    assert.ok(ratio(s.palette.ink, s.palette.panel) >= 4.5, `${mode} belt label`)
    assert.ok(ratio('#1a1423', s.palette.trim) >= 4.5, `${mode} badge`)
    assert.ok(ratio(s.palette.accent, tip) >= 4.5, `${mode} tip title`)
  }
})
