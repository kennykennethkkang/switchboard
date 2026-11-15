import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { readGroups, saveGroup, splitAsks } from '../src/hub/split'

const text = 'Fix the login button on the settings page. Also add a dark mode toggle to the nav bar.'

test('two unrelated asks come back as two', async () => {
  let asked = ''
  const asks = await splitAsks(text, async p => { asked = p; return '["Fix the login button on the settings page.", "Add a dark mode toggle to the nav bar."]' }, 1000)
  assert.deepEqual(asks, ['Fix the login button on the settings page.', 'Add a dark mode toggle to the nav bar.'])
  assert.match(asked, /never invent/i)
  assert.ok(asked.includes(text))
})

test('a reply wrapped in prose or a code fence still parses', async () => {
  const asks = await splitAsks(text, async () => 'Here:\n```json\n["Fix the login button on the settings page.", "Add a dark mode toggle to the nav bar."]\n```', 1000)
  assert.equal(asks.length, 2)
})

test('error, timeout, garbage, empty or invented asks: the text as one ask', async () => {
  const run = (ask: () => Promise<string>, ms = 1000) => splitAsks(text, ask, ms)
  assert.deepEqual(await run(async () => { throw new Error('x') }), [text])
  assert.deepEqual(await run(() => new Promise(r => setTimeout(() => r('["a", "b"]'), 50)), 10), [text])
  assert.deepEqual(await run(async () => 'not json'), [text])
  assert.deepEqual(await run(async () => '[]'), [text])
  assert.deepEqual(await run(async () => '[1, 2]'), [text])
  assert.deepEqual(await run(async () => '{"a": 1}'), [text])
  assert.deepEqual(await run(async () => '["Fix the login button on the settings page.", "Deploy the billing service to production kubernetes."]'), [text])
})

test('secret-looking text never reaches the model', async () => {
  let called = false
  const secret = 'Rotate sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 and also fix the nav bar.'
  assert.deepEqual(await splitAsks(secret, async () => { called = true; return '["a"]' }, 1000), [secret])
  assert.equal(called, false)
})

test('groups persist by session id', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-groups-')), 'groups.json')
  assert.deepEqual(readGroups(file), {})
  saveGroup('s1', 'g-abc', file)
  saveGroup('s2', 'g-abc', file)
  assert.deepEqual(readGroups(file), { s1: 'g-abc', s2: 'g-abc' })
  fs.writeFileSync(file, 'junk')
  assert.deepEqual(readGroups(file), {})
  fs.rmSync(path.dirname(file), { recursive: true })
})

test('POST /hub/split answers the asks to the token holder, with a body cap', async () => {
  const { HubService } = await import('../src/hub/hub-service')
  const { handleHub } = await import('../src/hub/routes')
  const hub = new HubService()
  const split = async (t: string) => [t, 'two']
  const call = (body: string, token = hub.token) => handleHub(hub, 'POST', `/hub/split?token=${token}`, body, undefined, undefined, undefined, undefined, undefined, undefined, split)
  assert.equal((await call('{"path":"/p","text":"a"}', 'nope'))?.status, 403)
  const ok = await call('{"path":"/p","text":"a and b"}')
  assert.equal(ok?.status, 200)
  assert.deepEqual(JSON.parse(ok!.body), { asks: ['a and b', 'two'] })
  assert.equal((await call('not json'))?.status, 400)
  assert.equal((await call('{"path":"/p"}'))?.status, 400)
  assert.equal((await call(JSON.stringify({ path: '/p', text: 'x'.repeat(8001) })))?.status, 400)
})
