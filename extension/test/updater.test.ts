import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions, pickReleaseAssets, shouldPull } from '../src/hub/updater-pure'
import { commandProblem } from '../src/hub/routes'

test('hub update commands need no payload', () => {
  assert.equal(commandProblem({ type: 'hub-update-check' }), undefined)
  assert.equal(commandProblem({ type: 'hub-update-reload' }), undefined)
})

test('compareVersions compares numeric version parts', () => {
  assert.equal(compareVersions('0.21.10', '0.21.9'), 1)
  assert.equal(compareVersions('0.21.9', '0.21.9'), 0)
  assert.equal(compareVersions('0.20.99', '0.21.0'), -1)
})

test('pickReleaseAssets finds the matching VSIX and checksum', () => {
  assert.deepEqual(pickReleaseAssets([
    { name: 'switchboard-1.2.3.vsix', browser_download_url: 'vsix' },
    { name: 'switchboard-1.2.3.vsix.sha256', browser_download_url: 'sum' },
    { name: 'other.zip', browser_download_url: 'other' },
  ], '1.2.3'), { vsix: 'vsix', checksum: 'sum' })
  assert.equal(pickReleaseAssets([], '1.2.3'), undefined)
})

test('shouldPull only permits a clean checkout on its default branch with upstream commits', () => {
  const base = { exists: true, isRepo: true, clean: true, onDefaultBranch: true, behind: true }
  assert.equal(shouldPull(base), true)
  for (const change of [{ clean: false }, { onDefaultBranch: false }, { behind: false }, { isRepo: false }, { exists: false }]) {
    assert.equal(shouldPull({ ...base, ...change }), false)
  }
})
