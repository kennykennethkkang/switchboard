/**
 * The finished chat's git card: lanes, outgoing numstat and the one Commit & push press,
 * against temp clones of a bare remote.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { agentPath, cleanMessage, gitOp, parseCommits, parseNumstat, readRepo } from '../src/hub/git'

describe('card parsing', () => {
  it('reads numstat -z rows, renames and binaries', () => {
    const out = '3\t1\tsrc/a.ts\0' + '0\t2\t\0old.ts\0new.ts\0' + '-\t-\tlogo.png\0'
    assert.deepEqual(parseNumstat(out), [
      { path: 'src/a.ts', added: 3, removed: 1 },
      { path: 'new.ts', added: 0, removed: 2 },
      { path: 'logo.png', added: 0, removed: 0 },
    ])
    assert.deepEqual(parseNumstat(''), [])
  })

  it('reads the subject and the lane of a left-right log row', () => {
    const row = (m: string, s: string) => ['abc1234', 'Lena', 'l@x', '100', m, s].join('\0')
    assert.deepEqual(parseCommits([row('>', 'Mine'), row('<', 'Theirs'), row('-', 'Fork')].join('\n'), ''), [
      { hash: 'abc1234', author: 'Lena', at: 100_000, subject: 'Mine', side: 'head' },
      { hash: 'abc1234', author: 'Lena', at: 100_000, subject: 'Theirs', side: 'base' },
      { hash: 'abc1234', author: 'Lena', at: 100_000, subject: 'Fork', side: 'fork' },
    ])
  })

  it('keeps agent files out', () => {
    for (const p of ['.claude/settings.json', 'CLAUDE.md', 'CLAUDE.local.md', 'app/.mcp.json', 'web/AGENTS.md', 'docs/superpowers/plan.md', '.superpowers/x', '.playwright-mcp/a.png', 'skills-lock.json'])
      assert.equal(agentPath(p), true, p)
    for (const p of ['src/claude.ts', 'docs/design.md', 'README.md', 'my.claude/x']) assert.equal(agentPath(p), false, p)
  })

  it('strips attribution trailers from the message', () => {
    assert.equal(cleanMessage('- one\n- two\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://x\n'), '- one\n- two')
    assert.equal(cleanMessage('- keep co-authored-by in prose'), '- keep co-authored-by in prose')
  })
})

describe('card on temp clones', () => {
  const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  let root = '', a = '', b = ''
  const remote = (...args: string[]) => sh(root, '--git-dir=remote.git', ...args)
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ship-'))
    sh(root, 'init', '--bare', '-q', '-b', 'main', 'remote.git')
    for (const name of ['a', 'b']) {
      sh(root, 'clone', '-q', 'remote.git', name)
      const dir = path.join(root, name)
      sh(dir, 'config', 'user.email', 't@t'); sh(dir, 'config', 'user.name', 'T'); sh(dir, 'config', 'commit.gpgsign', 'false')
    }
    a = path.join(root, 'a'); b = path.join(root, 'b')
    fs.writeFileSync(path.join(a, 'one.txt'), '1\n2\n3\n')
    sh(a, 'add', '.'); sh(a, 'commit', '-qm', 'init'); sh(a, 'push', '-q', '-u', 'origin', 'main')
    sh(b, 'pull', '-q', 'origin', 'main'); sh(b, 'branch', '-q', '--set-upstream-to=origin/main')
  })
  after(() => fs.rmSync(root, { recursive: true, force: true }))

  it('shows local commits on main against origin, with their line counts', async () => {
    fs.writeFileSync(path.join(a, 'one.txt'), '1\n2\nthree\nfour\n')
    sh(a, 'commit', '-qam', 'Local work')
    const r = await readRepo(a)
    assert.equal(r.ahead, 1)
    assert.equal(r.behind, 0)
    assert.equal(r.lanes?.against, 'origin/main')
    assert.deepEqual(r.lanes?.commits.map(c => [c.subject, c.side, c.author]), [['Local work', 'head', 'You']])
    assert.equal(r.lanes?.fork?.subject, 'init')
    assert.deepEqual(r.outgoing, [{ path: 'one.txt', added: 2, removed: 1 }])
  })

  it('commits everything but agent files, strips the trailer and publishes a new branch', async () => {
    sh(a, 'switch', '-q', '-c', 'feat/card')
    fs.writeFileSync(path.join(a, 'new.txt'), 'n\n')
    fs.writeFileSync(path.join(a, 'CLAUDE.md'), 'rules\n')
    fs.mkdirSync(path.join(a, '.claude')); fs.writeFileSync(path.join(a, '.claude', 's.json'), '{}\n')
    fs.writeFileSync(path.join(a, 'hidden.txt'), 'h\n')
    fs.appendFileSync(path.join(a, '.git', 'info', 'exclude'), 'hidden.txt\n')
    const summary = 'Add the card', description = '- new file\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
    assert.match((await gitOp(a, { op: 'ship', summary, description })).text, /confirm/i)
    const plan = (await readRepo(a)).ship
    assert.deepEqual(plan, { files: ['new.txt'], kept: ['.claude/s.json', 'CLAUDE.md'] })
    const r = await gitOp(a, { op: 'ship', summary, description, files: plan!.files, confirmed: true })
    assert.equal(r.ok, true, r.text)
    assert.match(r.text, /pushed to origin\/feat\/card/)
    assert.match(r.text, /left out .*CLAUDE\.md/)
    assert.equal(remote('log', '-1', '--format=%B', 'feat/card').trim(), 'Add the card\n\n- new file')
    assert.deepEqual(remote('show', '--name-only', '--format=', 'feat/card').split('\n').sort(), ['new.txt'])
    assert.equal(sh(a, 'rev-parse', '--abbrev-ref', '@{u}'), 'origin/feat/card')
    const left = (await readRepo(a)).files.map(f => f.path).sort()
    assert.deepEqual(left, ['.claude/s.json', 'CLAUDE.md'])
    sh(a, 'switch', '-q', 'main')
  })

  it('reads lanes against main from a branch, and the files that would conflict', async () => {
    sh(b, 'pull', '-q')
    fs.writeFileSync(path.join(b, 'one.txt'), '1\n2\nTHREE\n')
    sh(b, 'commit', '-qam', 'Theirs'); sh(b, 'push', '-q')
    sh(a, 'switch', '-q', 'feat/card')
    sh(a, 'fetch', '-q')
    const r = await readRepo(a)
    assert.equal(r.merge?.base, 'main')
    assert.equal(r.merge?.behind, 1)
    assert.deepEqual(r.merge?.conflicts?.map(c => c.path), ['one.txt'])
    assert.equal(r.lanes?.against, 'origin/main')
    assert.deepEqual(r.lanes?.commits.map(c => [c.subject, c.side]), [['Theirs', 'base'], ['Add the card', 'head'], ['Local work', 'head']])
    sh(a, 'switch', '-q', 'main')
  })

  it('says Pull first and pushes nothing while behind the upstream', async () => {
    fs.writeFileSync(path.join(a, 'more.txt'), 'm\n')
    const before = remote('rev-parse', 'main'), head = sh(a, 'rev-parse', 'HEAD')
    const r = await gitOp(a, { op: 'ship', summary: 'More', files: (await readRepo(a)).ship?.files, confirmed: true })
    assert.equal(r.ok, false)
    assert.match(r.text, /^Pull first/)
    assert.equal(remote('rev-parse', 'main'), before)
    assert.equal(sh(a, 'rev-parse', 'HEAD'), head)
  })
})

describe('ship edge cases, one fresh clone each', () => {
  const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  let base = ''
  before(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ship-edge-')) })
  after(() => fs.rmSync(base, { recursive: true, force: true }))
  const put = (d: string, p: string, t = 'x\n') => { fs.mkdirSync(path.dirname(path.join(d, p)), { recursive: true }); fs.writeFileSync(path.join(d, p), t) }
  // A clone of a new bare remote with keep.txt, old.txt, CLAUDE.md and secret.env pushed to main.
  const fresh = (name: string, remote = true) => {
    const d = path.join(base, name)
    if (remote) { sh(base, 'init', '--bare', '-q', '-b', 'main', `${name}.git`); sh(base, 'clone', '-q', `${name}.git`, name) } else { fs.mkdirSync(d); sh(d, 'init', '-q', '-b', 'main') }
    sh(d, 'config', 'user.email', 't@t'); sh(d, 'config', 'user.name', 'T'); sh(d, 'config', 'commit.gpgsign', 'false')
    put(d, 'keep.txt'); put(d, 'old.txt', 'o\n'); put(d, 'CLAUDE.md'); put(d, 'secret.env', 'KEY=1\n')
    sh(d, 'add', '.'); sh(d, 'commit', '-qm', 'init')
    if (remote) sh(d, 'push', '-q', '-u', 'origin', 'main')
    return d
  }
  const bare = (name: string, ...args: string[]) => sh(base, `--git-dir=${name}.git`, ...args)
  const ship = async (d: string, extra: Partial<Parameters<typeof gitOp>[1]> = {}) =>
    gitOp(d, { op: 'ship', summary: 'Ship it', files: (await readRepo(d)).ship?.files, confirmed: true, ...extra })

  it('ships a staged rename', async () => {
    const d = fresh('rename')
    sh(d, 'mv', 'old.txt', 'new.txt')
    const r = await ship(d)
    assert.equal(r.ok, true, r.text)
    assert.deepEqual(bare('rename', 'ls-tree', '-r', '--name-only', 'main').split('\n').sort(), ['CLAUDE.md', 'keep.txt', 'new.txt', 'secret.env'])
  })

  it('commits a staged rename from the Git panel too', async () => {
    const d = fresh('rename-panel')
    sh(d, 'mv', 'old.txt', 'new.txt')
    const c = await gitOp(d, { op: 'commit', summary: 'Rename', files: ['new.txt'] })
    assert.equal(c.ok, true, c.text)
    assert.equal(sh(d, 'show', '--name-status', '--format=', 'HEAD'), 'R100\told.txt\tnew.txt')
    sh(d, 'mv', 'new.txt', 'newer.txt')
    const p = await gitOp(d, { op: 'commit-push', summary: 'Again', files: ['newer.txt'], confirmed: true })
    assert.equal(p.ok, true, p.text)
    assert.equal(bare('rename-panel', 'show', '--name-status', '--format=', 'main'), 'R100\tnew.txt\tnewer.txt')
  })

  it('refuses while the branch would conflict with main', async () => {
    const d = fresh('conflict')
    sh(d, 'switch', '-q', '-c', 'feat/l'); sh(d, 'push', '-q', '-u', 'origin', 'feat/l')
    put(d, 'keep.txt', 'mine\n'); sh(d, 'commit', '-qam', 'mine')
    sh(d, 'switch', '-q', 'main'); put(d, 'keep.txt', 'theirs\n'); sh(d, 'commit', '-qam', 'theirs'); sh(d, 'push', '-q'); sh(d, 'switch', '-q', 'feat/l')
    const before = bare('conflict', 'rev-parse', 'feat/l')
    const r = await ship(d)
    assert.equal(r.ok, false)
    assert.match(r.text, /^Merge main first/)
    assert.equal(bare('conflict', 'rev-parse', 'feat/l'), before)
  })

  it('keeps a rename out when either side is an agent file, and says it plainly', async () => {
    const d = fresh('agent-rename')
    sh(d, 'mv', 'CLAUDE.md', 'notes.md')
    const plan = (await readRepo(d)).ship
    assert.deepEqual(plan, { files: [], kept: ['CLAUDE.md → notes.md'] })
    const r = await ship(d)
    assert.equal(r.ok, false)
    assert.equal(r.text, 'Only agent files changed (CLAUDE.md → notes.md), so nothing was committed')
  })

  it('ships the other files but neither side of an agent rename', async () => {
    const d = fresh('agent-rename-mixed')
    sh(d, 'mv', 'CLAUDE.md', 'notes.md'); put(d, 'n.txt')
    const r = await ship(d)
    assert.equal(r.ok, true, r.text)
    assert.deepEqual(bare('agent-rename-mixed', 'ls-tree', '-r', '--name-only', 'main').split('\n').sort(), ['CLAUDE.md', 'keep.txt', 'n.txt', 'old.txt', 'secret.env'])
  })

  it('commits nothing without a remote, or with one it cannot reach', async () => {
    const d = fresh('no-remote', false)
    put(d, 'n.txt')
    const head = sh(d, 'rev-parse', 'HEAD')
    const r = await ship(d)
    assert.equal(r.ok, false)
    assert.match(r.text, /no remote named origin/i)
    assert.equal(sh(d, 'rev-parse', 'HEAD'), head)
    sh(d, 'remote', 'add', 'origin', path.join(base, 'missing.git'))
    const u = await ship(d)
    assert.equal(u.ok, false)
    assert.match(u.text, /can't reach origin/i)
    assert.equal(sh(d, 'rev-parse', 'HEAD'), head)
  })

  it('says Pull first when the remote moved since the last fetch', async () => {
    const d = fresh('stale')
    sh(base, 'clone', '-q', 'stale.git', 'stale2')
    const d2 = path.join(base, 'stale2')
    sh(d2, 'config', 'user.email', 't@t'); sh(d2, 'config', 'user.name', 'T'); put(d2, 'z.txt'); sh(d2, 'add', '.'); sh(d2, 'commit', '-qm', 'z'); sh(d2, 'push', '-q')
    put(d, 'n.txt')
    const head = sh(d, 'rev-parse', 'HEAD')
    const r = await ship(d)
    assert.equal(r.ok, false)
    assert.match(r.text, /^Pull first/)
    assert.equal(sh(d, 'rev-parse', 'HEAD'), head)
  })

  it('leaves a file untracked with rm --cached, and counts it once', async () => {
    const d = fresh('untrack')
    sh(d, 'rm', '-q', '--cached', 'secret.env'); put(d, 'n.txt')
    const plan = (await readRepo(d)).ship
    assert.deepEqual(plan?.files.sort(), ['n.txt', 'secret.env'])
    const r = await ship(d)
    assert.equal(r.ok, true, r.text)
    assert.match(r.text, /Committed 2 files/)
    assert.deepEqual(bare('untrack', 'ls-tree', '-r', '--name-only', 'main').split('\n').sort(), ['CLAUDE.md', 'keep.txt', 'n.txt', 'old.txt'])
    assert.ok(fs.existsSync(path.join(d, 'secret.env')))
  })

  it('pushes a branch tracking origin/main to its own name, never to main', async () => {
    const d = fresh('track')
    sh(d, 'switch', '-q', '-c', 'feat/k', '--track', 'origin/main'); put(d, 'n.txt')
    const main = bare('track', 'rev-parse', 'main')
    const r = await ship(d)
    assert.equal(r.ok, true, r.text)
    assert.match(r.text, /pushed to origin\/feat\/k/)
    assert.equal(bare('track', 'rev-parse', 'main'), main)
    assert.equal(sh(d, 'rev-parse', '--abbrev-ref', '@{u}'), 'origin/feat/k')
  })

  it('refuses when the files changed since the confirm', async () => {
    const d = fresh('changed')
    put(d, 'n.txt')
    const files = (await readRepo(d)).ship?.files
    put(d, 'late.txt')
    const head = sh(d, 'rev-parse', 'HEAD')
    const r = await gitOp(d, { op: 'ship', summary: 'Ship it', files, confirmed: true })
    assert.equal(r.ok, false)
    assert.equal(r.text, 'Changed since you confirmed; review again')
    assert.equal(sh(d, 'rev-parse', 'HEAD'), head)
    assert.equal((await gitOp(d, { op: 'ship', summary: 'Ship it', confirmed: true })).text, 'Changed since you confirmed; review again')
  })
})
