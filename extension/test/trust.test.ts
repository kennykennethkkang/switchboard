import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { trustFolder, trustedWindowRoots } from '../src/hub/trust'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-trust-'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))
const file = path.join(tmp, '.claude.json')
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'))
// Folders under tmp/ws stand in for the window's workspace; real dirs, since the guard resolves real paths.
const ws = path.join(tmp, 'ws'), outside = path.join(tmp, 'other')
for (const d of ['a', 'b', 'c']) fs.mkdirSync(path.join(ws, d), { recursive: true })
fs.mkdirSync(outside)
const ok = { trusted: true, roots: [ws] }
const A = fs.realpathSync(path.join(ws, 'a')), B = fs.realpathSync(path.join(ws, 'b')), C = fs.realpathSync(path.join(ws, 'c'))

describe('trustFolder', () => {
  it('marks the exact folder trusted and keeps every other key', () => {
    fs.writeFileSync(file, JSON.stringify({ numStartups: 3, projects: { [A]: { allowedTools: ['x'] }, [B]: { hasTrustDialogAccepted: false, mcpServers: {} } } }))
    trustFolder(A, ok, file, tmp)
    trustFolder(`${B}/`, ok, file, tmp)
    trustFolder(C, ok, file, tmp)
    const j = read()
    assert.equal(j.numStartups, 3)
    assert.deepEqual(j.projects[A], { allowedTools: ['x'], hasTrustDialogAccepted: true })
    assert.deepEqual(j.projects[B], { hasTrustDialogAccepted: true, mcpServers: {} })
    assert.deepEqual(j.projects[C], { hasTrustDialogAccepted: true })
  })

  it('leaves the file alone when already trusted', () => {
    fs.writeFileSync(file, JSON.stringify({ projects: { [A]: { hasTrustDialogAccepted: true } } }))
    fs.utimesSync(file, 1, 1)
    trustFolder(A, ok, file, tmp)
    assert.equal(fs.statSync(file).mtimeMs, 1000)
  })

  it('never trusts the home folder or the root', () => {
    fs.writeFileSync(file, '{}')
    trustFolder(tmp, { trusted: true, roots: [tmp, '/'] }, file, tmp)
    trustFolder('/', { trusted: true, roots: ['/'] }, file, tmp)
    assert.deepEqual(read(), {})
  })

  it('skips an untrusted workspace, a folder outside it, and a symlink out of it', () => {
    fs.writeFileSync(file, '{}')
    trustFolder(A, { trusted: false, roots: [ws] }, file, tmp)
    trustFolder(outside, ok, file, tmp)
    trustFolder(A, { trusted: true, roots: [] }, file, tmp)
    // ws-sibling shares the prefix but is not under ws.
    fs.mkdirSync(`${ws}-sibling`)
    trustFolder(`${ws}-sibling`, ok, file, tmp)
    fs.symlinkSync(outside, path.join(ws, 'link'))
    trustFolder(path.join(ws, 'link'), ok, file, tmp)
    trustFolder(path.join(ws, 'missing'), ok, file, tmp)
    assert.deepEqual(read(), {})
    trustFolder(path.join(ws, '..', 'ws', 'a'), ok, file, tmp)
    assert.deepEqual(Object.keys(read().projects), [A])
  })

  it('never throws, and never writes over a file it cannot read', () => {
    fs.writeFileSync(file, '{broken')
    assert.doesNotThrow(() => trustFolder(A, ok, file, tmp))
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken')
    assert.doesNotThrow(() => trustFolder(A, ok, path.join(tmp, 'missing', '.claude.json'), tmp))
    assert.ok(!fs.existsSync(path.join(tmp, 'missing')))
  })
})

describe('trustFolder keys and other windows', () => {
  const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-trust-git-')))
  after(() => fs.rmSync(base, { recursive: true, force: true }))
  const json = path.join(base, '.claude.json')
  const keys = () => Object.keys(JSON.parse(fs.readFileSync(json, 'utf8')).projects ?? {})
  const repo = path.join(base, 'repo'), sub = path.join(repo, 'src', 'deep'), wt = path.join(base, 'wt'), plain = path.join(base, 'plain', 'x')
  const all = { trusted: true, roots: [base] }
  fs.mkdirSync(sub, { recursive: true }); fs.mkdirSync(plain, { recursive: true })
  sh(repo, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(repo, 'f.txt'), '1\n')
  sh(repo, 'add', '.'); sh(repo, '-c', 'user.email=t@t', '-c', 'user.name=T', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'init')
  sh(repo, 'worktree', 'add', '-q', wt)

  it('a repo subfolder writes the repo root; a worktree writes the main checkout; a plain folder writes itself', () => {
    fs.writeFileSync(json, '{}')
    trustFolder(sub, all, json, tmp)
    assert.deepEqual(keys(), [repo])
    fs.writeFileSync(json, '{}')
    trustFolder(wt, all, json, tmp)
    assert.deepEqual(keys(), [repo])
    fs.writeFileSync(json, '{}')
    trustFolder(plain, all, json, tmp)
    assert.deepEqual(keys(), [plain])
  })

  const windows = path.join(base, 'windows')
  fs.mkdirSync(windows)
  const win = (name: string, w: object) => fs.writeFileSync(path.join(windows, `${name}.json`), JSON.stringify({ port: 1, hubToken: 't', ...w }))

  it('trusts inside another live window that says trusted; never a dead one or one that says untrusted', () => {
    win('dead', { pid: 999_999_9, workspace: repo, trusted: true })
    win('untrusted', { pid: process.pid, workspace: repo, trusted: false })
    win('older', { pid: process.pid, workspace: repo })
    fs.writeFileSync(json, '{}')
    // This window is untrusted, and no other live window vouches for repo.
    trustFolder(sub, { trusted: false, roots: [repo], others: trustedWindowRoots(windows) }, json, tmp)
    trustFolder(sub, { trusted: true, roots: [], others: trustedWindowRoots(windows) }, json, tmp)
    assert.deepEqual(keys(), [])
    win('live', { pid: process.pid, workspace: repo, trusted: true })
    assert.deepEqual(trustedWindowRoots(windows), [repo])
    trustFolder(sub, { trusted: false, roots: [], others: trustedWindowRoots(windows) }, json, tmp)
    assert.deepEqual(keys(), [repo])
  })
})

describe('trustFolder: a trusted root vouches for its own repository', () => {
  const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-trust-same-')))
  after(() => fs.rmSync(base, { recursive: true, force: true }))
  const json = path.join(base, '.claude.json')
  const keys = () => Object.keys(JSON.parse(fs.readFileSync(json, 'utf8')).projects ?? {})
  const init = (dir: string) => {
    fs.mkdirSync(dir, { recursive: true })
    sh(dir, 'init', '-q', '-b', 'main')
    fs.writeFileSync(path.join(dir, 'f.txt'), '1\n')
    sh(dir, 'add', '.'); sh(dir, '-c', 'user.email=t@t', '-c', 'user.name=T', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'init')
  }
  const outer = path.join(base, 'outer'), sub = path.join(outer, 'pkg'), wt = path.join(base, 'wt'), nested = path.join(outer, 'nested')
  const lib = path.join(base, 'lib'), other = path.join(base, 'other'), plain = path.join(base, 'plain')
  init(outer); init(nested); init(lib); init(other)
  fs.mkdirSync(sub); fs.mkdirSync(plain)
  sh(outer, 'worktree', 'add', '-q', wt)
  sh(outer, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', lib, 'mods/lib')
  const subm = path.join(outer, 'mods', 'lib')
  const only = (root: string) => ({ trusted: true, roots: [root] })
  const run = (cwd: string, root: string) => { fs.writeFileSync(json, '{}'); trustFolder(cwd, only(root), json, base); return keys() }

  it('a window on a repo subfolder or a worktree trusts the repo root', () => {
    assert.deepEqual(run(sub, sub), [outer])
    assert.deepEqual(run(wt, wt), [outer])
    // Another live trusted window on the worktree vouches the same way.
    fs.writeFileSync(json, '{}')
    trustFolder(sub, { trusted: false, roots: [], others: [wt] }, json, base)
    assert.deepEqual(keys(), [outer])
  })

  it('a nested repo or submodule never vouches for the repo around it; an unrelated repo or a git failure refuses', () => {
    assert.deepEqual(run(outer, nested), [])
    assert.deepEqual(run(outer, subm), [])
    assert.deepEqual(run(outer, other), [])
    assert.deepEqual(run(outer, plain), [])
    assert.deepEqual(run(outer, path.join(base, 'missing')), [])
  })
})
