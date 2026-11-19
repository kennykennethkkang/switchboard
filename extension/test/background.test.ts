/** Agent work stays behind Kenneth's screen: headless agent browsers, status bar notices unless toasts are on. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { applyAgentBrowsers, headlessEnv, noticeKind, noticeSpot, noticeText } from '../src/hub/background'

describe('headlessEnv', () => {
  it('adds PLAYWRIGHT_MCP_HEADLESS by default and keeps other vars', () => {
    assert.deepEqual(headlessEnv({ FOO: 'x' }, undefined), { FOO: 'x', PLAYWRIGHT_MCP_HEADLESS: 'true' })
    assert.deepEqual(headlessEnv(undefined, false), { PLAYWRIGHT_MCP_HEADLESS: 'true' })
  })
  it('drops it when agent browsers are shown', () => {
    assert.deepEqual(headlessEnv({ FOO: 'x', PLAYWRIGHT_MCP_HEADLESS: 'true' }, true), { FOO: 'x' })
    assert.deepEqual(headlessEnv(undefined, true), {})
  })
})

describe('applyAgentBrowsers', () => {
  it('writes the flag into settings.json env and takes it out again, keeping the rest', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-bg-')), 'settings.json')
    fs.writeFileSync(file, JSON.stringify({ model: 'opus', env: { FOO: 'x' } }))
    assert.equal(applyAgentBrowsers(undefined, file), undefined)
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { model: 'opus', env: { FOO: 'x', PLAYWRIGHT_MCP_HEADLESS: 'true' } })
    applyAgentBrowsers(true, file)
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { model: 'opus', env: { FOO: 'x' } })
    fs.writeFileSync(file, '{ broken')
    assert.match(applyAgentBrowsers(false, file) ?? '', /could not read/)
    fs.rmSync(path.dirname(file), { recursive: true })
  })
})

describe('noticeKind', () => {
  it('uses system notifications unless Kenneth picks another', () => {
    assert.equal(noticeKind({}), 'system')
    assert.equal(noticeKind({ toasts: false }), 'system')
    assert.equal(noticeKind({ toasts: true }), 'toast')
    assert.equal(noticeKind({ toasts: true, notices: 'status' }), 'status')
    assert.equal(noticeKind({ notices: 'system' }), 'system')
  })
})

describe('noticeText', () => {
  it('drops the Switchboard prefix VS Code already shows as the source', () => {
    assert.equal(noticeText('Switchboard: Fix login: done.'), 'Fix login: done.')
  })
  it('folds whitespace and cuts long text', () => {
    assert.equal(noticeText('a\n\n  b'), 'a b')
    const t = noticeText('x'.repeat(300))
    assert.equal(t.length, 140)
    assert.ok(t.endsWith('…'))
  })
})

describe('noticeSpot', () => {
  it('moves notices out of the bottom right unless Kenneth picks it', () => {
    assert.equal(noticeSpot({}), 'top-right')
    assert.equal(noticeSpot({ noticeSpot: 'bottom-left' }), 'bottom-left')
    assert.equal(noticeSpot({ noticeSpot: 'bottom-right' }), 'bottom-right')
  })
})
