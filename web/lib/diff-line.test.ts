import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffLine, reviewNote } from './diff-line'

const diff = ['diff --git a/x b/x', '@@ -10,3 +20,4 @@ fn', ' keep', '-gone', '+new', '+more', ' tail']

test('diffLine gives the new line for added and kept lines, the old one for removed', () => {
  assert.deepEqual(diffLine(diff, 2), { line: 20, side: 'new' })
  assert.deepEqual(diffLine(diff, 3), { line: 11, side: 'old' })
  assert.deepEqual(diffLine(diff, 4), { line: 21, side: 'new' })
  assert.deepEqual(diffLine(diff, 6), { line: 23, side: 'new' })
  assert.equal(diffLine(diff, 0), undefined)
  assert.equal(diffLine(diff, 1), undefined)
})

test('reviewNote names the file, line and the line text', () => {
  assert.equal(reviewNote('a.ts', diff, 4, ' fix this '), 'Review note on a.ts:21 (`+new`): fix this')
  assert.equal(reviewNote('a.ts', diff, 3, 'why?'), 'Review note on a.ts:11, removed line (`-gone`): why?')
  assert.equal(reviewNote('a.ts', diff, 4, '  '), undefined)
  const long = ['@@ -1 +1 @@', '+' + 'x'.repeat(200)]
  assert.equal(reviewNote('a.ts', long, 1, 'n'), `Review note on a.ts:1 (\`+${'x'.repeat(118)}…\`): n`)
})
