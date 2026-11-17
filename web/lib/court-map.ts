/** Celestial Court layout: the Council at 0,0, a pavilion per AI on a ring, a courtyard per live chat fanned out from its AI, a desk per role.
 * When VS Code windows are known, each window gets its own island on the ring and its chats fan out from it instead. Pure, so it is tested. */
import type { ChatProgress, HubState, WindowColor } from './hub-types'
import { byWindow } from './windows'
import { ORDER, almostDone, missedCount } from './look'
import type { MemoryGraph } from './memory-graph'
import { limitTag } from './budget-ui'
import { chatRun, raiseLine, raisesFor, stageView } from './stages-ui'
import { armoryList, gardenList, keyList, mapList, memoryTally, studyList, todoList, towerList, uploadList, uploadSummary, type Item } from './court-places'

export type CourtState = 'working' | 'waiting' | 'done' | 'needs' | 'idle'
/** x, y: top left corner in world px; the council's center sits on 0,0.
 * Yards: group is the split id its chat was started from (siblings share it, Court.ties joins them); waitsOn names the chats it waits on, for a "Waiting on X" line. The wait rope itself comes from board-fx ropesOf. */
export type CourtNode = { id: string; kind: 'council' | 'pavilion' | 'window' | 'courtyard' | 'realm' | 'desk' | Place; x: number; y: number; w: number; h: number; label: string; ai?: string; chatId?: string; role?: string; state?: CourtState; task?: string; since?: number; runs?: number; shipped?: number; ask?: string; parent?: string; window?: string; color?: WindowColor; here?: boolean; /** The AI the chat's last version ran on, when it was another one. */ from?: string; /** A realm's second line: the AI and chat it stems from. */ sub?: string; /** A ring place's roster. */ list?: Item[]; /** Done with this many requests Jev found not covered (look.ts almostDone). */ missed?: number; /** Problems a place flags (memory health, missing keys). */ warn?: number; /** A desk's role raised to this model (stages-ui raiseLine says why). */ model?: string; raise?: string; group?: string; /** Run indefinitely limits and check-back, one quiet line (budget-ui limitTag). */ limits?: string; waitsOn?: string[] }
/** Ring places after the AIs, in ring order. */
export const PLACES = ['garden', 'armory', 'library', 'notice', 'tower', 'study', 'treasury', 'maps', 'uploads'] as const
export type Place = typeof PLACES[number]
const PLACE_NAME: Record<Place, string> = { garden: 'Tea garden', armory: 'Armory', library: 'Memory library', notice: 'Notice board', tower: 'Signal tower', study: 'Study hall', treasury: 'Treasury', maps: 'Map room', uploads: 'Uploads' }
/** points: world px, from's center first. */
export type CourtLink = { from: string; to: string; points: [number, number][] }
/** A tether between sibling yards of one split, chained in chat order; points: yard centers. */
export type CourtTie = { from: string; to: string; group: string; points: [number, number][] }
/** bounds: size of the box around every node. ties: group tethers, apart from links so placement ignores them. */
export type Court = { nodes: CourtNode[]; links: CourtLink[]; ties: CourtTie[]; bounds: { w: number; h: number }; petition?: { deskId: string; path: [number, number][] } }
export type Lod = 'card' | 'plate' | 'dot'
/** The desk plate board.tsx draws under a desk, in CSS px. */
export const PLATE = { minW: 100, maxW: 150, h: 46 }

type P = [number, number]
const COUNCIL = { w: 240, h: 160 }, ISLE = { w: 160, h: 120 }
// ROOM: under every desk row, so a plate (46px + 2px drop, at zoom 1 or more) never lands on the row below or off the island.
const DESK = { w: 96, h: 56 }, DGAP = 16, ROOM = PLATE.h + 10, PAD = 24, TOP = 28, COLS = 3, MARGIN = 24, GAP = 96
const NAMES: Record<string, string> = { claude: 'Claude', codex: 'Codex', hermes: 'Hermes', gemini: 'Gemini', jev: 'Jev', perplexity: 'Perplexity', research: 'Research' }
// DOCK: sky between yard box and realm, where board.tsx hangs the gate; RGAP clears a realm's rock and spikes.
// PLQ: sky kept beside the realms for their plaques at zoom 0.5 (realmPlaque); RGAP grows with the tallest realm so halos and rocks clear.
const REALM = { w: 140, h: 72 }, RGAP = 100, DOCK = 72, PLQ = 448
const isCodex = (role: string) => role.split(':').pop()!.endsWith('-codex')
const rank = (r: string) => { const i = ORDER.indexOf(r); return i < 0 ? 100 : i }
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]]
const mid = (n: CourtNode): P => [n.x + n.w / 2, n.y + n.h / 2]
const box = (id: string, kind: CourtNode['kind'], c: P, s: { w: number; h: number }, label: string): CourtNode =>
  ({ id, kind, label, x: Math.round(c[0]) - s.w / 2, y: Math.round(c[1]) - s.h / 2, w: s.w, h: s.h })

function chatState(p?: ChatProgress): CourtState {
  if (!p) return 'idle'
  if (p.state === 'needs-you' || p.asks?.length || p.ask) return 'needs'
  if (p.limited || p.waiting) return 'waiting'
  return p.state
}

// Where the road from p meets n's edge, 12px out, so the petition's callout stays off n's label.
const rimOf = (n: CourtNode, p: P): P => {
  const [cx, cy] = mid(n), dx = p[0] - cx, dy = p[1] - cy, k = Math.min((n.w / 2 + 12) / (Math.abs(dx) || 1e-9), (n.h / 2 + 12) / (Math.abs(dy) || 1e-9), 1)
  return [Math.round(cx + dx * k), Math.round(cy + dy * k)]
}
const hits = (a: CourtNode, b: CourtNode, m = 0) => a.x - m < b.x + b.w && b.x - m < a.x + a.w && a.y - m < b.y + b.h && b.y - m < a.y + a.h
// Liang-Barsky clip against the rect grown by MARGIN.
function segHits(p: P, q: P, n: CourtNode) {
  const dx = q[0] - p[0], dy = q[1] - p[1]
  let t0 = 0, t1 = 1
  for (const [pp, qq] of [[-dx, p[0] - (n.x - MARGIN)], [dx, n.x + n.w + MARGIN - p[0]], [-dy, p[1] - (n.y - MARGIN)], [dy, n.y + n.h + MARGIN - p[1]]]) {
    if (pp === 0) { if (qq <= 0) return false; continue }
    const r = qq / pp
    if (pp < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r)
    if (t0 >= t1) return false
  }
  return true
}
const side = (a: P, b: P, c: P) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
const crosses = (p: P, q: P, r: P, s: P) => side(p, q, r) * side(p, q, s) < 0 && side(r, s, p) * side(r, s, q) < 0

/** mem: the memory graph, fetched apart from hub state; the library stands empty without it. */
export function buildCourt(h: HubState, stage?: { w: number; h: number }, mem?: MemoryGraph): Court {
  const nodes: CourtNode[] = [], links: CourtLink[] = []
  const live = h.chats.filter(c => c.live)
  const progress = new Map(h.progress.map(p => [p.sessionId, p]))
  const byId = (id?: string) => nodes.find(n => n.id === id)
  // Centers from n up to its home, for the petition's road.
  const chain = (n: CourtNode): P[] => [mid(n), ...(n.kind === 'courtyard' ? chain(byId(n.parent)!) : [])]
  const link = (a: CourtNode, b: CourtNode) => links.push({ from: a.id, to: b.id, points: [mid(a), mid(b)] })

  // Claude and Codex run chats so they always show; the rest only when the hub has them.
  const ids = ['claude', 'codex', ...h.ais.filter(a => a.installed || a.chats).map(a => a.id), ...live.map(c => c.ai ?? 'claude')]
  if (h.signIns.keys?.some(k => k.name === 'GEMINI_API_KEY' && k.saved)) ids.push('gemini')
  if (h.jev.length || Object.keys(h.jevProjects ?? {}).length) ids.push('jev')
  // Research pseudo-island: always on the ring, launches a deep-research chat.
  ids.push('research')
  const ais = [...new Set(ids)]
  // window: its workspace, '' for chats no window holds.
  // Every open window shows, chats or not; Other only when some chat sits outside them all.
  const realms = h.windows?.length ? byWindow([...live.map(chat => ({ chat })), ...h.windows.map(w => ({ chat: { cwd: w.workspace }, empty: true }))], h.windows, h.thisWindow)
    .map(g => ({ ...g, cards: g.cards.flatMap(c => 'sessionId' in c.chat ? [c as { chat: typeof live[number] }] : []) })).filter(g => g.window || g.cards.length) : []
  const realmOf = new Map(realms.flatMap(g => g.cards.map(c => [c.chat.sessionId, g.window?.workspace ?? ''] as const)))

  const council = box('council', 'council', [0, 0], COUNCIL, 'Switchboard council')
  nodes.push(council)

  // Ring: the AIs, then the garden and armory. A wide stage stretches it sideways, a tall one squeezes it.
  const ring = realms.length + ais.length + 2, aspect = stage ? Math.min(1.6, Math.max(0.7, stage.w / stage.h)) : 1
  const R = Math.max(380, Math.ceil(ring * 280 / (2 * Math.PI) / Math.min(1, aspect)))
  const at = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / ring
  const spot = (a: number, d: number): P => [Math.cos(a) * d * aspect, Math.sin(a) * d]

  // Homes: window islands first (here at the top), then the AI pavilions.
  const homes = new Map<string, { n: CourtNode; a: number }>()
  realms.forEach((g, i) => {
    const w = g.window, n: CourtNode = { ...box(`win:${w?.workspace ?? ''}`, 'window', spot(at(i), R), ISLE, w?.name ?? 'Other'), parent: 'council', window: w?.workspace ?? '' }
    if (w) Object.assign(n, { color: w.color, here: g.here })
    homes.set(`win:${n.window}`, { n, a: at(i) }); nodes.push(n); link(council, n)
  })
  const pav = new Map<string, CourtNode>()
  ais.forEach((ai, j) => {
    const i = realms.length + j
    const n: CourtNode = { ...box(`ai:${ai}`, 'pavilion', spot(at(i), R), ISLE, h.ais.find(a => a.id === ai)?.name ?? NAMES[ai] ?? ai), ai, parent: 'council' }
    if (ai === 'jev' && h.jev.length) n.runs = h.jev.length
    pav.set(ai, n); homes.set(`ai:${ai}`, { n, a: at(i) }); nodes.push(n); link(council, n)
  })
  const busy = new Set(live.flatMap(c => progress.get(c.sessionId)?.roles.filter(r => r.state === 'active').map(r => r.role) ?? []))
  const files = uploadList(h), idle = gardenList(h, busy), tools = armoryList(h), todo = todoList(h), keys = keyList(h), study = studyList(h)
  const rated = keys.filter(k => k.ok !== undefined), tally = mem && memoryTally(mem), problems = (l: Item[]) => l.filter(i => i.ok === false).length
  const extra: Record<Place, Partial<CourtNode>> = {
    garden: { task: idle.length ? idle.map(i => i.name).join(', ') : undefined, list: idle },
    armory: { task: `${tools.length} tools`, list: tools, warn: problems(tools) },
    library: tally ? { task: `${tally.counts.memory} memories · ${tally.counts.wiki} wiki`, warn: tally.issues.contradictions + tally.issues.stale + tally.issues.dangling } : {},
    notice: { task: todo.length ? `${todo.length} open in all projects` : undefined, list: todo },
    tower: { list: towerList(h), task: h.rc.atStartup ? 'Remote Control on' : undefined },
    study: { list: study, task: h.learnReady?.length ? `${h.learnReady.length} waiting` : undefined, warn: h.learnReady?.length },
    treasury: { list: keys, task: rated.length ? `${rated.length - problems(rated)}/${rated.length} ok` : undefined, warn: problems(keys) },
    maps: { list: mapList(h), task: h.projects.length ? `${h.projects.length} projects` : undefined },
    uploads: { list: files, task: uploadSummary(h) },
  }
  const place0 = (k: Place, c: P) => { const n: CourtNode = { ...box(k, k, c, ISLE, PLACE_NAME[k]), parent: 'council', ...extra[k] }; nodes.push(n); link(council, n) }
  place0('garden', spot(at(ring - 2), R)); place0('armory', spot(at(ring - 1), R))

  let petition: Court['petition']
  // Plaque sky beside each yard's realms: later islands treat it as taken.
  const reserved: CourtNode[] = []
  const homeKey = (c: typeof live[number]) => realmOf.has(c.sessionId) ? `win:${realmOf.get(c.sessionId)}` : `ai:${c.ai ?? 'claude'}`
  // Courtyards per home, so a chat the home has no straight sky for can hang off a sibling yard.
  const yardsOf = new Map<string, CourtNode[]>()
  for (const c of live) {
    const ai = c.ai ?? 'claude', from = movedFrom(h, c), key = homeKey(c), { n: home, a: angle } = homes.get(key)!, p = progress.get(c.sessionId), state = chatState(p)
    const runs = p?.roles ?? [], tasks = p?.tasks ?? []
    const all = [...new Set(runs.map(r => r.role))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    // engineer-codex / qa-codex desks go in the Codex realm, not the yard; a Codex chat has no Codex realm.
    const codexRoles = ai === 'codex' ? [] : all.filter(isCodex), roles = all.filter(r => !codexRoles.includes(r))
    // The yard is the chat's own AI realm: lead and own subagents sit in it.
    const deskRoles = (x: string) => x === 'codex' ? codexRoles : []
    const runsIn = (x: string) => x === 'codex' ? runs.filter(s => isCodex(s.role)) : []
    const grid = (n: number) => { const cols = Math.min(COLS, n), rows = Math.ceil(n / COLS); return { w: 2 * PAD + cols * DESK.w + (cols - 1) * DGAP, h: TOP + PAD + rows * (DESK.h + ROOM) } }
    // One slot past the desks stays free for the yard's landmark (markSpot).
    const size = grid(roles.length + 2)
    // Realms: one per other AI this chat handed work to, never the chat's own AI.
    const helpers = p?.helpers ?? []
    const realmAis = [...new Set([...(codexRoles.length ? ['codex'] : []), ...helpers.map(x => x.ai)])].filter(x => x !== ai)
    const realmSize = (x: string) => deskRoles(x).length ? grid(deskRoles(x).length) : REALM
    const rgap = Math.round(RGAP + 0.4 * Math.max(0, ...realmAis.map(x => realmSize(x).h)))
    const rim = realmAis.length ? { w: Math.max(...realmAis.map(x => realmSize(x).w)), h: realmAis.reduce((s, x) => s + realmSize(x).h + rgap, -rgap) } : { w: 0, h: 0 }
    const side = rim.w ? DOCK + rim.w + PLQ : 0, whole = { w: size.w + side, h: Math.max(size.h, rim.h) }
    // Far enough out that this home's yards fit side by side in the fan. The yard alone sets the width: with realms and plaque sky (800px) it flung yards past 1500.
    const d0 = Math.max(320, Math.round((size.w + GAP) * live.filter(o => homeKey(o) === key).length / 2.4))
    // The bridge lands on the yard, which sits on the home's side of the box when realms dock on it.
    // hub: what the bridge comes from, the home or, once its sky runs out, a sibling yard further out.
    let hub = home
    const aim = (n: CourtNode): P => [n.x + (rim.w && mid(hub)[0] > n.x + n.w / 2 ? side : 0) + size.w / 2, n.y + n.h / 2]
    // Nor may the bridge run under this yard's own realm stack.
    const stack = (n: CourtNode): CourtNode => ({ ...n, x: rim.w && mid(hub)[0] > n.x + n.w / 2 ? n.x + PLQ : n.x + size.w + DOCK, y: n.y + (whole.h - rim.h) / 2, w: rim.w, h: rim.h })
    const fits = (n: CourtNode) => !rim.w || !segHits(mid(hub), aim(n), stack(n))
    const straight = place(nodes, links, home, angle, 1.4, d0, whole, spot, aim, fits, reserved)
    let spotFor = straight.fit ? straight.n : undefined
    // Outermost siblings first: they have the most open sky past them.
    const sibs = [...yardsOf.get(key) ?? []].sort((a, b) => Math.hypot(...sub(mid(b), mid(home))) - Math.hypot(...sub(mid(a), mid(home))))
    for (const y of spotFor ? [] : sibs) {
      hub = y
      const [dx, dy] = sub(mid(y), mid(home))
      const t = place(nodes, links, y, Math.atan2(dy, dx / aspect), 0.9, 200, whole, spot, aim, fits, reserved, 3000)
      if (t.fit) { spotFor = t.n; break }
    }
    if (!spotFor) { hub = home; spotFor = straight.n }
    if (rim.w) reserved.push({ ...spotFor, id: `sky:${c.sessionId}`, kind: 'courtyard' })
    // Realms dock on the rim away from the hub, so its bridge never runs under one.
    const left = rim.w > 0 && mid(hub)[0] > spotFor.x + whole.w / 2
    const yard = { ...spotFor, x: spotFor.x + (left ? side : 0), y: spotFor.y + Math.round((whole.h - size.h) / 2), w: size.w, h: size.h }
    const missed = almostDone(p) ? missedCount(p) : undefined
    const ask = state === 'needs' ? p?.question ?? p?.ask?.preview ?? p?.asks?.[0]?.preview : undefined
    // Advanced mode: the stage line stands in for the lead's task.
    const run = chatRun(h, c.sessionId), raised = raisesFor(h, c.cwd)
    const leadTask = (run && stageView(run.run.stages).line) || tasks.find(t => t.status === 'in_progress' && (!t.role || t.role === 'lead'))?.subject
    const group = c.group, on = (h.links ?? []).filter(l => l.from === c.sessionId).flatMap(l => l.to)
    const waitsOn = on.length ? on.map(id => h.chats.find(x => x.sessionId === id)?.name ?? id.slice(0, 8)) : undefined
    Object.assign(yard, { id: `yard:${c.sessionId}`, kind: 'courtyard', label: c.name ?? c.project ?? 'chat', ai, chatId: c.sessionId, state, task: leadTask, since: p?.startedAt, ask, parent: hub.id, from, missed, group, waitsOn, limits: limitTag(c) || undefined })
    nodes.push(yard); link(hub, yard); yardsOf.set(key, [...yardsOf.get(key) ?? [], yard])

    // Docked off the yard's rim, stacked top down, the stack centered on the yard.
    let rimY = spotFor.y + Math.round((whole.h - rim.h) / 2)
    const realms = new Map(realmAis.map(x => {
      const mine = helpers.filter(h => h.ai === x), r = { ...realmSize(x) }
      const codexRuns = runsIn(x)
      const working = mine.some(h => h.state === 'working') || codexRuns.some(s => s.state === 'active')
      const latest = [...mine].sort((a, b) => b.last - a.last)[0]
      const n: CourtNode = { id: `realm:${c.sessionId}:${x}`, kind: 'realm', x: left ? spotFor.x + PLQ + (rim.w - r.w) : yard.x + yard.w + DOCK, y: rimY, ...r, label: `${(NAMES[x] ?? x).toUpperCase()} REALM`,
        sub: `from ${NAMES[ai] ?? ai} · ${c.name ?? c.project ?? 'chat'}`, ai: x, chatId: c.sessionId, parent: yard.id,
        state: working ? 'working' : mine.some(h => h.state === 'done') || codexRuns.length ? 'done' : 'idle',
        task: latest?.label ?? (deskRoles(x).length ? tasks.find(t => t.status === 'in_progress' && t.role && deskRoles(x).includes(t.role))?.subject : undefined), since: working ? Math.max(...mine.filter(h => h.state === 'working').map(h => h.since), ...codexRuns.filter(s => s.state === 'active').map(s => s.startedAt)) : undefined,
        runs: mine.length ? mine.reduce((t, h) => t + h.count, 0) : codexRuns.length }
      rimY += r.h + rgap
      return [x, n] as const
    }))
    const desk = (k: number, role: string, extra: Partial<CourtNode>, box = yard) => {
      const d: CourtNode = { id: `desk:${c.sessionId}:${role}`, kind: 'desk', label: role.split(':').pop()!, role, ai, from, chatId: c.sessionId, parent: box.id,
        x: box.x + PAD + (k % COLS) * (DESK.w + DGAP), y: box.y + TOP + PAD + Math.floor(k / COLS) * (DESK.h + ROOM), w: DESK.w, h: DESK.h, ...extra }
      nodes.push(d); link(box, d); return d
    }
    const lead = desk(0, 'lead', { state, task: leadTask, since: p?.startedAt, ask, missed })
    if (state === 'needs' && !petition) petition = { deskId: lead.id, path: [mid(lead), mid(yard), ...chain(hub), rimOf(council, chain(hub).at(-1)!)] }
    for (const r of realms.values()) { nodes.push(r); link(yard, r) }
    const roleDesk = (k: number, role: string, box = yard) => {
      const mine = runs.filter(r => r.role === role), active = mine.filter(r => r.state === 'active')
      // engineer-codex / qa-codex: a Claude lead's job handed to Codex; the normal desk with a Codex badge, in the Codex realm.
      const codex = /^(.+)-codex$/.exec(role.split(':').pop()!), up = raised[codex?.[1] ?? role.split(':').pop()!]
      desk(k, role, {
        ...(codex ? { role: codex[1], label: codex[1], ai: 'codex' } : {}),
        state: active.length ? 'working' : 'done', runs: mine.length, shipped: mine.filter(r => r.state === 'done').length,
        since: active.length ? Math.max(...active.map(r => r.startedAt)) : undefined,
        task: tasks.find(t => t.status === 'in_progress' && t.role === role)?.subject,
        ...(up ? { model: up.to, raise: raiseLine(up) } : {}),
      }, box)
    }
    roles.forEach((role, i) => roleDesk(i + 1, role))
    const cx = realms.get('codex'); if (cx) codexRoles.forEach((role, i) => roleDesk(i, role, cx))
  }
  // The other places go last, fanned out from the armory and garden like courtyards from a pavilion, so they never crowd a chat's fan.
  const shelf: Record<string, Place[]> = { armory: ['library', 'treasury', 'study', ...(files.length ? ['uploads' as const] : [])], garden: ['notice', 'tower', 'maps'] }
  for (const [from, ks] of Object.entries(shelf)) {
    const home = nodes.find(n => n.id === from)!, a = at(ring - (from === 'garden' ? 2 : 1))
    for (const k of ks) {
      // A crowded shelf hangs the place off a sibling place, like a yard off a yard, rather than flinging it far out.
      let t = place(nodes, links, home, a, 1.4, 260, ISLE, spot, mid, undefined, reserved), up = home
      for (const sib of t.fit ? [] : nodes.filter(n => (PLACES as readonly string[]).includes(n.kind) && n !== home)) {
        const [dx, dy] = sub(mid(sib), mid(council)), o = place(nodes, links, sib, Math.atan2(dy, dx / aspect), 1.2, 200, ISLE, spot, mid, undefined, reserved, 3000)
        if (o.fit) { t = o; up = sib; break }
      }
      const n: CourtNode = { ...t.n, id: k, kind: k, label: PLACE_NAME[k], parent: up.id, ...extra[k] }
      nodes.push(n); link(up, n)
    }
  }
  // An AI's tallies are its desks' sums, left out when none of its chats has runs.
  for (const n of pav.values()) {
    const desks = nodes.filter(d => d.kind === 'desk' && d.ai === n.ai && d.runs !== undefined)
    if (desks.length) { n.runs = desks.reduce((s, d) => s + d.runs!, 0); n.shipped = desks.reduce((s, d) => s + d.shipped!, 0) }
  }
  const ties: CourtTie[] = [], last = new Map<string, CourtNode>()
  for (const y of nodes.filter(n => n.kind === 'courtyard' && n.group)) {
    const prev = last.get(y.group!)
    if (prev) ties.push({ from: prev.id, to: y.id, group: y.group!, points: [mid(prev), mid(y)] })
    last.set(y.group!, y)
  }
  const xs = nodes.flatMap(n => [n.x, n.x + n.w]), ys = nodes.flatMap(n => [n.y, n.y + n.h])
  return { nodes, links, ties, bounds: { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }, petition }
}

// Walks outward from the pavilion, fanning side to side within its sector, until the island and its bridge clear everything placed so far.
// fit: false when nothing fits within reach; n is then the last spot tried.
// ponytail: greedy O(chats^2) search; fine for a hundred chats.
function place(nodes: CourtNode[], links: CourtLink[], home: CourtNode, a0: number, half: number, d0: number, size: { w: number; h: number }, spot: (a: number, d: number) => P, aim: (n: CourtNode) => P = mid, ok: (n: CourtNode) => boolean = () => true, sky: CourtNode[] = [], reach = 40000): { n: CourtNode; fit: boolean } {
  const big = nodes.filter(n => n.kind !== 'desk'), bridges = links.filter(l => big.some(n => n.id === l.to))
  // Rays from the pavilion's center: two of them never cross, so outer islands just thread the gaps between inner ones.
  const from = mid(home), offsets = [0], at = (a: number, d: number): P => { const [x, y] = spot(a, d); return [from[0] + x, from[1] + y] }
  for (let k = 1; k * 0.03 <= half; k++) offsets.push(k * 0.03, -k * 0.03)
  let n = box('', 'courtyard', at(a0, d0), size, '')
  for (let d = d0; d < d0 + reach; d += Math.max(40, Math.round(d * 0.02))) for (const o of offsets) {
    n = box('', 'courtyard', at(a0 + o, d), size, '')
    if (!ok(n)) continue
    const to = aim(n)
    // Islands keep GAP apart, wider than two bridge margins, so later bridges fit between them.
    if (big.some(b => hits(n, b, GAP)) || sky.some(b => hits(n, b, 8))) continue
    if (bridges.some(l => segHits(l.points[0], l.points[1], n))) continue
    if (big.some(b => b !== home && segHits(from, to, b))) continue
    if (bridges.some(l => crosses(from, to, l.points[0], l.points[1]))) continue
    return { n, fit: true }
  }
  return { n, fit: false }
}

/** Base of a yard's landmark in world px: low in the free slot after its k desks, so it clears the plate above. */
export const markSpot = (yard: CourtNode, k: number): [number, number] =>
  [yard.x + PAD + (k % COLS) * (DESK.w + DGAP) + DESK.w / 2, yard.y + TOP + PAD + Math.floor(k / COLS) * (DESK.h + ROOM) + 80]

/** Roughly where board.tsx hangs a realm's plaque, in world px at zoom z: beside it, away from its courtyard. */
export function realmPlaque(r: CourtNode, yard: CourtNode, z = 0.5) {
  const w = 220 / z, h = 32 / z, y = r.y + r.h / 2 - h / 2
  return { x: r.x > yard.x ? r.x + r.w + 4 / z : r.x - w - 4 / z, y, w, h }
}

/** A screen box: x, y, w, h in CSS px. */
export type Box = readonly [number, number, number, number]
type Spot = [number, number]
const over = (x: number, y: number, w: number, h: number, [a, b, c, d]: Box, gap: number) => x < a + c + gap && a < x + w + gap && y < b + d + gap && b < y + h + gap
/** The first spot 2px clear of every taken label and clear of every island but owner's; stage: the box it must stay inside. */
export function freeSpot(spots: Spot[], w: number, h: number, taken: Box[], isles: Array<{ id: string; r: Box }>, owner?: string, stage?: Box): Spot | undefined {
  return spots.find(([x, y]) => (!stage || (x >= stage[0] && y >= stage[1] && x + w <= stage[0] + stage[2] && y + h <= stage[1] + stage[3]))
    && !taken.some(t => over(x, y, w, h, t, 2)) && !isles.some(i => i.id !== owner && over(x, y, w, h, i.r, 0)))
}
/** A realm plaque whose own spots are all taken: the same spots pushed further out from c, then narrower, clear of islands;
 * then clear of labels only. Never on another label or the petition: undefined when nothing on stage is free. */
export function forcedSpot(spots: Spot[], w: number, h: number, c: Spot, taken: Box[], isles: Array<{ id: string; r: Box }>, owner: string, stage: Box): { at: Spot; w: number } | undefined {
  const tries: Array<{ at: Spot; w: number }> = []
  for (const ww of [w, Math.round(w * 0.8), Math.round(w * 0.65)]) for (let k = 0; k <= 8; k++) for (const [x, y] of spots) {
    // Push along the spot's side of c: sideways for a side spot, up or down for one above or below.
    const dx = x + w / 2 - c[0], dy = y + h / 2 - c[1], sx = Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : 0, sy = sx ? 0 : Math.sign(dy) || -1
    tries.push({ at: [x + (w - ww) / 2 + sx * k * 40, y + sy * k * (h + 6)], w: ww })
  }
  for (const ok of [isles, []]) for (const t of tries) if (freeSpot([t.at], t.w, h, taken, ok, owner, stage)) return t
  return undefined
}

/** plate: a courtyard is big enough on screen for desk plates and zoom is 1 or more, so ROOM holds them; card: one quest card per courtyard; dot: too small for either. */
export function lod(zoom: number, courtyardPx: number): Lod {
  const px = zoom * courtyardPx
  return px >= 300 && zoom >= 1 ? 'plate' : px >= 80 ? 'card' : 'dot'
}

/** The zoom and screen offset (screen = world * zoom + offset) that frames every node in a w by h stage. */
export function fitCourt(c: Court, w: number, h: number) {
  // Islands only: board.tsx keeps every plaque on stage when it draws it (freeSpot/forcedSpot), so reserving 220px
  // of plaque beside each realm just shrank the court and pushed it off centre. Tighter pad on a phone.
  const narrow = w < 600, pad = narrow ? 12 : 32, top = narrow ? 24 : 48
  const x0 = Math.min(...c.nodes.map(b => b.x)), y0 = Math.min(...c.nodes.map(b => b.y))
  const bw = Math.max(...c.nodes.map(b => b.x + b.w)) - x0, bh = Math.max(...c.nodes.map(b => b.y + b.h)) - y0
  const zoom = Math.min((w - 2 * pad) / bw, (h - pad - top) / bh)
  // cx, cy: the framed box's world center; sy: where its center sits on screen.
  const cx = x0 + bw / 2, cy = y0 + bh / 2, sy = top + (h - pad - top) / 2
  return { zoom, x: Math.round(w / 2 - cx * zoom), y: Math.round(sy - cy * zoom), cx, cy, sy }
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
/** The Council's line, plaque and card alike: AIs that have chats, chats, agents. */
export function courtSummary(c: Court) {
  const yards = c.nodes.filter(n => n.kind === 'courtyard')
  return `${plural(new Set(yards.map(y => y.ai)).size, 'AI')} · ${plural(yards.length, 'chat')} · ${plural(c.nodes.filter(n => n.kind === 'desk').length, 'agent')}`
}

/** The chat a node opens: its own, else the nearest parent's. */
export function chatOf(c: Court, id: string): string | undefined {
  const by = new Map(c.nodes.map(n => [n.id, n]))
  for (let n = by.get(id), i = 0; n && i < 8; n = by.get(n.parent ?? ''), i++) if (n.chatId) return n.chatId
  return undefined
}

/** The other AI a chat came from: the newest closed version of its chain ran there. */
export function movedFrom(h: Pick<HubState, 'archive'>, c: { chain?: string; ai?: string }): string | undefined {
  if (!c.chain) return undefined
  const last = (h.archive ?? []).filter(a => a.origin === c.chain).sort((a, b) => b.version - a.version || b.archivedAt - a.archivedAt)[0]
  return last && last.ai !== (c.ai ?? 'claude') ? last.ai : undefined
}

/** What changed between two courts: meet, a new subagent desk in a courtyard that was already there (with its lead); cheer, a desk that just turned done; move, a new courtyard handed over from another AI. */
export function courtEvents(prev: Court | undefined, next: Court) {
  const meet: Array<{ deskId: string; leadId: string }> = [], cheer: string[] = [], move: Array<{ yardId: string; from: string; to: string }> = []
  if (!prev) return { meet, cheer, move }
  const old = new Map(prev.nodes.map(n => [n.id, n]))
  for (const n of next.nodes) {
    if (n.kind === 'courtyard' && n.from && !old.has(n.id)) move.push({ yardId: n.id, from: n.from, to: n.ai ?? 'claude' })
    if (n.kind !== 'desk') continue
    // The lead sits in the yard, its subagents may sit in a realm: match by chat.
    const was = old.get(n.id), lead = next.nodes.find(m => m.kind === 'desk' && m.chatId === n.chatId && m.role === 'lead')
    if (!was) { if (lead && lead !== n && old.has(`yard:${n.chatId}`)) meet.push({ deskId: n.id, leadId: lead.id }) }
    else if (n.state === 'done' && was.state !== 'done') cheer.push(n.id)
  }
  return { meet, cheer, move }
}
