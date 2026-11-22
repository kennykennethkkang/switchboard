import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLACES, buildCourt, markSpot, courtSummary, chatOf, courtEvents, fitCourt, forcedSpot, freeSpot, lod, movedFrom, PLATE, realmPlaque, type Box, type Court, type CourtNode } from './court-map'
import { emptyHub } from './hub-demo'
import type { ChatProgress, ChatRow, Helper, HubState, RoleStep } from './hub-types'

const NOW = 1_800_000_000_000
const ROLES = ['researcher', 'engineer', 'qa', 'designer', 'ops', 'growth']
const chat = (id: string, ai: ChatRow['ai'] = 'claude', live = true): ChatRow => ({ pid: 1, sessionId: id, cwd: '/x', link: '', live, why: [], ai, name: id })
const prog = (p: Partial<ChatProgress> & { sessionId: string }): ChatProgress =>
  ({ cwd: '/x', state: 'working', roles: [], tasks: [], startedAt: NOW - 60e3, at: NOW, ...p })
const hub = (over: Partial<HubState>): HubState => ({ ...emptyHub(), ...over })

// n chats spread over Claude, Codex and Hermes with 0 to 6 roles each.
function many(n: number): HubState {
  const ais: ChatRow['ai'][] = ['claude', 'claude', 'codex', 'hermes']
  const chats = Array.from({ length: n }, (_, i) => chat(`c${i}`, ais[i % ais.length]))
  const progress = chats.map((c, i) => prog({
    sessionId: c.sessionId,
    roles: ROLES.slice(0, i % 7).map((role, k): RoleStep => ({ id: `${c.sessionId}-${k}`, role, state: k % 2 ? 'done' : 'active', startedAt: NOW - k * 1e3 })),
  }))
  return hub({ chats, progress, ais: [{ id: 'hermes', name: 'Hermes', installed: true, chats: 0 }] })
}

const inside = (px: number, py: number, n: CourtNode) => px > n.x + 1 && px < n.x + n.w - 1 && py > n.y + 1 && py < n.y + n.h - 1
type Rect = Pick<CourtNode, 'x' | 'y' | 'w' | 'h'>
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const cross = (p: [number, number], q: [number, number], r: [number, number], s: [number, number]) => {
  const d = (a: [number, number], b: [number, number], c: [number, number]) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
  return d(p, q, r) * d(p, q, s) < 0 && d(r, s, p) * d(r, s, q) < 0
}
const segs = (c: Court) => c.links.flatMap(l => l.points.slice(1).map((q, i) => ({ l, p: l.points[i], q })))

function checkLayout(c: Court) {
  const big = c.nodes.filter(n => n.kind !== 'desk')
  for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++)
    assert.ok(!overlap(big[i], big[j]), `${big[i].id} overlaps ${big[j].id}`)
  for (const d of c.nodes.filter(n => n.kind === 'desk')) {
    const yard = c.nodes.find(n => n.id === d.parent)!
    assert.ok(d.x >= yard.x && d.y >= yard.y && d.x + d.w <= yard.x + yard.w && d.y + d.h <= yard.y + yard.h, `${d.id} outside its courtyard`)
    for (const o of c.nodes) if (o !== d && o.kind === 'desk' && o.parent === d.parent) assert.ok(!overlap(d, o), `${d.id} overlaps ${o.id}`)
  }
  // Bridges between islands never run over an island they do not join.
  for (const { l, p, q } of segs(c)) {
    if (c.nodes.find(n => n.id === l.to)?.kind === 'desk') continue
    const len = Math.hypot(q[0] - p[0], q[1] - p[1])
    for (const n of big) {
      if (n.id === l.from || n.id === l.to) continue
      for (let t = 0; t <= len; t += 4) {
        const x = p[0] + (q[0] - p[0]) * t / len, y = p[1] + (q[1] - p[1]) * t / len
        assert.ok(!inside(x, y, n), `bridge ${l.from}>${l.to} crosses ${n.id}`)
      }
    }
  }
  const s = segs(c)
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++)
    assert.ok(!cross(s[i].p, s[i].q, s[j].p, s[j].q), `${s[i].l.from}>${s[i].l.to} crosses ${s[j].l.from}>${s[j].l.to}`)
}

// 90 chats: past what one home's straight bridges reach, yards chain off sibling yards.
for (const n of [1, 6, 13, 30, 90]) test(`no overlaps with ${n} chats`, () => {
  for (const stage of n === 90 ? [undefined, { w: 1440, h: 846 }, { w: 1280, h: 800 }] : [undefined]) {
    const c = buildCourt(many(n), stage)
    assert.equal(c.nodes.filter(x => x.kind === 'courtyard').length, n)
    checkLayout(c)
  }
})

test('no overlaps on a phone stage either', () => checkLayout(buildCourt(many(13), { w: 390, h: 844 })))

test('every node but the council is reachable along links', () => {
  const c = buildCourt(many(13))
  const seen = new Set(['council']), q = ['council']
  while (q.length) { const id = q.shift()!; for (const l of c.links) if (l.from === id && !seen.has(l.to)) { seen.add(l.to); q.push(l.to) } }
  for (const n of c.nodes) assert.ok(seen.has(n.id), `${n.id} unreachable`)
})

test('integer coordinates everywhere', () => {
  const c = buildCourt(many(6))
  for (const n of c.nodes) for (const v of [n.x, n.y, n.w, n.h]) assert.ok(Number.isInteger(v), `${n.id} ${v}`)
  for (const l of c.links) for (const [x, y] of l.points) assert.ok(Number.isInteger(x) && Number.isInteger(y))
})

test('council at the origin; Claude and Codex always get pavilions, Hermes when the hub has it', () => {
  const c = buildCourt(hub({}))
  const council = c.nodes.find(n => n.kind === 'council')!
  assert.equal(council.x + council.w / 2, 0); assert.equal(council.y + council.h / 2, 0)
  assert.deepEqual(c.nodes.filter(n => n.kind === 'pavilion').map(n => n.ai), ['claude', 'codex', 'research'])
  const research = c.nodes.find(n => n.id === 'ai:research')!
  assert.deepEqual([research.kind, research.label], ['pavilion', 'Research'])
  const c2 = buildCourt(hub({ ais: [{ id: 'hermes', name: 'Hermes', installed: true, chats: 0 }] }))
  assert.ok(c2.nodes.some(n => n.id === 'ai:hermes'))
  assert.ok(c2.nodes.some(n => n.kind === 'garden') && c2.nodes.some(n => n.kind === 'armory'))
})

test('Gemini shows with its key saved, Jev with runs', () => {
  const h = hub({ jev: [{ items: 3, costUsd: 0, seconds: 1, at: NOW }, { items: 1, costUsd: 0, seconds: 1, at: NOW }] })
  h.signIns = { ...h.signIns, keys: [{ name: 'GEMINI_API_KEY', saved: true }] }
  const c = buildCourt(h)
  assert.ok(c.nodes.some(n => n.id === 'ai:gemini'))
  assert.equal(c.nodes.find(n => n.id === 'ai:jev')!.runs, 2)
  assert.equal(c.nodes.find(n => n.id === 'ai:gemini')!.runs, undefined)
})

test('a live crowd-ab run puts Jev on the map with its count', () => {
  const crowdAb = { run: 'r', startedAt: NOW, lastAt: NOW, items: 20, done: 7, ended: false, votes: [], noPreference: 0, feed: [] }
  assert.equal(buildCourt(hub({ crowdAb })).nodes.find(n => n.id === 'ai:jev')!.task, 'Crowd A/B 7/20')
  assert.equal(buildCourt(hub({ crowdAb: { ...crowdAb, ended: true } })).nodes.find(n => n.id === 'ai:jev')!.task, undefined)
  assert.equal(buildCourt(hub({ crowdAb: { ...crowdAb, stopped: true } })).nodes.find(n => n.id === 'ai:jev')!.task, 'Crowd A/B stopped at 7/20')
})

test('desks carry runs, shipped, since and task from the hub; unknowns stay undefined', () => {
  const c = buildCourt(hub({
    chats: [chat('a')],
    progress: [prog({ sessionId: 'a', roles: [
      { id: 'e1', role: 'engineer', state: 'active', startedAt: NOW - 5e3 },
      { id: 'e2', role: 'engineer', state: 'done', startedAt: NOW - 50e3 },
    ], tasks: [{ id: 't', subject: 'Desk plates', status: 'in_progress', role: 'engineer' }] })],
  }))
  const eng = c.nodes.find(n => n.id === 'desk:a:engineer')!
  assert.deepEqual([eng.state, eng.runs, eng.shipped, eng.since, eng.task, eng.chatId, eng.parent], ['working', 2, 1, NOW - 5e3, 'Desk plates', 'a', 'yard:a'])
  const lead = c.nodes.find(n => n.id === 'desk:a:lead')!
  assert.equal(lead.task, undefined); assert.equal(lead.runs, undefined)
  assert.equal(c.petition, undefined)
})

test('a chat that needs you gets a petition from its lead desk to the council', () => {
  const h = many(6)
  h.progress[3] = { ...h.progress[3], state: 'needs-you', question: 'Stripe or Paddle?' }
  const c = buildCourt(h)
  const lead = c.nodes.find(n => n.id === 'desk:c3:lead')!
  assert.equal(lead.state, 'needs'); assert.equal(lead.ask, 'Stripe or Paddle?')
  assert.equal(c.petition!.deskId, lead.id)
  const path = c.petition!.path, council = c.nodes.find(n => n.kind === 'council')!
  assert.deepEqual(path[0], [lead.x + lead.w / 2, lead.y + lead.h / 2].map(Math.round))
  // The walk stops at the council's rim, so its callout leaves the Council label clear.
  const [ex, ey] = path.at(-1)!, [px, py] = path.at(-2)!
  assert.ok(!(ex > council.x && ex < council.x + council.w && ey > council.y && ey < council.y + council.h), 'stops outside the council')
  assert.ok(Math.abs((ex - px) * (0 - py) - (ey - py) * (0 - px)) < 1e3 * Math.hypot(px, py), 'on the road to the council')
  assert.ok(Math.hypot(ex, ey) < Math.hypot(council.w, council.h), 'right at the rim')
  // Every leg but the last runs along a link.
  for (let i = 1; i < path.length - 1; i++) assert.ok(c.links.some(l => l.points.some(p => p[0] === path[i][0] && p[1] === path[i][1])))
})

test('lod: plates when a courtyard is big on screen, one card at mid zoom, dots when tiny', () => {
  assert.equal(lod(1, 400), 'plate')
  assert.equal(lod(0.5, 400), 'card')
  assert.equal(lod(0.1, 400), 'dot')
  assert.equal(lod(2, 150), 'plate')
})

for (const [w, h] of [[1440, 900], [390, 844]]) test(`fitCourt shows the whole court on ${w}x${h}`, () => {
  for (const n of [1, 13]) {
    const c = buildCourt(many(n), { w, h }), f = fitCourt(c, w, h)
    assert.ok(f.zoom > 0)
    for (const nd of c.nodes) {
      const x = nd.x * f.zoom + f.x, y = nd.y * f.zoom + f.y
      assert.ok(x >= 0 && y >= 0 && x + nd.w * f.zoom <= w && y + nd.h * f.zoom <= h, `${nd.id} off screen at ${w}x${h}`)
    }
  }
})

test('at the first zoom that shows plates, a plate never lands on a desk or plate below it, and stays on its island', () => {
  const c = buildCourt(many(13))
  for (const yard of c.nodes.filter(n => n.kind === 'courtyard')) {
    let z = 0.05
    while (lod(z, yard.w) !== 'plate') z += 0.01
    // Same box board.tsx draws: centered under the desk, 2px below it, in CSS px.
    const desks = c.nodes.filter(n => n.parent === yard.id && n.kind === 'desk').map(d => ({ x: d.x * z, y: d.y * z, w: d.w * z, h: d.h * z }))
    const plates = desks.map(d => { const w = Math.min(PLATE.maxW, Math.max(PLATE.minW, d.w - 6)); return { x: d.x + d.w / 2 - w / 2, y: d.y + d.h + 2, w, h: PLATE.h } })
    const hit = (a: typeof plates[0], b: typeof plates[0]) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    plates.forEach((p, i) => {
      desks.forEach((d, j) => assert.ok(i === j || !hit(p, d), `${yard.id} plate ${i} on desk ${j} at zoom ${z.toFixed(2)}`))
      plates.forEach((q, j) => assert.ok(i === j || !hit(p, q), `${yard.id} plate ${i} on plate ${j}`))
      assert.ok(p.x >= yard.x * z && p.y + p.h <= (yard.y + yard.h) * z, `${yard.id} plate ${i} off its island`)
    })
  }
})

test('chatOf walks up to the chat', () => {
  const c = buildCourt(hub({ chats: [chat('a')], progress: [prog({ sessionId: 'a', roles: [{ id: 'r', role: 'qa', state: 'active', startedAt: NOW }] })] }))
  assert.equal(chatOf(c, 'desk:a:qa'), 'a')
  assert.equal(chatOf(c, 'desk:a:lead'), 'a')
  assert.equal(chatOf(c, 'yard:a'), 'a')
  assert.equal(chatOf(c, 'council'), undefined)
  assert.equal(chatOf({ ...c, nodes: [...c.nodes, { id: 'x', kind: 'desk', x: 0, y: 0, w: 1, h: 1, label: 'x', parent: 'yard:a' }] }, 'x'), 'a')
})

test('courtEvents: a new subagent meets its lead, a finished run cheers', () => {
  const step = (state: RoleStep['state']): RoleStep => ({ id: 'r', role: 'qa', state, startedAt: NOW })
  const a = buildCourt(hub({ chats: [chat('a')], progress: [prog({ sessionId: 'a' })] }))
  const b = buildCourt(hub({ chats: [chat('a')], progress: [prog({ sessionId: 'a', roles: [step('active')] })] }))
  const done = buildCourt(hub({ chats: [chat('a')], progress: [prog({ sessionId: 'a', roles: [step('done')] })] }))
  assert.deepEqual(courtEvents(undefined, b), { meet: [], cheer: [], move: [] })
  assert.deepEqual(courtEvents(a, b), { meet: [{ deskId: 'desk:a:qa', leadId: 'desk:a:lead' }], cheer: [], move: [] })
  assert.deepEqual(courtEvents(b, done), { meet: [], cheer: ['desk:a:qa'], move: [] })
  assert.deepEqual(courtEvents(done, done), { meet: [], cheer: [], move: [] })
  // A whole new chat arrives with its desks: no walk.
  const empty = buildCourt(hub({}))
  assert.deepEqual(courtEvents(empty, b).meet, [])
})

// Two windows plus a chat outside both; /w/a is here.
function windowed(n = 3): HubState {
  const cwds = ['/w/a', '/w/a/sub', '/w/b', '/elsewhere']
  const chats = Array.from({ length: n }, (_, i) => ({ ...chat(`c${i}`), cwd: cwds[i % cwds.length] }))
  return hub({ chats, progress: chats.map(c => prog({ sessionId: c.sessionId, cwd: c.cwd })), thisWindow: '/w/a',
    windows: [{ workspace: '/w/b', name: 'Bee', color: 'amber' }, { workspace: '/w/a', name: 'Ay', color: 'violet' }] })
}

test('each VS Code window gets its own island, here first, Other last', () => {
  const c = buildCourt(windowed(4))
  const wins = c.nodes.filter(n => n.kind === 'window')
  assert.deepEqual(wins.map(w => [w.label, w.window, w.color, !!w.here]), [['Ay', '/w/a', 'violet', true], ['Bee', '/w/b', 'amber', false], ['Other', '', undefined, false]])
  const home = (id: string) => c.nodes.find(n => n.id === `yard:${id}`)!.parent
  assert.deepEqual(['c0', 'c1', 'c2', 'c3'].map(home), ['win:/w/a', 'win:/w/a', 'win:/w/b', 'win:'])
  assert.ok(wins.every(w => c.links.some(l => l.from === 'council' && l.to === w.id)))
  checkLayout(c)
})

test('a window with no chats still shows; Other only when needed', () => {
  const c = buildCourt(windowed(2))
  assert.deepEqual(c.nodes.filter(n => n.kind === 'window').map(n => n.label), ['Ay', 'Bee'])
})

test('no windows known: chats hang off their AI pavilion as before', () => {
  const c = buildCourt({ ...windowed(3), windows: undefined })
  assert.equal(c.nodes.filter(n => n.kind === 'window').length, 0)
  assert.ok(c.nodes.filter(n => n.kind === 'courtyard').every(y => y.parent === 'ai:claude'))
})

test('no overlaps with windows and many chats', () => {
  const h = many(13), ws = ['/p/0', '/p/1', '/p/2']
  checkLayout(buildCourt({ ...h, chats: h.chats.map((c, i) => ({ ...c, cwd: ws[i % 3] })), windows: ws.slice(0, 2).map((w, i) => ({ workspace: w, name: `w${i}`, color: 'teal' })) }, { w: 390, h: 844 }))
})

test('a chain handed to the other AI is marked moved, and a new courtyard fires one move', () => {
  const old = (ai: 'claude' | 'codex', version: number) => ({ sessionId: `o${version}`, ai, name: `fix v${version}`, origin: 'fix', version, cwd: '/x', project: 'x', archivedAt: version })
  const next = { ...chat('b', 'codex'), chain: 'fix' }
  assert.equal(movedFrom({ archive: [old('codex', 1), old('claude', 2)] }, next), 'claude')
  assert.equal(movedFrom({ archive: [old('claude', 1), old('codex', 2)] }, next), undefined)
  assert.equal(movedFrom({ archive: [old('claude', 1)] }, { ...next, chain: undefined }), undefined)
  const before = buildCourt(hub({ chats: [chat('a')] }))
  const after = buildCourt(hub({ chats: [chat('a'), next], archive: [old('claude', 1)] }))
  const yard = after.nodes.find(n => n.id === 'yard:b')!
  assert.equal(yard.from, 'claude')
  assert.ok(after.nodes.filter(n => n.parent === 'yard:b').every(d => d.from === 'claude'))
  assert.deepEqual(courtEvents(before, after).move, [{ yardId: 'yard:b', from: 'claude', to: 'codex' }])
  assert.deepEqual(courtEvents(after, after).move, [])
})

test('engineer-codex and qa-codex are the normal desks run on Codex under a Claude lead', () => {
  const c = buildCourt(hub({
    chats: [chat('a')],
    progress: [prog({ sessionId: 'a', roles: [
      { id: 'x1', role: 'engineer-codex', state: 'active', startedAt: NOW - 5e3 },
      { id: 'x2', role: 'qa-codex', state: 'done', startedAt: NOW - 9e3 },
    ] })],
  }))
  const eng = c.nodes.find(n => n.id === 'desk:a:engineer-codex')!, qa = c.nodes.find(n => n.id === 'desk:a:qa-codex')!
  assert.deepEqual([eng.role, eng.label, eng.ai, eng.state], ['engineer', 'engineer', 'codex', 'working'])
  assert.deepEqual([qa.role, qa.ai], ['qa', 'codex'])
  assert.equal(c.nodes.find(n => n.id === 'desk:a:lead')!.ai, 'claude')
})

const helper = (h: Partial<Helper> & Pick<Helper, 'ai'>): Helper => ({ label: 'call', state: 'done', since: NOW - 4e3, last: NOW - 1e3, count: 1, ...h })

test('realms: a Claude lead\'s Codex desks and Jev calls dock on its courtyard as realms', () => {
  const c = buildCourt(hub({
    chats: [chat('a')],
    progress: [prog({ sessionId: 'a',
      roles: [{ id: 'x1', role: 'engineer-codex', state: 'active', startedAt: NOW - 5e3 }, { id: 'r1', role: 'qa', state: 'done', startedAt: NOW - 9e3 }],
      helpers: [helper({ ai: 'codex', role: 'engineer-codex', label: 'Fix parser', state: 'working', count: 2 }), helper({ ai: 'jev', label: 'ask web-route', count: 3 })] })],
  }))
  const yard = c.nodes.find(n => n.id === 'yard:a')!
  const codex = c.nodes.find(n => n.id === 'realm:a:codex')!, jev = c.nodes.find(n => n.id === 'realm:a:jev')!
  assert.deepEqual([codex.kind, codex.parent, codex.ai, codex.label, codex.sub, codex.state, codex.task, codex.runs], ['realm', 'yard:a', 'codex', 'CODEX REALM', 'from Claude · a', 'working', 'Fix parser', 2])
  assert.deepEqual([jev.parent, jev.label, jev.state, jev.task, jev.runs], ['yard:a', 'JEV REALM', 'done', 'ask web-route', 3])
  // The Codex desk lives in the Codex realm; the yard is the Claude realm and keeps the lead and its Claude desks.
  const eng = c.nodes.find(n => n.id === 'desk:a:engineer-codex')!
  assert.deepEqual([eng.parent, eng.ai, eng.role], ['realm:a:codex', 'codex', 'engineer'])
  assert.equal(c.nodes.find(n => n.id === 'realm:a:claude'), undefined)
  assert.deepEqual(c.nodes.filter(n => n.parent === 'yard:a' && n.kind === 'desk').map(n => n.role), ['lead', 'qa'])
  assert.ok(inside(eng.x + eng.w / 2, eng.y + eng.h / 2, codex))
  for (const r of [codex, jev]) assert.ok(!overlap(r, yard), `${r.id} sits on the rim, not over the yard`)
  // Docked with sky for the gate, stacked clear of each other, the stack centered on the yard.
  const home = c.nodes.find(n => n.id === yard.parent)!, side = (n: { x: number; w: number }) => Math.sign(n.x + n.w / 2 - (yard.x + yard.w / 2))
  for (const r of [codex, jev]) {
    assert.ok((side(r) > 0 ? r.x - (yard.x + yard.w) : yard.x - (r.x + r.w)) >= 72, `${r.id} docks 72 off the rim`)
    const bridge = c.links.find(l => l.from === home.id && l.to === yard.id)!.points
    for (let k = 0; k <= 20; k++) { const [[x0, y0], [x1, y1]] = [bridge[0], bridge[bridge.length - 1]]; assert.ok(!inside(x0 + (x1 - x0) * k / 20, y0 + (y1 - y0) * k / 20, r), `the home bridge runs clear of ${r.id}`) }
  }
  assert.ok(jev.y >= codex.y + codex.h + 40, 'room under the Codex realm for its rock')
  const stack = c.nodes.filter(n => n.kind === 'realm' && n.parent === 'yard:a'), mid = (Math.min(...stack.map(n => n.y)) + Math.max(...stack.map(n => n.y + n.h))) / 2
  assert.ok(Math.abs(mid - (yard.y + yard.h / 2)) <= 1, 'stack centered on the yard')
  assert.ok(c.links.some(l => l.from === 'yard:a' && l.to === 'realm:a:codex'))
})

test('realms: plaques beside stacked realms stay clear of each other and of every realm and yard', () => {
  const c = buildCourt(hub({
    chats: [chat('a')],
    progress: [prog({ sessionId: 'a',
      roles: [{ id: 'x1', role: 'engineer-codex', state: 'active', startedAt: NOW - 5e3 }, { id: 'x2', role: 'qa-codex', state: 'active', startedAt: NOW - 4e3 }],
      helpers: [helper({ ai: 'jev', label: 'ask web-route' }), helper({ ai: 'perplexity', label: 'search' })] })],
  }))
  const yard = c.nodes.find(n => n.id === 'yard:a')!, realms = c.nodes.filter(n => n.kind === 'realm')
  assert.equal(realms.length, 3)
  for (const z of [0.3, 0.5, 1]) {
    const plaques = realms.map(r => realmPlaque(r, yard, z))
    plaques.forEach((p, i) => {
      for (const n of [yard, ...realms]) assert.ok(!overlap(p, n), `${realms[i].id} plaque clear of ${n.id} at zoom ${z}`)
      plaques.forEach((q, j) => { if (j > i) assert.ok(!overlap(p, q), `plaques ${i} and ${j} apart at zoom ${z}`) })
    })
  }
})

test('realms: a Codex chat\'s Perplexity calls stem from that Codex chat; no realm for the chat\'s own AI', () => {
  const c = buildCourt(hub({
    chats: [chat('a'), chat('b', 'codex')],
    progress: [prog({ sessionId: 'b', helpers: [helper({ ai: 'perplexity', label: 'search', state: 'working' }), helper({ ai: 'codex', role: 'engineer-codex' })] })],
  }))
  const px = c.nodes.find(n => n.id === 'realm:b:perplexity')!
  assert.deepEqual([px.parent, px.ai, px.label, px.sub, px.state], ['yard:b', 'perplexity', 'PERPLEXITY REALM', 'from Codex · b', 'working'])
  assert.equal(c.nodes.find(n => n.id === 'realm:b:codex'), undefined)
  assert.equal(c.nodes.filter(n => n.kind === 'realm' && n.chatId === 'a').length, 0)
})

test('realms: Codex desks alone, with no helper rows, still make the realm', () => {
  const c = buildCourt(hub({ chats: [chat('a')], progress: [prog({ sessionId: 'a', roles: [{ id: 'x2', role: 'qa-codex', state: 'done', startedAt: NOW - 9e3 }] })] }))
  const r = c.nodes.find(n => n.id === 'realm:a:codex')!
  assert.deepEqual([r.state, r.runs], ['done', 1])
  assert.equal(c.nodes.find(n => n.id === 'desk:a:qa-codex')!.parent, r.id)
})

test('every Switchboard place stands on the ring and the library reads the memory graph', async () => {
  const { demoGraph } = await import('./memory-graph')
  const c = buildCourt(hub({ todos: { '/w/a': { todo: [{ id: '1', text: 'Ship logo', at: 1 }] } } }), undefined, demoGraph())
  const kinds = ['garden', 'armory', 'library', 'notice', 'tower', 'study', 'treasury', 'maps'] as const
  for (const k of kinds) { const n = c.nodes.find(m => m.kind === k); assert.ok(n, k); assert.ok(['council', 'garden', 'armory'].includes(n!.parent!), k) }
  const lib = c.nodes.find(n => n.kind === 'library')!
  assert.equal(lib.task, '8 memories · 1 wiki'); assert.equal(lib.warn, 2)
  assert.equal(c.nodes.find(n => n.kind === 'notice')!.task, '1 open in all projects')
  const big = c.nodes.filter(n => n.kind !== 'desk')
  for (const a of big) for (const b of big) if (a !== b) assert.ok(!overlap(a, b), `${a.id} hits ${b.id}`)
  assert.equal(buildCourt(hub({})).nodes.find(n => n.kind === 'library')!.task, undefined)
})

test('realms: a Codex chat keeps its own desks in the yard and makes no Claude realm', () => {
  const c = buildCourt(hub({ chats: [chat('b', 'codex')], progress: [prog({ sessionId: 'b', roles: [{ id: 'r', role: 'engineer', state: 'active', startedAt: NOW }] })] }))
  assert.equal(c.nodes.find(n => n.id === 'desk:b:engineer')!.parent, 'yard:b')
  assert.equal(c.nodes.find(n => n.id === 'realm:b:claude'), undefined)
})

const staff = (...roles: string[]): RoleStep[] => roles.map((role, k) => ({ id: `s${k}`, role, state: 'active', startedAt: NOW }))
for (const ai of ['claude', 'codex'] as const) test(`the yard is the ${ai} realm: lead and own desks sit in it, no ${ai} realm island`, () => {
  const c = buildCourt(hub({ chats: [chat('a', ai)], progress: [prog({ sessionId: 'a', roles: staff('engineer', 'qa') })] }))
  assert.equal(c.nodes.filter(n => n.kind === 'realm').length, 0)
  for (const r of ['lead', 'engineer', 'qa']) assert.equal(c.nodes.find(n => n.id === `desk:a:${r}`)!.parent, 'yard:a', r)
  checkLayout(c)
})

test('a Claude chat\'s engineer-codex docks one Codex realm holding that desk', () => {
  const c = buildCourt(hub({ chats: [chat('a')], progress: [prog({ sessionId: 'a', roles: staff('engineer', 'engineer-codex') })] }))
  const realms = c.nodes.filter(n => n.kind === 'realm')
  assert.deepEqual(realms.map(n => [n.id, n.ai, n.parent]), [['realm:a:codex', 'codex', 'yard:a']])
  assert.equal(c.nodes.find(n => n.id === 'desk:a:engineer-codex')!.parent, 'realm:a:codex')
  assert.equal(c.nodes.find(n => n.id === 'desk:a:engineer')!.parent, 'yard:a')
  checkLayout(c)
})

for (const n of [0, 1, 2, 3, 5]) test(`a yard keeps a free slot for its landmark with ${n} subagents`, () => {
  const c = buildCourt(hub({ chats: [chat('a')], progress: [prog({ sessionId: 'a', roles: staff(...ROLES.slice(0, n)) })] }))
  const yard = c.nodes.find(n => n.id === 'yard:a')!, [x, y] = markSpot(yard, n + 1)
  // The landmark: about 44 wide and 74 tall above its base.
  const mark = { x: x - 22, y: y - 74, w: 44, h: 74 }
  assert.ok(mark.x >= yard.x && mark.y >= yard.y && mark.x + mark.w <= yard.x + yard.w && y <= yard.y + yard.h, 'landmark inside the yard')
  for (const d of c.nodes.filter(m => m.kind === 'desk' && m.parent === yard.id)) assert.ok(!overlap(mark, { ...d, h: d.h + 48 }), `landmark clear of ${d.id} and its plate`)
})

test('a lead-only Claude chat has no empty Claude realm', () => {
  const c = buildCourt(hub({ chats: [chat('a')], progress: [prog({ sessionId: 'a' })] }))
  assert.equal(c.nodes.filter(n => n.kind === 'realm').length, 0)
})

test('links: every node but the council hangs from its parent by exactly one link, and every end exists', () => {
  for (const h of [many(13), hub({ chats: [chat('a')], progress: [prog({ sessionId: 'a', roles: [{ id: 'x', role: 'qa-codex', state: 'active', startedAt: NOW }, { id: 'y', role: 'engineer', state: 'done', startedAt: NOW }], helpers: [helper({ ai: 'jev', label: 'j' })] })] })]) {
    const c = buildCourt(h), ids = new Set(c.nodes.map(n => n.id))
    for (const l of c.links) { assert.ok(ids.has(l.from) && ids.has(l.to), `${l.from}>${l.to}`); assert.equal(l.points.length, 2) }
    for (const n of c.nodes) {
      if (n.id === 'council') continue
      const into = c.links.filter(l => l.to === n.id)
      assert.deepEqual(into.map(l => l.from), [n.parent], n.id)
    }
  }
})

test('meet fires for a new desk in a Claude yard, with the yard lead', () => {
  const base = { chats: [chat('a')] }
  const one = buildCourt(hub({ ...base, progress: [prog({ sessionId: 'a', roles: [{ id: 'x', role: 'engineer', state: 'active', startedAt: NOW }] })] }))
  const two = buildCourt(hub({ ...base, progress: [prog({ sessionId: 'a', roles: [{ id: 'x', role: 'engineer', state: 'active', startedAt: NOW }, { id: 'y', role: 'qa', state: 'active', startedAt: NOW }] })] }))
  assert.deepEqual(courtEvents(one, two).meet, [{ deskId: 'desk:a:qa', leadId: 'desk:a:lead' }])
})

for (const n of [30, 90]) test(`ring places stay clear of every island with ${n} chats`, () => {
  const c = buildCourt(many(n)), big = c.nodes.filter(x => x.kind !== 'desk'), places = new Set<string>(PLACES)
  for (const a of big) if (places.has(a.kind)) for (const b of big) if (a !== b) assert.ok(!overlap(a, b), `${a.id} overlaps ${b.id}`)
})

for (const n of [1, 6, 13, 30, 90]) test(`realm plaques stay clear of every island and of each other with ${n} chats`, () => {
  const h = many(n)
  // Every third chat calls Jev.
  h.progress = h.progress.map((p, i) => i % 3 ? p : { ...p, helpers: [{ ai: 'jev', label: 'ask', state: 'done', since: NOW, last: NOW, count: 1 }] })
  const c = buildCourt(h), big = c.nodes.filter(x => x.kind !== 'desk'), by = new Map(c.nodes.map(x => [x.id, x]))
  for (const z of [0.5, 1]) {
    const ps = c.nodes.filter(r => r.kind === 'realm').map(r => ({ r, p: realmPlaque(r, by.get(r.parent!)!, z) }))
    for (const { r, p } of ps) {
      for (const b of big) if (b !== r) assert.ok(!overlap(p, b), `${r.id} plaque on ${b.id} at zoom ${z}`)
      for (const o of ps) if (o.r !== r) assert.ok(!overlap(p, o.p), `${r.id} plaque on ${o.r.id}'s at zoom ${z}`)
    }
  }
})

test('Fit frames every island inside the stage and fills it on one axis', () => {
  const c = buildCourt(many(13))
  for (const [w, ht] of [[1440, 846], [1280, 800], [968, 740]]) {
    const f = fitCourt(c, w, ht), sx = (x: number) => x * f.zoom + f.x, sy = (y: number) => y * f.zoom + f.y
    for (const b of c.nodes) assert.ok(sx(b.x) >= 0 && sx(b.x + b.w) <= w && sy(b.y) >= 0 && sy(b.y + b.h) <= ht, `${b.id} out of the ${w} stage`)
    assert.ok(Math.max(c.bounds.w * f.zoom / w, c.bounds.h * f.zoom / ht) > 0.85, `court fills the ${w} stage`)
  }
})

// Same order board.tsx draws: the petition card, then each realm's plaque, own side first, then forced further out.
for (const n of [1, 30, 90]) test(`realm plaques never land on each other or the petition with ${n} chats`, () => {
  const h = many(n)
  h.progress = h.progress.map((p, i) => ({ ...p, ...(i % 3 ? {} : { helpers: [{ ai: 'jev', label: 'ask', state: 'done', since: NOW, last: NOW, count: 1 }] }), ...(i === n - 1 ? { state: 'needs-you', question: 'Keep Closet?' } : {}) }))
  for (const [W, H] of [[1440, 846], [1280, 800]]) {
    const c = buildCourt(h, { w: W, h: H }), f = fitCourt(c, W, H), by = new Map(c.nodes.map(x => [x.id, x]))
    const X = (x: number) => x * f.zoom + f.x, Y = (y: number) => y * f.zoom + f.y, stage: Box = [4, 4, W - 8, H - 8]
    const isles = c.nodes.filter(x => x.kind !== 'desk').map(x => ({ id: x.id, r: [X(x.x), Y(x.y), x.w * f.zoom, x.h * f.zoom] as Box }))
    const taken: Array<{ id: string; r: Box }> = [], boxes = () => taken.map(t => t.r)
    const lead = by.get(c.petition!.deskId)!, wx = X(lead.x + lead.w / 2), wy = Y(lead.y + lead.h / 2)
    const pw = 230, ph = 36, pat = freeSpot([[wx - pw / 2, wy + 14 * f.zoom + 8], [wx - pw / 2, wy - 32 * f.zoom - ph - 4]], pw, ph, [], isles, undefined, stage)
    if (pat) taken.push({ id: 'petition', r: [pat[0], pat[1], pw, ph] })
    let shown = 0
    for (const r of c.nodes.filter(x => x.kind === 'realm')) {
      const yd = by.get(r.parent!)!, w = 220, ph2 = 32, cx = X(r.x + r.w / 2), mid = Y(r.y + r.h / 2)
      const spots: Array<[number, number]> = [[cx - w / 2, Y(r.y) - 4 - ph2], [cx - w / 2, Y(r.y + r.h) + 4], [X(r.x + r.w) + 4, mid - ph2 / 2], [X(r.x) - w - 4, mid - ph2 / 2]]
      spots.unshift(...spots.splice(r.x > yd.x ? 2 : 3, 1))
      const free = freeSpot(spots, w, ph2, boxes(), isles, r.id, stage), got = free ? { at: free, w } : forcedSpot(spots, w, ph2, [cx, mid], boxes(), isles, r.id, stage)
      if (!got) continue
      const box: Box = [got.at[0], got.at[1], got.w, ph2]
      assert.ok(box[0] >= stage[0] && box[1] >= stage[1] && box[0] + box[2] <= stage[0] + stage[2] && box[1] + box[3] <= stage[1] + stage[3], `${r.id} plaque off the ${W}x${H} stage`)
      for (const t of taken) assert.ok(!overlap({ x: box[0], y: box[1], w: box[2], h: box[3] }, { x: t.r[0], y: t.r[1], w: t.r[2], h: t.r[3] }), `${r.id} plaque on ${t.id} at ${W}x${H}`)
      taken.push({ id: r.id, r: box }); shown++
    }
    if (n === 1) assert.equal(shown, c.nodes.filter(x => x.kind === 'realm').length, 'a lone chat shows every plaque')
  }
})

test('a Codex chat that hands work to Claude gets a Claude realm', () => {
  const c = buildCourt(hub({ chats: [chat('b', 'codex')], progress: [prog({ sessionId: 'b', helpers: [helper({ ai: 'claude', label: 'review', state: 'working' })] })] }))
  const r = c.nodes.find(n => n.id === 'realm:b:claude')!
  assert.deepEqual([r.parent, r.label, r.sub, r.state], ['yard:b', 'CLAUDE REALM', 'from Codex · b', 'working'])
})

test('the Uploads place stands only when there are uploads', () => {
  assert.equal(buildCourt(hub({})).nodes.find(n => n.kind === 'uploads'), undefined)
  assert.equal(buildCourt(hub({ uploads: {} })).nodes.find(n => n.kind === 'uploads'), undefined)
  const c = buildCourt(hub({ uploads: { web: { count: 2, last: [{ name: 'a.png', at: NOW, size: '1 KB', chat: 'x' }] } } }))
  const u = c.nodes.find(n => n.kind === 'uploads')!
  assert.ok((PLACES as readonly string[]).includes(c.nodes.find(n => n.id === u.parent)!.kind), u.parent); assert.equal(u.list!.length, 1)
  checkLayout(c)
})

test('with uploads the demo court stays compact: a crowded shelf never flings a place far out', async () => {
  const { demoHub } = await import('./hub-demo')
  const c = buildCourt(demoHub(NOW), { w: 1440, h: 846 })
  assert.ok(c.nodes.some(n => n.kind === 'uploads'))
  assert.ok(c.bounds.w < 8000 && c.bounds.h < 8000, `bounds ${c.bounds.w}x${c.bounds.h}`)
  checkLayout(c)
})

test('a done chat with a request not covered carries missed on its yard and lead; a covered one does not', () => {
  const c = buildCourt(hub({ chats: [chat('a'), chat('b')], progress: [
    prog({ sessionId: 'a', state: 'done', asked: ['x', 'y'], covered: [0.1, 0.9] }),
    prog({ sessionId: 'b', state: 'done', asked: ['x'], covered: [0.9] }),
  ] }))
  const get = (id: string) => c.nodes.find(n => n.id === id)!
  assert.equal(get('yard:a').missed, 1)
  assert.equal(get('desk:a:lead').missed, 1)
  assert.equal(get('yard:b').missed, undefined)
  assert.equal(get('desk:b:lead').state, 'done')
})

test('yards with realms sit near their window: no bridge runs far across the sky', () => {
  const chats = ['a', 'b', 'c', 'd'].map(id => ({ ...chat(id), cwd: '/w/a' }))
  const progress = chats.map(c => prog({ sessionId: c.sessionId, roles: [{ id: `${c.sessionId}-r`, role: 'engineer-codex', state: 'active', startedAt: NOW }] }))
  const c = buildCourt(hub({ chats, progress, windows: [{ workspace: '/w/a', name: 'Ay', color: 'violet' }] }), { w: 1600, h: 900 })
  assert.equal(c.nodes.filter(n => n.kind === 'realm').length, 4)
  for (const l of c.links.filter(l => l.from === 'win:/w/a')) {
    const [[x0, y0], [x1, y1]] = l.points
    assert.ok(Math.hypot(x1 - x0, y1 - y0) < 900, `${l.to} bridge is ${Math.round(Math.hypot(x1 - x0, y1 - y0))}px`)
  }
  checkLayout(c)
})

test('a tall stage squeezes the ring sideways instead of stretching it', () => {
  const h = many(6)
  assert.ok(buildCourt(h, { w: 390, h: 844 }).bounds.w < buildCourt(h).bounds.w * 0.9)
})

test('treasury counts only keys that can fail: unset keys and backup profiles stay out', () => {
  const h = hub({
    signIns: { chrome: [], projects: {}, keys: [{ name: 'GEMINI_API_KEY', saved: true }, { name: 'PERPLEXITY_API_KEY', saved: false }] },
    aws: [{ name: 'default', status: 'signed-in', checkedAt: 1 }, { name: 'previous-default-1', status: 'expired', checkedAt: 1 }, { name: 'scratch', status: 'never', checkedAt: 1 }],
  })
  const t = buildCourt(h).nodes.find(n => n.kind === 'treasury')!
  assert.deepEqual([t.task, t.warn], ['2/2 ok', 0])
})

test('Fit on a phone fills the stage instead of shrinking to fit 220px plaques', () => {
  const h = many(13)
  h.progress = h.progress.map((p, i) => i % 3 ? p : { ...p, helpers: [{ ai: 'jev', label: 'ask', state: 'done', since: NOW, last: NOW, count: 1 }] })
  const c = buildCourt(h, { w: 390, h: 622 }), f = fitCourt(c, 390, 622)
  assert.ok(Math.max(c.bounds.w * f.zoom / 390, c.bounds.h * f.zoom / 622) > 0.85)
})

test('council summary counts only AIs that have chats, pluralized', () => {
  const h = hub({ chats: [chat('a')], progress: [prog({ sessionId: 'a', roles: [] })] })
  assert.equal(courtSummary(buildCourt(h)), '1 AI · 1 chat · 1 agent')
  const two = hub({ chats: [chat('a'), { ...chat('b'), ai: 'codex' }], progress: [prog({ sessionId: 'a', roles: [] }), prog({ sessionId: 'b', roles: [] })] })
  assert.match(courtSummary(buildCourt(two)), /^2 AI · 2 chats/)
})

test('Advanced mode: the yard and lead show the stage line, a raised role desk its model', () => {
  const h = hub({
    chats: [chat('s1')],
    progress: [prog({ sessionId: 's1', roles: [{ id: 'r1', role: 'qa', state: 'active', startedAt: NOW }, { id: 'r2', role: 'engineer', state: 'done', startedAt: NOW }] })],
    stages: { '/x': [{ run: 'r', sessionId: 's1', at: NOW, stages: [{ n: 1, name: 'Fix it', role: 'engineer', status: 'doing' }] }] },
    escalations: { '/x': [{ project: '/x', role: 'qa', files: ['a.ts'], from: 'sonnet', to: 'opus', reason: '', at: NOW }] },
  })
  h.controls.switchboard.advancedMode = { '/x': true }
  const by = (id: string) => buildCourt(h).nodes.find(n => n.id === id)!
  assert.equal(by('yard:s1').task, 'Stage 1 of 1 running: Fix it, engineer')
  assert.equal(by('desk:s1:lead').task, 'Stage 1 of 1 running: Fix it, engineer')
  assert.equal(by('desk:s1:qa').model, 'opus')
  assert.equal(by('desk:s1:qa').raise, 'qa raised to opus on a.ts')
  assert.equal(by('desk:s1:engineer').model, undefined)
  h.controls.switchboard.advancedMode = {}
  assert.equal(by('yard:s1').task, undefined)
})

test('yards carry group and waitsOn; one tie per group sibling', () => {
  const g = (c: ChatRow, group?: string) => ({ ...c, group }) as ChatRow
  const h = hub({
    chats: [g(chat('a'), 'g-1'), g(chat('b'), 'g-1'), g(chat('c'), 'g-1'), chat('d')],
    links: [{ from: 'b', to: ['a', 'gone'], reason: 'split', auto: false, since: NOW }],
  })
  const c = buildCourt(h)
  const yard = (id: string) => c.nodes.find(n => n.id === `yard:${id}`)!
  assert.equal(yard('a').group, 'g-1')
  assert.equal(yard('d').group, undefined)
  assert.deepEqual(yard('b').waitsOn, ['a', 'gone'.slice(0, 8)])
  assert.equal(yard('a').waitsOn, undefined)
  assert.deepEqual(c.ties.map(t => [t.from, t.to, t.group]), [['yard:a', 'yard:b', 'g-1'], ['yard:b', 'yard:c', 'g-1']])
  for (const t of c.ties) assert.deepEqual(t.points, [[yard(t.from.slice(5)).x + yard(t.from.slice(5)).w / 2, yard(t.from.slice(5)).y + yard(t.from.slice(5)).h / 2], [yard(t.to.slice(5)).x + yard(t.to.slice(5)).w / 2, yard(t.to.slice(5)).y + yard(t.to.slice(5)).h / 2]])
})

test('a chat archived a moment ago gets no yard, so the map counts what Chats counts', () => {
  const archive = [{ sessionId: 'b', origin: 'b', version: 1, archivedAt: NOW, name: 'b', cwd: '/x' }] as unknown as HubState['archive']
  const c = buildCourt(hub({ chats: [chat('a'), chat('b')], archive }))
  assert.deepEqual(c.nodes.filter(n => n.kind === 'courtyard').map(n => n.chatId), ['a'])
})

test('the Research island counts source checks and names the one still running', () => {
  const src = (id: string, done: boolean) => ({ id, question: `q ${id}`, at: NOW, done, sources: [] })
  const c = buildCourt(hub({ sourceChecks: [src('a', true), src('b', false)] }))
  const r = c.nodes.find(n => n.id === 'ai:research')!
  assert.deepEqual([r.runs, r.shipped, r.task], [2, 1, 'Source check: q b'])
})

test('plainWord explains the court jargon and nothing else', async () => {
  const { plainWord, YARD_TAG_CAP } = await import('./court-map')
  assert.match(plainWord('council')!, /role agents/)
  assert.ok(plainWord('realm') && plainWord('petition'))
  assert.equal(plainWord('desk'), undefined)
  assert.ok(YARD_TAG_CAP >= 4)
})
