import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { pieces, readGroups, saveGroup, splitAsks } from '../src/hub/split'

const text = 'Fix the login button on the settings page. Also add a dark mode toggle to the nav bar.'

test('two unrelated asks come back as two, word for word', async () => {
  let asked = ''
  const asks = await splitAsks(text, async p => { asked = p; return '[[1], [2]]' }, 1000)
  assert.deepEqual(asks, ['Fix the login button on the settings page.', 'Also add a dark mode toggle to the nav bar.'])
  assert.match(asked, /\[1\] Fix the login button/)
  assert.match(asked, /\[2\] Also add a dark mode/)
})

test('pieces: sentences, lines and inline list items; joined back they give the message', () => {
  const m = 'To-do, in this order: 1. Release the drawer. 2. Fix worktrees.\n- add tests\nDo these 1) a 2) b'
  const p = pieces(m)
  assert.equal(p.join(''), m)
  assert.deepEqual(p.map(x => x.trim()), ['To-do, in this order:', '1. Release the drawer.', '2. Fix worktrees.', '- add tests', 'Do these', '1) a', '2) b'])
  assert.deepEqual(pieces('Add version 2.0 support, see e.g. the docs'), ['Add version 2.0 support, see e.g. the docs'])
  assert.deepEqual(pieces('Fix the bug in step 3. Then ship version 2. Done.').map(x => x.trim()), ['Fix the bug in step 3.', 'Then ship version 2.', 'Done.'])
})

test('list markers come off, a lead-in and skipped pieces stay with their ask', async () => {
  const m = 'Switchboard to-do, in this order: 1. Release the agent drawer. It needs a bump. 2. Fix worktrees so I can see them.'
  assert.deepEqual(await splitAsks(m, async () => '[[2, 3], [4]]', 1000), ['Switchboard to-do, in this order: 1. Release the agent drawer. It needs a bump.', 'Fix worktrees so I can see them.'])
  assert.deepEqual(await splitAsks(m, async () => '[[2], [4]]', 1000), ['Switchboard to-do, in this order: 1. Release the agent drawer. It needs a bump.', 'Fix worktrees so I can see them.'])
  assert.deepEqual(await splitAsks('1. a thing\n2. b thing', async () => '[[1], [2]]', 1000), ['a thing', 'b thing'])
})

test('a number inside a sentence stays, and asks keep the message order', async () => {
  const m = 'Fix the bug in step 3. Then ship the release. Also update the docs.'
  assert.deepEqual(await splitAsks(m, async () => '[[2], [1, 3]]', 1000), ['Fix the bug in step 3. Also update the docs.', 'Then ship the release.'])
})

test('a reply wrapped in prose or a code fence still parses', async () => {
  const asks = await splitAsks(text, async () => 'Here:\n```json\n[[1], [2]]\n```', 1000)
  assert.equal(asks.length, 2)
})

test('error, timeout, garbage, one group or bad numbers: the text as one ask', async () => {
  const run = (ask: () => Promise<string>, ms = 1000) => splitAsks(text, ask, ms)
  assert.deepEqual(await run(async () => { throw new Error('x') }), [text])
  assert.deepEqual(await run(() => new Promise(r => setTimeout(() => r('[[1], [2]]'), 50)), 10), [text])
  assert.deepEqual(await run(async () => 'not json'), [text])
  assert.deepEqual(await run(async () => '[]'), [text])
  assert.deepEqual(await run(async () => '[[1, 2]]'), [text])
  assert.deepEqual(await run(async () => '[1, 2]'), [text])
  assert.deepEqual(await run(async () => '[[1], [3]]'), [text])
  assert.deepEqual(await run(async () => '[[1], [1, 2]]'), [text])
  assert.deepEqual(await run(async () => '[["a"], ["b"]]'), [text])
  assert.deepEqual(await run(async () => '{"a": 1}'), [text])
})

test('secret-looking text never reaches the model', async () => {
  let called = false
  const secret = 'Rotate sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 and also fix the nav bar.'
  assert.deepEqual(await splitAsks(secret, async () => { called = true; return '[[1], [2]]' }, 1000), [secret])
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
