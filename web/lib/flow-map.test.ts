import { test } from 'node:test'
import assert from 'node:assert/strict'
import { components, demoAppMap, groupTies, layers, routeLinks, KIND_NAME, projectOf, startProject, demoFlowMap, type FlowEdge, type FlowMap, type FlowNode } from './flow-map'
import type { MemoryGraph } from './memory-graph'

test('the map opens on this window\'s project, then the last pick, then the chat\'s', () => {
  const cwds = ['/r/a', '/r/b', '/r/c']
  assert.equal(startProject(cwds, '/r/a', '/r/b', '/r/c'), '/r/a')
  assert.equal(startProject(cwds, undefined, '/r/b', '/r/c'), '/r/b')
  assert.equal(startProject(cwds, undefined, '/r/gone', '/r/c'), '/r/c')
  assert.equal(startProject(cwds, undefined, undefined, undefined), '/r/a')
})

test('the demo points at files that exist and names roles plainly', () => {
  const ids = demoFlowMap().nodes.map(n => n.id)
  assert.ok(!ids.includes('f:extension/src/hub.ts'))
  assert.ok(ids.includes('f:extension/src/hub/routes.ts') && ids.includes('f:extension/src/hub/graph.ts'))
  assert.equal(KIND_NAME.role, 'Role')
})

// Shaped like a real project: 21 folders, 36 chats, ~50 tools, a few hundred edges.
function big(): FlowMap {
  const nodes: FlowNode[] = [], edges: FlowEdge[] = []
  for (let d = 0; d < 21; d++) {
    nodes.push({ id: `d:d${d}`, kind: 'folder', label: `d${d}` })
    for (let f = 0; f < 15; f++) nodes.push({ id: `f:d${d}/f${f}.ts`, kind: 'file', label: `d${d}/f${f}.ts`, folder: `d:d${d}` })
  }
  for (let i = 0; i < 300; i++) edges.push({ from: `f:d${i % 21}/f${i % 15}.ts`, to: `f:d${(i * 7) % 21}/f${(i * 3) % 15}.ts`, kind: 'import', n: 1 })
  const kinds = ['skill', 'plugin', 'mod', 'role'] as const
  for (let t = 0; t < 49; t++) nodes.push({ id: `${kinds[t % 4]}:t${t}`, kind: kinds[t % 4], label: `t${t}` })
  for (let c = 0; c < 36; c++) {
    nodes.push({ id: `chat:${c}`, kind: 'chat', label: `chat ${c}`, at: c * 1000 })
    for (let k = 0; k < 8; k++) { const t = (c + k * 5) % 49; edges.push({ from: `chat:${c}`, to: `${kinds[t % 4]}:t${t}`, kind: 'used', n: 2 }) }
    for (let k = 0; k < 8; k++) edges.push({ from: `chat:${c}`, to: `f:d${(c + k) % 21}/f${k}.ts`, kind: 'touched', n: 1, at: c })
  }
  return { project: 'big', nodes, edges, builtAt: 0 }
}


test('the picker folds a chat folder into its registered project', () => {
  const projects = ['/r/agent-flow', '/r/agent-flow/extension', '/r/other']
  assert.equal(projectOf(projects, '/r/agent-flow/web'), '/r/agent-flow')
  assert.equal(projectOf(projects, '/r/agent-flow/extension/src'), '/r/agent-flow/extension')
  assert.equal(projectOf(projects, '/r/other'), '/r/other')
  assert.equal(projectOf(projects, '/r/agent-flow-x'), undefined)
  assert.equal(projectOf(projects, '/tmp/x'), undefined)
})

test('components: top folders, a dominant one split a level down, with files, chats and their tools', () => {
  const { parts, links } = components(demoAppMap())
  const ids = parts.map(p => p.id).sort()
  assert.deepEqual(ids, ['c:app', 'c:extension/src', 'c:extension/test', 'c:web/app', 'c:web/components', 'c:web/lib'])
  const lib = parts.find(p => p.id === 'c:web/lib')!
  assert.equal(lib.name, 'lib')
  assert.ok(lib.files.includes('web/lib/today.ts'))
  assert.equal(lib.about, 'Small helpers the pages share.')
  assert.deepEqual(lib.chats.map(c => c.label), ['Today card v2'])
  const tools = Object.fromEntries(lib.tools.map(t => [t.label, t.n]))
  assert.equal(tools.playwright, 1)
  assert.equal(tools.engineer, 1)
  const ui = links.find(l => l.from === 'c:web/components' && l.to === 'c:web/lib')!
  assert.ok(ui.n >= 2, 'imports are summed')
  assert.ok(!links.some(l => l.from === l.to), 'no self links')
})

test('components: a small repo is not split, root files get their own part', () => {
  const map: FlowMap = { project: 'p', builtAt: 0, edges: [{ from: 'f:a.ts', to: 'f:src/b.ts', kind: 'import', n: 1 }], nodes: [
    { id: 'f:a.ts', kind: 'file', label: 'a.ts' }, { id: 'f:src/b.ts', kind: 'file', label: 'src/b.ts', folder: 'd:src' }, { id: 'f:lib/c.ts', kind: 'file', label: 'lib/c.ts', folder: 'd:lib' },
  ] }
  const { parts, links } = components(map)
  assert.deepEqual(parts.map(p => p.id).sort(), ['c:.', 'c:lib', 'c:src'])
  assert.equal(parts.find(p => p.id === 'c:.')!.name, 'p')
  assert.deepEqual(links, [{ from: 'c:.', to: 'c:src', n: 1 }])
})

test('components: flow depth runs entry first, cycles do not loop, loners go last', () => {
  const f = (p: string): FlowNode => ({ id: `f:${p}`, kind: 'file', label: p })
  const imp = (a: string, b: string): FlowEdge => ({ from: `f:${a}`, to: `f:${b}`, kind: 'import', n: 1 })
  const map: FlowMap = { project: 'p', builtAt: 0, nodes: ['a/x.ts', 'b/x.ts', 'c/x.ts', 'd/x.ts'].map(f), edges: [imp('a/x.ts', 'b/x.ts'), imp('b/x.ts', 'c/x.ts'), imp('c/x.ts', 'b/x.ts')] }
  const { parts, order } = components(map)
  const depth = Object.fromEntries(parts.map(p => [p.id, p.depth]))
  assert.equal(depth['c:a'], 0)
  assert.equal(depth['c:b'], 1)
  assert.equal(depth['c:c'], 2)
  assert.equal(depth['c:d'], 3)
  assert.ok(parts.find(p => p.id === 'c:d')!.alone)
  assert.deepEqual(order, ['c:a', 'c:b', 'c:c', 'c:d'])
})

test('components: memory notes match by path or file name, project notes kept apart', () => {
  const mem: MemoryGraph = { health: { dangling: [], orphans: [], duplicates: [], contradictions: [], superseded: [], invalid: [], stale: [], loops: [] },
    nodes: [
      { id: 'project:/w/switchboard', kind: 'project', label: 'switchboard' }, { id: 'project:/w/other', kind: 'project', label: 'other' },
      { id: 'm:1', kind: 'memory', label: 'today-card', text: 'today.ts reads the hub once' },
      { id: 'm:2', kind: 'memory', label: 'routes', description: 'extension/src owns the routes' },
      { id: 'm:3', kind: 'memory', label: 'vision', text: 'Keep it simple' },
      { id: 'm:4', kind: 'memory', label: 'elsewhere', text: 'today.ts in another repo' },
    ],
    edges: ['m:1', 'm:2', 'm:3'].map(s => ({ source: s, target: 'project:/w/switchboard', kind: 'in' as const })).concat([{ source: 'm:4', target: 'project:/w/other', kind: 'in' }]) }
  const { parts, notes } = components(demoAppMap(), mem, '/w/switchboard')
  assert.deepEqual(parts.find(p => p.id === 'c:web/lib')!.notes.map(n => n.id), ['m:1'])
  assert.deepEqual(parts.find(p => p.id === 'c:extension/src')!.notes.map(n => n.id), ['m:2'])
  assert.deepEqual(notes.map(n => n.id).sort(), ['m:1', 'm:2', 'm:3'])
})

test('routes: no line runs through a box it does not start or end at, on the demo and a big tangled repo', () => {
  for (const map of [demoAppMap(), big()]) {
    const { parts, links } = components(map)
    const { at } = layers(parts, links)
    const paths = routeLinks(parts, links, at)
    assert.equal(paths.size, links.length)
  }
})

test('routes: every turn is a right angle, out of the right side, into the left', () => {
  const { parts, links } = components(demoAppMap())
  const { at } = layers(parts, links)
  const paths = routeLinks(parts, links, at)
  for (const l of links) {
    const pts = paths.get(`${l.from}>${l.to}`)!
    for (let i = 1; i < pts.length; i++) assert.ok(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y, `${l.from} ${i}`)
    assert.equal(pts[0].x, at.get(l.from)!.x + 232)
    assert.equal(pts[pts.length - 1].x, at.get(l.to)!.x)
  }
})

test('groupTies: chat nodes of one group, chained', () => {
  const m = demoFlowMap()
  assert.deepEqual(groupTies(m), [{ from: 'chat:a', to: 'chat:b', group: m.nodes.find(n => n.id === 'chat:a')!.group }])
  assert.ok(m.nodes.find(n => n.id === 'chat:a')!.group)
  assert.deepEqual(groupTies({ ...m, nodes: m.nodes.map(n => ({ ...n, group: undefined })) }), [])
})
