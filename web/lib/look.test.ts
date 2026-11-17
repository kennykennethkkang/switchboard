import assert from 'node:assert/strict'
import test from 'node:test'
import { ago } from './look'
import { baseName } from './path'

test('look helpers keep their existing output', () => {
  assert.equal(baseName('/work/repo'), 'repo')
  assert.equal(baseName('C:\\work\\repo'), 'repo')
  assert.equal(ago(60_000, 120_000), '1 min')
})
