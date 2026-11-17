/** An own-worktree chat: the start command, the project mapping and the Merge back op. */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { newChatCommand, repoTop } from '../src/hub/projects'
import { cleanWorktree, endedWorktrees, gitOp, readRepo, worktreeDirs } from '../src/hub/git'
import { excludeWorktrees } from '../src/hub/advanced'
import { commandProblem } from '../src/hub/routes'

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

describe('worktree start', () => {
  it('adds --worktree after the name', () => {
    assert.equal(newChatCommand({ name: 'Fix it', worktree: 'fix-it' }, 'posix'), "claude --name 'Fix it' --worktree 'fix-it'")
  })
  it('refuses a name that is not a slug', () => {
    assert.throws(() => newChatCommand({ worktree: '../x' }, 'posix'))
  })
  it('accepts worktree on hub-new-chat', () => {
    assert.equal(commandProblem({ type: 'hub-new-chat', path: '/x', remote: false, worktree: true }), undefined)
    assert.match(commandProblem({ type: 'hub-new-chat', path: '/x', remote: false, worktree: 'y' }) ?? '', /worktree/)
  })
})

describe('worktree chats', () => {
  let tmp = '', main = '', wt = ''
  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-wt-')))
    main = path.join(tmp, 'repo')
    fs.mkdirSync(main)
    sh(main, 'init', '-q', '-b', 'main')
    sh(main, 'config', 'user.email', 't@t'); sh(main, 'config', 'user.name', 'T'); sh(main, 'config', 'commit.gpgsign', 'false')
    fs.writeFileSync(path.join(main, 'a.txt'), '1\n')
    sh(main, 'add', '.'); sh(main, 'commit', '-qm', 'init')
    excludeWorktrees(main)
    wt = path.join(main, '.claude', 'worktrees', 'fix')
    sh(main, 'worktree', 'add', '-q', '-b', 'worktree-fix', wt)
  })
  after(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('maps a worktree folder to its main checkout', () => {
    assert.equal(repoTop(wt), main)
    assert.equal(repoTop(path.join(wt, 'sub')), main)
  })

  it('flags the worktree on its repo view, not the main one', async () => {
    assert.equal((await readRepo(wt)).worktree, true)
    assert.equal((await readRepo(main)).worktree, undefined)
  })

  it('keeps .claude/worktrees out of git', () => {
    assert.equal(sh(main, 'status', '--porcelain'), '')
  })

  it('refuses outside a worktree and with uncommitted files', async () => {
    assert.match((await gitOp(main, { op: 'merge-back', confirmed: true })).text, /not a worktree/i)
    fs.writeFileSync(path.join(wt, 'b.txt'), 'x\n')
    assert.match((await gitOp(wt, { op: 'merge-back', confirmed: true })).text, /Commit/)
    fs.rmSync(path.join(wt, 'b.txt'))
  })

  it('stops on a conflict and leaves main as it was', async () => {
    fs.writeFileSync(path.join(wt, 'a.txt'), 'wt\n'); sh(wt, 'commit', '-qam', 'wt')
    fs.writeFileSync(path.join(main, 'a.txt'), 'main\n'); sh(main, 'commit', '-qam', 'main')
    const r = await gitOp(wt, { op: 'merge-back', confirmed: true })
    assert.equal(r.ok, false)
    assert.match(r.text, /conflict/i)
    assert.equal(sh(main, 'status', '--porcelain'), '')
    assert.ok(fs.existsSync(wt))
  })

  it('merges but keeps the worktree while a chat runs in it', async () => {
    sh(wt, 'reset', '-q', '--hard', 'main')
    fs.writeFileSync(path.join(wt, 'k.txt'), 'k\n'); sh(wt, 'add', '.'); sh(wt, 'commit', '-qm', 'keep')
    const r = await gitOp(wt, { op: 'merge-back', confirmed: true }, undefined, true)
    assert.equal(r.ok, true, r.text)
    assert.match(r.text, /Merged; worktree kept while the chat runs/)
    assert.ok(fs.existsSync(path.join(main, 'k.txt')))
    assert.ok(fs.existsSync(wt))
    assert.match(sh(main, 'branch', '--list', 'worktree-fix'), /worktree-fix/)
  })

  it('merges, removes the worktree and its branch', async () => {
    sh(wt, 'reset', '-q', '--hard', 'main')
    fs.writeFileSync(path.join(wt, 'a.txt'), 'wt\n'); sh(wt, 'commit', '-qam', 'wt2')
    const r = await gitOp(wt, { op: 'merge-back', confirmed: true })
    assert.equal(r.ok, true, r.text)
    assert.equal(fs.readFileSync(path.join(main, 'a.txt'), 'utf8'), 'wt\n')
    assert.equal(fs.existsSync(wt), false)
    assert.equal(sh(main, 'branch', '--list', 'worktree-fix'), '')
    assert.equal(sh(main, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main')
  })
})

describe('kept worktree cleanup', () => {
  let tmp = '', main = ''
  const add = (name: string) => { const wt = path.join(main, '.claude', 'worktrees', name); sh(main, 'worktree', 'add', '-q', '-b', `worktree-${name}`, wt); return wt }
  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-wtc-')))
    main = path.join(tmp, 'repo')
    fs.mkdirSync(main)
    sh(main, 'init', '-q', '-b', 'main')
    sh(main, 'config', 'user.email', 't@t'); sh(main, 'config', 'user.name', 'T'); sh(main, 'config', 'commit.gpgsign', 'false')
    fs.writeFileSync(path.join(main, 'a.txt'), '1\n'); sh(main, 'add', '.'); sh(main, 'commit', '-qm', 'init')
  })
  after(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('removes a merged, clean worktree and its branch', async () => {
    const wt = add('done')
    assert.equal(await cleanWorktree(wt), true)
    assert.equal(fs.existsSync(wt), false)
    assert.equal(sh(main, 'branch', '--list', 'worktree-done'), '')
  })
  it('leaves one with unmerged commits', async () => {
    const wt = add('ahead')
    fs.writeFileSync(path.join(wt, 'n.txt'), 'n\n'); sh(wt, 'add', '.'); sh(wt, 'commit', '-qm', 'n')
    assert.equal(await cleanWorktree(wt), false)
    assert.ok(fs.existsSync(wt))
  })
  it('leaves one with uncommitted files', async () => {
    const wt = add('dirty')
    fs.writeFileSync(path.join(wt, 'u.txt'), 'u\n')
    assert.equal(await cleanWorktree(wt), false)
    assert.ok(fs.existsSync(wt))
  })
  it('leaves a plain checkout alone', async () => {
    assert.equal(await cleanWorktree(main), false)
    assert.ok(fs.existsSync(main))
  })

  it('names a worktree only after 10 minutes with no live chat, and a live sighting resets the clock', () => {
    const seen = new Map<string, number | undefined>()
    const wt = path.join(main, '.claude', 'worktrees', 'x')
    const MIN = 60_000
    assert.deepEqual(endedWorktrees(seen, [{ live: false, cwd: wt }], 0), [])
    assert.deepEqual(endedWorktrees(seen, [{ live: true, cwd: path.join(wt, 'sub') }], 1 * MIN), [])
    assert.deepEqual(endedWorktrees(seen, [{ live: false, cwd: wt }], 2 * MIN), [])
    // A flicker back to live inside the window starts the wait over.
    assert.deepEqual(endedWorktrees(seen, [{ live: true, cwd: wt }], 8 * MIN), [])
    assert.deepEqual(endedWorktrees(seen, [], 9 * MIN), [])
    assert.deepEqual(endedWorktrees(seen, [], 18 * MIN), [])
    assert.deepEqual(endedWorktrees(seen, [], 19 * MIN), [wt])
    assert.deepEqual(endedWorktrees(seen, [], 40 * MIN), [])
  })

  it('picks up a worktree found on disk that no live chat was seen in, as after a reload', () => {
    const seen = new Map<string, number | undefined>()
    const wt = path.join(main, '.claude', 'worktrees', 'left')
    fs.mkdirSync(wt, { recursive: true })
    const MIN = 60_000
    assert.deepEqual(worktreeDirs([main, path.join(main, '.claude', 'worktrees', 'other', 'sub')]).includes(wt), true)
    assert.deepEqual(endedWorktrees(seen, [], 0, [wt]), [])
    assert.deepEqual(endedWorktrees(seen, [{ live: true, cwd: wt }], 5 * MIN, [wt]), [])
    assert.deepEqual(endedWorktrees(seen, [], 6 * MIN, [wt]), [])
    assert.deepEqual(endedWorktrees(seen, [], 16 * MIN, [wt]), [fs.realpathSync.native(wt)])
    fs.rmSync(wt, { recursive: true })
  })

  it('treats case twins of one worktree as one', () => {
    const wt = path.join(main, '.claude', 'worktrees', 'Twin')
    fs.mkdirSync(wt, { recursive: true })
    const twin = wt.replace('Twin', 'twin')
    if (!fs.existsSync(twin)) return
    const seen = new Map<string, number | undefined>()
    endedWorktrees(seen, [{ live: true, cwd: wt }], 0)
    endedWorktrees(seen, [{ live: true, cwd: twin }], 1)
    assert.equal(seen.size, 1)
  })
})
