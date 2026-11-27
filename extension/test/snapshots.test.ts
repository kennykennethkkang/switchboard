import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { listSnapshots, restoreSnapshot, saveSnapshot } from '../src/hub/snapshots'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'))
process.env.HOME = home
process.env.USERPROFILE = home
const work = path.join(home, 'work')
fs.mkdirSync(work)
const f = path.join(work, 'rules.md')
const script = path.join(__dirname, '..', 'kit', 'skills', 'aar', 'scripts', 'snapshot.mjs')

test('save, edit, restore puts the old text back and keeps a before-undo snapshot', () => {
  fs.writeFileSync(f, 'one')
  const s = saveSnapshot('rules edit', [f], 'chat-1')
  assert.equal(s.chat, 'chat-1')
  assert.deepEqual(s.paths, [f])
  fs.writeFileSync(f, 'two')
  const before = restoreSnapshot(s.id)
  assert.equal(fs.readFileSync(f, 'utf8'), 'one')
  assert.match(before.label, /^before undo/)
  assert.equal(listSnapshots()[0].id, before.id)
  restoreSnapshot(before.id)
  assert.equal(fs.readFileSync(f, 'utf8'), 'two')
})

test('manifest has id, label, at, paths and lives under the store', () => {
  const s = listSnapshots().at(-1)!
  const m = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'switchboard', 'snapshots', s.id, 'manifest.json'), 'utf8'))
  assert.deepEqual(Object.keys(m).sort(), ['at', 'chat', 'id', 'label', 'paths'])
})

test('a missing file is skipped, an unknown id throws', () => {
  const s = saveSnapshot('gone', [path.join(work, 'nope.md'), f])
  assert.deepEqual(s.paths, [f])
  assert.throws(() => restoreSnapshot('nope'))
  assert.throws(() => restoreSnapshot('../x'))
})

test('the kit script shares the store: save, list, restore', () => {
  const run = (...a: string[]) => spawnSync('node', [script, ...a], { env: { ...process.env, HOME: home }, encoding: 'utf8' })
  fs.writeFileSync(f, 'v1')
  const out = run('save', 'cli edit', f)
  assert.equal(out.status, 0, out.stderr)
  const id = out.stdout.trim().split(/\s+/)[0]
  assert.ok(listSnapshots().some(s => s.id === id && s.label === 'cli edit'))
  assert.match(run('list').stdout, /cli edit/)
  fs.writeFileSync(f, 'v2')
  assert.equal(run('restore', id).status, 0)
  assert.equal(fs.readFileSync(f, 'utf8'), 'v1')
  assert.match(listSnapshots()[0].label, /^before undo/)
})

test('restore skips manifest paths outside home or escaping through a symlink', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-out-'))
  const target = path.join(outside, 'x.txt')
  fs.writeFileSync(target, 'keep')
  const link = path.join(work, 'link')
  fs.symlinkSync(outside, link)
  fs.writeFileSync(f, 'a')
  const s = saveSnapshot('esc', [f])
  const dir = path.join(home, '.claude', 'switchboard', 'snapshots', s.id)
  const forged = [f, target, path.join(link, 'x.txt'), '/etc/snap-test-evil']
  const rel = (p: string) => p.replace(/^[A-Za-z]:/, m => m[0]).replace(/^[\\/]+/, '')
  fs.mkdirSync(path.join(dir, 'files', rel(outside)), { recursive: true })
  fs.writeFileSync(path.join(dir, 'files', rel(outside), 'x.txt'), 'evil')
  fs.mkdirSync(path.join(dir, 'files', rel(link)), { recursive: true })
  fs.writeFileSync(path.join(dir, 'files', rel(link), 'x.txt'), 'evil')
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...s, paths: forged, chat: null }))
  fs.writeFileSync(f, 'b')
  const r = restoreSnapshot(s.id)
  assert.equal(fs.readFileSync(f, 'utf8'), 'a')
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep')
  assert.equal(fs.existsSync('/etc/snap-test-evil'), false)
  assert.equal(r.skipped.length, 3)
})

test('a reason is kept as one line in the manifest, from the hub and the kit script', () => {
  const s = saveSnapshot('why', [f], undefined, [], 'Learn aar\nof chat x')
  assert.equal(listSnapshots().find(x => x.id === s.id)?.reason, 'Learn aar of chat x')
  const out = spawnSync('node', [script, 'save', 'cli why', '--reason', 'retarget links', f], { env: { ...process.env, HOME: home }, encoding: 'utf8' })
  assert.equal(out.status, 0, out.stderr)
  const id = out.stdout.trim().split(/\s+/)[0]
  assert.equal(listSnapshots().find(x => x.id === id)?.reason, 'retarget links')
  assert.deepEqual(listSnapshots().find(x => x.id === id)?.paths, [f])
})

test('same-millisecond saves get distinct ids', () => {
  const now = Date.now
  Date.now = () => 42
  try {
    const a = saveSnapshot('dup', [f]), b = saveSnapshot('dup', [f])
    assert.notEqual(a.id, b.id)
  } finally { Date.now = now }
})

test('restore lists paths outside home as skipped', () => {
  const out = path.join(os.tmpdir(), `snap-out-${Date.now()}.md`)
  fs.writeFileSync(out, 'x')
  const s = saveSnapshot('outside', [f, out])
  const r = restoreSnapshot(s.id)
  assert.deepEqual(r.skipped, [`${out} (outside home)`])
  fs.rmSync(out, { force: true })
})

test('skipped paths go in the manifest of the before-undo snapshot and come back from listSnapshots', () => {
  const s = saveSnapshot('with outside', [f])
  const m = path.join(home, '.claude', 'switchboard', 'snapshots', s.id, 'manifest.json')
  const raw = JSON.parse(fs.readFileSync(m, 'utf8'))
  assert.equal(raw.skipped, undefined)
  const b = saveSnapshot('before undo x', [f], undefined, ['/etc/x (outside home)'])
  assert.deepEqual(listSnapshots().find(x => x.id === b.id)!.skipped, ['/etc/x (outside home)'])
  const out = restoreSnapshot(s.id)
  assert.deepEqual(listSnapshots().find(x => x.id === out.id)!.skipped ?? [], [])
})
