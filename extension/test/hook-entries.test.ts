/**
 * Unit tests for settings.json hook handling.
 *
 * The invariant: Switchboard only ever touches its own hooks. Other tools
 * register loopback HTTP hooks too (#73), and a settings file we can't parse
 * must never be overwritten.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  isLegacyHookUrl, isSwitchboardHook, hasSwitchboardHook,
  mergeSwitchboardHooks, CODEX_HOOK_EVENTS, migrateLegacyHttpHooks, removeSwitchboardHooks,
  readSettingsFile, writeJsonAtomic, HOOK_EVENTS, missingHookEvents,
} from '../src/hook-entries'

const HOOK_CMD = '"/usr/bin/node" "/home/u/.claude/switchboard/hook.js"'
const foreignHttp = () => ({ hooks: [{ type: 'http', url: 'http://127.0.0.1:19847/hook/9207692e/session-start' }] })

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-hooks-'))
}

describe('isLegacyHookUrl', () => {
  it('matches only the bare hook server origin', () => {
    assert.equal(isLegacyHookUrl('http://127.0.0.1:52341'), true)
    assert.equal(isLegacyHookUrl('http://127.0.0.1:52341/'), true)
    assert.equal(isLegacyHookUrl('http://127.0.0.1:19847/hook/abc/stop'), false)
    assert.equal(isLegacyHookUrl('http://127.0.0.1:8080/?x=1'), false)
    assert.equal(isLegacyHookUrl('http://localhost:52341'), false)
    assert.equal(isLegacyHookUrl(undefined), false)
  })
})

describe('isSwitchboardHook', () => {
  it('matches our command hook on POSIX and Windows paths', () => {
    assert.equal(isSwitchboardHook({ hooks: [{ command: HOOK_CMD }] }), true)
    assert.equal(isSwitchboardHook({ hooks: [{ command: '"C:\\node.exe" "C:\\Users\\u\\.claude\\switchboard\\hook.js"' }] }), true)
  })

  it("does not match other tools' hooks", () => {
    assert.equal(isSwitchboardHook(foreignHttp()), false)
    assert.equal(isSwitchboardHook({ hooks: [{ command: 'other-tool notify' }] }), false)
    // Agent Flow's own forwarder stays Agent Flow's, for its own uninstall to remove.
    assert.equal(isSwitchboardHook({ hooks: [{ command: '"/usr/bin/node" "/home/u/.claude/agent-flow/hook.js"' }] }), false)
    // The browser app's forwarder is scripts/setup.js's to replace, not the extension's.
    assert.equal(isSwitchboardHook({ hooks: [{ command: '"/usr/bin/node" "/home/u/.claude/switchboard-app/hook.js"' }] }), false)
    assert.equal(isSwitchboardHook({}), false)
  })
})

describe('mergeSwitchboardHooks', () => {
  it('replaces our entries and keeps everything else', () => {
    const settings: Record<string, unknown> = {
      permissions: { allow: ['Bash(ls)'] },
      hooks: {
        SessionStart: [foreignHttp(), { hooks: [{ type: 'http', url: 'http://127.0.0.1:52341' }] }],
        Stop: [{ hooks: [{ type: 'command', command: '"/old/node" "/x/.claude/switchboard/hook.js"' }] }],
        UserPromptSubmit: [foreignHttp()],
      },
    }
    const entry = { hooks: [{ type: 'command', command: HOOK_CMD, timeout: 2 }] }
    mergeSwitchboardHooks(settings, entry, ['SessionStart', 'Stop'])
    mergeSwitchboardHooks(settings, entry, ['SessionStart', 'Stop'])

    const hooks = settings.hooks as Record<string, unknown[]>
    assert.deepEqual(hooks.SessionStart, [foreignHttp(), entry])
    assert.deepEqual(hooks.Stop, [entry])
    assert.deepEqual(hooks.UserPromptSubmit, [foreignHttp()])
    assert.deepEqual(settings.permissions, { allow: ['Bash(ls)'] })
  })
})

describe('removeSwitchboardHooks', () => {
  it('drops only our entries and the events they leave empty', () => {
    const ours = { hooks: [{ type: 'command', command: HOOK_CMD }] }
    const agentFlow = { hooks: [{ type: 'command', command: 'node /home/u/.claude/agent-flow/hook.js' }] }
    const settings: Record<string, unknown> = { model: 'opus', hooks: { Stop: [ours, foreignHttp()], SessionStart: [ours], PreToolUse: [agentFlow] } }
    removeSwitchboardHooks(settings)
    assert.deepEqual(settings, { model: 'opus', hooks: { Stop: [foreignHttp()], PreToolUse: [agentFlow] } })
  })

  it('removes the hooks key once nothing is left in it', () => {
    const settings: Record<string, unknown> = { hooks: { Stop: [{ hooks: [{ type: 'command', command: HOOK_CMD }] }] } }
    assert.deepEqual(removeSwitchboardHooks(settings), {})
  })
})

describe('hasSwitchboardHook', () => {
  it('is false when only another tool has loopback hooks', () => {
    assert.equal(hasSwitchboardHook({ hooks: { SessionStart: [foreignHttp()] } }), false)
    assert.equal(hasSwitchboardHook({ hooks: { SessionStart: [{ hooks: [{ command: HOOK_CMD }] }] } }), true)
    assert.equal(hasSwitchboardHook({}), false)
  })
})

describe('HOOK_EVENTS', () => {
  it('registers the five newer events', () => {
    for (const e of ['PostCompact', 'TaskCreated', 'TaskCompleted', 'PermissionDenied', 'InstructionsLoaded']) assert.ok((HOOK_EVENTS as readonly string[]).includes(e), e)
  })
})

describe('missingHookEvents', () => {
  it('names events that lack our hook, so an older install gets new ones without touching the rest', () => {
    const ours = () => ({ hooks: [{ type: 'command', command: HOOK_CMD }] })
    const hooks: Record<string, unknown> = {}
    for (const e of HOOK_EVENTS) if (e !== 'UserPromptSubmit') hooks[e] = [ours()]
    hooks.UserPromptSubmit = [foreignHttp()]
    hooks.PreToolUse = [foreignHttp(), ours()]
    const settings: Record<string, unknown> = { hooks, permissions: { allow: ['Bash'] } }
    assert.deepEqual(missingHookEvents(settings, HOOK_EVENTS), ['UserPromptSubmit'])
    const before = JSON.parse(JSON.stringify(settings))
    mergeSwitchboardHooks(settings, ours(), missingHookEvents(settings, HOOK_EVENTS))
    assert.deepEqual(missingHookEvents(settings, HOOK_EVENTS), [])
    assert.deepEqual((settings.hooks as Record<string, unknown>).UserPromptSubmit, [foreignHttp(), ours()])
    for (const e of HOOK_EVENTS) if (e !== 'UserPromptSubmit') assert.deepEqual((settings.hooks as Record<string, unknown>)[e], before.hooks[e])
    assert.deepEqual(settings.permissions, before.permissions)
  })
  it('names every event when there are no hooks', () => {
    assert.deepEqual(missingHookEvents({}, ['Stop']), ['Stop'])
  })
})

describe('migrateLegacyHttpHooks', () => {
  it('rewrites legacy Agent Flow HTTP hooks and leaves foreign ones alone', () => {
    const settings: Record<string, unknown> = {
      hooks: {
        PreToolUse: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:52341' }] }],
        Stop: [foreignHttp()],
      },
    }
    assert.equal(migrateLegacyHttpHooks(settings, HOOK_CMD, 2), true)
    const hooks = settings.hooks as Record<string, unknown[]>
    assert.deepEqual(hooks.PreToolUse, [{ hooks: [{ type: 'command', command: HOOK_CMD, timeout: 2 }] }])
    assert.deepEqual(hooks.Stop, [foreignHttp()])
  })

  it('reports no change when there is nothing to migrate', () => {
    const settings = { hooks: { Stop: [foreignHttp()] } }
    assert.equal(migrateLegacyHttpHooks(settings, HOOK_CMD, 2), false)
    assert.deepEqual(settings, { hooks: { Stop: [foreignHttp()] } })
  })
})

describe('readSettingsFile', () => {
  it('treats a missing or empty file as empty settings', () => {
    const dir = tmpDir()
    assert.deepEqual(readSettingsFile(path.join(dir, 'missing.json')), { ok: true, settings: {} })
    fs.writeFileSync(path.join(dir, 'empty.json'), '  \n')
    assert.deepEqual(readSettingsFile(path.join(dir, 'empty.json')), { ok: true, settings: {} })
  })

  it('reports invalid JSON and non-object values as errors', () => {
    const dir = tmpDir()
    fs.writeFileSync(path.join(dir, 'trailing-comma.json'), '{ "a": 1, }')
    fs.writeFileSync(path.join(dir, 'array.json'), '[]')
    assert.equal(readSettingsFile(path.join(dir, 'trailing-comma.json')).ok, false)
    assert.equal(readSettingsFile(path.join(dir, 'array.json')).ok, false)
  })
})

describe('writeJsonAtomic', () => {
  it('writes the file, creating parent dirs, and leaves no temp file behind', () => {
    const dir = tmpDir()
    const file = path.join(dir, 'nested', 'settings.json')
    writeJsonAtomic(file, { a: 1 })
    assert.equal(fs.readFileSync(file, 'utf-8'), '{\n  "a": 1\n}\n')
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json'])
  })

  it('makes a new file owner-only', () => {
    const file = path.join(tmpDir(), 'new.json')
    writeJsonAtomic(file, {})
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  })

  it('writes through a symlink and keeps the file mode', () => {
    const dir = tmpDir()
    const real = path.join(dir, 'dotfiles-settings.json')
    const link = path.join(dir, 'settings.json')
    fs.writeFileSync(real, '{}\n', { mode: 0o600 })
    fs.symlinkSync(real, link)
    writeJsonAtomic(link, { a: 1 })
    assert.ok(fs.lstatSync(link).isSymbolicLink())
    assert.equal(fs.readFileSync(real, 'utf-8'), '{\n  "a": 1\n}\n')
    assert.equal(fs.statSync(real).mode & 0o777, 0o600)
  })
})

describe('HOOK_EVENTS', () => {
  it('registers UserPromptSubmit so a new prompt clears Done', () => {
    assert.ok(HOOK_EVENTS.includes('UserPromptSubmit'))
  })
})

describe('StopFailure', () => {
  it('is registered so a turn ended by a usage limit leaves Working', () => {
    assert.ok((HOOK_EVENTS as readonly string[]).includes('StopFailure'))
  })
})

describe('CODEX_HOOK_EVENTS', () => {
  it('is a subset of the Claude events, so the hook server reads them the same way', () => {
    for (const e of CODEX_HOOK_EVENTS) assert.ok((HOOK_EVENTS as readonly string[]).includes(e), e)
  })
  it('merges into a codex hooks.json and keeps the user entries', () => {
    const user = { hooks: [{ type: 'command', command: 'my-logger' }] }
    const out = mergeSwitchboardHooks({ hooks: { Stop: [user] } }, { hooks: [{ type: 'command', command: 'node /x/switchboard/hook.js', timeout: 5 }] }, CODEX_HOOK_EVENTS) as { hooks: Record<string, unknown[]> }
    assert.equal(out.hooks.Stop.length, 2)
    assert.deepEqual(out.hooks.Stop[0], user)
    assert.deepEqual(Object.keys(out.hooks).sort(), [...CODEX_HOOK_EVENTS].sort())
  })
})

describe('plain JS copies of the hook rules', () => {
  const setup = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'setup.js'), 'utf8')
  const uninstall = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'uninstall.js'), 'utf8')
  const list = (src: string, name: string) => [...(new RegExp(`${name} = \\[([^\\]]*)\\]`).exec(src)?.[1] ?? '').matchAll(/'(\w+)'/g)].map(m => m[1])
  it('setup.js registers the same events', () => {
    assert.deepEqual(list(setup, 'const HOOK_EVENTS'), [...HOOK_EVENTS])
    assert.deepEqual(list(setup, 'const CODEX_HOOK_EVENTS'), [...CODEX_HOOK_EVENTS])
  })
  it('setup.js and uninstall.js match legacy URLs the same way', () => {
    const re = /LEGACY_HOOK_URL_RE = (\/.*\/);?$/m
    const want = re.exec(setup)?.[1]
    assert.ok(want)
    assert.equal(re.exec(uninstall)?.[1], want)
    assert.equal(want, String(/^http:\/\/127\.0\.0\.1:\d+\/?$/))
    assert.equal(isLegacyHookUrl('http://127.0.0.1:1'), true)
  })
})
