/** The Memory view's helpers: groups, search, neighbors and the sample graph. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ago, bareProjects, demoGraph, dolly, findNodes, framePose, graphCounts, groupOf, healthLine, healthParts, listNodes, neighbors, projectOf, relations, GROUPS } from './memory-graph'

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
  const h = { dangling: ['a'], orphans: ['a', 'b'], duplicates: [], contradictions: [['a', 'b']] as [string, string][], superseded: [], invalid: ['a'], stale: ['a', 'b'], loops: [], unproven: ['a'] }
  assert.equal(healthLine(h), '1 note with broken links, 2 unlinked notes, 1 contradiction, 1 invalid note, 2 stale notes, 1 note unproven for 14 days')
  assert.equal(healthLine({ ...h, dangling: [], orphans: [], contradictions: [], invalid: [], stale: [], unproven: [], duplicates: ['x', 'y'], superseded: ['s'] }), '2 shared names, 1 superseded note')
})

// Where p lands on screen, -1..1 each way, seen from pos looking at at (y up).
function ndc(p: { x: number; y: number; z: number }, pos: { x: number; y: number; z: number }, at: { x: number; y: number; z: number }, fov: number, aspect: number) {
  const f = [at.x - pos.x, at.y - pos.y, at.z - pos.z], fl = Math.hypot(...f), fw = f.map(v => v / fl)
  const r = [-fw[2], 0, fw[0]], rl = Math.hypot(...r), rw = r.map(v => v / rl)
  const u = [rw[1] * fw[2] - rw[2] * fw[1], rw[2] * fw[0] - rw[0] * fw[2], rw[0] * fw[1] - rw[1] * fw[0]]
  const d = [p.x - pos.x, p.y - pos.y, p.z - pos.z], dot = (a: number[]) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2]
  const t = Math.tan((fov * Math.PI) / 360)
  return { x: dot(rw) / (dot(fw) * t * aspect), y: dot(u) / (dot(fw) * t) }
}

test('frames every point inside the fill share of the view, tight on the widest side', () => {
  const pts = [{ x: -300, y: 10, z: 40 }, { x: 260, y: -50, z: -80 }, { x: 0, y: 120, z: 0 }, { x: 30, y: -90, z: 150 }]
  for (const [aspect, cam] of [[1176 / 856, { x: 0, y: 0, z: 1000 }], [390 / 500, { x: 700, y: 0, z: 300 }]] as const) {
    const pose = framePose(pts, cam, 75, aspect, 0.8)!
    const max = Math.max(...pts.map(p => { const s = ndc(p, pose.pos, pose.at, 75, aspect); return Math.max(Math.abs(s.x), Math.abs(s.y)) }))
    assert.ok(max <= 0.8 + 1e-9 && max > 0.6, `max ${max}`)
  }
  assert.equal(framePose([], { x: 0, y: 0, z: 1 }, 75, 1), undefined)
})

test('dolly moves the camera toward its target and back, keeping the direction', () => {
  const at = { x: 10, y: 0, z: 0 }
  assert.deepEqual(dolly({ x: 10, y: 0, z: 100 }, at, 0.5), { x: 10, y: 0, z: 50 })
  assert.deepEqual(dolly({ x: 10, y: 0, z: 100 }, at, 2), { x: 10, y: 0, z: 200 })
})

test('centres the framed points on screen and fills the share on the binding side', () => {
  const pts = [{ x: -300, y: 10, z: 40 }, { x: 260, y: -50, z: -80 }, { x: 0, y: 120, z: 300 }, { x: 30, y: -90, z: 150 }, { x: 400, y: 200, z: -200 }]
  for (const [aspect, cam] of [[1176 / 856, { x: 0, y: 0, z: 1000 }], [390 / 600, { x: 700, y: 0, z: 300 }]] as const) {
    const pose = framePose(pts, cam, 75, aspect, 0.8)!
    const s = pts.map(p => ndc(p, pose.pos, pose.at, 75, aspect))
    const xs = s.map(p => p.x), ys = s.map(p => p.y)
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
    const ex = (Math.max(...xs) - Math.min(...xs)) / 2, ey = (Math.max(...ys) - Math.min(...ys)) / 2
    assert.ok(Math.abs(cx) < 0.02 && Math.abs(cy) < 0.02, `centre ${cx} ${cy}`)
    assert.ok(Math.abs(Math.max(ex, ey) - 0.8) < 0.02, `fill ${ex} ${ey}`)
  }
})

test('puts superseded notes last in search and the list, the list by project', () => {
  const g = demoGraph()
  const proj = projectOf(g)
  assert.equal(proj.get('m:recall'), 'switchboard')
  assert.equal(proj.get('m:logo'), 'Armasu')
  assert.equal(proj.get('rule:global'), undefined)
  const hits = findNodes([{ id: 'a', kind: 'memory', label: 'ask-old', superseded: true }, { id: 'b', kind: 'memory', label: 'ask-new-longer' }], 'ask', new Set())
  assert.deepEqual(hits.map(h => h.id), ['b', 'a'])
  const rows = listNodes(g.nodes.filter(n => n.type === 'project'), '', new Set(), proj)
  assert.deepEqual(rows.map(n => n.id), ['m:logo', 'm:vision', 'm:recall', 'm:askall'])
})

test('counts notes and only the links notes make', () => {
  assert.deepEqual(graphCounts(demoGraph()), { notes: 10, links: 9 })
})

test('splits the health line into parts holding the node ids to show', () => {
  const g = demoGraph()
  const parts = healthParts({ ...g.health, duplicates: ['recall-tool'] }, g.nodes)
  assert.deepEqual(parts.map(p => p.text), ['1 note with broken links', '1 unlinked note', '1 shared name', '1 contradiction', '1 superseded note'])
  assert.deepEqual(parts.find(p => p.text === '1 contradiction')!.ids, ['m:nograph', 'm:recall'])
  assert.deepEqual(parts.find(p => p.text === '1 shared name')!.ids, ['m:recall'])
})

test('says how long ago in the largest whole unit', () => {
  const now = Date.parse('2026-11-21T12:00:00Z'), m = 6e4
  assert.deepEqual([20e3, 5 * m, 130 * m, 3 * 1440 * m, 45 * 1440 * m].map(d => ago(now - d, now)), ['just now', '5m ago', '2h ago', '3d ago', '6w ago'])
  assert.equal(ago(now + m, now), 'just now')
})

test('the big demo dates its notes over about 60 days, a few today', () => {
  const now = Date.now(), days = demoGraph(true).nodes.filter(n => n.modified).map(n => (now - Date.parse(n.modified!)) / 864e5)
  assert.ok(days.filter(d => d < 1).length >= 4)
  assert.ok(Math.max(...days) > 50 && Math.max(...days) <= 61)
})

test('bare projects: a project with chats but no notes is left out, one with notes stays', () => {
  const nodes = [
    { id: 'p1', kind: 'project', label: 'Armasu' },
    { id: 'p2', kind: 'project', label: 'Empty' },
    { id: 'n1', kind: 'memory', label: 'a note' },
  ]
  const place = new Map([['p1', 'Armasu'], ['p2', 'Empty'], ['n1', 'Armasu']])
  assert.deepEqual([...bareProjects(nodes, place)], ['p2'])
})
