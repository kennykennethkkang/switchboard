import { it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFile as realExecFile, execFileSync } from 'child_process'
import { gitOp, readRepo, repoReadKey, repoRoot, setAutoMerge, setGitRunner, setRepoClock } from '../src/hub/git'
import { todoRefFromFiles } from '../src/hub/todo'
import { dropPending, fillRepos } from '../src/hub/progress'

it('reuses unchanged repo reads and refreshes on worktree and git metadata changes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-cache-'))
  const run = (args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  try {
    run(['init', '-b', 'main'])
    run(['config', 'user.email', 'test@example.com'])
    run(['config', 'user.name', 'Test'])
    fs.writeFileSync(path.join(root, 'file.txt'), 'one')
    run(['add', 'file.txt']); run(['commit', '-m', 'initial'])
    let count = 0
    setGitRunner(((file: string, args: string[], options: import('child_process').ExecFileOptions, callback: (err: import('child_process').ExecFileException | null, stdout: string | Buffer, stderr: string | Buffer) => void) => {
      count++
      return realExecFile(file, args, options, callback)
    }) as never)
    const first = await readRepo(root)
    assert.ok(count > 1)
    count = 0
    const second = await readRepo(root)
    assert.equal(count, 1)
    assert.deepEqual(second.files, first.files)
    const firstKey = repoReadKey(root)
    await readRepo(root)
    assert.equal(repoReadKey(root), firstKey)
    setRepoClock(() => Date.now() + 60_001)
    count = 0
    await readRepo(root)
    assert.ok(count > 1, 'a full read expires after a minute')
    setRepoClock()
    fs.writeFileSync(path.join(root, 'file.txt'), 'two')
    count = 0
    assert.deepEqual((await readRepo(root)).files, [{ path: 'file.txt', status: 'modified' }])
    assert.ok(count > 1)
    assert.notEqual(repoReadKey(root), firstKey)
    run(['add', 'file.txt'])
    count = 0
    await readRepo(root)
    assert.ok(count > 1, 'stage refreshes the view')
    run(['branch', 'unseen'])
    count = 0
    await readRepo(root)
    assert.ok(count > 1, 'a new local branch refreshes the view')
    count = 0
    const commit = await gitOp(root, { op: 'commit', files: ['file.txt'], summary: 'second' })
    assert.equal(commit.ok, true, commit.text)
    count = 0
    await readRepo(root)
    assert.ok(count > 1, 'Switchboard commit invalidates the view')
    run(['switch', '-c', 'feature'])
    count = 0
    assert.equal((await readRepo(root)).branch, 'feature')
    assert.ok(count > 1, 'branch switch refreshes the view')
    fs.writeFileSync(path.join(root, 'stash.txt'), 'stash')
    run(['stash', 'push', '-u', '-m', 'test'])
    count = 0
    await readRepo(root)
    assert.ok(count > 1, 'stash refreshes the view')
    const remote = path.join(os.tmpdir(), `repo-cache-remote-${process.pid}`)
    try {
      execFileSync('git', ['init', '--bare', remote], { encoding: 'utf8' })
      run(['remote', 'add', 'origin', remote])
      run(['push', '-u', 'origin', 'feature'])
      run(['fetch', 'origin'])
      count = 0
      await readRepo(root)
      assert.ok(count > 1, 'fetch refreshes the view')
    } finally { fs.rmSync(remote, { recursive: true, force: true }) }
  } finally {
    setGitRunner(undefined)
    setRepoClock()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

it('refreshes pending text on a cached read and drops it when cleared', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-pending-'))
  const run = (args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  try {
    run(['init', '-b', 'main'])
    run(['config', 'user.email', 'test@example.com'])
    run(['config', 'user.name', 'Test'])
    fs.writeFileSync(path.join(root, 'file.txt'), 'one')
    run(['add', 'file.txt']); run(['commit', '-m', 'initial'])
    const boxes = new Map(), filled = new Set<string>()
    fillRepos([{ rootUri: { fsPath: root }, inputBox: { value: '' } }], { sessionId: 's', cwd: root, state: 'done', commit: 'Pending title', commits: undefined }, boxes, filled)
    let count = 0
    setGitRunner(((file: string, args: string[], options: import('child_process').ExecFileOptions, callback: (err: import('child_process').ExecFileException | null, stdout: string | Buffer, stderr: string | Buffer) => void) => {
      count++
      return realExecFile(file, args, options, callback)
    }) as never)
    count = 0
    assert.equal((await readRepo(root)).pending?.text, 'Pending title')
    dropPending(root)
    count = 0
    assert.equal((await readRepo(root)).pending, undefined)
    assert.equal(count, 1)
  } finally { setGitRunner(undefined); fs.rmSync(root, { recursive: true, force: true }) }
})

it('rechecks a cached root when a nested folder becomes a repository', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-root-'))
  const child = path.join(root, 'child')
  fs.mkdirSync(child)
  const run = (cwd: string, args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  try {
    run(root, ['init', '-b', 'main'])
    assert.equal(await repoRoot(child), fs.realpathSync(root))
    run(child, ['init', '-b', 'nested'])
    assert.equal(await repoRoot(child), fs.realpathSync(child))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

it('reads the todo ref from loose and packed refs in the shared worktree git dir', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-ref-'))
  const run = (cwd: string, args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  try {
    run(root, ['init', '-b', 'main'])
    run(root, ['config', 'user.email', 'test@example.com'])
    run(root, ['config', 'user.name', 'Test'])
    fs.writeFileSync(path.join(root, 'file.txt'), 'one')
    run(root, ['add', 'file.txt']); run(root, ['commit', '-m', 'initial'])
    const head = run(root, ['rev-parse', 'HEAD']).trim()
    run(root, ['update-ref', 'refs/switchboard/todo', head])
    assert.equal(todoRefFromFiles(root), head)
    run(root, ['pack-refs', '--all', '--prune'])
    assert.equal(todoRefFromFiles(root), head)
    const wt = path.join(root, 'worktree')
    run(root, ['worktree', 'add', '-b', 'other', wt])
    assert.equal(todoRefFromFiles(wt), head)
    await readRepo(wt)
    setAutoMerge(root, false)
    assert.equal((await readRepo(wt)).auto, false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
