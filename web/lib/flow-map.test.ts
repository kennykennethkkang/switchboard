import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KIND_NAME, NODE_H, NODE_W, boxH, READ, boxText, cardOf, openView, projectOf, quietEdges, startProject, toggleOpen, withTree, demoFlowMap, foldView, layoutView, neighbours, sidesOf, type FlowEdge, type FlowKind, type FlowMap, type FlowNode } from './flow-map'

test('the folder tree opens one level at a time; edges go to the deepest drawn folder', () => {
  const map = demoFlowMap()
  const chatless = new Set<FlowKind>(['chat', 'skill', 'plugin', 'mod', 'role'])
  const shut = foldView(map, new Set(), '', chatless)
  assert.deepEqual(shut.nodes.map(n => n.id).sort(), ['d:extension', 'd:web'])
  assert.deepEqual(shut.nodes.find(n => n.id === 'd:web')!.subs, 2)
  assert.deepEqual(shut.edges, [])
  const web = foldView(map, new Set(['d:web']), '', chatless)
  assert.deepEqual(web.nodes.map(n => n.id).sort(), ['d:extension', 'd:web', 'd:web/components', 'd:web/lib'])
  assert.deepEqual(web.edges, [{ from: 'd:web/components', to: 'd:web/lib', kind: 'import', n: 2 }])
  const open = foldView(map, new Set(['d:web', 'd:web/lib']))
  assert.ok(open.nodes.some(n => n.id === 'f:web/lib/today.ts'))
  assert.ok(open.edges.some(e => e.from === 'f:web/lib/now.ts' && e.to === 'f:web/lib/today.ts'))
  const all = foldView(map, new Set())
  for (const k of ['folder', 'chat', 'skill', 'plugin', 'role'] as const) assert.ok(all.nodes.some(n => n.kind === k), k)
  assert.ok(all.edges.some(e => e.from === 'chat:a' && e.to === 'd:web' && e.kind === 'touched'))
})

// 100 nested folders, the new data shape: every folder names its parent.
function deep(): FlowMap {
  const nodes: FlowNode[] = [], edges: FlowEdge[] = []
  for (let a = 0; a < 4; a++) {
    nodes.push({ id: `d:a${a}`, kind: 'folder', label: `a${a}` })
    for (let b = 0; b < 4; b++) {
      nodes.push({ id: `d:a${a}/b${b}`, kind: 'folder', label: `a${a}/b${b}`, folder: `d:a${a}` })
      for (let c = 0; c < 5; c++) {
        const d = `a${a}/b${b}/c${c}`
        nodes.push({ id: `d:${d}`, kind: 'folder', label: d, folder: `d:a${a}/b${b}` })
        nodes.push({ id: `f:${d}/x.ts`, kind: 'file', label: `${d}/x.ts`, folder: `d:${d}` })
        edges.push({ from: `f:${d}/x.ts`, to: `f:a${(a + 1) % 4}/b0/c0/x.ts`, kind: 'import', n: 1 })
      }
    }
  }
  return { project: 'deep', nodes, edges, builtAt: 0 }
}

test('a big nested repo opens on its top folders only, each with its child count', () => {
  const map = deep()
  assert.equal(map.nodes.filter(n => n.kind === 'folder').length, 100)
  const v = foldView(map, new Set())
  assert.deepEqual(v.nodes.map(n => n.id).sort(), ['d:a0', 'd:a1', 'd:a2', 'd:a3'])
  assert.equal(v.nodes[0].subs, 4)
  assert.equal(v.nodes[0].files, 0)
  assert.ok(v.edges.every(e => e.from.split('/').length === 1 && e.to.split('/').length === 1))
  const one = foldView(map, new Set(['d:a0']))
  assert.equal(one.nodes.length, 8)
  assert.equal(one.nodes.find(n => n.id === 'd:a0/b1')!.subs, 5)
})

test('old data (folders cut at 3 levels, no parents) gets its missing ancestors', () => {
  const map: FlowMap = { project: 'old', builtAt: 0, edges: [], nodes: [
    { id: 'd:.', kind: 'folder', label: 'old' },
    { id: 'f:readme.ts', kind: 'file', label: 'readme.ts', folder: 'd:.' },
    { id: 'd:x/y/z', kind: 'folder', label: 'x/y/z' },
    { id: 'f:x/y/z/w/deep.ts', kind: 'file', label: 'x/y/z/w/deep.ts', folder: 'd:x/y/z' },
  ] }
  const t = withTree(map)
  assert.equal(t.nodes.find(n => n.id === 'd:x/y')?.folder, 'd:x')
  assert.equal(t.nodes.find(n => n.id === 'd:x')?.folder, undefined)
  assert.equal(t.nodes.find(n => n.id === 'd:x/y/z')?.folder, 'd:x/y')
  assert.deepEqual(foldView(map, new Set()).nodes.map(n => n.id).sort(), ['d:.', 'd:x'])
  assert.ok(foldView(map, new Set(['d:x', 'd:x/y', 'd:x/y/z'])).nodes.some(n => n.id === 'f:x/y/z/w/deep.ts'))
  assert.equal(cardOf(map, 'd:x')?.kind, 'Folder')
  assert.equal(withTree(t), withTree(t), 'cached')
})

test('folding a folder closes everything under it', () => {
  const open = toggleOpen(new Set(['d:a0', 'd:a0/b1', 'd:a0/b1/c2', 'd:a1']), 'd:a0')
  assert.deepEqual([...open].sort(), ['d:a1'])
  assert.deepEqual([...toggleOpen(new Set(), 'd:a0')], ['d:a0'])
})

test('search looks through every node, and opens the folders a hit sits in', () => {
  const v = foldView(deep(), new Set(), 'a2/b3/c4/x')
  const hit = v.nodes.find(n => n.hit)
  assert.equal(hit?.id, 'f:a2/b3/c4/x.ts')
  assert.equal(foldView(deep(), new Set(), '').nodes.some(n => n.hit), false)
})

test('a wall of imports inside one lane rests hidden; few imports always show', () => {
  const many = foldView(deep(), new Set(['d:a0', 'd:a1', 'd:a2', 'd:a3', 'd:a0/b0', 'd:a1/b0', 'd:a2/b0', 'd:a3/b0', 'd:a0/b1', 'd:a1/b1', 'd:a2/b1', 'd:a3/b1']))
  assert.ok(many.edges.filter(e => e.kind === 'import').length > 40)
  const quiet = quietEdges(many.nodes, many.edges)
  assert.ok(quiet.size > 40)
  const few = foldView(demoFlowMap(), new Set(['d:web', 'd:web/lib']))
  assert.equal(quietEdges(few.nodes, few.edges).size, 0)
})

test('box words: skills drop their plugin onto the small line, folders count both kinds', () => {
  assert.deepEqual(boxText({ id: 'skill:superpowers:tdd', kind: 'skill', label: 'superpowers:tdd', chats: 2 }), { name: 'tdd', meta: 'superpowers, 2 chats' })
  assert.deepEqual(boxText({ id: 'skill:aar', kind: 'skill', label: 'aar' }), { name: 'aar', meta: 'Skill' })
  assert.deepEqual(boxText({ id: 'f:app/api/route.ts', kind: 'file', label: 'app/api/route.ts', folder: 'd:app/api' }), { name: 'route.ts', meta: 'app/api' })
  assert.deepEqual(boxText({ id: 'f:x.ts', kind: 'file', label: 'x.ts', folder: 'd:.' }), { name: 'x.ts', meta: 'File' })
  const long = boxText({ id: 'f:app/(dash)/settings/billing/invoices/[id]/route.ts', kind: 'file', label: 'app/(dash)/settings/billing/invoices/[id]/route.ts' }).meta
  assert.ok(long.startsWith('...') && long.endsWith('invoices/[id]') && long.length <= 30, long)
  assert.deepEqual(boxText({ id: 'd:a/b', kind: 'folder', label: 'a/b', folder: 'd:a', subs: 2, files: 1 }), { name: 'b', meta: '2 folders, 1 file' })
  assert.deepEqual(boxText({ id: 'd:a', kind: 'folder', label: 'a', subs: 0, files: 3, open: true }), { name: 'a', meta: '3 files, open' })
})

test('the map opens on this window\'s project, then the last pick, then the chat\'s', () => {
  const cwds = ['/r/a', '/r/b', '/r/c']
  assert.equal(startProject(cwds, '/r/a', '/r/b', '/r/c'), '/r/a')
  assert.equal(startProject(cwds, undefined, '/r/b', '/r/c'), '/r/b')
  assert.equal(startProject(cwds, undefined, '/r/gone', '/r/c'), '/r/c')
  assert.equal(startProject(cwds, undefined, undefined, undefined), '/r/a')
})

test('search keeps hits and their neighbours', () => {
  const v = foldView(demoFlowMap(), new Set(), 'playwright')
  assert.deepEqual(v.nodes.map(n => n.id).sort(), ['chat:a', 'plugin:playwright'])
  assert.equal(v.nodes.find(n => n.id === 'plugin:playwright')?.hit, true)
})

test('the card says what a part is, what it links to and which chats changed it', () => {
  const map = demoFlowMap()
  const lib = cardOf(map, 'd:web/lib')!
  assert.equal(lib.about, 'Small helpers the pages share.')
  assert.deepEqual(lib.usedBy, ['web/components/switchboard'])
  assert.equal(lib.history[0].who, 'Today card v2')
  assert.ok(lib.history[0].with.includes('playwright'))
  assert.deepEqual(cardOf(map, 'role:engineer')!.history.map(h => h.who), ['Hub state cleanup', 'Today card v2'])
  assert.match(cardOf(map, 'f:web/lib/todo.ts')!.about, /no header comment/)
  assert.equal(cardOf(map, 'role:engineer')!.kind, 'Role')
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

test('chat boxes are taller for a three line name, and the rows below them make room', () => {
  const v = foldView(big(), new Set())
  const l = layoutView(v.nodes, v.edges, 1.6)
  assert.ok(boxH('chat') > NODE_H && boxH('skill') === NODE_H)
  const chats = v.nodes.filter(n => n.kind === 'chat').map(n => l.at.get(n.id)!)
  for (const a of chats) {
    assert.ok(a.y + boxH('chat') <= l.height)
    for (const b of chats) if (a !== b && a.x === b.x) assert.ok(Math.abs(a.y - b.y) >= boxH('chat'), 'chat boxes overlap')
  }
})

test('the layout puts lanes left to right, never overlaps and keeps a big map near the screen shape', () => {
  const v = foldView(big(), new Set())
  const l = layoutView(v.nodes, v.edges, 1.6)
  assert.deepEqual(l.lanes.map(x => x.name), ['Folders', 'Chats', 'Skills, plugins, mods and roles'])
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
  const v = foldView(map, open, '', new Set(['chat', 'skill', 'plugin', 'mod', 'role']))
  const l = layoutView(v.nodes, v.edges, 1.6)
  assert.equal(l.at.size, 21 + 315)
  assert.equal(l.lanes[0].count, 21, 'the Folders lane counts folders, not their files')
  const order = [...l.at.entries()].sort((a, b) => a[1].x - b[1].x || a[1].y - b[1].y).map(([id]) => id)
  assert.equal(order[0], 'd:d0')
  assert.ok(order[1].startsWith('f:d0/'))
  assert.ok(l.width / l.height < 3.2)
})

test('edges leave toward the other node, or loop on the right within a column; neighbours go both ways', () => {
  assert.deepEqual(sidesOf({ x: 0 }, { x: 300 }), { from: 'r', to: 'l' })
  assert.deepEqual(sidesOf({ x: 300 }, { x: 0 }), { from: 'l', to: 'r' })
  assert.deepEqual(sidesOf({ x: 5 }, { x: 5 }), { from: 'r', to: 'r' })
  const nb = neighbours(foldView(demoFlowMap(), new Set()).edges)
  assert.ok(nb.get('role:engineer')!.has('chat:a') && nb.get('chat:a')!.has('role:engineer'))
})

test('an open folder and its shown files light each other up', () => {
  const v = foldView(demoFlowMap(), new Set(['d:web', 'd:web/lib']))
  const nb = neighbours(v.edges, v.nodes)
  assert.ok(nb.get('d:web/lib')!.has('f:web/lib/today.ts') && nb.get('f:web/lib/today.ts')!.has('d:web/lib'))
  assert.ok(!nb.get('d:extension/src/hub')?.has('f:extension/src/hub/routes.ts'), 'a shut folder has no files drawn')
})

test('hidden kinds drop out with their edges', () => {
  const v = foldView(demoFlowMap(), new Set(), '', new Set(['plugin', 'skill']))
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

test('a tool counts the drawn chats that used it, for its box', () => {
  const v = foldView(demoFlowMap(), new Set())
  assert.equal(v.nodes.find(n => n.id === 'role:engineer')!.chats, 2)
  assert.equal(v.nodes.find(n => n.id === 'plugin:playwright')!.chats, 1)
  assert.equal(v.nodes.find(n => n.id === 'chat:a')!.chats, undefined)
  assert.equal(foldView(demoFlowMap(), new Set(), '', new Set(['chat'])).nodes.find(n => n.id === 'role:engineer')!.chats, undefined, 'hidden chats are not counted')
})

test('a map too big to read at full fit opens at a readable zoom from the top left', () => {
  assert.equal(openView({ width: 900, height: 500 }, 1600, 1000), 'fit')
  const v = openView({ width: 1200, height: 3000 }, 1600, 1000)
  assert.ok(v !== 'fit' && v.zoom === READ && v.x > 0 && v.y > 40 * READ, 'lane titles stay on screen')
})

test('a map wider than a narrow canvas at READ zoom opens fitted to the width', () => {
  const v = openView({ width: 928, height: 1400 }, 760, 900)
  assert.ok(v !== 'fit' && v.zoom < READ && v.x + 928 * v.zoom <= 760 - 72, 'third lane stays on screen')
})

test('a big map never runs wider than maxW: it grows rows and scrolls down instead', () => {
  const v = foldView(big(), new Set())
  const wide = layoutView(v.nodes, v.edges, 1.8)
  const capped = layoutView(v.nodes, v.edges, 1.8, wide.width * 0.7)
  assert.ok(capped.width <= wide.width * 0.7 && capped.height > wide.height)
  assert.deepEqual(layoutView(v.nodes, v.edges, 1.8, 1e9), wide)
})
