import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diskVersion, gitPuller, newerVersion, newestVsix, onSwitchboard, pendingReload } from '../src/hub/self-update'

test('newerVersion: dotted parts compare as numbers', () => {
  assert.equal(newerVersion('0.17.10', '0.17.9'), true)
  assert.equal(newerVersion('0.17.9', '0.17.10'), false)
  assert.equal(newerVersion('1.0.0', '0.99.99'), true)
  assert.equal(newerVersion('0.17.9', '0.17.9'), false)
  assert.equal(newerVersion('0.17.9', undefined), true)
})

test('newestVsix: highest version wins, other files ignored', () => {
  assert.deepEqual(newestVsix(['switchboard-0.17.9.vsix', 'switchboard-0.17.10.vsix', 'rules.md', 'other-1.0.0.vsix']),
    { file: 'switchboard-0.17.10.vsix', version: '0.17.10' })
  assert.equal(newestVsix(['rules.md']), undefined)
  assert.equal(newestVsix(['switchboard-0.17.9-beta.vsix', 'switchboard-x.vsix', 'switchboard-1.0.vsix']), undefined)
})

test('diskVersion: our entry in extensions.json, nothing when missing or broken', () => {
  const json = JSON.stringify([
    { identifier: { id: 'someone.else' }, version: '9.9.9' },
    { identifier: { id: 'kennykennethkkang.switchboard' }, version: '0.17.9' },
  ])
  assert.equal(diskVersion(json, 'kennykennethkkang.switchboard'), '0.17.9')
  assert.equal(diskVersion(json, 'missing.id'), undefined)
  assert.equal(diskVersion('not json', 'kennykennethkkang.switchboard'), undefined)
})

test('startSelfUpdate: installs and reloads only for a production install whose row shows the new version', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path')
  const Module = require('module')
  const id = 'kennykennethkkang.switchboard'
  const row = (v: string) => JSON.stringify([{ identifier: { id }, version: v }])
  const calls: string[] = []
  let listing = '', landed: string | undefined, throws = false
  const lock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-lock-')), 'self-update.lock')
  let state = new Map<string, unknown>()
  let leave: (s: { focused: boolean }) => void = () => {}
  let answer: string | undefined = 'Install'
  const fake = {
    ExtensionMode: { Production: 1, Development: 2 },
    commands: { executeCommand: async (c: string) => {
      calls.push(c)
      if (c.endsWith('installExtension') && throws) throw new Error('install failed')
      if (landed && c.endsWith('installExtension')) fs.writeFileSync(listing, row(landed))
    } },
    Uri: { file: (p: string) => ({ fsPath: p }) },
    window: { state: { focused: false }, showInformationMessage: async (m: string) => { if (m.endsWith('Install it?')) { calls.push('ask'); return answer } return undefined }, onDidChangeWindowState: (f: (s: { focused: boolean }) => void) => { leave = f; return { dispose() {} } } },
  }
  const orig = Module._load
  Module._load = function (req: string, ...a: unknown[]) { return req === 'vscode' ? fake : orig.call(this, req, ...a) }
  const { startSelfUpdate } = await import('../src/hub/self-update')
  const run = async (mode: number, json: string | undefined, installs?: string) => {
    const exts = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-su-')), kit = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-kit-'))
    fs.writeFileSync(path.join(kit, 'switchboard-0.17.10.vsix'), '')
    listing = path.join(exts, 'extensions.json')
    landed = installs
    if (json) fs.writeFileSync(listing, json)
    const ctx = { globalState: { get: (k: string) => state.get(k), update: async (k: string, v: unknown) => { state.set(k, v) } }, extensionMode: mode, extension: { packageJSON: { version: '0.17.9' }, id }, extensionPath: path.join(exts, `${id}-0.17.9`), subscriptions: [] as { dispose(): void }[] }
    await startSelfUpdate(ctx as never, kit, async () => { calls.push('pull') }, lock)
    for (const s of ctx.subscriptions) s.dispose()
    return calls.splice(0)
  }
  try {
    assert.deepEqual(await run(2, row('0.17.9')), [], 'dev host')
    assert.deepEqual(await run(1, undefined), [], 'no extensions.json')
    assert.deepEqual(await run(1, '[]'), [], 'no row for us')
    answer = undefined
    assert.deepEqual(await run(1, row('0.17.9')), ['pull', 'ask'], 'declined: no install')
    assert.deepEqual(await run(1, row('0.17.9')), ['pull'], 'asked once per version')
    state = new Map()
    answer = 'Install'
    assert.deepEqual(await run(1, row('0.17.9')), ['pull', 'ask', 'workbench.extensions.installExtension'], 'install did not land: no reload')
    assert.deepEqual(await run(1, row('0.17.9')), ['pull'], 'same version is not tried again')
    state = new Map()
    assert.deepEqual(await run(1, row('0.17.9'), '0.17.10'), ['pull', 'ask', 'workbench.extensions.installExtension', 'workbench.action.reloadWindow'])
    // the row stays ahead of the running version (reload did not take): next start does not reload again
    assert.deepEqual(await run(1, row('0.17.10')), ['pull'], 'reloads at most once per version')
    leave({ focused: false })
    assert.deepEqual(calls.splice(0), [], 'leaving the window does not reload with nothing pending')
    state = new Map()
    throws = true
    assert.deepEqual(await run(1, row('0.17.9')), ['pull', 'ask', 'workbench.extensions.installExtension'])
    throws = false
    assert.deepEqual(await run(1, row('0.17.9')), ['pull', 'ask', 'workbench.extensions.installExtension'], 'a failed install is asked and tried again')
    state = new Map()
    fs.writeFileSync(lock, '')
    assert.deepEqual(await run(1, row('0.17.9')), [], 'another window holds the update: no pull or install here')
    assert.ok(fs.existsSync(lock), 'and its lock stays')
    fs.rmSync(lock)
    await run(1, row('0.17.9'))
    assert.ok(!fs.existsSync(lock), 'the lock goes once the check ends')
  } finally {
    Module._load = orig
  }
})

test('startSelfUpdate: a reload held back while focused happens at the next check once the window is in the background', async (t) => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path')
  const Module = require('module')
  const id = 'kennykennethkkang.switchboard'
  const calls: string[] = []
  const win = { focused: true }
  const fake = {
    ExtensionMode: { Production: 1 },
    commands: { executeCommand: async (c: string) => { calls.push(c) } },
    Uri: { file: (p: string) => ({ fsPath: p }) },
    window: { state: win, showInformationMessage: async () => undefined, onDidChangeWindowState: () => ({ dispose() {} }) },
  }
  const orig = Module._load
  Module._load = function (req: string, ...a: unknown[]) { return req === 'vscode' ? fake : orig.call(this, req, ...a) }
  t.mock.timers.enable({ apis: ['setInterval'] })
  try {
    const { startSelfUpdate } = await import('../src/hub/self-update')
    const exts = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-su-')), kit = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-kit-'))
    fs.writeFileSync(path.join(exts, 'extensions.json'), JSON.stringify([{ identifier: { id }, version: '0.17.11' }]))
    const state = new Map<string, unknown>()
    const ctx = { globalState: { get: (k: string) => state.get(k), update: async (k: string, v: unknown) => { state.set(k, v) } }, extensionMode: 1, extension: { packageJSON: { version: '0.17.10' }, id }, extensionPath: path.join(exts, `${id}-0.17.10`), subscriptions: [] as { dispose(): void }[] }
    await startSelfUpdate(ctx as never, kit, async () => {}, path.join(exts, 'self-update.lock'))
    assert.deepEqual(calls.splice(0), [], 'focused: asks, does not reload')
    // Already in the background, so no blur event comes.
    win.focused = false
    // Five minutes plus up to one of jitter.
    t.mock.timers.tick(6 * 60 * 1000)
    await new Promise(r => setImmediate(r))
    assert.deepEqual(calls.splice(0), ['workbench.action.reloadWindow'])
    for (const s of ctx.subscriptions) s.dispose()
  } finally {
    Module._load = orig
  }
})

test('gitPuller: pulls only with an upstream, one at a time, and never throws', async () => {
  const calls: string[] = []
  let upstream = true, failPull = false, release = () => {}
  const run = async (args: string[]) => {
    calls.push(args.join(' '))
    if (args[0] === 'rev-parse' && !upstream) throw new Error('no upstream')
    if (args[0] === 'pull') {
      await new Promise<void>(r => { release = r })
      if (failPull) throw new Error('conflict')
    }
    return ''
  }
  const pull = gitPuller(run)
  const a = pull(), b = pull()
  await new Promise(r => setTimeout(r, 5))
  release()
  await Promise.all([a, b])
  assert.deepEqual(calls.splice(0), ['rev-parse --abbrev-ref --symbolic-full-name @{u}', 'pull --ff-only --quiet'])
  upstream = false
  await pull()
  assert.deepEqual(calls.splice(0), ['rev-parse --abbrev-ref --symbolic-full-name @{u}'], 'no upstream or not a repo: no pull')
  upstream = true; failPull = true
  const c = pull()
  await new Promise(r => setTimeout(r, 5))
  release()
  await c
  assert.equal(calls.length, 2, 'a failed pull is swallowed')
})

const tmp = (p: string) => require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), p)) as string

/** An extensions folder holding Switchboard copies, version: build ('' for a copy without a stamp). */
function extDir(copies: Record<string, string>, obsolete: string[] = []): string {
  const fs = require('node:fs'), path = require('node:path')
  const dir = tmp('sb-ext-')
  for (const [v, build] of Object.entries(copies)) {
    const d = path.join(dir, `kennykennethkkang.switchboard-${v}`, 'dist')
    fs.mkdirSync(d, { recursive: true })
    if (build) fs.writeFileSync(path.join(d, 'build.txt'), `${build}\n`)
  }
  fs.writeFileSync(path.join(dir, '.obsolete'), JSON.stringify(Object.fromEntries(obsolete.map(v => [`kennykennethkkang.switchboard-${v}`, true]))))
  return dir
}

test('pendingReload: a newer version reloads every window, keyed by version', () => {
  const dir = extDir({ '0.18.0': 'a', '0.18.1': 'b' })
  assert.equal(pendingReload(dir, { version: '0.18.0', build: 'a' }, false), '0.18.1')
  assert.equal(pendingReload(dir, { version: '0.18.1', build: 'b' }, false), undefined)
})

test('pendingReload: a same-version rebuild reloads only with rebuilds on, keyed by build', () => {
  const dir = extDir({ '0.18.0': 'new' })
  assert.equal(pendingReload(dir, { version: '0.18.0', build: 'old' }, false), undefined)
  assert.equal(pendingReload(dir, { version: '0.18.0', build: 'old' }, true), '0.18.0+new')
  assert.equal(pendingReload(dir, { version: '0.18.0', build: 'new' }, true), undefined)
  // An older build with no stamp running: the stamped copy is still a new build.
  assert.equal(pendingReload(dir, { version: '0.18.0' }, true), '0.18.0+new')
})

test('pendingReload: no stamp on disk, obsolete or older copies never reload', () => {
  assert.equal(pendingReload(extDir({ '0.18.0': '' }), { version: '0.18.0', build: 'a' }, true), undefined)
  assert.equal(pendingReload(extDir({ '0.18.0': 'a', '0.19.0': 'z' }, ['0.19.0']), { version: '0.18.0', build: 'a' }, true), undefined)
  assert.equal(pendingReload(extDir({ '0.17.0': 'z', '0.18.0': 'a' }), { version: '0.18.0', build: 'a' }, true), undefined)
  assert.equal(pendingReload('/no/such/dir', { version: '0.18.0', build: 'a' }, true), undefined)
})

test('pendingReload: with rebuilds on, a newer version is keyed by its build too', () => {
  const dir = extDir({ '0.18.0': 'a', '0.19.0': 'z' })
  assert.equal(pendingReload(dir, { version: '0.18.0', build: 'a' }, true), '0.19.0+z')
})

test('onSwitchboard: a folder at or inside the Switchboard checkout, nothing else', () => {
  const fs = require('node:fs'), path = require('node:path')
  const repo = tmp('sb-repo-')
  fs.mkdirSync(path.join(repo, 'extension'))
  fs.mkdirSync(path.join(repo, 'web', 'lib'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'extension', 'package.json'), JSON.stringify({ name: 'switchboard', publisher: 'kennykennethkkang' }))
  const other = tmp('sb-other-')
  fs.mkdirSync(path.join(other, 'extension'))
  fs.writeFileSync(path.join(other, 'extension', 'package.json'), JSON.stringify({ name: 'something', publisher: 'kennykennethkkang' }))
  assert.equal(onSwitchboard([repo]), true)
  assert.equal(onSwitchboard([path.join(repo, 'extension')]), true)
  assert.equal(onSwitchboard([path.join(repo, 'web', 'lib')]), true)
  assert.equal(onSwitchboard([other, repo]), true)
  assert.equal(onSwitchboard([other]), false)
  assert.equal(onSwitchboard([]), false)
})
