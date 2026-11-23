import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { endedMerges, gitOp, mergeWorktrees } from '../src/hub/git'
import { excludeWorktrees } from '../src/hub/advanced'

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const idle = () => false

describe('merge back uncommitted worktree work', () => {
  let tmp = '', main = ''
  const add = (slug: string) => { const w = path.join(main, '.claude', 'worktrees', slug); sh(main, 'worktree', 'add', '-q', '-b', `worktree-${slug}`, w); return w }
  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-mb-')))
    main = path.join(tmp, 'repo')
    fs.mkdirSync(main)
    sh(main, 'init', '-q', '-b', 'main')
    sh(main, 'config', 'user.email', 't@t'); sh(main, 'config', 'user.name', 'T'); sh(main, 'config', 'commit.gpgsign', 'false')
    fs.writeFileSync(path.join(main, 'a.txt'), '1\n')
    sh(main, 'add', '.'); sh(main, 'commit', '-qm', 'init')
    excludeWorktrees(main)
  })
  after(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('folds only this worktree into main as uncommitted changes and removes it', async () => {
    const wt = add('one'), other = add('other')
    fs.writeFileSync(path.join(wt, 'a.txt'), 'wt\n')
    fs.writeFileSync(path.join(wt, 'new.txt'), 'new\n')
    fs.writeFileSync(path.join(other, 'o.txt'), 'o\n')
    const r = await gitOp(wt, { op: 'merge-back', confirmed: true }, undefined, false, idle)
    assert.equal(r.ok, true, r.text)
    assert.match(r.text, /uncommitted/)
    assert.equal(fs.readFileSync(path.join(main, 'a.txt'), 'utf8'), 'wt\n')
    assert.equal(fs.readFileSync(path.join(main, 'new.txt'), 'utf8'), 'new\n')
    assert.equal(sh(main, 'log', '--format=%s'), 'init')
    assert.ok(!fs.existsSync(wt))
    assert.equal(sh(main, 'branch', '--list', 'worktree-one'), '')
    // The other idle worktree is left alone.
    assert.ok(fs.existsSync(path.join(other, 'o.txt')) && !fs.existsSync(path.join(main, 'o.txt')))
    sh(main, 'checkout', '--', 'a.txt'); fs.rmSync(path.join(main, 'new.txt'))
  })

  it('takes commits and uncommitted files together, keeping the unmerged branch', async () => {
    const wt = add('both')
    fs.writeFileSync(path.join(wt, 'c.txt'), 'c\n'); sh(wt, 'add', '.'); sh(wt, 'commit', '-qm', 'c')
    fs.writeFileSync(path.join(wt, 'd.txt'), 'd\n')
    const r = await gitOp(wt, { op: 'merge-back', confirmed: true }, undefined, false, idle)
    assert.equal(r.ok, true, r.text)
    assert.equal(fs.readFileSync(path.join(main, 'c.txt'), 'utf8'), 'c\n')
    assert.equal(fs.readFileSync(path.join(main, 'd.txt'), 'utf8'), 'd\n')
    assert.equal(sh(main, 'log', '--format=%s'), 'init')
    assert.ok(!fs.existsSync(wt))
    assert.match(sh(main, 'branch', '--list', 'worktree-both'), /worktree-both/)
    fs.rmSync(path.join(main, 'c.txt')); fs.rmSync(path.join(main, 'd.txt'))
  })

  it('refuses while a chat runs in the worktree and changes nothing', async () => {
    const wt = add('busy')
    fs.writeFileSync(path.join(wt, 'b.txt'), 'b\n')
    for (const r of [
      await gitOp(wt, { op: 'merge-back', confirmed: true }, undefined, true, idle),
      await gitOp(wt, { op: 'merge-back', confirmed: true }, undefined, false, w => w === fs.realpathSync(wt)),
    ]) {
      assert.equal(r.ok, false)
      assert.match(r.text, /chat is still running in it/)
    }
    assert.ok(!fs.existsSync(path.join(main, 'b.txt')))
    assert.ok(fs.existsSync(path.join(wt, 'b.txt')))
  })

  it('keeps a worktree holding a nested git repo main does not track', async () => {
    const wt = add('nested'), sub = path.join(wt, 'sub')
    fs.mkdirSync(sub)
    sh(sub, 'init', '-q', '-b', 'main')
    sh(sub, 'config', 'user.email', 't@t'); sh(sub, 'config', 'user.name', 'T'); sh(sub, 'config', 'commit.gpgsign', 'false')
    fs.writeFileSync(path.join(sub, 'keep.txt'), 'k\n'); sh(sub, 'add', '.'); sh(sub, 'commit', '-qm', 'k')
    fs.writeFileSync(path.join(wt, 'n.txt'), 'n\n')
    const r = await gitOp(wt, { op: 'merge-back', confirmed: true }, undefined, false, idle)
    assert.equal(r.ok, false)
    assert.match(r.text, /nested git repo/)
    assert.ok(fs.existsSync(path.join(sub, 'keep.txt')))
    assert.ok(!fs.existsSync(path.join(main, 'n.txt')) && !fs.existsSync(path.join(main, 'sub')))
    assert.equal(sh(main, 'status', '--porcelain'), '')
    fs.rmSync(wt, { recursive: true, force: true }); sh(main, 'worktree', 'prune')
  })

  it('says why a linked worktree outside .claude/worktrees does not merge back', async () => {
    const wt = path.join(tmp, 'elsewhere')
    sh(main, 'worktree', 'add', '-q', '-b', 'elsewhere', wt)
    fs.writeFileSync(path.join(wt, 'e.txt'), 'e\n')
    const r = await gitOp(wt, { op: 'merge-back', confirmed: true }, undefined, false, idle)
    assert.equal(r.ok, false)
    assert.match(r.text, /Only Switchboard worktrees under \.claude\/worktrees merge back from here/)
    assert.ok(fs.existsSync(path.join(wt, 'e.txt')))
  })

  it('keeps the worktree when its work clashes with main', async () => {
    const wt = add('clash')
    fs.writeFileSync(path.join(wt, 'a.txt'), 'clash\n')
    fs.writeFileSync(path.join(main, 'a.txt'), 'main edit\n')
    const r = await gitOp(wt, { op: 'merge-back', confirmed: true }, undefined, false, idle)
    assert.equal(r.ok, false)
    assert.match(r.text, /clashes with main/)
    assert.equal(fs.readFileSync(path.join(main, 'a.txt'), 'utf8'), 'main edit\n')
    assert.ok(fs.existsSync(wt))
    sh(main, 'checkout', '--', 'a.txt')
  })

  it('hands out a queued worktree only once its chat has ended', () => {
    const wt = add('queued')
    const q = new Map([['s1', path.join(wt, 'sub')], ['gone', path.join(main, '.claude', 'worktrees', 'nope')]])
    let live = true
    assert.deepEqual(endedMerges(q, () => live), [])
    assert.deepEqual([...q.keys()], ['s1'])
    live = false
    assert.deepEqual(endedMerges(q, () => live), [['s1', wt]])
    assert.equal(q.size, 0)
    sh(main, 'worktree', 'remove', '--force', wt); sh(main, 'branch', '-D', 'worktree-queued')
  })

  it('merges a worktree whose files were already copied into main by hand', async () => {
    const wt = add('copied')
    fs.writeFileSync(path.join(wt, 'a.txt'), 'copied\n')
    fs.writeFileSync(path.join(wt, 'b.txt'), 'b\n')
    fs.writeFileSync(path.join(main, 'a.txt'), 'copied\n')
    const r = await gitOp(wt, { op: 'merge-back', confirmed: true }, undefined, false, idle)
    assert.equal(r.ok, true, r.text)
    assert.equal(fs.readFileSync(path.join(main, 'a.txt'), 'utf8'), 'copied\n')
    assert.equal(fs.readFileSync(path.join(main, 'b.txt'), 'utf8'), 'b\n')
    assert.ok(!fs.existsSync(wt))
    sh(main, 'checkout', '--', 'a.txt'); fs.rmSync(path.join(main, 'b.txt'))
  })

  it('merges a rename and a non-ASCII file main already holds the same', async () => {
    const wt = add('renamed')
    fs.renameSync(path.join(wt, 'a.txt'), path.join(wt, 'z.txt'))
    fs.writeFileSync(path.join(wt, 'caf\u00e9 \u00fc.txt'), 'c\n')
    fs.renameSync(path.join(main, 'a.txt'), path.join(main, 'z.txt'))
    fs.writeFileSync(path.join(main, 'caf\u00e9 \u00fc.txt'), 'c\n')
    const r = await gitOp(wt, { op: 'merge-back', confirmed: true }, undefined, false, idle)
    assert.equal(r.ok, true, r.text)
    assert.ok(!fs.existsSync(path.join(main, 'a.txt')))
    assert.equal(fs.readFileSync(path.join(main, 'z.txt'), 'utf8'), '1\n')
    assert.ok(!fs.existsSync(wt))
    fs.rmSync(path.join(main, 'z.txt')); fs.rmSync(path.join(main, 'caf\u00e9 \u00fc.txt')); sh(main, 'checkout', '--', 'a.txt')
  })

  it('never skips a link, a dangling link or a mode change that only looks the same', async () => {
    const wt = add('kinds')
    fs.writeFileSync(path.join(main, 'old.txt'), 'o\n'); fs.writeFileSync(path.join(wt, 'old.txt'), 'o\n')
    fs.symlinkSync('nowhere', path.join(wt, 'dangle'))
    fs.chmodSync(path.join(wt, 'a.txt'), 0o755)
    fs.symlinkSync('old.txt', path.join(wt, 'ln.txt')); fs.writeFileSync(path.join(main, 'ln.txt'), 'o\n')
    const r = await gitOp(wt, { op: 'merge-back', confirmed: true }, undefined, false, idle)
    // ln.txt is a file in main and a link here: a clash, so nothing is lost.
    assert.equal(r.ok, false, r.text)
    assert.ok(fs.existsSync(wt))
    fs.rmSync(path.join(main, 'ln.txt')); fs.rmSync(path.join(wt, 'ln.txt'))
    const r2 = await gitOp(wt, { op: 'merge-back', confirmed: true }, undefined, false, idle)
    assert.equal(r2.ok, true, r2.text)
    assert.equal(fs.readlinkSync(path.join(main, 'dangle')), 'nowhere')
    assert.ok(fs.statSync(path.join(main, 'a.txt')).mode & 0o100)
    fs.rmSync(path.join(main, 'dangle')); fs.rmSync(path.join(main, 'old.txt')); fs.chmodSync(path.join(main, 'a.txt'), 0o644); sh(main, 'checkout', '--', 'a.txt')
  })

  it('undoes only what it applied when checks fail on a partly copied worktree', async () => {
    const wt = add('partcheck')
    fs.writeFileSync(path.join(wt, 'a.txt'), 'same\n')
    fs.writeFileSync(path.join(wt, 'e.txt'), 'e\n')
    fs.writeFileSync(path.join(main, 'a.txt'), 'same\n')
    const r = await mergeWorktrees(wt, idle, async () => ({ ok: !fs.existsSync(path.join(main, 'e.txt')), text: 'test failed' }), wt)
    assert.equal(r.ok, false)
    assert.equal(fs.readFileSync(path.join(main, 'a.txt'), 'utf8'), 'same\n')
    assert.ok(!fs.existsSync(path.join(main, 'e.txt')))
    assert.ok(fs.existsSync(wt))
    sh(main, 'checkout', '--', 'a.txt')
  })
})
