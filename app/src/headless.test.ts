import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { withSelf } from './hub-proxy'
import { chatSpawn, newChatHeadless } from './headless'
import { hub } from '../../extension/src/hub/hub-service'

const self = { port: 9, hubToken: 's', workspace: '/app', mtimeMs: 0 }

describe('withSelf', () => {
  it('adds the app itself only when no editor window is live', async () => {
    const ed = { port: 1, hubToken: 't', workspace: '/u', mtimeMs: 1, pid: process.pid }
    assert.deepEqual(await withSelf(async () => [], self)(), [self])
    assert.deepEqual(await withSelf(async () => [{ ...ed, pid: 2 ** 22 + 7 }], self)(), [{ ...ed, pid: 2 ** 22 + 7 }, self])
    assert.deepEqual(await withSelf(async () => [ed], self)(), [ed])
  })
})

describe('chatSpawn', { skip: process.platform === 'win32' && 'Windows starts chats in PowerShell' }, () => {
  it('starts a detached tmux session in the folder when tmux is there', () => {
    const s = chatSpawn('/u/my proj', 'claude --name x', '/opt/homebrew/bin/tmux', 'sb-my-proj')
    assert.equal(s.cmd, '/opt/homebrew/bin/tmux')
    assert.deepEqual(s.args.slice(0, 6), ['new-session', '-d', '-s', 'sb-my-proj', '-c', '/u/my proj'])
    assert.equal(s.args.at(-1), 'claude --name x')
  })
  it('else opens a Terminal window through do script, with no activate', () => {
    const s = chatSpawn('/u/a"b', `claude 'hi "there"'`, undefined, 'x')
    assert.equal(s.cmd, 'osascript')
    const script = s.args[1]
    assert.match(script, /^tell application "Terminal" to do script "/)
    assert.ok(!/activate/.test(script))
    assert.ok(script.includes(`'/u/a\\"b'`))
    assert.ok(script.includes(`\\"there\\"`))
  })
})

describe('newChatHeadless', () => {
  it('refuses a folder outside the project list and starts claude or codex in one inside it', () => {
    hub.set({ projects: [{ path: '/u/p', name: 'p', kind: 'repo' }] as never })
    const runs: { cmd: string; args: string[] }[] = []
    const run = (cmd: string, args: string[]) => { runs.push({ cmd, args }) }
    assert.match(String(newChatHeadless({ path: '/etc' }, run, undefined)), /not in the project list/)
    assert.equal(newChatHeadless({ path: '/u/p', text: 'fix it' }, run, '/t/tmux'), true)
    assert.equal(newChatHeadless({ path: '/u/p', ai: 'codex' }, run, '/t/tmux'), true)
    assert.match(runs[0].args.at(-1)!, /(^|; )claude .*'fix it'$/)
    assert.match(runs[1].args.at(-1)!, /(^|; )codex$/)
    assert.match(String(newChatHeadless({ path: '/u/p', ai: 'hermes' }, run, '/t/tmux')), /editor/)
  })
})
