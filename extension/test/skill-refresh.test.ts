import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { refreshSkills } from '../src/hub/skill-refresh'

test('refreshSkills: windows that start together run it once, a later start runs it again', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-skill-refresh-'))
  const lock = path.join(dir, 'skill-refresh.lock')
  const calls: string[] = []
  const run = async (script: string) => { calls.push(script); return '' }
  await Promise.all([refreshSkills('/ext', lock, run), refreshSkills('/ext', lock, run)])
  await refreshSkills('/ext', lock, run)
  assert.deepEqual(calls, [path.join('/ext', 'kit', 'setup-run.mjs')])
  const old = new Date(Date.now() - 3 * 60_000)
  fs.utimesSync(lock, old, old)
  await refreshSkills('/ext', lock, run)
  assert.equal(calls.length, 2)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('refreshSkills: a failed run is logged, not thrown, and the next window tries again', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-skill-refresh-'))
  const lock = path.join(dir, 'l.lock')
  await refreshSkills('/ext', lock, async () => { throw new Error('no node') })
  let ran = 0
  await refreshSkills('/ext', lock, async () => { ran++; return '' })
  assert.equal(ran, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('startSkillRefresh: off the activation path, for an installed build only, and not after the window closes', async t => {
  const Module = await import('node:module')
  const load = (Module.default as unknown as { _load: (...a: unknown[]) => unknown })
  const was = load._load
  load._load = (name: unknown, ...rest: unknown[]) => (name === 'vscode' ? { ExtensionMode: { Production: 1, Development: 2 } } : was(name, ...rest))
  t.mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const { startSkillRefresh } = await import('../src/hub/skill-refresh')
    const calls: string[] = []
    const refresh = async (ext: string) => { calls.push(ext) }
    const ctx = (mode: number) => ({ extensionMode: mode, extensionPath: `/ext${mode}`, subscriptions: [] as { dispose(): void }[] })
    const live = ctx(1), dev = ctx(2), closed = ctx(1)
    for (const c of [live, dev, closed]) startSkillRefresh(c as never, refresh)
    closed.subscriptions.forEach(s => s.dispose())
    assert.deepEqual(calls, [])
    t.mock.timers.tick(60_000)
    assert.deepEqual(calls, ['/ext1'])
  } finally { load._load = was }
})
