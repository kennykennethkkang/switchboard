/** The Memory view's helpers: groups, search, neighbors and the sample graph. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { demoGraph, findNodes, groupOf, listNodes, neighbors, relations, GROUPS } from './memory-graph'

test('groups a memory by its type and everything else by its kind', () => {
  assert.equal(groupOf({ id: 'a', kind: 'memory', label: 'a', type: 'feedback' }), 'feedback')
  assert.equal(groupOf({ id: 'b', kind: 'todo', label: 'b' }), 'todo')
  assert.equal(groupOf({ id: 'w', kind: 'wiki', label: 'w' }), 'wiki')
  assert.equal(GROUPS.length, new Set(GROUPS.map(g => g.color)).size)
})

test('finds by label, best (prefix) first, ignoring case and hidden groups', () => {
  const g = demoGraph()
  const hits = findNodes(g.nodes, 'arm', new Set())
  assert.ok(hits.length > 0)
  assert.match(hits[0].label.toLowerCase(), /^arm/)
  assert.deepEqual(findNodes(g.nodes, '', new Set()), [])
  assert.ok(findNodes(g.nodes, 'arm', new Set(['project', 'feedback', 'reference', 'user', 'chat', 'todo', 'rule', 'project-memory'])).length === 0)
})

test('lists a node\'s neighbors both ways, once each', () => {
  const g = demoGraph()
  const p = g.nodes.find(n => n.kind === 'project')!
  const near = neighbors(g, p.id)
  assert.ok(near.length > 0)
  assert.equal(new Set(near.map(n => n.id)).size, near.length)
  for (const e of g.edges) assert.ok(g.nodes.some(n => n.id === e.source) && g.nodes.some(n => n.id === e.target))
})

test('lists every visible match by label or description', () => {
  const g = demoGraph()
  assert.equal(listNodes(g.nodes, '', new Set()).length, g.nodes.length)
  assert.ok(listNodes(g.nodes, 'horizon', new Set()).some(n => n.id === 'm:logo'))
  assert.equal(listNodes(g.nodes, '', new Set(['chat'])).filter(n => n.kind === 'chat').length, 0)
})

test('splits relations into links out, links in, parents and children', () => {
  const g = demoGraph()
  const r = relations(g, 'm:logo')
  assert.deepEqual(r.to.map(n => n.id), ['m:tokens'])
  assert.deepEqual(r.up.map(n => n.id), ['project:/w/Armasu'])
  assert.deepEqual(relations(g, 'm:tokens').from.map(n => n.id), ['m:logo'])
  assert.deepEqual(relations(g, 'm:vision').from.map(n => groupOf(n)), ['wiki'])
  assert.ok(g.nodes.some(n => groupOf(n) === 'raw'))
  assert.ok(relations(g, 'chat:a').down.some(n => n.id === 'todo:1'))
})

test('every group belongs to a set, in set order', () => {
  const sets = GROUPS.map(g => g.set)
  assert.deepEqual([...new Set(sets)], ['Memory', 'Vault', 'Workspace'])
})
