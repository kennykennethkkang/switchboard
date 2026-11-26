import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'
import { invalidateSharedRun, sharedRun } from '../src/hub/shared-run'

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shared-run-'))
const opts = (directory: string, run: (file: string, args: string[], timeoutMs: number) => Promise<string>, ttlMs = 100) => ({ directory, run, ttlMs, timeoutMs: 100 })

test('two windows share a result inside the ttl and rerun it after expiry', async () => {
  const directory = temp()
  let calls = 0
  const runner = async () => `read ${++calls}`
  const first = await sharedRun('ps', ['-axo'], opts(directory, runner))
  const second = await sharedRun('ps', ['-axo'], opts(directory, runner))
  assert.equal(first, 'read 1')
  assert.equal(second, 'read 1')
  await new Promise(resolve => setTimeout(resolve, 110))
  assert.equal(await sharedRun('ps', ['-axo'], opts(directory, runner)), 'read 2')
  fs.rmSync(directory, { recursive: true, force: true })
})

test('separate module instances read the shared result', async () => {
  const directory = temp()
  let calls = 0
  const runner = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 80)); return 'read 1' }
  const loaded = await (new Function('specifier', 'return import(specifier)')('../src/hub/shared-run.ts?window=second') as Promise<typeof import('../src/hub/shared-run') & { default?: typeof import('../src/hub/shared-run') }>)
  const second = loaded.default ?? loaded
  const firstCall = sharedRun('ps', ['-axo', 'window'], opts(directory, runner))
  await new Promise(resolve => setTimeout(resolve, 10))
  const secondCall = second.sharedRun('ps', ['-axo', 'window'], opts(directory, runner))
  assert.deepEqual(await Promise.all([firstCall, secondCall]), ['read 1', 'read 1'])
  assert.equal(calls, 1)
  fs.rmSync(directory, { recursive: true, force: true })
})

test('in-flight calls in one window use one run', async () => {
  const directory = temp()
  let calls = 0
  const runner = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 20)); return 'result' }
  const options = opts(directory, runner)
  assert.deepEqual(await Promise.all([sharedRun('ps', ['-axo', 'flight'], options), sharedRun('ps', ['-axo', 'flight'], options)]), ['result', 'result'])
  assert.equal(calls, 1)
  fs.rmSync(directory, { recursive: true, force: true })
})

test('failed and empty runs are never cached', async () => {
  const directory = temp()
  let calls = 0
  const runner = async () => { calls++; if (calls === 1) throw new Error('failed'); return calls === 2 ? '' : 'fresh' }
  assert.equal(await sharedRun('lsof', [], opts(directory, runner)), '')
  assert.equal(await sharedRun('lsof', [], opts(directory, runner)), '')
  assert.equal(await sharedRun('lsof', [], opts(directory, runner)), 'fresh')
  assert.equal(calls, 3)
  fs.rmSync(directory, { recursive: true, force: true })
})

test('a stale lock is recovered and corrupt or future cache files rerun', async () => {
  const directory = temp()
  let calls = 0
  const cacheDir = path.join(directory, 'shared')
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 })
  const cacheFor = async (args: string[]) => path.join(cacheDir, `${(await import('node:crypto')).createHash('sha256').update(JSON.stringify(['cmd', args])).digest('hex')}.json`)
  const corrupt = await cacheFor(['corrupt'])
  fs.writeFileSync(corrupt, '{broken')
  assert.equal(await sharedRun('cmd', ['corrupt'], opts(directory, async () => `run ${++calls}`)), 'run 1')
  const future = await cacheFor(['future'])
  fs.writeFileSync(future, JSON.stringify({ at: Date.now() + 10_000, value: 'future' }))
  assert.equal(await sharedRun('cmd', ['future'], opts(directory, async () => `run ${++calls}`)), 'run 2')
  const lock = (await cacheFor(['locked'])).replace(/\.json$/, '.lock')
  fs.writeFileSync(lock, 'stale')
  fs.utimesSync(lock, new Date(0), new Date(0))
  assert.equal(await sharedRun('cmd', ['locked'], opts(directory, async () => `run ${++calls}`)), 'run 3')
  assert.equal(fs.statSync(cacheDir).mode & 0o777, 0o700)
  assert.equal(fs.statSync(await cacheFor(['locked'])).mode & 0o777, 0o600)
  fs.rmSync(directory, { recursive: true, force: true })
})

test('fresh runs bypass cached results', async () => {
  const directory = temp()
  let calls = 0
  const options = opts(directory, async () => `run ${++calls}`)
  assert.equal(await sharedRun('ps', [], options), 'run 1')
  assert.equal(await sharedRun('ps', [], { ...options, fresh: true }), 'run 2')
  assert.equal(await sharedRun('ps', [], options), 'run 2')
  assert.equal(calls, 2)
  fs.rmSync(directory, { recursive: true, force: true })
})

test('an invalidation during an older run stays newer than its result', async () => {
  const directory = temp()
  const args = ['-axo', 'racing']
  let finish!: (value: string) => void
  let calls = 0
  const runner = async () => {
    calls++
    if (calls === 1) return new Promise<string>(resolve => { finish = resolve })
    return 'new'
  }
  const pending = sharedRun('ps', args, opts(directory, runner))
  await new Promise(resolve => setTimeout(resolve, 10))
  invalidateSharedRun('ps', args, directory)
  finish('old')
  assert.equal(await pending, 'old')
  assert.equal(await sharedRun('ps', args, opts(directory, runner)), 'new')
  assert.equal(calls, 2)
  fs.rmSync(directory, { recursive: true, force: true })
})

test('a failed fresh run does not populate the cache', async () => {
  const directory = temp()
  let calls = 0
  const runner = async () => { calls++; if (calls === 1) throw new Error('failed'); return 'saved' }
  assert.equal(await sharedRun('ps', ['fresh-failure'], { ...opts(directory, runner), fresh: true }), '')
  assert.equal(await sharedRun('ps', ['fresh-failure'], opts(directory, runner)), 'saved')
  assert.equal(calls, 2)
  fs.rmSync(directory, { recursive: true, force: true })
})
