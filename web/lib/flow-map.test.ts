import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NODE_H, NODE_W, cardOf, projectOf, demoFlowMap, foldView, layoutView, neighbours, sidesOf, type FlowEdge, type FlowMap, type FlowNode } from './flow-map'

test('folders stand in for their files until opened, edges merge and modes filter', () => {
  const map = demoFlowMap()
  const shut = foldView(map, 'code', new Set())
  assert.deepEqual(shut.nodes.map(n => n.id).sort(), ['d:extension/src', 'd:web/app', 'd:web/lib'])
  assert.deepEqual(shut.edges, [{ from: 'd:web/app', to: 'd:web/lib', kind: 'import', n: 2 }])
  const open = foldView(map, 'code', new Set(['d:web/lib']))
  assert.ok(open.nodes.some(n => n.id === 'f:web/lib/today.ts'))
  assert.ok(open.edges.some(e => e.from === 'f:web/lib/today.ts' && e.to === 'f:web/lib/todo.ts'))
  assert.ok(foldView(map, 'work', new Set()).nodes.every(n => n.kind !== 'folder' && n.kind !== 'file'))
  assert.ok(foldView(map, 'both', new Set()).edges.some(e => e.from === 'chat:a' && e.to === 'd:web/lib' && e.kind === 'touched'))
})

test('search keeps hits and their neighbours', () => {
  const v = foldView(demoFlowMap(), 'both', new Set(), 'playwright')
  assert.deepEqual(v.nodes.map(n => n.id).sort(), ['chat:a', 'plugin:playwright'])
  assert.equal(v.nodes.find(n => n.id === 'plugin:playwright')?.hit, true)
})

test('the card says what a part is, what it links to and which chats changed it', () => {
  const map = demoFlowMap()
  const lib = cardOf(map, 'd:web/lib')!
  assert.equal(lib.about, 'Small helpers the pages share.')
  assert.deepEqual(lib.usedBy, ['web/app'])
  assert.equal(lib.history[0].who, 'Today card v2')
  assert.ok(lib.history[0].with.includes('playwright'))
  assert.deepEqual(cardOf(map, 'role:engineer')!.history.map(h => h.who), ['Hub state cleanup', 'Today card v2'])
  assert.match(cardOf(map, 'f:web/lib/todo.ts')!.about, /no header comment/)
})

// Shaped like a real project: 21 folders, 36 chats, ~50 tools, a few hundred edges.
function big(): FlowMap {
  const nodes: FlowNode[] = [], edges: FlowEdge[] = []
  for (let d = 0; d < 21; d++) {
    nodes.push({ id: `d:src/d${d}`, kind: 'folder', label: `src/d${d}` })
    for (let f = 0; f < 15; f++) nodes.push({ id: `f:src/d${d}/f${f}.ts`, kind: 'file', label: `src/d${d}/f${f}.ts`, folder: `d:src/d${d}` })
  }
  for (let i = 0; i < 300; i++) edges.push({ from: `f:src/d${i % 21}/f${i % 15}.ts`, to: `f:src/d${(i * 7) % 21}/f${(i * 3) % 15}.ts`, kind: 'import', n: 1 })
  const kinds = ['skill', 'plugin', 'mod', 'role'] as const
  for (let t = 0; t < 49; t++) nodes.push({ id: `${kinds[t % 4]}:t${t}`, kind: kinds[t % 4], label: `t${t}` })
  for (let c = 0; c < 36; c++) {
    nodes.push({ id: `chat:${c}`, kind: 'chat', label: `chat ${c}`, at: c * 1000 })
    for (let k = 0; k < 8; k++) { const t = (c + k * 5) % 49; edges.push({ from: `chat:${c}`, to: `${kinds[t % 4]}:t${t}`, kind: 'used', n: 2 }) }
    for (let k = 0; k < 8; k++) edges.push({ from: `chat:${c}`, to: `f:src/d${(c + k) % 21}/f${k}.ts`, kind: 'touched', n: 1, at: c })
  }
  return { project: 'big', nodes, edges, builtAt: 0 }
}

test('the layout puts lanes left to right, never overlaps and keeps a big map near the screen shape', () => {
  const v = foldView(big(), 'both', new Set())
  const l = layoutView(v.nodes, v.edges, 1.6)
  assert.deepEqual(l.lanes.map(x => x.name), ['Code', 'Chats', 'Skills, plugins, mods and roles'])
  assert.equal(l.at.size, v.nodes.length)
  const seen = new Set<string>()
  for (const p of l.at.values()) { const k = `${p.x},${p.y}`; assert.ok(!seen.has(k), `overlap at ${k}`); seen.add(k) }
  for (const p of l.at.values()) { assert.ok(p.x >= 0 && p.x + NODE_W <= l.width && p.y >= 0 && p.y + NODE_H <= l.height) }
  const ratio = l.width / l.height
  assert.ok(ratio > 0.8 && ratio < 3.2, `ratio ${ratio}`)
  const lane = (k: string) => l.at.get(v.nodes.find(n => n.kind === k)!.id)!.x
  assert.ok(lane('folder') < lane('chat') && lane('chat') < lane('skill'))
  // newest chat on top
  assert.deepEqual(l.at.get('chat:35'), { x: l.lanes[1].x, y: 0 })
})

test('an open folder sits right above its files, and it scales to every file open', () => {
  const map = big()
  const open = new Set(map.nodes.filter(n => n.kind === 'folder').map(n => n.id))
  const v = foldView(map, 'code', open)
  const l = layoutView(v.nodes, v.edges, 1.6)
  assert.equal(l.at.size, 21 + 315)
  const order = [...l.at.entries()].sort((a, b) => a[1].x - b[1].x || a[1].y - b[1].y).map(([id]) => id)
  assert.equal(order[0], 'd:src/d0')
  assert.ok(order[1].startsWith('f:src/d0/'))
  assert.ok(l.width / l.height < 3.2)
})

test('edges leave toward the other node, or loop on the right within a column; neighbours go both ways', () => {
  assert.deepEqual(sidesOf({ x: 0 }, { x: 300 }), { from: 'r', to: 'l' })
  assert.deepEqual(sidesOf({ x: 300 }, { x: 0 }), { from: 'l', to: 'r' })
  assert.deepEqual(sidesOf({ x: 5 }, { x: 5 }), { from: 'r', to: 'r' })
  const nb = neighbours(foldView(demoFlowMap(), 'both', new Set()).edges)
  assert.ok(nb.get('role:engineer')!.has('chat:a') && nb.get('chat:a')!.has('role:engineer'))
})

test('hidden kinds drop out with their edges', () => {
  const v = foldView(demoFlowMap(), 'both', new Set(), '', new Set(['plugin', 'skill']))
  assert.ok(v.nodes.every(n => n.kind !== 'plugin' && n.kind !== 'skill'))
  assert.ok(v.edges.every(e => !e.to.startsWith('plugin:') && !e.to.startsWith('skill:')))
})

test('the picker folds a chat folder into its registered project', () => {
  const projects = ['/r/agent-flow', '/r/agent-flow/extension', '/r/other']
  assert.equal(projectOf(projects, '/r/agent-flow/web'), '/r/agent-flow')
  assert.equal(projectOf(projects, '/r/agent-flow/extension/src'), '/r/agent-flow/extension')
  assert.equal(projectOf(projects, '/r/other'), '/r/other')
  assert.equal(projectOf(projects, '/r/agent-flow-x'), undefined)
  assert.equal(projectOf(projects, '/tmp/x'), undefined)
})
