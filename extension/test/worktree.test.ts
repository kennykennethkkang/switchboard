/** An own-worktree chat: the start command, the project mapping and the Merge back op. */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { newChatCommand, repoTop } from '../src/hub/projects'
import { addWorktree, cleanWorktree, endedWorktrees, gitOp, liveIn, mergeDue, mergeWorktrees, QUIET_MS, readRepo, sweepChats, worktreeDirs, type MergeClock } from '../src/hub/git'
import { MAC_ONLY_GIT } from '../src/hub/types'
import { excludeWorktrees } from '../src/hub/advanced'
import { commandProblem } from '../src/hub/routes'

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

describe('worktree start', () => {
  it('never passes --worktree to claude', () => {
    assert.equal(newChatCommand({ name: 'Fix it' }, 'posix'), "claude --name 'Fix it'")
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
    assert.match((await gitOp(wt, { op: 'merge-back', confirmed: true })).text, /still running/)
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

  it('keeps the worktree of a chat killed without SessionEnd while its progress row stays', () => {
    const seen = new Map<string, number | undefined>()
    const wt = path.join(main, '.claude', 'worktrees', 'killed')
    const MIN = 60_000
    const fast: string[] = []
    endedWorktrees(seen, sweepChats([{ live: true, cwd: wt }], [{ cwd: wt }]), 0)
    assert.deepEqual(endedWorktrees(seen, sweepChats([{ live: false, cwd: wt }], [{ cwd: wt }]), 3 * MIN, [], fast), [])
    assert.deepEqual(endedWorktrees(seen, sweepChats([{ live: false, cwd: wt }], [{ cwd: wt }]), 30 * MIN, [], fast), [])
    assert.deepEqual(fast, [])
    // SessionEnd drops the row: the fast path takes it.
    endedWorktrees(seen, sweepChats([], []), 31 * MIN, [], fast)
    endedWorktrees(seen, sweepChats([], []), 33 * MIN, [], fast)
    assert.deepEqual(fast, [wt])
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

describe('own worktree creation', () => {
  let tmp = '', main = ''
  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-wta-')))
    main = path.join(tmp, 'repo')
    fs.mkdirSync(main)
    sh(main, 'init', '-q', '-b', 'main')
    sh(main, 'config', 'user.email', 't@t'); sh(main, 'config', 'user.name', 'T'); sh(main, 'config', 'commit.gpgsign', 'false')
    fs.writeFileSync(path.join(main, 'a.txt'), '1\n'); sh(main, 'add', '.'); sh(main, 'commit', '-qm', 'init')
  })
  after(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('adds repo/.claude/worktrees/<slug> on worktree-<slug> from HEAD and excludes the folder', async () => {
    const r = await addWorktree(main, 'fix-it-ab12')
    assert.equal(r.ok, true)
    const dir = path.join(main, '.claude', 'worktrees', 'fix-it-ab12')
    assert.equal(r.ok && r.dir, dir)
    assert.equal(sh(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'worktree-fix-it-ab12')
    assert.equal(sh(dir, 'rev-parse', 'HEAD'), sh(main, 'rev-parse', 'HEAD'))
    assert.equal(sh(main, 'status', '--porcelain'), '')
    assert.equal(repoTop(dir), main)
  })
  it('says why when git refuses, and rejects a bad name', async () => {
    const again = await addWorktree(main, 'fix-it-ab12')
    assert.equal(again.ok, false)
    assert.equal(again.ok === false && again.error.length > 0, true)
    assert.equal((await addWorktree(main, '../x')).ok, false)
  })
})

describe('merged worktree cleanup', () => {
  let tmp = '', main = ''
  const add = (name: string) => { const wt = path.join(main, '.claude', 'worktrees', name); sh(main, 'worktree', 'add', '-q', '-b', `worktree-${name}`, wt); return wt }
  const commit = (wt: string, f: string) => { fs.writeFileSync(path.join(wt, f), f); sh(wt, 'add', '.'); sh(wt, 'commit', '-qm', f) }
  const merged = async () => 'MERGED'
  const open = async () => 'OPEN'
  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-wtm-')))
    main = path.join(tmp, 'repo')
    fs.mkdirSync(main)
    sh(main, 'init', '-q', '-b', 'main')
    sh(main, 'config', 'user.email', 't@t'); sh(main, 'config', 'user.name', 'T'); sh(main, 'config', 'commit.gpgsign', 'false')
    fs.writeFileSync(path.join(main, 'a.txt'), '1\n'); sh(main, 'add', '.'); sh(main, 'commit', '-qm', 'init')
  })
  after(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('removes a squash-merged worktree with branch -D when its PR is merged', async () => {
    const wt = add('squash'); commit(wt, 's.txt')
    assert.equal(await cleanWorktree(wt, async (_r, b, sha) => (b === 'worktree-squash' && sha === sh(wt, 'rev-parse', 'HEAD') ? 'MERGED' : 'OPEN')), true)
    assert.equal(fs.existsSync(wt), false)
    assert.equal(sh(main, 'branch', '--list', 'worktree-squash'), '')
  })
  it('keeps unmerged work when the PR is open or absent', async () => {
    const wt = add('openpr'); commit(wt, 'o.txt')
    assert.equal(await cleanWorktree(wt, open), false)
    assert.equal(await cleanWorktree(wt, async () => undefined), false)
    assert.ok(fs.existsSync(wt))
  })
  it('keeps a merged PR worktree that is dirty', async () => {
    const wt = add('squashdirty'); commit(wt, 'd.txt'); fs.writeFileSync(path.join(wt, 'x.txt'), 'x')
    assert.equal(await cleanWorktree(wt, merged), false)
    assert.ok(fs.existsSync(wt))
  })
  it('unlocks a lock left by a process that is gone, then removes', async () => {
    const wt = add('stale')
    const gone = require('child_process').spawnSync('true').pid
    sh(main, 'worktree', 'lock', '--reason', `claude session stale (pid ${gone} host x)`, wt)
    assert.equal(await cleanWorktree(wt, open), true)
    assert.equal(fs.existsSync(wt), false)
  })
  it('keeps a worktree locked by a live pid', async () => {
    const wt = add('livelock')
    sh(main, 'worktree', 'lock', '--reason', `claude session x (pid ${process.pid} host x)`, wt)
    assert.equal(await cleanWorktree(wt, open), false)
    assert.ok(fs.existsSync(wt))
  })
  it('scans repos with no chat when given the project roots', () => {
    const wt = add('scanned')
    assert.equal(worktreeDirs([], [main]).includes(wt), true)
  })
  it('names a worktree its chat left only after 2 minutes, not on a live-flag blip', () => {
    const MIN = 60_000, seen = new Map<string, number | undefined>(), fast: string[] = []
    const w = path.join(main, '.claude', 'worktrees', 'chatty')
    fs.mkdirSync(w, { recursive: true })
    const real = fs.realpathSync.native(w)
    endedWorktrees(seen, [{ live: true, cwd: w }], 0, [], fast)
    endedWorktrees(seen, [], 1000, [], fast)
    endedWorktrees(seen, [{ live: true, cwd: w }], 15_000, [], fast)
    endedWorktrees(seen, [], 30_000, [], fast)
    endedWorktrees(seen, [], 30_000 + 1.5 * MIN, [], fast)
    assert.deepEqual(fast, [])
    endedWorktrees(seen, [], 30_000 + 2 * MIN, [], fast)
    assert.deepEqual(fast, [real])
    endedWorktrees(seen, [], 30_000 + 3 * MIN, [], fast)
    assert.deepEqual(fast, [real])
    fs.rmSync(w, { recursive: true })
  })
})

describe('merge all worktrees', () => {
  let tmp = '', main = ''
  const add = (slug: string) => { const w = path.join(main, '.claude', 'worktrees', slug); sh(main, 'worktree', 'add', '-q', '-b', `worktree-${slug}`, w); return w }
  const pass = async () => ({ ok: true, text: 'checks passed' })
  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-wtall-')))
    main = path.join(tmp, 'repo')
    fs.mkdirSync(main)
    sh(main, 'init', '-q', '-b', 'main')
    sh(main, 'config', 'user.email', 't@t'); sh(main, 'config', 'user.name', 'T'); sh(main, 'config', 'commit.gpgsign', 'false')
    fs.writeFileSync(path.join(main, 'a.txt'), '1\n')
    sh(main, 'add', '.'); sh(main, 'commit', '-qm', 'init')
    excludeWorktrees(main)
  })
  after(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('needs a confirm and refuses from the phone', async () => {
    assert.match((await gitOp(main, { op: 'merge-all' })).text, /Confirm/)
    assert.ok(MAC_ONLY_GIT.has('merge-all'))
  })

  it('folds uncommitted and committed work into main uncommitted, skips live and clashing ones', async () => {
    const one = add('one'), two = add('two'), busy = add('busy'), clash = add('clash')
    fs.writeFileSync(path.join(one, 'new.txt'), 'new\n')
    fs.writeFileSync(path.join(two, 'b.txt'), 'b\n'); sh(two, 'add', '.'); sh(two, 'commit', '-qm', 'b')
    fs.writeFileSync(path.join(busy, 'busy.txt'), 'x\n')
    fs.writeFileSync(path.join(clash, 'a.txt'), 'clash\n')
    fs.writeFileSync(path.join(main, 'a.txt'), 'main edit\n')
    const r = await mergeWorktrees(main, w => w === busy, pass)
    assert.equal(r.ok, true, r.text)
    assert.match(r.text, /Merged one, two/)
    assert.match(r.text, /Kept clash: clashes with main/)
    assert.match(r.text, /1 worktree with a running chat/)
    assert.equal(fs.readFileSync(path.join(main, 'new.txt'), 'utf8'), 'new\n')
    assert.equal(fs.readFileSync(path.join(main, 'b.txt'), 'utf8'), 'b\n')
    assert.equal(fs.readFileSync(path.join(main, 'a.txt'), 'utf8'), 'main edit\n')
    assert.equal(sh(main, 'log', '--format=%s'), 'init')
    assert.ok(!fs.existsSync(one) && !fs.existsSync(two))
    assert.ok(fs.existsSync(busy) && fs.existsSync(clash))
    // two's commit is not in main's history, so its branch stays.
    assert.match(sh(main, 'branch', '--list', 'worktree-two'), /worktree-two/)
    assert.ok(fs.readdirSync(path.join(main, '.git', 'switchboard-merged')).some(f => f.startsWith('one-')))
    sh(main, 'checkout', '--', 'a.txt')
  })

  it('undoes a worktree that breaks the checks and keeps it', async () => {
    const bad = add('bad')
    fs.writeFileSync(path.join(bad, 'bad.txt'), 'bad\n')
    const r = await mergeWorktrees(main, () => false, async d => fs.existsSync(path.join(d, 'bad.txt')) ? { ok: false, text: 'npm run test failed' } : { ok: true, text: 'ok' })
    assert.match(r.text, /Kept .*bad: npm run test failed, undone/)
    assert.ok(!fs.existsSync(path.join(main, 'bad.txt')))
    assert.ok(fs.existsSync(bad))
  })

  it('merges nothing when the checks already fail on main', async () => {
    const r = await mergeWorktrees(main, () => false, async () => ({ ok: false, text: 'pnpm run test failed' }))
    assert.equal(r.ok, false)
    assert.match(r.text, /already fail/)
  })

  it('keeps a worktree written to while its checks run, and copies ignored files of merged ones', async () => {
    const late = add('late'), ign = add('ign')
    fs.writeFileSync(path.join(late, 'l.txt'), 'l\n')
    fs.writeFileSync(path.join(ign, '.gitignore'), '*.local\nnode_modules/\n')
    fs.writeFileSync(path.join(ign, 'secrets.local'), 's\n')
    fs.mkdirSync(path.join(ign, 'node_modules')); fs.writeFileSync(path.join(ign, 'node_modules', 'x.js'), '')
    const r = await mergeWorktrees(main, () => false, async d => { if (d === main && fs.existsSync(path.join(main, 'l.txt'))) fs.writeFileSync(path.join(late, 'more.txt'), 'm\n'); return { ok: true, text: 'ok' } })
    assert.match(r.text, /late: it changed while merging, undone/)
    assert.ok(fs.existsSync(path.join(late, 'more.txt')) && !fs.existsSync(path.join(main, 'l.txt')))
    assert.ok(!fs.existsSync(ign))
    const saved = fs.readdirSync(path.join(main, '.git', 'switchboard-merged')).find(f => f.startsWith('ign-'))!
    assert.equal(fs.readFileSync(path.join(main, '.git', 'switchboard-merged', saved, 'ignored', 'secrets.local'), 'utf8'), 's\n')
    assert.ok(!fs.existsSync(path.join(main, '.git', 'switchboard-merged', saved, 'ignored', 'node_modules')))
    fs.rmSync(path.join(main, '.gitignore'), { force: true })
  })

  it('holds a lock another run touched recently, and counts a held Codex chat as live', async () => {
    fs.writeFileSync(path.join(main, '.git', 'switchboard-merge.lock'), 'other')
    assert.match((await mergeWorktrees(main, () => false, pass)).text, /already running/)
    fs.rmSync(path.join(main, '.git', 'switchboard-merge.lock'))
    const wt = path.join(main, '.claude', 'worktrees', 'late')
    assert.equal(liveIn([{ live: false, cwd: wt, sessionId: 'c' }], id => id === 'c')(wt), true)
    assert.equal(liveIn([{ live: false, cwd: wt, sessionId: 'c' }])(wt), false)
  })

  it('runs automatically after 15 quiet minutes, once per quiet spell in any window', () => {
    const m: MergeClock = { seen: new Set(), since: new Map(), fired: new Map() }
    const dirs = () => ['/r/.claude/worktrees/x']
    let ran = 0
    const due = (chats: { sessionId: string; cwd: string }[], now: number, d = dirs) => mergeDue(m, chats, ['/r'], now, d, () => ran)
    assert.deepEqual(due([{ sessionId: 'a', cwd: '/r' }], 1), [])
    assert.deepEqual(due([], QUIET_MS), [])
    // A new chat starts the clock over.
    assert.deepEqual(due([{ sessionId: 'b', cwd: '/r/sub' }], QUIET_MS), [])
    assert.deepEqual(due([], 2 * QUIET_MS), ['/r'])
    // Not again while it runs, even when a folder goes.
    assert.deepEqual(due([], 2 * QUIET_MS + 5000, () => ['/r/.claude/worktrees/y']), [])
    // Another window already ran it after this quiet spell began.
    const m2: MergeClock = { seen: new Set(), since: new Map(), fired: new Map() }
    mergeDue(m2, [], ['/r'], 0, dirs, () => 0)
    ran = 5
    assert.deepEqual(mergeDue(m2, [], ['/r'], 2 * QUIET_MS, dirs, () => ran), [])
    assert.deepEqual(mergeDue(m2, [], ['/r'], 3 * QUIET_MS, () => [], () => 0), [])
  })
})
