/** New chat's repo step: what Start sends for a new or cloned repo. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repoAsk } from './new-repo'

test('create takes a GitHub repo name only', () => {
  assert.deepEqual(repoAsk('__new', ' my-app ', true), { create: 'my-app', private: true })
  assert.deepEqual(repoAsk('__new', 'a.b_c', false), { create: 'a.b_c', private: false })
  for (const n of ['', '.x', '-x', 'a b', 'a/b', 'x'.repeat(101)]) assert.equal(repoAsk('__new', n, true), undefined, n)
})

test('clone takes owner/repo or a GitHub link', () => {
  assert.deepEqual(repoAsk('__clone', ' o/r ', true), { clone: 'o/r' })
  assert.deepEqual(repoAsk('__clone', 'https://github.com/o/r', true), { clone: 'https://github.com/o/r' })
  assert.equal(repoAsk('__clone', 'just-a-name', true), undefined)
  assert.equal(repoAsk('__clone', '', true), undefined)
  // cloneTarget refuses these, so Start must stay off
  for (const n of ['git@github.com:o/r/', 'git@github.com:o/r.git/', '-x/y', 'o/-y', '.o/r', 'o/..', 'o/.']) assert.equal(repoAsk('__clone', n, true), undefined, n)
  assert.deepEqual(repoAsk('__clone', 'git@github.com:o/r.git', true), { clone: 'git@github.com:o/r.git' })
})

test('a project path is no repo step', () => {
  assert.equal(repoAsk('/Users/k/proj', 'x', true), undefined)
})
