/** The git guard: chats can't commit or push, Kenneth and the buttons can. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawnSync } from 'child_process'
import { GUARD_MARK, installGuard } from '../src/hub/git-guard'
import { gitEnv } from '../src/hub/git'

// No chat markers, so the setup commits below aren't refused themselves.
const clean = () => {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'SWITCHBOARD_CHAT', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k]
  return env
}
const git = (cwd: string, args: string[], extra: Record<string, string> = {}) => spawnSync('git', args, { cwd, env: { ...clean(), ...extra }, encoding: 'utf8' })
const repo = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-guard-'))
  git(dir, ['init', '-q'])
  return dir
}
const commit = (dir: string, extra: Record<string, string> = {}) => {
  fs.writeFileSync(path.join(dir, 'f'), String(Math.random()))
  git(dir, ['add', 'f'])
  return git(dir, ['commit', '-qm', 'x'], extra)
}
const hook = (dir: string, name: string) => path.join(dir, '.git', 'hooks', name)

describe('installGuard', () => {
  it('refuses a commit from a chat, allows one without the markers', async () => {
    const dir = repo()
    try {
      assert.equal(fs.realpathSync.native(await installGuard(dir) ?? ''), fs.realpathSync.native(path.join(dir, '.git', 'hooks')))
      for (const k of ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'SWITCHBOARD_CHAT']) {
        const r = commit(dir, { [k]: '1' })
        assert.notEqual(r.status, 0, k)
        assert.match(r.stderr, /Refused: Kenneth commits and pushes himself/)
      }
      assert.equal(commit(dir).status, 0)
      assert.equal(fs.statSync(hook(dir, 'pre-push')).mode & 0o777, 0o755)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('refuses a push from a chat', async () => {
    const dir = repo(), bare = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-bare-'))
    try {
      git(bare, ['init', '-q', '--bare'])
      assert.equal(commit(dir).status, 0)
      await installGuard(dir)
      assert.notEqual(git(dir, ['push', '-q', bare, 'HEAD:main'], { SWITCHBOARD_CHAT: '1' }).status, 0)
      assert.equal(git(dir, ['push', '-q', bare, 'HEAD:main']).status, 0)
    } finally { for (const d of [dir, bare]) fs.rmSync(d, { recursive: true, force: true }) }
  })

  it('leaves a foreign hook alone, and is idempotent on its own', async () => {
    const dir = repo()
    try {
      fs.writeFileSync(hook(dir, 'pre-commit'), '#!/bin/sh\nexit 0\n')
      await installGuard(dir)
      assert.equal(fs.readFileSync(hook(dir, 'pre-commit'), 'utf8'), '#!/bin/sh\nexit 0\n')
      const first = fs.readFileSync(hook(dir, 'pre-push'), 'utf8')
      assert.ok(first.includes(GUARD_MARK))
      fs.writeFileSync(hook(dir, 'pre-push'), `#!/bin/sh\n${GUARD_MARK}\nold\n`)
      await installGuard(dir)
      await installGuard(dir)
      assert.equal(fs.readFileSync(hook(dir, 'pre-push'), 'utf8'), first)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('skips a repo with core.hooksPath, and a folder that is not a repo', async () => {
    const dir = repo(), plain = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-plain-'))
    try {
      git(dir, ['config', 'core.hooksPath', '.husky'])
      assert.equal(await installGuard(dir), undefined)
      assert.ok(!fs.existsSync(hook(dir, 'pre-commit')))
      assert.equal(await installGuard(plain), undefined)
    } finally { for (const d of [dir, plain]) fs.rmSync(d, { recursive: true, force: true }) }
  })

  it('installs into the main repo for a worktree', async () => {
    const dir = repo(), wt = path.join(os.tmpdir(), `sb-wt-${process.pid}`)
    try {
      assert.equal(commit(dir).status, 0)
      git(dir, ['worktree', 'add', '-q', wt])
      assert.equal(fs.realpathSync.native(await installGuard(wt) ?? ''), fs.realpathSync.native(path.join(dir, '.git', 'hooks')))
      assert.notEqual(commit(wt, { CLAUDECODE: '1' }).status, 0)
    } finally { for (const d of [dir, wt]) fs.rmSync(d, { recursive: true, force: true }) }
  })
})

describe('installGuard and symlinks', () => {
  it('leaves a dangling hook symlink alone instead of writing through it', async () => {
    const dir = repo()
    try {
      fs.mkdirSync(path.join(dir, 'tools'))
      fs.symlinkSync('../../tools/pre-commit', hook(dir, 'pre-commit'))
      await installGuard(dir)
      assert.ok(!fs.existsSync(path.join(dir, 'tools', 'pre-commit')))
      assert.ok(fs.lstatSync(hook(dir, 'pre-commit')).isSymbolicLink())
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('gitEnv', () => {
  it('drops chat markers so the buttons work in a window opened from a chat', () => {
    const env = gitEnv({ PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's', SWITCHBOARD_CHAT: '1' })
    assert.equal(env.PATH, '/bin')
    for (const k of ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'SWITCHBOARD_CHAT']) assert.equal(env[k], undefined)
    assert.equal(env.GIT_TERMINAL_PROMPT, '0')
  })
})
