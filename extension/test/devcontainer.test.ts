import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { containerPrefix, defaultConfigFile, hasOwnConfig, riskyKeys, CONTAINER_SETTINGS } from '../src/hub/devcontainer'
import { newChatCommand } from '../src/hub/projects'
import { commandProblem } from '../src/hub/routes'

describe('devcontainer chats', () => {
  const p = containerPrefix({ repo: '/r/app', cwd: '/r/app/.claude/worktrees/x', home: '/h', data: '/h/box', exists: () => true })

  const posix = { skip: process.platform === 'win32' && 'container chats run a POSIX sh command' }

  it('mounts the repo, the login folder and only this chat folder transcripts', posix, () => {
    assert.match(p, /--mount 'type=bind,source=\/r\/app,target=\/r\/app'/)
    assert.match(p, /--mount 'type=bind,source=\/h\/box,target=\/sb-claude'/)
    assert.match(p, /source=\/h\/\.claude\/projects\/-r-app--claude-worktrees-x,target=\/sb-claude\/projects\/-r-app--claude-worktrees-x'/)
    assert.doesNotMatch(p, /source=\/h\/\.claude\/projects,/)
  })

  it('gives the container copies of the git hooks and config, never the real ones', posix, () => {
    assert.match(p, /cp '\/r\/app\/\.git\/config' '\/h\/\.claude\/switchboard\/container-git\/-r-app\/config'/)
    assert.match(p, /source=\/h\/\.claude\/switchboard\/container-git\/-r-app\/hooks,target=\/r\/app\/\.git\/hooks'/)
    assert.match(p, /source=\/h\/\.claude\/switchboard\/container-git\/-r-app\/config,target=\/r\/app\/\.git\/config'/)
    assert.doesNotMatch(containerPrefix({ repo: '/r', cwd: '/r', home: '/h', exists: () => false }), /container-git/)
  })

  it('refuses the home folder, its parents and paths with a comma, and keeps spaces exact', () => {
    assert.throws(() => containerPrefix({ repo: '/h', cwd: '/h', home: '/h' }), /home folder/)
    assert.throws(() => containerPrefix({ repo: '/', cwd: '/', home: '/h' }), /home folder/)
    if (process.platform === 'darwin') assert.throws(() => containerPrefix({ repo: '/Users/K', cwd: '/Users/K', home: '/users/k' }), /home folder/)
    assert.throws(() => containerPrefix({ repo: '/h/a,b', cwd: '/h/a,b', home: '/h' }), /comma/)
    assert.match(containerPrefix({ repo: "/h/a  b'c", cwd: "/h/a  b'c", home: '/h', exists: () => false }), /sh '\/h\/a  b'\\''c' $/)
  })

  it('keys the container by chat folder and runs claude at the same path', () => {
    assert.match(p, /--id-label 'switchboard\.dir=\/r\/app\/\.claude\/worktrees\/x'/)
    assert.match(p, /--remote-env CLAUDE_CONFIG_DIR=\/sb-claude/)
    assert.ok(p.endsWith("sh '/r/app/.claude/worktrees/x' "))
    assert.doesNotMatch(p, /--override-config/)
    assert.match(containerPrefix({ repo: '/r', cwd: '/r', home: '/h', override: '/h/box/devcontainer.json' }), /--override-config '\/h\/box\/devcontainer\.json'/)
  })

  it('writes no lockfile into the repo for its own config, keeps a repo lockfile, and lets git run on the mounted repo', () => {
    assert.match(containerPrefix({ repo: '/r', cwd: '/r', home: '/h', override: '/h/box/devcontainer.json' }), / up --no-lockfile --workspace-folder /)
    assert.doesNotMatch(p, /--no-lockfile/)
    assert.match(p, /--remote-env GIT_CONFIG_COUNT=1 --remote-env GIT_CONFIG_KEY_0=safe\.directory --remote-env 'GIT_CONFIG_VALUE_0=\*'/)
  })

  it('puts the prefix in front of claude, after a branch switch', () => {
    const c = newChatCommand({ text: 'hi', branch: 'b', prefix: 'X ', settings: CONTAINER_SETTINGS }, 'posix')
    assert.match(c, /^git switch -c 'b' && X claude --settings /)
    assert.equal(newChatCommand({ text: 'hi' }, 'posix'), "claude 'hi'")
  })

  it('accepts container on hub-new-chat', () => {
    assert.equal(commandProblem({ type: 'hub-new-chat', path: '/x', remote: false, container: true }), undefined)
    assert.match(commandProblem({ type: 'hub-new-chat', path: '/x', remote: false, container: 'y' }) ?? '', /container/)
  })

  it('finds a repo config and writes the default one outside the repo', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-dc-'))
    try {
      assert.equal(hasOwnConfig(d), false)
      fs.mkdirSync(path.join(d, '.devcontainer'))
      fs.writeFileSync(path.join(d, '.devcontainer', 'devcontainer.json'), '{}')
      assert.equal(hasOwnConfig(d), true)
      assert.deepEqual(riskyKeys(d), [])
      fs.writeFileSync(path.join(d, '.devcontainer', 'devcontainer.json'), '{ // host hook\n  "initializeCommand": "touch /tmp/x", "runArgs": ["--privileged"], "image": "x" }')
      assert.deepEqual(riskyKeys(d), ['initializeCommand', 'runArgs'])
      const f = defaultConfigFile(path.join(d, 'box'))
      assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).remoteUser, 'node')
    } finally { fs.rmSync(d, { recursive: true, force: true }) }
  })
})
