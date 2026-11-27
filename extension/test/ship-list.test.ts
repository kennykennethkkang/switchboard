import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { addWorktree, autoMergeOn, cleanWorktree, endedMerges, gitOp, mergeBusy, mergeNote, mergeWorktrees, queueEnded, readRepo, setAutoMerge, triedLately, worktreeFolder } from '../src/hub/git'
import { readShip, shipFolder } from '../src/hub/ship'
import { excludeWorktrees } from '../src/hub/advanced'

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const pass = async () => ({ ok: true, text: 'checks passed' })
const idle = () => false

let tmp = '', main = ''
const init = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true })
  sh(dir, 'init', '-q', '-b', 'main')
  sh(dir, 'config', 'user.email', 't@t'); sh(dir, 'config', 'user.name', 'T'); sh(dir, 'config', 'commit.gpgsign', 'false')
  fs.writeFileSync(path.join(dir, 'a.txt'), '1\n')
  sh(dir, 'add', '.'); sh(dir, 'commit', '-qm', 'init')
}
const commit = (dir: string, f: string, text = `${f}\n`) => { fs.writeFileSync(path.join(dir, f), text); sh(dir, 'add', '.'); sh(dir, 'commit', '-qm', f) }
const add = (slug: string) => { const w = path.join(main, '.claude', 'worktrees', slug); sh(main, 'worktree', 'add', '-q', '-b', `worktree-${slug}`, w); return w }

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ship-')))
  main = path.join(tmp, 'repo')
  init(main)
  excludeWorktrees(main)
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('merging into the branch being worked on', () => {
  it('lands on whatever branch the checkout is on and names it', async () => {
    const wt = add('one')
    fs.writeFileSync(path.join(wt, 'n.txt'), 'n\n')
    sh(main, 'switch', '-q', '-c', 'feature')
    const r = await mergeWorktrees(main, idle, pass, wt)
    assert.equal(r.ok, true, r.text)
    assert.match(r.text, /into feature as uncommitted changes/)
    assert.equal(sh(main, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature')
    assert.ok(fs.existsSync(path.join(main, 'n.txt')))
  })

  it('leaves the old branch\'s commits out when the checkout moved to another branch', async () => {
    sh(main, 'switch', '-q', '-c', 'feature'); commit(main, 'feature-only.txt')
    const wt = add('two')
    commit(wt, 'mine.txt'); fs.writeFileSync(path.join(wt, 'more.txt'), 'm\n')
    sh(main, 'switch', '-q', 'main')
    const r = await mergeWorktrees(main, idle, pass, wt)
    assert.equal(r.ok, true, r.text)
    assert.ok(fs.existsSync(path.join(main, 'mine.txt')) && fs.existsSync(path.join(main, 'more.txt')))
    assert.ok(!fs.existsSync(path.join(main, 'feature-only.txt')))
    assert.equal(sh(main, 'log', '--format=%s'), 'init')
  })

  it('tells the chat page which branch that is, and whether it merges on its own', async () => {
    const wt = add('view')
    sh(main, 'switch', '-q', '-c', 'feature')
    assert.deepEqual((({ worktree, into, auto }) => ({ worktree, into, auto }))(await readRepo(wt)), { worktree: true, into: 'feature', auto: true })
    setAutoMerge(main, false)
    assert.equal((await readRepo(wt)).auto, false)
    assert.equal((await readRepo(main)).auto, undefined)
    assert.equal(worktreeFolder(path.join(wt, 'sub', 'dir')), wt)
    assert.equal(worktreeFolder(main), undefined)
  })

  it('still knows where a worktree started once its reflog is gone', async () => {
    sh(main, 'switch', '-q', '-c', 'feature'); commit(main, 'feature-only.txt')
    const made = await addWorktree(main, 'old')
    assert.ok(made.ok)
    commit(made.dir, 'mine.txt')
    sh(main, 'reflog', 'expire', '--expire=now', '--expire-unreachable=now', '--all')
    sh(main, 'switch', '-q', 'main')
    assert.equal((await mergeWorktrees(main, idle, pass, made.dir)).ok, true)
    assert.ok(fs.existsSync(path.join(main, 'mine.txt')) && !fs.existsSync(path.join(main, 'feature-only.txt')))
  })

  it('Merge back on a committed worktree waits for the lock and lets it go', async () => {
    const wt = add('locked'); commit(wt, 'l.txt')
    const lock = path.join(main, '.git', 'switchboard-merge.lock')
    fs.writeFileSync(lock, `${process.pid}-other`)
    assert.match((await gitOp(wt, { op: 'merge-back', confirmed: true }, undefined, false, idle)).text, /already running/)
    assert.ok(!fs.existsSync(path.join(main, 'l.txt')))
    fs.rmSync(lock)
    assert.equal((await gitOp(wt, { op: 'merge-back', confirmed: true }, undefined, false, idle)).ok, true)
    assert.ok(!fs.existsSync(lock))
  })

  it('Merge back on a committed worktree keeps a copy of its ignored files', async () => {
    commit(main, '.gitignore', 'secret.local\n')
    const wt = add('ignored'); commit(wt, 'i.txt'); fs.writeFileSync(path.join(wt, 'secret.local'), 's\n')
    assert.equal((await gitOp(wt, { op: 'merge-back', confirmed: true }, undefined, false, idle)).ok, true)
    const kept = path.join(main, '.git', 'switchboard-merged')
    assert.equal(fs.readFileSync(path.join(kept, fs.readdirSync(kept)[0], 'ignored', 'secret.local'), 'utf8'), 's\n')
  })

  it('clearing a merged worktree keeps a copy of its ignored files, and none when it stays', async () => {
    commit(main, '.gitignore', 'secret.local\n')
    const kept = path.join(main, '.git', 'switchboard-merged')
    const wt = add('cleared'); fs.writeFileSync(path.join(wt, 'secret.local'), 's\n')
    // A modules folder in its git dir makes git refuse to remove it.
    const sub = add('stays'); fs.writeFileSync(path.join(sub, 'secret.local'), 's\n')
    fs.mkdirSync(path.join(sh(sub, 'rev-parse', '--absolute-git-dir'), 'modules', 'x'), { recursive: true })
    // Another window's copy from the same millisecond stays when this one's removal is refused.
    const now = Date.now
    fs.mkdirSync(path.join(kept, 'stays-1'), { recursive: true })
    Date.now = () => 1
    try { assert.equal(await cleanWorktree(sub), false) } finally { Date.now = now }
    assert.deepEqual(fs.readdirSync(kept), ['stays-1'])
    fs.rmSync(path.join(kept, 'stays-1'), { recursive: true })
    assert.ok(fs.existsSync(path.join(sub, 'secret.local')))
    assert.equal(await cleanWorktree(wt), true)
    assert.ok(!fs.existsSync(wt))
    assert.equal(fs.readFileSync(path.join(kept, fs.readdirSync(kept)[0], 'ignored', 'secret.local'), 'utf8'), 's\n')
  })

  it('does the same from Merge back on a committed worktree, with no git merge of the old branch', async () => {
    sh(main, 'switch', '-q', '-c', 'feature'); commit(main, 'feature-only.txt')
    const wt = add('three'); commit(wt, 'mine.txt')
    sh(main, 'switch', '-q', 'main')
    const r = await gitOp(wt, { op: 'merge-back', confirmed: true }, undefined, false, idle)
    assert.equal(r.ok, true, r.text)
    assert.ok(fs.existsSync(path.join(main, 'mine.txt')) && !fs.existsSync(path.join(main, 'feature-only.txt')))
    assert.equal(sh(main, 'log', '--format=%s'), 'init')
  })
})

describe('merge note and lock', () => {
  it('keeps the last result for every window and is busy only while the lock is held', async () => {
    assert.equal(mergeNote(main), undefined)
    const wt = add('noted'); fs.writeFileSync(path.join(wt, 'n.txt'), 'n\n')
    let during = false
    await mergeWorktrees(main, idle, async () => { during = mergeBusy(main); return { ok: true, text: 'ok' } }, wt)
    assert.equal(during, true)
    assert.equal(mergeBusy(main), false)
    // A lock left by a window that died holds nothing up.
    fs.writeFileSync(path.join(main, '.git', 'switchboard-merge.lock'), '999999-x'); assert.equal(mergeBusy(main), false)
    fs.rmSync(path.join(main, '.git', 'switchboard-merge.lock'))
    const n = mergeNote(main)
    assert.equal(n?.ok, true)
    assert.match(n?.text ?? '', /Merged noted into main/)
    assert.ok(n?.tried?.noted)
  })

  it('notes a failing check too, and a one-worktree merge never counts as the quiet sweep', async () => {
    const wt = add('bad'); fs.writeFileSync(path.join(wt, 'n.txt'), 'n\n')
    await mergeWorktrees(main, idle, async () => ({ ok: false, text: 'test failed' }), wt)
    assert.equal(mergeNote(main)?.ok, false)
    assert.ok(!fs.existsSync(path.join(main, '.git', 'switchboard-merge-ran')))
    await mergeWorktrees(main, idle, pass)
    assert.ok(fs.existsSync(path.join(main, '.git', 'switchboard-merge-ran')))
  })
})

describe('merge when the chat ends', () => {
  it('queues an ended worktree once, then the queue hands it out', () => {
    const wt = add('ended'), q = new Map<string, string>()
    queueEnded(q, wt)
    assert.deepEqual([...q], [[wt, wt]])
    assert.deepEqual(endedMerges(q, idle), [[wt, wt]])
  })

  it('skips one that was just tried, one already queued by Approve, and a repo with auto merge off', async () => {
    const wt = add('tried'); fs.writeFileSync(path.join(wt, 'n.txt'), 'n\n')
    const q = new Map<string, string>([['chat-1', path.join(wt, 'sub')]])
    queueEnded(q, wt)
    assert.deepEqual([...q.keys()], ['chat-1'])
    q.clear()
    setAutoMerge(main, false); queueEnded(q, wt, autoMergeOn(main)); assert.equal(q.size, 0)
    setAutoMerge(main, true)
    await mergeWorktrees(main, idle, async () => ({ ok: false, text: 'test failed' }), wt)
    assert.equal(triedLately(wt), true)
    queueEnded(q, wt); assert.equal(q.size, 0)
    queueEnded(q, wt, true, Date.now() + 11 * 60_000); assert.equal(q.size, 1)
  })
})

describe('the Ship list', () => {
  it('reads repos with no chat: files, commits not on the remote, worktrees', async () => {
    const bare = path.join(tmp, 'origin.git'); sh(tmp, 'init', '-q', '--bare', '-b', 'main', bare)
    sh(main, 'remote', 'add', 'origin', bare); sh(main, 'push', '-qu', 'origin', 'main')
    commit(main, 'b.txt'); fs.writeFileSync(path.join(main, 'c.txt'), 'c\n')
    const wt = add('tree'); fs.writeFileSync(path.join(wt, 'n.txt'), 'n\n')
    const other = path.join(tmp, 'plain'); fs.mkdirSync(other)
    const [r, ...rest] = await readShip([main, other, main], w => w === fs.realpathSync.native(wt))
    assert.equal(rest.length, 0)
    assert.deepEqual({ ...r, trees: [] }, { id: main, name: 'repo', branch: 'main', files: 1, ahead: 1, behind: 0, auto: true, trees: [] })
    assert.deepEqual(r.trees, [{ id: wt, name: 'tree', branch: 'worktree-tree', files: 1, commits: 0, live: true }])
  })

  it('counts commits on a branch that was never pushed', async () => {
    const bare = path.join(tmp, 'origin.git'); sh(tmp, 'init', '-q', '--bare', '-b', 'main', bare)
    sh(main, 'remote', 'add', 'origin', bare); sh(main, 'push', '-qu', 'origin', 'main')
    sh(main, 'switch', '-q', '-c', 'feature'); commit(main, 'f.txt')
    const [r] = await readShip([main], idle)
    assert.equal(r.ahead, 1)
  })

  it('keeps the list when one repo cannot be read', async () => {
    const broken = path.join(tmp, 'broken'); fs.mkdirSync(path.join(broken, '.git'), { recursive: true })
    assert.deepEqual((await readShip([broken, main], idle)).map(r => r.name), ['repo'])
  })

  it('takes only a listed repo or worktree as a ship target, never a path from the page', async () => {
    const wt = add('tree')
    const list = await readShip([main], idle)
    assert.equal(shipFolder(list, main), main)
    assert.equal(shipFolder(list, wt), wt)
    assert.equal(shipFolder(list, tmp), undefined)
    assert.equal(shipFolder(list, `${main}/../repo`), undefined)
    assert.equal(shipFolder(undefined, main), undefined)
  })

  it('turns auto merge off and on per repo', async () => {
    assert.equal(autoMergeOn(main), true)
    setAutoMerge(main, false); assert.equal(autoMergeOn(main), false)
    assert.equal((await readShip([main], idle))[0].auto, false)
    setAutoMerge(main, true); assert.equal(autoMergeOn(main), true)
    setAutoMerge(main, true)
  })
})
