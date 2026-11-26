import test from 'node:test'
import assert from 'node:assert/strict'
import { isStale, undoPlan, withoutActions, type Change, type SuggestedChanges } from './workbench'

const change = (o: Partial<Change>): Change => ({ id: 'i', title: 't', why: '', area: 'dev', target: '', device: '', status: 'open', at: 0, files: [], ...o })

test('the undo plan runs the command first, then puts files back', () => {
  const f = (path: string, before: string | null) => ({ path, backup: before && 'files/0', before })
  assert.deepEqual(undoPlan(change({ undo: 'defaults delete x y', files: [f('~/.zshrc', 'h'), f('~/new', null)] })), ['defaults delete x y', 'restore ~/.zshrc', 'remove ~/new'])
})

test('an open change goes stale after two hours, a finished one never does', () => {
  assert.equal(isStale(change({ at: 0 }), 2 * 3_600_000 + 1), true)
  assert.equal(isStale(change({ at: 0 }), 3_600_000), false)
  assert.equal(isStale(change({ at: 0, status: 'applied' }), 9e9), false)
})

test('a starting mark ends once the hub shows the change or it times out', async () => {
  const { idOf, partsOf, stillStarting, START_MS } = await import('./workbench-store')
  const id = idOf('general/2026-a.md', 'cache')
  assert.deepEqual(partsOf(id), ['general/2026-a.md', 'cache'])
  const sug = (state: string) => [{ report: 'general/2026-a.md', question: '', at: 0, actions: [{ key: 'cache', state }] }] as unknown as SuggestedChanges[]
  assert.deepEqual(stillStarting({ [id]: 0 }, sug('new'), 1000), { [id]: 0 })
  assert.deepEqual(stillStarting({ [id]: 0 }, sug('open'), 1000), {})
  assert.deepEqual(stillStarting({ [id]: 0 }, sug('new'), START_MS), {})
})

test('a report body drops its Actions sections and nothing else', () => {
  assert.equal(withoutActions('**Answer:** x\n## Actions\n- [dev] **A**: b\n### more\nc\n## Sources\n[1] u'), '**Answer:** x\n## Sources\n[1] u')
  assert.equal(withoutActions('## Findings\n```\n## Actions\n```\nend'), '## Findings\n```\n## Actions\n```\nend')
})
