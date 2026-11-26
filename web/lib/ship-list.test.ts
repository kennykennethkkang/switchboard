import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ShipRepo, ShipTree } from './hub-types'
import { isShipId, repoLine, shipCount, shipOf, shipPick, shipRows, treeLine, treeState } from './ship-list'

const tree = (repo: string, name: string, p: Partial<ShipTree> = {}): ShipTree => ({ id: `${repo}/.claude/worktrees/${name}`, name, branch: `worktree-${name}`, files: 1, commits: 0, live: false, ...p })
const repo = (id: string, p: Partial<ShipRepo> = {}): ShipRepo => ({ id, name: id.split('/').pop()!, branch: 'main', files: 0, ahead: 0, behind: 0, auto: true, trees: [], ...p })
const ship = [repo('/g/clean'), repo('/g/mods', { files: 71 }), repo('/g/app', { trees: [tree('/g/app', 'fix')] }), repo('/g/app-two', { ahead: 2 })]

test('repos with files, commits or worktrees come first; the rest fold', () => {
  const r = shipRows(ship, [])
  assert.deepEqual(r.ready.map(x => x.name), ['mods', 'app', 'app-two'])
  assert.deepEqual(r.clean.map(x => x.name), ['clean'])
  assert.deepEqual(shipRows(ship, ['mods']).ready.map(x => x.name), ['mods'])
  assert.equal(shipCount(ship), 3)
  assert.equal(shipCount(undefined), 0)
})

test('a folder belongs to its worktree, else its repo, never to a repo whose name it only starts with', () => {
  assert.equal(shipOf(ship, '/g/app/.claude/worktrees/fix/src')?.tree?.name, 'fix')
  assert.equal(shipOf(ship, '/g/app/src')?.tree, undefined)
  assert.equal(shipOf(ship, '/g/app-two')?.repo.name, 'app-two')
  assert.equal(shipOf(ship, '/elsewhere'), undefined)
})

test('the pick holds, a merged worktree falls back to its repo, and no chat is needed', () => {
  const rows = shipRows(ship, [])
  assert.equal(shipPick(ship, rows)?.repo.name, 'mods')
  assert.equal(shipPick(ship, rows, '/g/clean')?.repo.name, 'clean')
  assert.equal(shipPick(ship, rows, '/g/app/.claude/worktrees/fix')?.tree?.name, 'fix')
  assert.deepEqual(shipPick(ship, rows, '/g/app/.claude/worktrees/gone'), { repo: ship[2], tree: undefined })
  assert.equal(shipPick(ship, rows, undefined, '/g/app-two/x')?.repo.name, 'app-two')
  assert.equal(shipPick(ship, rows, undefined, '/g/clean')?.repo.name, 'mods')
  // The filter hides the pick.
  assert.equal(shipPick(ship, shipRows(ship, ['app']), '/g/mods')?.repo.name, 'app')
  assert.equal(shipPick([], { ready: [], clean: [] }), undefined)
})

test('a path is a Ship target, a chat id is not', () => {
  assert.deepEqual(['/g/app', 'C:\\g\\app', 'd-tree', '4d95974e-c432'].map(isShipId), [true, true, false, false])
})

test('what a repo and a worktree say', () => {
  assert.equal(repoLine(repo('/g/a', { files: 1, ahead: 2 })), '1 file · 2 to push')
  assert.equal(repoLine(repo('/g/a')), 'Nothing to ship')
  assert.equal(treeLine(tree('/g/a', 't', { files: 2, commits: 1 })), '2 files · 1 commit')
  assert.deepEqual([
    treeState(tree('/g/a', 't')), treeState(tree('/g/a', 't', { live: true })), treeState(tree('/g/a', 't', { live: true, queued: true })),
    treeState(tree('/g/a', 't', { files: 0 })), treeState(tree('/g/a', 't'), true),
  ].map(s => [s.text, s.can]), [['Ready to merge', 'merge'], ['Chat running', 'queue'], ['Merges when chat ends', 'no'], ['Nothing to merge', 'no'], ['Waiting on a merge', 'no']])
})
