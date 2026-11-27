import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { cliCall, displayPath, insidePath } from '../src/hub/windows'

describe('Windows helpers', () => {
  it('escapes cmd metacharacters in shim arguments', () => {
    assert.deepEqual(cliCall('claude.cmd', ['a" & | % ! ^ < > space \\', 'two words'], 'win32'), {
      cmd: 'cmd.exe', args: ['/d', '/s', '/c', '"claude.cmd ^"a\\^"^ ^&^ ^|^ ^%^ ^!^ ^^^ ^<^ ^>^ space^ \\\\^" ^"two^ words^""'], windowsVerbatimArguments: true,
    })
  })

  it('escapes a shim path with spaces', () => {
    const call = cliCall('C:\\Program Files\\nodejs\\npm.cmd', ['run', 'dev'], 'win32')
    assert.equal(call.args[3], '"C:\\Program^ Files\\nodejs\\npm.cmd ^^^"run^^^" ^^^"dev^^^""')
  })

  it('rejects line breaks and NUL for command shims', () => {
    assert.throws(() => cliCall('claude.cmd', ['line\nbreak'], 'win32'))
    assert.throws(() => cliCall('claude.cmd', ['nul\0byte'], 'win32'))
    assert.throws(() => cliCall('safe\n.cmd', [], 'win32'))
  })

  it('resolves bare commands to native executables', { skip: process.platform !== 'win32' && 'requires Windows filesystem path semantics' }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-windows-'))
    try {
      fs.writeFileSync(path.join(dir, 'git.exe'), '')
      assert.deepEqual(cliCall('git', ['status'], 'win32', { PATH: dir, PATHEXT: '.exe;.cmd;.bat' }), {
        cmd: path.win32.join(dir, 'git.exe'), args: ['status'],
      })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('double escapes arguments for npm shims', () => {
    assert.equal(cliCall('npm.cmd', ['100% & x'], 'win32', { PATH: '', PATHEXT: '.CMD' }).args[3], '"npm.cmd ^^^"100^^^%^^^ ^^^&^^^ x^^^""')
  })

  it('leaves native executables as direct calls', () => {
    assert.deepEqual(cliCall('claude.exe', ['-p', 'hello'], 'win32'), { cmd: 'claude.exe', args: ['-p', 'hello'] })
  })

  it('displays Windows paths by their components', () => {
    assert.equal(displayPath('C:\\Users\\ken\\repo\\src\\file.ts'), 'src/file.ts')
  })

  it('checks containment with Windows separators and case rules', () => {
    assert.equal(insidePath('C:\\Users\\ken\\repo', 'c:/users/ken/repo/src/file.ts', 'win32'), true)
    assert.equal(insidePath('C:\\Users\\ken\\repo', 'C:\\Users\\ken\\repository\\file.ts', 'win32'), false)
  })
})
