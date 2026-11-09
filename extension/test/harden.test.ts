import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { BLA, blaArgs, buildDir, tryHarden, type Run } from '../src/hub/harden'

const project = (pkg: object, dirs: Record<string, Record<string, string>> = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harden-test-'))
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg))
  for (const [d, files] of Object.entries(dirs)) for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, d, f)), { recursive: true })
    fs.writeFileSync(path.join(root, d, f), body)
  }
  return root
}

describe('harden build check', () => {
  it('pins the BLA version and passes the copy as one argument', () => {
    assert.equal(BLA, 'bla-agents@3.1.0')
    assert.deepEqual(blaArgs('/tmp/x y; rm -rf ~/build'), ['--yes', 'bla-agents@3.1.0', 'harden', '/tmp/x y; rm -rf ~/build'])
  })

  it('finds the build dir from the build script, else the usual names', () => {
    assert.equal(buildDir(project({ scripts: { build: 'tsc --outDir lib' } }, { lib: { 'a.js': '1' }, dist: { 'b.js': '2' } })), 'lib')
    assert.equal(buildDir(project({ scripts: { build: 'vite build' } }, { build: { 'a.js': '1' } })), 'build')
    assert.equal(buildDir(project({ scripts: { build: 'next build' } }, { '.next': { 'a.js': '1' } })), '.next')
    assert.equal(buildDir(project({ scripts: { build: 'tsc --outDir ../escape' } }, { dist: { 'a.js': '1' } })), 'dist')
    assert.equal(buildDir(project({ scripts: {} })), undefined)
  })

  it('does nothing when the setting is off', async () => {
    const calls: string[][] = []
    const run: Run = async (_c, args) => { calls.push(args); return { ok: true, out: '' } }
    const r = await tryHarden(project({}, { dist: { 'a.js': '1' } }), { enabled: false, run })
    assert.equal(r.ok, false)
    assert.match(r.text, /off/)
    assert.equal(calls.length, 0)
  })

  it('hardens a temp copy, runs tests against it, reports the diff and cleans up', async () => {
    const root = project({ scripts: { build: 'tsc', test: 'node t.js' } }, { dist: { 'a.js': 'console.log(1)' } })
    const calls: { cmd: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }[] = []
    let copy = ''
    const run: Run = async (cmd, args, o) => {
      calls.push({ cmd, args, cwd: o.cwd, env: o.env })
      if (cmd === 'npx') {
        copy = args[3]
        fs.writeFileSync(path.join(copy, 'a.js'), 'sealed'.repeat(10))
        fs.writeFileSync(path.join(copy, 'a.js.seal'), 'x')
      }
      return { ok: true, out: '' }
    }
    const r = await tryHarden(root, { enabled: true, run })
    assert.equal(r.ok, true)
    assert.equal(calls[0].cmd, 'npx')
    assert.ok(copy.startsWith(os.tmpdir()) || copy.startsWith(fs.realpathSync(os.tmpdir())))
    assert.ok(!copy.startsWith(root))
    assert.deepEqual(calls[1].args, ['run', 'test'])
    assert.equal(calls[1].env?.HARDENED_BUILD_DIR, copy)
    assert.match(r.text, /1 → 2 files/)
    assert.match(r.text, /tests passed/)
    assert.equal(fs.readFileSync(path.join(root, 'dist', 'a.js'), 'utf8'), 'console.log(1)')
    assert.equal(fs.existsSync(copy), false)
  })

  it('reports a failed harden and still cleans up, with no test run', async () => {
    let copy = ''
    const run: Run = async (cmd, args) => { if (cmd === 'npx') copy = args[3]; return { ok: false, out: 'boom' } }
    const r = await tryHarden(project({ scripts: { test: 'x' } }, { dist: { 'a.js': '1' } }), { enabled: true, run })
    assert.equal(r.ok, false)
    assert.match(r.text, /boom/)
    assert.equal(fs.existsSync(copy), false)
  })

  it('without a test script, reports the diff only', async () => {
    const calls: string[] = []
    const run: Run = async cmd => { calls.push(cmd); return { ok: true, out: '' } }
    const r = await tryHarden(project({}, { out: { 'a.js': '1' } }), { enabled: true, run })
    assert.deepEqual(calls, ['npx'])
    assert.match(r.text, /no test script/)
  })
})
