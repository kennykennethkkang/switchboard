/** The finished chat's git card: the button it offers, the message it sends, the lane rows it draws. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checks, laneRows, mergeMessage, shipAction, splitMessage } from './ship-card'
import type { RepoView } from './hub-types'

const repo = (p: Partial<RepoView>): RepoView => ({ sessionId: 's', name: 'r', branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, files: [], branches: [], sync: { kind: 'fetch', label: 'Fetch' }, log: [], stashes: 0, at: 0, ...p })

test('shipAction: behind the upstream says Pull first and offers no push', () => {
  assert.deepEqual(shipAction(repo({ behind: 2, ship: { files: ['a'], kept: [] } })), { kind: 'pull', label: 'Pull first', note: 'origin/main has 2 new commits' })
})

test('shipAction: a conflict with main says Merge main first', () => {
  const merge = { base: 'main', behind: 1, files: 2, conflicts: [], commits: [] }
  assert.deepEqual(shipAction(repo({ branch: 'feat', merge, ship: { files: ['a'], kept: [] } })), { kind: 'merge', label: 'Merge main first', note: '2 files would conflict with main' })
})

test('shipAction: takes the server plan as is, else pushes, else nothing', () => {
  const r = repo({ ship: { files: ['a.ts', 'notes.md'], kept: ['CLAUDE.md → x.md', '.mcp.json'] } })
  assert.deepEqual(shipAction(r), { kind: 'ship', label: 'Commit & push', files: ['a.ts', 'notes.md'], kept: ['CLAUDE.md → x.md', '.mcp.json'] })
  assert.deepEqual(shipAction(repo({ ahead: 3, ship: { files: [], kept: [] } })), { kind: 'push', label: 'Push 3', files: [], kept: [] })
  assert.deepEqual(shipAction(repo({ upstream: undefined, branch: 'feat', ship: { files: [], kept: [] } })), { kind: 'push', label: 'Publish feat', files: [], kept: [] })
  assert.equal(shipAction(repo({ ship: { files: [], kept: ['AGENTS.md'] } })).kind, 'none')
  assert.equal(shipAction(repo({ branch: undefined, ship: { files: ['a'], kept: [] } })).kind, 'none')
  assert.equal(shipAction(repo({ files: [{ path: 'a', status: 'modified' }] })).kind, 'none')
})

test('shipAction: too many files for one request says so instead of a button', () => {
  const files = Array.from({ length: 1001 }, (_, i) => `f${i}`)
  assert.deepEqual(shipAction(repo({ ship: { files, kept: [] } })), { kind: 'none', label: 'More than 1000 files changed: commit these from a terminal' })
})

test('splitMessage: summary, then the body without attribution trailers', () => {
  assert.deepEqual(splitMessage('Add card\n\n- one\n- two\n\nCo-Authored-By: Claude <x@y>\n'), { summary: 'Add card', description: '- one\n- two' })
})

test('checks: the test run, plus types and lint when the same command ran them', () => {
  assert.deepEqual(checks({ command: 'pnpm run lint && pnpm test', ok: true, at: 0, total: 12 }), [{ name: 'Tests', ok: true, detail: '12 passed' }, { name: 'Types and lint', ok: true }])
  assert.deepEqual(checks({ command: 'pnpm test', ok: false, at: 0, failed: 2, total: 9 }), [{ name: 'Tests', ok: false, detail: '2 of 9 failed' }])
  assert.deepEqual(checks(undefined), [])
})

test('laneRows: newest first, head on lane 0, base on lane 1, the fork last on lane 0', () => {
  const c = (hash: string, side: 'head' | 'base') => ({ hash, author: 'You', at: 0, subject: hash, side })
  const rows = laneRows({ against: 'origin/main', fork: { hash: 'f', author: 'You', at: 0, side: 'fork' }, commits: [c('b1', 'base'), c('h1', 'head'), c('h2', 'head')] })
  assert.deepEqual(rows.map(r => [r.commit.hash, r.lane]), [['b1', 1], ['h1', 0], ['h2', 0], ['f', 0]])
  assert.deepEqual(laneRows(undefined), [])
})

test('mergeMessage: the new summary on top, then its lines, the old summary as a bullet and the old lines it lacks', () => {
  assert.equal(mergeMessage('My words\n\n- mine\n- b1', 'B one\n\n- b1\n- A one'), 'B one\n\n- b1\n- A one\n- My words\n- mine')
  assert.equal(mergeMessage('', 'B one\n\n- b1'), 'B one\n\n- b1')
  assert.equal(mergeMessage('B one\n\n- b1', 'B one\n\n- b1'), 'B one\n\n- b1')
})
