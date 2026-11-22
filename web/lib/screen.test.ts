/** The Screen tab's fetches and its poll: once a second while visible, backing off when there is no screen. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitScale, KEY_LABELS, loadScreen, pollScreen, sendKeys, type Screen } from './screen'

const SCREEN: Screen = { cols: 80, rows: 24, text: 'hi', running: true, at: 1, typing: false }
const settle = () => new Promise<void>(r => setImmediate(r))

// A clock the test turns by hand: the timer waits and what each asked for.
function clock() {
  const q: Array<{ f: () => void; ms: number; id: number }> = []
  let n = 0
  return {
    q,
    timers: { set: (f: () => void, ms: number) => { q.push({ f, ms, id: ++n }); return n }, clear: (h: unknown) => { const i = q.findIndex(x => x.id === h); if (i >= 0) q.splice(i, 1) } },
    async tick() { const x = q.shift()!; x.f(); await settle(); return x.ms },
  }
}

function setup(results: Array<Screen | null | string>, visible?: () => boolean) {
  const c = clock(), seen: Array<Screen | null | string> = []
  let calls = 0
  const stop = pollScreen({ load: async () => results[Math.min(calls++, results.length - 1)], onScreen: r => { seen.push(r) }, visible, timers: c.timers })
  return { c, seen, stop, calls: () => calls }
}

test('pollScreen: loads at once, then every second while screens come back', async () => {
  const { c, seen, stop } = setup([SCREEN])
  await settle()
  assert.deepEqual(seen, [SCREEN])
  assert.equal(c.q[0].ms, 1000)
  await c.tick(); await c.tick()
  assert.equal(seen.length, 3)
  assert.equal(c.q[0].ms, 1000)
  stop()
})

test('pollScreen: does not load while hidden, and goes on once visible', async () => {
  let shown = false
  const { c, seen, stop, calls } = setup([SCREEN], () => shown)
  await settle()
  await c.tick(); await c.tick()
  assert.deepEqual([calls(), seen.length], [0, 0])
  shown = true
  await c.tick()
  assert.deepEqual([calls(), seen.length], [1, 1])
  stop()
})

test('pollScreen: backs off on no screen and on an error, then resets after a good read', async () => {
  const { c, seen, stop } = setup([null, null, 'Cannot reach the Mac.', SCREEN, null])
  await settle()
  const waits = [c.q[0].ms]
  for (let i = 0; i < 4; i++) waits.push(await c.tick() && c.q[0].ms)
  assert.deepEqual(waits, [2000, 4000, 8000, 1000, 2000])
  assert.deepEqual(seen, [null, null, 'Cannot reach the Mac.', SCREEN, null])
  stop()
})

test('pollScreen: the wait stops growing at 15 seconds', async () => {
  const { c, stop } = setup([null])
  await settle()
  let ms = 0
  for (let i = 0; i < 8; i++) { await c.tick(); ms = c.q[0].ms }
  assert.equal(ms, 15_000)
  stop()
})

test('pollScreen: stopping clears the timer and drops a read still in flight', async () => {
  const c = clock(), seen: unknown[] = []
  let release: (s: Screen) => void = () => {}
  const stop = pollScreen({ load: () => new Promise<Screen>(r => { release = r }), onScreen: r => { seen.push(r) }, timers: c.timers })
  stop()
  release(SCREEN)
  await settle()
  assert.deepEqual([seen, c.q.length], [[], 0])
  const again = setup([SCREEN])
  await settle()
  again.stop()
  assert.equal(again.c.q.length, 0)
})

test('loadScreen: asks for the colored screen, with the page header and no cache', async () => {
  const urls: string[] = [], inits: RequestInit[] = []
  const f = (async (u: string, init: RequestInit) => { urls.push(u); inits.push(init); return new Response(JSON.stringify(SCREEN)) }) as unknown as typeof fetch
  assert.deepEqual(await loadScreen('s 1', f), SCREEN)
  assert.deepEqual(urls, ['/hub/chat/screen?session=s+1&ansi=1'])
  assert.deepEqual(inits[0], { headers: { 'X-Switchboard': '1' }, cache: 'no-store' })
})

test('loadScreen: null for no screen, the reason for anything else', async () => {
  const reply = (status: number) => (async () => new Response('', { status })) as unknown as typeof fetch
  assert.equal(await loadScreen('s', reply(404)), null)
  assert.match(String(await loadScreen('s', reply(403))), /signed out/)
  assert.match(String(await loadScreen('s', reply(502))), /No editor window/)
  assert.match(String(await loadScreen('s', (async () => { throw new Error('down') }) as unknown as typeof fetch)), /Cannot reach the Mac/)
})

test('sendKeys: posts the chat with the text or the key, undefined when sent', async () => {
  const sent: Array<{ url: string; init: RequestInit }> = []
  const f = (async (url: string, init: RequestInit) => { sent.push({ url, init }); return new Response(null, { status: 204 }) }) as unknown as typeof fetch
  assert.equal(await sendKeys('s1', { text: 'go' }, f), undefined)
  assert.equal(await sendKeys('s1', { key: 'esc' }, f), undefined)
  assert.deepEqual(sent.map(s => [s.url, s.init.method, s.init.body]), [['/hub/chat/keys', 'POST', '{"session":"s1","text":"go"}'], ['/hub/chat/keys', 'POST', '{"session":"s1","key":"esc"}']])
  assert.deepEqual(sent[0].init.headers, { 'X-Switchboard': '1', 'Content-Type': 'application/json' })
})

test('sendKeys: says what the Mac said when it refused, else why it could not reach it', async () => {
  const refuse = (status: number, body: string) => (async () => new Response(body, { status })) as unknown as typeof fetch
  assert.equal(await sendKeys('s1', { key: 'tab' }, refuse(403, 'Typing from here is off.')), 'Typing from here is off.')
  assert.equal(await sendKeys('s1', { key: 'tab' }, refuse(409, 'claude or codex is not what runs in that terminal now')), 'claude or codex is not what runs in that terminal now')
  assert.match(String(await sendKeys('s1', { key: 'tab' }, refuse(502, ''))), /No editor window/)
  assert.match(String(await sendKeys('s1', { key: 'tab' }, (async () => { throw new Error('down') }) as unknown as typeof fetch)), /Cannot reach the Mac/)
})

test('fitScale: fits the width, but text stays between 11px and 14px', () => {
  assert.deepEqual([fitScale(600, 600), fitScale(390, 722), fitScale(2000, 722)].map(k => +(k * 12).toFixed(2)), [12, 11, 14])
})

test('KEY_LABELS: every key the Mac allows has a button label and a spoken name', () => {
  assert.deepEqual(Object.keys(KEY_LABELS).sort(), ['ctrl-c', 'down', 'enter', 'esc', 'left', 'right', 'tab', 'up'])
  for (const [short, name] of Object.values(KEY_LABELS)) assert.ok(short && name)
})
