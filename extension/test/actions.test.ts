import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

describe('AWS login process', () => {
  it('keeps spawn errors and calls done once when error is followed by close', () => {
    const Module = require('module') as { _load: (...args: any[]) => any }
    const original = Module._load
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill() {} })
    const errors: string[] = []
    const aws = {
      validProfileName: () => true, readPrefs: () => ({ chrome: {} }), chromeChoice: () => ({ dir: '', gone: [] }),
      writePrefs() {}, awsBinary: () => 'aws', writeOpenChrome: () => undefined, loginError: () => undefined,
      rowText: (rows: Record<string, string>, key: string, message?: string) => { if (message) errors.push(message); return { ...rows, [key]: message } },
    }
    const vscode = { window: { showWarningMessage() {} } }
    Module._load = function (request, ...args) {
      if (request === 'vscode') return vscode
      if (request === 'child_process') return { ...original.call(this, request, ...args), spawn: () => child }
      if (request === './aws') return aws
      if (request === './hub-service') return { hub: { get: () => ({ signIns: { chrome: [], errors: {}, notes: {} } }), set() {} } }
      return original.call(this, request, ...args)
    }
    try {
      const { awsLogin } = require('../src/hub/actions') as typeof import('../src/hub/actions')
      let done = 0
      awsLogin('work', undefined, () => done++)
      child.emit('error', new Error('spawn denied'))
      child.emit('close', 1)
      assert.equal(done, 1)
      assert.deepEqual(errors, ['aws login could not start: spawn denied'])
    } finally {
      Module._load = original
    }
  })
})

describe('temp files', () => {
  it('sweepTemp removes only its own launch files older than a day', () => {
    const fs = require('fs') as typeof import('fs'), os = require('os') as typeof import('os'), path = require('path') as typeof import('path')
    const Module = require('module') as { _load: (...args: any[]) => any }
    const original = Module._load
    Module._load = function (request, ...args) { return request === 'vscode' ? { window: {} } : original.call(this, request, ...args) }
    try {
      const { sweepTemp } = require('../src/hub/actions') as typeof import('../src/hub/actions')
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-sweep-'))
      const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
      const names = [`switchboard-${id}.txt`, `switchboard-${id}.sh`, `switchboard-${id}.ps1`, 'switchboard-setup.json', 'other.txt']
      const old = (Date.now() - 2 * 86_400_000) / 1000
      for (const n of names) { fs.writeFileSync(path.join(dir, n), ''); fs.utimesSync(path.join(dir, n), old, old) }
      fs.writeFileSync(path.join(dir, 'switchboard-1f8fad5b-d9cb-469f-a165-70867728950e.txt'), '')
      sweepTemp(dir)
      assert.deepEqual(fs.readdirSync(dir).sort(), ['other.txt', 'switchboard-1f8fad5b-d9cb-469f-a165-70867728950e.txt', 'switchboard-setup.json'])
    } finally {
      Module._load = original
    }
  })
})
