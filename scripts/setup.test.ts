import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawn } from 'child_process'
import * as http from 'http'
import { CODEX_HOOK_EVENTS, getHookScriptContent, configureCodexHooks, configureHooks, isSwitchboardHook, isAlreadySetup, raiseHookTimeouts, removeAppHooks } from './setup'

const HOOK_CMD = '"/usr/bin/node" "/home/u/.claude/switchboard-app/hook.js"'
const OLD_CMD = '"/usr/bin/node" "/home/u/.claude/agent-flow/hook.js"'

function tmpSettings(content?: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-setup-'))
  const file = path.join(dir, '.claude', 'settings.json')
  if (content !== undefined) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
  }
  return file
}

function read(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

function quietly<T>(fn: () => T): T {
  const { log, error } = console
  console.log = () => {}
  console.error = () => {}
  try { return fn() } finally { console.log = log; console.error = error }
}

const foreignHttp = { hooks: [{ type: 'http', url: 'http://127.0.0.1:19847/hook/9207692e/session-start' }] }
const foreignCommand = { hooks: [{ type: 'command', command: 'other-tool notify' }] }

test('isSwitchboardHook matches only our own hooks', () => {
  assert.equal(isSwitchboardHook({ hooks: [{ command: HOOK_CMD }] }), true)
  assert.equal(isSwitchboardHook({ hooks: [{ command: OLD_CMD }] }), true, 'written before the rename')
  assert.equal(isSwitchboardHook({ hooks: [{ command: '"node" "/home/u/.claude/switchboard/hook.js"' }] }), false, 'the extension hook')
  assert.equal(isSwitchboardHook({ hooks: [{ command: '"C:\\node.exe" "C:\\Users\\u\\.claude\\agent-flow\\hook.js"' }] }), true)
  assert.equal(isSwitchboardHook({ hooks: [{ type: 'http', url: 'http://127.0.0.1:52341' }] }), true)
  assert.equal(isSwitchboardHook({ hooks: [{ type: 'http', url: 'http://127.0.0.1:52341/' }] }), true)
  assert.equal(isSwitchboardHook(foreignHttp), false)
  assert.equal(isSwitchboardHook({ hooks: [{ type: 'http', url: 'http://127.0.0.1:8080/hooks' }] }), false)
  assert.equal(isSwitchboardHook(foreignCommand), false)
  assert.equal(isSwitchboardHook({}), false)
})

test("configureHooks keeps other tools' loopback HTTP hooks (#73)", () => {
  const file = tmpSettings({ hooks: { SessionStart: [foreignHttp], Stop: [foreignHttp, foreignCommand] } })
  assert.equal(quietly(() => configureHooks(file, HOOK_CMD)), true)

  const { hooks } = read(file)
  assert.deepEqual(hooks.SessionStart[0], foreignHttp)
  assert.deepEqual(hooks.Stop.slice(0, 2), [foreignHttp, foreignCommand])
  for (const event of ['SessionStart', 'PreToolUse', 'Stop', 'SessionEnd']) {
    assert.equal(hooks[event].filter(isSwitchboardHook).length, 1, event)
  }
})

test('configureHooks replaces hooks from before the rename instead of duplicating them', () => {
  const legacy = { hooks: [{ type: 'http', url: 'http://127.0.0.1:52341' }] }
  const old = { hooks: [{ type: 'command', command: '"/old/node" "/home/u/.claude/agent-flow/hook.js"', timeout: 2 }] }
  const file = tmpSettings({ hooks: { PreToolUse: [legacy, old, foreignCommand] } })
  quietly(() => configureHooks(file, HOOK_CMD))
  quietly(() => configureHooks(file, HOOK_CMD))

  const { hooks } = read(file)
  assert.deepEqual(hooks.PreToolUse, [
    foreignCommand,
    { hooks: [{ type: 'command', command: HOOK_CMD, timeout: 10 }] },
  ])
})

test('raiseHookTimeouts raises our old entries only, once', () => {
  const ext = { hooks: [{ type: 'command', command: '"node" "/home/u/.claude/switchboard/hook.js"', timeout: 2 }] }
  const other = { hooks: [{ type: 'command', command: 'other-tool notify', timeout: 2 }] }
  const ours = (timeout: number) => ({ hooks: [{ type: 'command', command: HOOK_CMD, timeout }] })
  const file = tmpSettings({ model: 'opus', hooks: { Stop: [ext, other, ours(2)], PreToolUse: [ours(30)] } })
  assert.equal(raiseHookTimeouts(file), true)
  assert.deepEqual(read(file), { model: 'opus', hooks: { Stop: [ext, other, ours(10)], PreToolUse: [ours(30)] } })
  assert.equal(raiseHookTimeouts(file), false)
  const broken = tmpSettings('{oops')
  assert.equal(raiseHookTimeouts(broken), false)
  assert.equal(fs.readFileSync(broken, 'utf-8'), '{oops')
})

test('removeAppHooks keeps user hooks and the matcher inside a mixed entry', () => {
  const mixed = { matcher: 'Bash', hooks: [
    { type: 'command', command: HOOK_CMD },
    { type: 'command', command: 'notify-user' },
  ] }
  const file = tmpSettings({ hooks: { PreToolUse: [mixed, foreignCommand] } })
  assert.equal(removeAppHooks(file), true)
  assert.deepEqual(read(file).hooks, { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'notify-user' }] }, foreignCommand] })
  assert.equal(removeAppHooks(file), false)
})

test('running setup again on an existing install raises its timeout', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-setup-again-'))
  const file = path.join(home, '.claude', 'settings.json')
  const script = path.join(home, '.claude', 'switchboard-app', 'hook.js')
  fs.mkdirSync(path.dirname(script), { recursive: true })
  fs.writeFileSync(script, '')
  fs.writeFileSync(file, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: HOOK_CMD, timeout: 2 }] }] } }))
  try {
    const child = spawn(process.execPath, [path.join(__dirname, 'setup.js')], { env: { ...process.env, HOME: home, USERPROFILE: home } })
    await new Promise(resolve => child.on('exit', resolve))
    assert.equal(read(file).hooks.Stop[0].hooks[0].timeout, 10)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('setup removes app hooks when an installed v14 extension hook is configured', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-setup-extension-'))
  const codex = path.join(home, '.codex')
  const claude = path.join(home, '.claude')
  const settings = path.join(claude, 'settings.json')
  const extensionHook = path.join(claude, 'switchboard', 'hook.js')
  const appHook = path.join(claude, 'switchboard-app', 'hook.js')
  const appEntry = { hooks: [{ type: 'command', command: HOOK_CMD }] }
  fs.mkdirSync(path.dirname(extensionHook), { recursive: true })
  fs.mkdirSync(path.dirname(appHook), { recursive: true })
  fs.mkdirSync(codex, { recursive: true })
  fs.writeFileSync(extensionHook, '// Switchboard hook forwarder v14\n')
  fs.writeFileSync(appHook, 'existing app hook')
  fs.writeFileSync(settings, JSON.stringify({ hooks: { Stop: [appEntry, { hooks: [{ command: `node "${extensionHook}"` }] }] } }))
  fs.writeFileSync(path.join(codex, 'hooks.json'), JSON.stringify({ hooks: { Stop: [appEntry], PreToolUse: [{ hooks: [{ command: `node "${extensionHook}"` }] }] } }))
  try {
    const child = spawn(process.execPath, [path.join(__dirname, 'setup.js')], { env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: codex } })
    let out = ''
    child.stdout.on('data', c => { out += c })
    await new Promise(resolve => child.on('exit', resolve))
    assert.equal(out, 'Switchboard extension hook already covers the app.\n')
    assert.deepEqual(read(settings).hooks.Stop, [{ hooks: [{ command: `node "${extensionHook}"` }] }])
    assert.deepEqual(Object.keys(read(path.join(codex, 'hooks.json')).hooks), ['PreToolUse'])
    assert.equal(fs.readFileSync(appHook, 'utf8'), 'existing app hook')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('setup keeps its hook when the extension is absent or below v14', async () => {
  for (const version of ['', '// Switchboard hook forwarder v13\n']) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-setup-no-extension-'))
    const claude = path.join(home, '.claude')
    const extensionHook = path.join(claude, 'switchboard', 'hook.js')
    fs.mkdirSync(path.dirname(extensionHook), { recursive: true })
    fs.writeFileSync(extensionHook, version)
    fs.writeFileSync(path.join(claude, 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'node ~/.claude/switchboard/hook.js' }] }] } }))
    try {
      const child = spawn(process.execPath, [path.join(__dirname, 'setup.js')], { env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.missing-codex') } })
      await new Promise(resolve => child.on('exit', resolve))
      assert.ok(read(path.join(claude, 'settings.json')).hooks.Stop.some(isSwitchboardHook))
      assert.ok(fs.existsSync(path.join(claude, 'switchboard-app', 'hook.js')))
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
    }
  }
})

test('the app forwarder still exits 1.5s after it starts', () => {
  assert.match(getHookScriptContent(), /setTimeout\(\(\) => process\.exit\(0\), 1500\)/)
})

test('configureHooks writes through a settings.json symlink and keeps its mode', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-setup-'))
  const real = path.join(dir, 'dotfiles-settings.json')
  const link = path.join(dir, 'settings.json')
  fs.writeFileSync(real, '{}\n', { mode: 0o600 })
  fs.symlinkSync(real, link)
  quietly(() => configureHooks(link, HOOK_CMD))
  assert.ok(fs.lstatSync(link).isSymbolicLink())
  if (process.platform !== 'win32') assert.equal(fs.statSync(real).mode & 0o777, 0o600)
  assert.ok(read(real).hooks)
})

test('configureHooks preserves unrelated settings', () => {
  const file = tmpSettings({ permissions: { allow: ['Bash(ls)'] }, env: { FOO: '1' } })
  quietly(() => configureHooks(file, HOOK_CMD))
  const settings = read(file)
  assert.deepEqual(settings.permissions, { allow: ['Bash(ls)'] })
  assert.deepEqual(settings.env, { FOO: '1' })
})

test('configureHooks leaves an unparseable settings file untouched', () => {
  const broken = '{\n  "permissions": { "allow": ["Bash(ls)"] },\n}\n'
  const file = tmpSettings(broken)
  assert.equal(quietly(() => configureHooks(file, HOOK_CMD)), false)
  assert.equal(fs.readFileSync(file, 'utf-8'), broken)
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json'])
})

test('configureHooks creates settings.json when missing', () => {
  const file = tmpSettings()
  assert.equal(quietly(() => configureHooks(file, HOOK_CMD)), true)
  assert.equal(read(file).hooks.SessionStart.length, 1)
})

test("isAlreadySetup ignores other tools' loopback hooks", () => {
  const file = tmpSettings({ hooks: { SessionStart: [foreignHttp] } })
  const hookScript = path.join(path.dirname(file), 'hook.js')
  fs.writeFileSync(hookScript, '')
  assert.equal(isAlreadySetup(file, hookScript), false)

  quietly(() => configureHooks(file, HOOK_CMD))
  assert.equal(isAlreadySetup(file, hookScript), true)
})

test('configureCodexHooks adds our entry for the Codex events hook-entries.ts lists, keeping other hooks', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'src', 'hook-entries.ts'), 'utf8')
  const listed = JSON.parse(/CODEX_HOOK_EVENTS = (\[[^\]]+\])/.exec(src)![1].replace(/'/g, '"'))
  assert.deepEqual(CODEX_HOOK_EVENTS, listed)
  const file = tmpSettings({ hooks: { Stop: [foreignCommand] } })
  assert.equal(quietly(() => configureCodexHooks(file, HOOK_CMD)), true)
  const { hooks } = read(file)
  assert.deepEqual(Object.keys(hooks).sort(), [...listed].sort())
  assert.deepEqual(hooks.Stop[0], foreignCommand)
  for (const e of listed) assert.equal(hooks[e].filter(isSwitchboardHook).length, 1, e)
  assert.equal(quietly(() => configureCodexHooks(tmpSettings('{oops'), HOOK_CMD)), false)
})

test('isAlreadySetup is false while only pre-rename hooks are there, so setup swaps them', () => {
  const file = tmpSettings({ hooks: { Stop: [{ hooks: [{ type: 'command', command: OLD_CMD }] }] } })
  const script = path.join(path.dirname(file), 'hook.js')
  fs.writeFileSync(script, '')
  assert.equal(isAlreadySetup(file, script), false)
  quietly(() => configureHooks(file, HOOK_CMD, ['Stop']))
  assert.deepEqual(read(file).hooks.Stop, [{ hooks: [{ type: 'command', command: HOOK_CMD, timeout: 10 }] }])
  assert.equal(isAlreadySetup(file, script), true)
})

test('the app forwarder tags a Codex role run with role_run and its parent chat', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-app-role-'))
  const dir = path.join(home, '.claude', 'switchboard-app')
  fs.mkdirSync(dir, { recursive: true })
  const script = path.join(home, 'hook.js')
  fs.writeFileSync(script, getHookScriptContent())
  const got: string[] = []
  const s = await new Promise<http.Server>(resolve => {
    const srv = http.createServer((req, res) => { let b = ''; req.on('data', c => { b += c }); req.on('end', () => { got.push(b); res.end() }) })
    srv.listen(0, '127.0.0.1', () => resolve(srv))
  })
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ pid: process.pid, port: (s.address() as { port: number }).port, workspace: home }))
  try {
    const child = spawn(process.execPath, [script], { env: { ...process.env, HOME: home, USERPROFILE: home, SWITCHBOARD_ROLE_RUN: 'qa-codex', CLAUDE_CODE_SESSION_ID: 'lead' } })
    child.stdin.end(JSON.stringify({ cwd: home, session_id: 's', hook_event_name: 'Stop' }))
    await new Promise(resolve => child.on('exit', resolve))
    assert.equal(JSON.parse(got[0]).role_run, 'qa-codex')
    assert.equal(JSON.parse(got[0]).role_parent, 'lead')
  } finally {
    s.close()
    fs.rmSync(home, { recursive: true, force: true })
  }
})
