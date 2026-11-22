import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { aiPath, autopilot, busiestTodo, upNext, pilotLanes, planFolder, stepLabel, moved, finishUp, inside, openCount, ordered, runIds, runLanded, runTargets, startable, holdOf, HELD, withHome } from './todo'
import { demoHub } from './hub-demo'
import type { ChatRow, TodoItem, TodoList } from './hub-types'

const t = (id: string, before?: string): TodoItem => ({ id, text: id, at: 1, ...(before ? { before } : {}) })

describe('todo panel helpers', () => {
  it('adds an empty list for the chat\'s folder only when no listed project holds it', () => {
    const lists = { '/r/a': { todo: [t('x')] } }
    assert.equal(withHome(lists, '/r/a/web'), lists)
    assert.deepEqual(withHome(lists, '/r/b'), { ...lists, '/r/b': { todo: [] } })
    assert.deepEqual(withHome(undefined, '/r/b'), { '/r/b': { todo: [] } })
    assert.deepEqual(withHome(undefined), {})
  })
  it('plan follows the window (this one or the last used), else the picked chat; a manual pick holds until that changes', () => {
    const f = ['/r/a', '/r/b', '/r/c']
    assert.deepEqual(planFolder(f, '/r/b/web', '/r/a'), { at: '/r/a', folder: '/r/a' })
    assert.deepEqual(planFolder(f, '/r/b/web', undefined), { at: '/r/b', folder: '/r/b' })
    assert.equal(planFolder(f, '/r/b', '/r/a', { at: '/r/a', folder: '/r/c' }).folder, '/r/c')
    // Another window got focus: the pick made while following /r/a lets go.
    assert.equal(planFolder(f, undefined, '/r/b', { at: '/r/a', folder: '/r/c' }).folder, '/r/b')
    assert.equal(planFolder(f, undefined, '/r/a', { at: '/r/a', folder: '/r/gone' }).folder, '/r/a')
    // This window's project with no list yet still wins over another project's list.
    assert.equal(planFolder(Object.keys(withHome({ '/r/other': { todo: [t('x')] } }, '/r/here')), undefined, '/r/here').folder, '/r/here')
  })
  it('lists Kenneth\'s hand steps from the tray, then older accepted ones', () => {
    const you = (id: string): TodoItem => ({ id, text: id, at: 1, why: 'you' })
    const steps = finishUp({ todo: [t('a'), you('old')], suggested: [you('s1'), you('s2'), { ...t('s3'), why: 'later' }] })
    assert.deepEqual(steps.map(x => x.id), ['s1', 's2', 'old'])
    assert.deepEqual(finishUp({ todo: [t('a')] }), [])
  })
  it('puts each prerequisite indented directly above its item; one whose item is gone stands alone', () => {
    const rows = ordered([t('a'), t('b'), t('p', 'b'), t('pp', 'p'), t('q', 'gone')])
    assert.deepEqual(rows.map(r => [r.t.id, r.depth]), [['a', 0], ['pp', 2], ['p', 1], ['b', 0], ['q', 0]])
    assert.deepEqual(ordered([t('x', 'y'), t('y', 'x')]).map(r => r.t.id).sort(), ['x', 'y'])
  })
  it('counts open items, leaving out hand steps that show under Finish up', () => {
    const you: TodoItem = { ...t('y'), why: 'you' }
    assert.equal(openCount({ todo: [t('1'), you] }), 1)
    assert.equal(openCount(undefined), 0)
  })
  it('offers running chats in the project that take messages', () => {
    const c = (sessionId: string, cwd: string, live = true, takes = true): ChatRow => ({ pid: 1, sessionId, cwd, link: '', live, why: [], takes })
    const chats = [c('in', '/u/app/web'), c('root', '/u/app'), c('other', '/u/apple'), c('dead', '/u/app', false), c('mute', '/u/app', true, false)]
    assert.deepEqual(runTargets(chats, '/u/app').map(x => x.sessionId), ['in', 'root'])
    assert.equal(inside('C:\\u\\app', 'c:/u/app/x'), true)
  })
})

describe('run landed', () => {
  const todo: TodoItem[] = [{ id: 'a', text: 'A', at: 1, chat: 's1' }, { id: 'b', text: 'B', at: 1 }]
  it('counts an item already in the chat it was sent to as sent', () => {
    assert.equal(runLanded(todo, ['a'], new Map([['a', 's1']]), 's1'), true)
    assert.equal(runLanded(todo, ['b'], new Map(), 's1'), false)
  })
  it('waits for a new chat to take the items, even ones that were in an ended chat', () => {
    const was = new Map([['a', 's1']])
    assert.equal(runLanded(todo, ['a'], was), false)
    assert.equal(runLanded([{ ...todo[0], chat: 'new' }], ['a'], was), true)
    assert.equal(runLanded([], ['a'], was), true)
  })
  it('runs the picked items with their open prerequisites', () => {
    const list: TodoItem[] = [{ id: 'a', text: 'A', at: 1 }, { id: 'p', text: 'P', at: 1, before: 'a' }, { id: 'pp', text: 'PP', at: 1, before: 'p' }, { id: 'x', text: 'X', at: 1 }]
    assert.deepEqual([...runIds(list, ['a', 'gone'])].sort(), ['a', 'p', 'pp'])
  })
})

describe('aiPath and moved', () => {
  const chat = (sessionId: string, more: Partial<ChatRow> = {}): ChatRow => ({ pid: 1, sessionId, cwd: '/r', link: '', live: true, why: [], ...more })
  const arch = (v: number, ai: 'claude' | 'codex') => ({ sessionId: `v${v}`, ai, name: 'x', origin: 'Fix', version: v, cwd: '/r', project: 'r', archivedAt: v })
  it('names the AI, and the change when a handoff moved it', () => {
    assert.equal(aiPath('c', [chat('c')]), 'Claude')
    assert.equal(aiPath('c', [chat('c', { ai: 'codex' })]), 'Codex')
    assert.equal(aiPath('c', [chat('c', { ai: 'codex', chain: 'Fix' })], [arch(2, 'claude'), arch(1, 'claude')]), 'Claude to Codex')
    assert.equal(aiPath('v2', [], [arch(1, 'codex'), arch(2, 'claude')]), 'Codex to Claude')
    assert.equal(aiPath('nope', [chat('c')]), undefined)
  })
  it('moves an id up, down or to a place, clamped', () => {
    assert.deepEqual(moved(['a', 'b', 'c'], 'c', 1), ['a', 'c', 'b'])
    assert.deepEqual(moved(['a', 'b', 'c'], 'a', 9), ['b', 'c', 'a'])
    assert.deepEqual(moved(['a', 'b', 'c'], 'b', -3), ['b', 'a', 'c'])
    assert.deepEqual(moved(['a'], 'z', 0), ['a'])
  })
})

describe('busiestTodo', () => {
  const item = (id: string, why?: 'you'): TodoItem => ({ id, text: id, ...(why ? { why } : {}) }) as TodoItem
  it('picks the project with the most open items plus your steps; none open gives undefined', () => {
    assert.equal(busiestTodo({ '/a': { todo: [item('1')] }, '/b': { todo: [item('2'), item('3', 'you')] }, '/c': { todo: [] } }), '/b')
    assert.equal(busiestTodo({ '/a': { todo: [] } }), undefined)
  })
})

describe('autopilot', () => {
  const live = (c?: string) => c === 'live'
  const list = (more: Partial<TodoList> = {}): TodoList => ({
    todo: [{ id: 'q1', text: 'CSV', at: 1 }, { id: 'r', text: 'Stripe', at: 1, chat: 'live', run: 2, auto: true, before: 'q1' }, { id: 'q2', text: 'Phone', at: 1, chat: 'gone' }, { id: 'y', text: 'Key', at: 1, why: 'you' }],
    ticked: [{ id: 'd1', text: 'Login', at: 1, run: 1, auto: true }, { id: 'old', text: 'Old', at: 1, run: 0 }, { id: 'hand', text: 'Hand', at: 1 }],
    seq: 2, streak: 1, pilot: { on: true, at: 1 },
    // As todo.ts upcoming sends it: r's chat is live, so q1 waits on nothing.
    plan: { runs: [{ n: 3, ids: ['q1'] }], held: [{ id: 'q2', why: 'stopped' }, { id: 'y', why: 'you' }] }, ...more,
  })
  it('shows the hold in the head when the next item waits, not "starts by itself"', () => {
    const hold = { kind: 'waiting' as const, text: 'Next to-do waits: Fix login is waiting on Outfit picker copy to finish' }
    assert.equal(autopilot(list({ plan: { runs: [{ n: 3, ids: ['q1'] }], held: [], hold } }), true, () => false).head, hold.text)
    assert.match(autopilot(list({ plan: { runs: [{ n: 3, ids: ['q1'] }], held: [], hold } }), false, live).note, /Next to-do waits: Fix login is waiting on Outfit picker copy to finish\./)
    assert.equal(autopilot(list({ plan: { runs: [{ n: 3, ids: ['q1'] }], held: [] } }), true, () => false).head, 'Next: To-do 3 starts by itself when no to-do chat is running')
  })
  it('chains done (run >= streak), running, then the plan with its numbers; a stopped chat is held; hand steps stay out', () => {
    const p = autopilot(list(), false, live)
    assert.deepEqual(p.steps.map(s => [s.id, s.n, s.state, s.why]), [['d1', 1, 'done', undefined], ['r', 2, 'running', undefined], ['q1', 3, 'next', undefined], ['q2', undefined, 'held', 'stopped']])
    assert.equal(p.mode, 'running')
    assert.equal(p.head, 'Autopilot is running To-do 2 of 3')
    assert.equal(stepLabel(p.steps[3]), 'a to-do, Phone: Stopped')
    assert.match(p.note, /beside your other chats.*To-do 3 starts by itself/)
    assert.equal(stepLabel(p.steps[1]), 'To-do 2, Stripe: Running, started by autopilot')
  })
  it('no streak means no done steps', () => {
    assert.ok(!autopilot(list({ streak: undefined }), true, live).steps.some(s => s.state === 'done'))
  })
  it('a hand start says so', () => {
    const l = list(); l.todo[1] = { ...l.todo[1], auto: undefined }
    assert.equal(autopilot(l, true, live).head, 'To-do 2 is running, started by hand')
  })
  it('on falls back to Auto-start; off and paused win over running', () => {
    assert.equal(autopilot(list({ pilot: undefined }), false, live).mode, 'off')
    assert.equal(autopilot(list({ pilot: undefined }), true, live).mode, 'running')
    assert.equal(autopilot(list({ pilot: { on: true, paused: true, at: 1 } }), false, live).mode, 'paused')
    assert.equal(autopilot(list({ pilot: { on: false, paused: true, at: 1 } }), true, live).mode, 'off')
  })
  it('idle names the next one; empty when nothing is left', () => {
    const idle = autopilot(list(), true, () => false)
    assert.equal(idle.mode, 'idle')
    assert.match(idle.head, /^Next: To-do 3 starts by itself/)
    assert.equal(autopilot({ todo: [], pilot: { on: true, at: 1 } }, false, live).mode, 'empty')
  })
  it('numbers and next come from the plan: a run is one number and one chip, held rows say why', () => {
    // seq 4, [B, P before B, C]: the extension runs [P, B] as 5, C as 6.
    const l: TodoList = { todo: [{ id: 'B', text: 'Ship', at: 1 }, { id: 'P', text: 'Pre', at: 1, before: 'B' }, { id: 'C', text: 'Fix footer', at: 1 }], seq: 4, pilot: { on: true, at: 1 },
      plan: { runs: [{ n: 5, ids: ['P', 'B'] }, { n: 6, ids: ['C'] }], held: [] } }
    const p = autopilot(l, false, () => false)
    assert.deepEqual(p.steps.map(s => [s.id, s.n, s.state, s.pre]), [['B', 5, 'next', 1], ['C', 6, 'queued', undefined]])
    assert.deepEqual([...p.num], [['P', 5], ['B', 5], ['C', 6]])
    assert.deepEqual(p.starts, ['P', 'C'])
    assert.equal(stepLabel(p.steps[0]), 'To-do 5, Ship, +1 prerequisite: Next')
    // A blocked item, and one waiting on a hand step, are held, not next.
    const h: TodoList = { todo: [{ id: 'b', text: 'Wait on API key', at: 1, why: 'blocked' }, { id: 'x', text: 'Deploy', at: 1 }, { id: 'k', text: 'Key', at: 1, why: 'you', before: 'x' }, { id: 'f', text: 'Fix footer', at: 1 }], seq: 4, pilot: { on: true, at: 1 },
      plan: { runs: [{ n: 5, ids: ['f'] }], held: [{ id: 'b', why: 'blocked' }, { id: 'x', why: 'you' }, { id: 'k', why: 'you' }] } }
    const q = autopilot(h, false, () => false)
    assert.deepEqual(q.steps.map(s => [s.id, s.n, s.state, s.why]), [['f', 5, 'next', undefined], ['b', undefined, 'held', 'blocked'], ['x', undefined, 'held', 'you']])
    assert.match(q.head, /^Next: To-do 5 starts/)
    assert.equal(q.queued, 1)
    assert.equal(stepLabel(q.steps[1]), 'a to-do, Wait on API key: Blocked')
  })
  it('the demo lists carry a plan', () => {
    const l = demoHub(1e12).todos!['/Users/k/GitHub/Armasu']
    assert.deepEqual(l.plan, { runs: [{ n: 3, ids: ['dt1'] }, { n: 4, ids: ['dt4'] }, { n: 5, ids: ['dt7'] }], held: [{ id: 'dt5', why: 'stopped' },
      // An approval holds the item after it too; a dated, a stopped and a blocked one each say why.
      { id: 'dt11', why: 'ok' }, { id: 'dt12', why: 'ok' }, { id: 'dt13', why: 'date' }, { id: 'dt14', why: 'stopped' }, { id: 'dt15', why: 'blocked' }], hold: { kind: 'waiting', text: 'Next to-do waits: Put a Stripe test key in .env.local is waiting on Accurate Done state to finish' } })
    assert.deepEqual(demoHub(1e12).todos!['/Users/k/GitHub/switchboard'].plan?.hold, { kind: 'paused', text: 'Next to-do waits: autopilot is paused' })
  })
  it('no plan (an older extension): queued in list order, no numbers', () => {
    const p = autopilot(list({ plan: undefined }), true, live)
    assert.deepEqual(p.steps.slice(2).map(s => [s.id, s.n, s.state, s.why]), [['q1', undefined, 'next', undefined], ['q2', undefined, 'held', 'stopped']])
    assert.equal(p.num.size, 0)
    // A blocked or stopped first row is never Next.
    const f = autopilot({ todo: [{ id: 'b', text: 'B', at: 1, why: 'blocked' }, { id: 's', text: 'S', at: 1, stopped: true }, { id: 'z', text: 'Z', at: 1 }], pilot: { on: true, at: 1 } }, true, () => false)
    assert.deepEqual(f.steps.map(s => [s.id, s.state, s.why]), [['z', 'next', undefined], ['b', 'held', 'blocked'], ['s', 'held', 'stopped']])
    assert.deepEqual(f.starts, ['z'])
  })
  it('the running note says the next starts when this one is done', () => {
    assert.match(autopilot(list(), false, live).note, /starts by itself when this one is done/)
  })
  it('lanes skip projects with nothing in them', () => {
    assert.deepEqual(pilotLanes({ '/a': list(), '/b': { todo: [] }, '/c': { todo: [{ id: 'y', text: 'k', at: 1, why: 'you' }] } }, true, live).map(l => l.folder), ['/a'])
  })
})

describe('one startable rule', () => {
  const no = () => false
  it('Start works on any open item that is not a hand step or running: stopped ones included', () => {
    assert.equal(startable({ id: 'a', text: 'A', at: 1 }, no), true)
    assert.equal(startable({ id: 'a', text: 'A', at: 1, stopped: true }, no), true)
    assert.equal(startable({ id: 'a', text: 'A', at: 1, chat: 'gone' }, no), true)
    assert.equal(startable({ id: 'a', text: 'A', at: 1, chat: 'live' }, c => c === 'live'), false)
    assert.equal(startable({ id: 'a', text: 'A', at: 1, why: 'you' }, no), false)
    // A gate holds auto-start, not Start.
    assert.equal(startable({ id: 'a', text: 'A', at: 1, needsOk: true, notBefore: 9e12 }, no), true)
  })
  it('the Now card offers a stopped item, the same one the Plan page can start', () => {
    const list: TodoList = { todo: [{ id: 'y', text: 'Key', at: 1, why: 'you' }, { id: 's', text: 'Memory', at: 1, stopped: true }] }
    assert.equal(upNext(list, no)?.id, 's')
    assert.equal(startable(list.todo[1], no), true)
  })
  it('holdOf says why auto-start leaves an item, as the extension plan does', () => {
    const now = 1000, t = (more: Partial<TodoItem>): TodoItem => ({ id: 'a', text: 'A', at: 1, ...more })
    assert.equal(holdOf(t({}), now), undefined)
    assert.equal(holdOf(t({ why: 'blocked', needsOk: true }), now), 'blocked')
    assert.equal(holdOf(t({ why: 'you' }), now), 'you')
    assert.equal(holdOf(t({ needsOk: true, notBefore: now + 1, stopped: true }), now), 'ok')
    assert.equal(holdOf(t({ needsOk: false, notBefore: now + 1 }), now), 'date')
    assert.equal(holdOf(t({ notBefore: now }), now), undefined)
    assert.equal(holdOf(t({ notBefore: 0 }), now), undefined)
    assert.equal(holdOf(t({ stopped: true }), now), 'stopped')
    assert.equal(holdOf(t({ chat: 'c' }), now), 'stopped')
  })
  it('names the new holds', () => {
    assert.deepEqual([HELD.ok, HELD.date], ['Needs your OK', 'Waits for its date'])
  })
  it('a stopped item gets its own note, not a promise that clearing something starts it', () => {
    const stopped: TodoList = { todo: [{ id: 's', text: 'Memory', at: 1, stopped: true }], pilot: { on: true, at: 1 }, plan: { runs: [], held: [{ id: 's', why: 'stopped' }] } }
    assert.equal(autopilot(stopped, false, () => false).note, '1 item stopped: its chat ended before finishing. Press Start again.')
    const two: TodoList = { ...stopped, todo: [...stopped.todo, { id: 'k', text: 'K', at: 1, stopped: true }], plan: { runs: [], held: [{ id: 's', why: 'stopped' }, { id: 'k', why: 'stopped' }] } }
    assert.equal(autopilot(two, false, () => false).note, '2 items stopped: their chats ended before finishing. Press Start again.')
    const mixed: TodoList = { ...stopped, todo: [...stopped.todo, { id: 'b', text: 'B', at: 1, why: 'blocked' }], plan: { runs: [], held: [{ id: 's', why: 'stopped' }, { id: 'b', why: 'blocked' }] } }
    assert.equal(autopilot(mixed, false, () => false).note, '2 items held. Clear what holds one and it starts by itself. A stopped one needs Start again.')
  })
  it('without a plan, a gated item is held, not next', () => {
    const now = 1000
    const l: TodoList = { todo: [{ id: 'o', text: 'O', at: 1, needsOk: true }, { id: 'd', text: 'D', at: 1, notBefore: now + 5 }, { id: 'z', text: 'Z', at: 1 }], pilot: { on: true, at: 1 } }
    const p = autopilot(l, true, () => false, now)
    assert.deepEqual(p.steps.map(s => [s.id, s.state, s.why]), [['z', 'next', undefined], ['o', 'held', 'ok'], ['d', 'held', 'date']])
    assert.equal(stepLabel(p.steps[1]), 'a to-do, O: Needs your OK')
  })
})

describe('upNext', () => {
  it('skips an item already running in a live chat and your hand steps', () => {
    const list: TodoList = { todo: [{ id: 'q1', text: 'CSV', at: 1 }, { id: 'r', text: 'Stripe', at: 1, chat: 'live', before: 'q1' }, { id: 'y', text: 'Key', at: 1, why: 'you' }] }
    assert.equal(upNext(list, c => c === 'live')?.text, 'CSV')
    assert.equal(upNext(list, () => false)?.text, 'Stripe')
    assert.equal(upNext({ todo: [{ id: 'r', text: 'Stripe', at: 1, chat: 'live' }] }, c => c === 'live'), undefined)
  })
})
