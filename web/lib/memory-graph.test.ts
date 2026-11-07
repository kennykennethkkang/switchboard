/** The Memory view's helpers: groups, search, neighbors and the sample graph. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { demoGraph, findNodes, groupOf, healthLine, listNodes, neighbors, relations, GROUPS } from './memory-graph'

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

test('the sample has one edge of each predicate, a from edge, a superseded note and its health', () => {
  const g = demoGraph()
  for (const k of ['supersedes', 'depends-on', 'part-of', 'contradicts', 'related', 'from']) assert.ok(g.edges.some(e => e.kind === k), k)
  const old = g.nodes.find(n => n.superseded)!
  assert.ok(g.edges.some(e => e.kind === 'supersedes' && e.target === old.id))
  assert.deepEqual(g.health.superseded, [old.id])
  assert.equal(g.health.contradictions.length, 1)
  for (const id of [...g.health.dangling, ...g.health.orphans]) assert.ok(g.nodes.some(n => n.id === id))
})

test('labels typed relations by predicate, both ways, and keeps them out of links and parents', () => {
  const g = demoGraph()
  const sup = g.edges.find(e => e.kind === 'supersedes')!
  const r = relations(g, sup.source)
  assert.ok(r.typed.some(t => t.title === 'Supersedes' && t.list.some(n => n.id === sup.target)))
  assert.ok(relations(g, sup.target).typed.some(t => t.title === 'Superseded by' && t.list.some(n => n.id === sup.source)))
  assert.ok(!r.to.some(n => n.id === sup.target) && !r.up.some(n => n.id === sup.target))
  const from = g.edges.find(e => e.kind === 'from')!
  assert.ok(relations(g, from.source).typed.some(t => t.title === 'From chat' && t.list.some(n => n.id === from.target)))
  assert.ok(!relations(g, from.source).up.some(n => n.id === from.target))
})

test('finds and lists by alias too', () => {
  const g = demoGraph()
  assert.ok(findNodes(g.nodes, 'recall-tool', new Set()).some(n => n.id === 'm:recall'))
  assert.ok(listNodes(g.nodes, 'RECALL-TOOL', new Set()).some(n => n.id === 'm:recall'))
})

test('words the health line in singular or plural, leaving out what is zero', () => {
  const h = { dangling: ['a'], orphans: ['a', 'b'], duplicates: [], contradictions: [['a', 'b']] as [string, string][], superseded: [], invalid: ['a'], stale: ['a', 'b'] }
  assert.equal(healthLine(h), '1 note with broken links, 2 unlinked notes, 1 contradiction, 1 invalid note, 2 stale notes')
  assert.equal(healthLine({ ...h, dangling: [], orphans: [], contradictions: [], invalid: [], stale: [], duplicates: ['x', 'y'], superseded: ['s'] }), '2 shared names, 1 superseded note')
})
