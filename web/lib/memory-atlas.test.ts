import { test } from 'node:test'
import assert from 'node:assert/strict'
import { atlasLayout, SHARED } from './memory-atlas'
import { demoGraph } from './memory-graph'

test('places every non-project node once, inside its cluster, the same way each time', () => {
  const g = demoGraph(), a = atlasLayout(g)
  assert.equal(a.dots.size, g.nodes.filter(n => n.kind !== 'project').length)
  for (const d of a.dots.values()) {
    const c = a.clusters.find(c => c.id === d.cluster)!
    assert.ok(Math.hypot(d.x - c.x, d.y - c.y) < c.r, d.id)
  }
  assert.deepEqual([...atlasLayout(g).dots.values()], [...a.dots.values()])
})

test('one cluster per project plus Shared for the vault and two-project files, none overlapping', () => {
  const a = atlasLayout(demoGraph())
  assert.deepEqual(a.clusters.map(c => c.label).sort(), ['Armasu', 'Shared', 'switchboard'])
  assert.equal(a.dots.get('rule:global')!.cluster, SHARED)
  assert.equal(a.dots.get('m:logo')!.cluster, 'project:/w/Armasu')
  for (const p of a.clusters) for (const q of a.clusters) if (p !== q) assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= p.r + q.r)
})
