import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STUCK, canStop, detect, newWatch, parsePs, redact, sampleDue, snoozed, stopTree, type Proc } from '../src/hub/stuck'
import type { ChatProgress, ChatRow } from '../src/hub/types'

const MIN = 60_000
const T0 = 10_000_000
const chat = (sessionId: string, pid: number): ChatRow => ({ pid, sessionId, cwd: '/r', link: '', live: true, why: [] })
const prog = (o: Partial<ChatProgress> = {}): ChatProgress => ({ sessionId: 's', cwd: '/r', state: 'working', roles: [], tasks: [], startedAt: T0, at: T0, ...o })
const proc = (pid: number, ppid: number, o: Partial<Proc> = {}): Proc => ({ pid, ppid, cpu: 0, rss: 100 << 20, start: T0 - 60 * MIN, command: `cmd${pid}`, ...o })
// The chat's claude is 100; a shell 200 under it, pnpm 300 and a node worker 400 under that.
const tree = (o: Record<number, Partial<Proc>> = {}) => [proc(1, 0, { command: '/sbin/launchd' }), proc(100, 1, { command: 'claude', start: T0 - 120 * MIN }), proc(200, 100, { command: "/bin/zsh -c eval 'pnpm test' < /dev/null", start: T0 - 40 * MIN }), proc(300, 200, { command: 'node pnpm test', start: T0 - 30 * MIN }), proc(400, 300, { command: 'node worker.js', start: T0 - 30 * MIN }), proc(900, 1, { command: 'other' })].map(p => ({ ...p, ...o[p.pid] }))
const input = (o: Partial<Parameters<typeof detect>[0]> = {}) => ({ progress: [prog()], chats: [chat('s', 100)], procs: tree(), outAt: new Map<string, number | undefined>(), finished: new Set<string>(), ...o })

test('parsePs reads pid, ppid, cpu, rss in bytes and start from etime, skipping the header', () => {
  const out = '  PID  PPID  %CPU    RSS      ELAPSED COMMAND\n  42     1  97.5  2048        01:05 node a b\n 43 42 0.0 10 02:03:04 x\n44 1 1.0 1 3-00:00:10 /usr/bin/y --z\n'
  const ps = parsePs(out, T0)
  assert.deepEqual(ps[0], { pid: 42, ppid: 1, cpu: 97.5, rss: 2048 * 1024, start: T0 - 65_000, command: 'node a b' })
  assert.equal(ps[1].start, T0 - (2 * 3600 + 3 * 60 + 4) * 1000)
  assert.equal(ps[2].start, T0 - (3 * 86400 + 10) * 1000)
  assert.equal(ps.length, 3)
})

test('agent: flagged after 10 min with no tool call, not before, not while the chat waits on a prompt', () => {
  const p = (at: number, o: Partial<ChatProgress> = {}) => prog({ running: ['a1'], roles: [{ id: 'a1', role: 'engineer', state: 'active', startedAt: T0 - 30 * MIN, at }], tools: [{ tool: 'Bash', target: 'pnpm test', role: 'engineer', at }], ...o })
  assert.deepEqual(detect(input({ progress: [p(T0 - 9 * MIN)] }), newWatch(), T0), [])
  const [item] = detect(input({ progress: [p(T0 - 11 * MIN)] }), newWatch(), T0)
  assert.equal(item.kind, 'agent')
  assert.equal(item.sessionId, 's')
  assert.equal(item.since, T0 - 11 * MIN)
  assert.equal(item.last, 'Bash pnpm test')
  assert.match(item.what, /engineer/)
  assert.deepEqual(detect(input({ progress: [p(T0 - 11 * MIN, { state: 'needs-you' })] }), newWatch(), T0), [])
  // A chat whose process is gone is not stuck, it is over.
  assert.deepEqual(detect(input({ progress: [p(T0 - 11 * MIN)], chats: [{ ...chat('s', 100), live: false }] }), newWatch(), T0), [])
})

test('job: with no output file, plain age over 30 min', () => {
  const job = (startedAt: number) => prog({ jobs: [{ id: 'j1', label: 'run tests', startedAt }] })
  assert.deepEqual(detect(input({ progress: [job(T0 - 29 * MIN)], procs: [] }), newWatch(), T0), [])
  const [item] = detect(input({ progress: [job(T0 - 31 * MIN)], procs: [] }), newWatch(), T0)
  assert.equal(item.kind, 'job')
  assert.equal(item.since, T0 - 31 * MIN)
})

test('job: with an output file, 15 min with no new output; a finished one never counts', () => {
  const p = prog({ subJobs: [{ id: 'j1', task: 'b1', agent: 'a1', startedAt: T0 - 40 * MIN }] })
  assert.deepEqual(detect(input({ progress: [p], procs: [], outAt: new Map([['j1', T0 - 14 * MIN]]) }), newWatch(), T0), [])
  assert.equal(detect(input({ progress: [p], procs: [], outAt: new Map([['j1', T0 - 16 * MIN]]) }), newWatch(), T0)[0].since, T0 - 16 * MIN)
  assert.deepEqual(detect(input({ progress: [p], procs: [], outAt: new Map([['j1', T0 - 16 * MIN]]), finished: new Set(['j1']) }), newWatch(), T0), [])
})

test('job: tied to its shell in the chat tree, which takes the pid, cpu and memory of its subtree', () => {
  const p = prog({ jobs: [{ id: 'j1', command: 'pnpm test', startedAt: T0 - 40 * MIN }] })
  const items = detect(input({ progress: [p], procs: tree({ 400: { cpu: 99 } }) }), newWatch(), T0)
  assert.equal(items.length, 1)
  assert.equal(items[0].pid, 200)
  assert.equal(items[0].cpu, 99)
  assert.equal(items[0].rss, 3 * (100 << 20))
  assert.equal(items[0].started, T0 - 40 * MIN)
})

test('process: over 80% CPU for 5 min across samples, reset when it cools; only the chat tree, never claude itself', () => {
  const w = newWatch()
  const hot = input({ procs: tree({ 400: { cpu: 95 }, 900: { cpu: 99 }, 100: { cpu: 99 } }) })
  assert.deepEqual(detect(hot, w, T0), [])
  assert.deepEqual(detect(hot, w, T0 + 4 * MIN), [])
  const [item] = detect(hot, w, T0 + 5 * MIN)
  assert.deepEqual([item.kind, item.pid, item.cpu, item.since], ['process', 400, 95, T0])
  detect(input(), w, T0 + 6 * MIN)
  assert.deepEqual(detect(hot, w, T0 + 7 * MIN), [])
})

test('process: over 2 GB of memory counts at once', () => {
  const [item] = detect(input({ procs: tree({ 300: { rss: 3 * 1024 ** 3 } }) }), newWatch(), T0)
  assert.deepEqual([item.kind, item.pid, item.rss], ['process', 300, 3 * 1024 ** 3])
  assert.ok(item.command!.length <= 120)
})

test('canStop: a descendant of the chat passes; a stranger, claude itself, a guarded pid and a reused pid do not', () => {
  const ps = tree()
  const at = (pid: number) => ({ pid, start: ps.find(p => p.pid === pid)!.start })
  assert.equal(canStop(ps, at(400), 100, new Set()), undefined)
  assert.match(canStop(ps, at(900), 100, new Set())!, /not under/)
  assert.match(canStop(ps, at(100), 100, new Set())!, /chat itself/)
  assert.match(canStop(ps, at(300), 100, new Set([300]))!, /protected/)
  // Same pid, different start: the old process ended and the pid went to another.
  assert.match(canStop(ps, { pid: 400, start: at(400).start + 60_000 }, 100, new Set())!, /ended/)
  assert.match(canStop(ps.filter(p => p.pid !== 400), at(400), 100, new Set())!, /ended/)
  // The parent died and the worker was reparented to launchd.
  assert.match(canStop(tree({ 400: { ppid: 1 } }), at(400), 100, new Set())!, /not under/)
  // The chat's pid went to a newer process: a child cannot be older than its parent.
  assert.match(canStop(tree({ 100: { start: T0 } }), at(400), 100, new Set())!, /not under/)
})

test('stopTree: SIGTERM to the subtree, deepest first, then SIGKILL after 5 s to what is left, checked again', async () => {
  const sent: string[] = []
  let ps = tree()
  const deps = { list: async () => ps, kill: (pid: number, sig: string) => { sent.push(`${sig} ${pid}`) }, wait: async (ms: number) => { sent.push(`wait ${ms}`); ps = ps.filter(p => p.pid !== 400) } }
  const r = await stopTree({ pid: 300, start: ps.find(p => p.pid === 300)!.start }, 100, new Set(), deps)
  assert.equal(r.problem, undefined)
  await r.done
  assert.deepEqual(sent, ['SIGTERM 400', 'SIGTERM 300', 'wait 5000', 'SIGKILL 300'])
  sent.length = 0
  // A pid reused in the 5 s gets no SIGKILL.
  const again = await stopTree({ pid: 300, start: ps.find(p => p.pid === 300)!.start }, 100, new Set(), { ...deps, wait: async () => { ps = ps.map(p => p.pid === 300 ? { ...p, start: T0 } : p) } })
  await again.done
  assert.deepEqual(sent, ['SIGTERM 300'])
  sent.length = 0
  assert.match((await stopTree({ pid: 900, start: T0 - 60 * MIN }, 100, new Set(), deps)).problem!, /not under/)
  assert.deepEqual(sent, [])
})

test('snooze: a dismissed item hides for 30 min, then shows again', () => {
  const items = [{ id: 'a' }, { id: 'b' }]
  const s = new Map([['a', T0]])
  assert.deepEqual(snoozed(items, s, T0 + 29 * MIN).map(i => i.id), ['b'])
  assert.deepEqual(snoozed(items, s, T0 + STUCK.snoozeMs).map(i => i.id), ['a', 'b'])
  assert.equal(s.has('a'), false)
})

test('redact: secrets go before the cut, the rest stays readable', () => {
  const r = redact('curl -H "Authorization: Bearer abc123def" https://u:pw@x.io?token=s3cr3t OPENAI_API_KEY=sk-abcdefghijk1234 run a4f9e2c1b7d3a4f9e2c1b7d3a4f9e2c1ff')
  for (const s of ['abc123def', 'pw@', 's3cr3t', 'sk-abcdefghijk1234', 'a4f9e2c1b7d3a4f9e2c1b7d3a4f9e2c1ff']) assert.ok(!r.includes(s), `${s} left in ${r}`)
  assert.match(r, /^curl -H/)
  assert.equal(redact('/Users/k/Documents/GitHub/-Users-kennykennethkkang-Documents-GitHub-agent-flow x'), '/Users/k/Documents/GitHub/-Users-kennykennethkkang-Documents-GitHub-agent-flow x')
  assert.equal(Array.from(redact('x'.repeat(300))).length, 120)
})

test('hub: the stuck list leaves out snoozed items, a snooze from another window counts, and each item notifies once, only where its chat is owned', async () => {
  const { HubService } = await import('../src/hub/hub-service')
  const h = new HubService()
  const item = (id: string, sessionId = 's') => ({ id, kind: 'agent' as const, sessionId, what: 'x', since: T0 })
  h.hook({ session_id: 's', cwd: '/r', hook_event_name: 'SessionStart' }, T0)
  h.hook({ session_id: 'm', cwd: '/r', hook_event_name: 'SessionStart' }, T0, true)
  h.setStuck([item('a'), item('b'), item('c', 'm')], T0)
  assert.deepEqual(h.get().stuck?.map(i => i.id), ['a', 'b', 'c'])
  assert.deepEqual(h.unseenStuck().map(i => i.id), ['a', 'b'])
  assert.deepEqual(h.unseenStuck(), [])
  h.snooze('a', T0)
  assert.deepEqual(h.get().stuck?.map(i => i.id), ['b', 'c'])
  assert.equal(h.ingest({ token: h.token, kind: 'stuck-snooze', id: 'b' }, T0), true)
  assert.deepEqual(h.get().stuck?.map(i => i.id), ['c'])
  h.setStuck([item('a'), item('b'), item('c', 'm')], T0 + STUCK.snoozeMs)
  assert.deepEqual(h.get().stuck?.map(i => i.id), ['a', 'b', 'c'])
  assert.deepEqual(h.unseenStuck(), [])
})

test('routes: the stuck commands take a session and an id, behind the token like every hub command', async () => {
  const { commandProblem, handleHub } = await import('../src/hub/routes')
  const { HubService } = await import('../src/hub/hub-service')
  assert.equal(commandProblem({ type: 'hub-stuck-stop', sessionId: 's', id: 'proc:s:1:2' }), undefined)
  assert.equal(commandProblem({ type: 'hub-stuck-dismiss', sessionId: 's', id: 'a' }), undefined)
  assert.match(commandProblem({ type: 'hub-stuck-stop', sessionId: 's', pid: 42 })!, /id/)
  const h = new HubService()
  h.runner = () => true
  assert.equal((handleHub(h, 'POST', '/hub/command', JSON.stringify({ type: 'hub-stuck-stop', sessionId: 's', id: 'a' })) as { status: number }).status, 403)
  assert.equal((handleHub(h, 'POST', `/hub/command?token=${h.token}`, JSON.stringify({ type: 'hub-stuck-stop', sessionId: 's', id: 'a' })) as { status: number }).status, 204)
})

// ps output for one hot shell under claude, sampled at `at` with etime truncated to whole seconds, as ps does.
const psAt = (at: number, born: number, cpu = 95, rss = 100 << 10) => {
  const e = Math.floor((at - born) / 1000), mm = Math.floor(e / 60), ss = e % 60
  return [`  100     1   1.0  1000  99:00 claude`, `  777   100  ${cpu}  ${rss}  ${mm}:${String(ss).padStart(2, '0')} node hot.js`].join('\n')
}

test('a moving clock: one process keeps one id across samples, so CPU fires after 5 min and a Dismiss holds', () => {
  const born = T0 - 90_400 // a start that is not on a whole second
  const w = newWatch(), snoozes = new Map<string, number>()
  const ids: string[] = []
  // Samples about 30 s apart with sub-second drift either way.
  const times = [0, 30_480, 60_910, 91_020, 121_600, 150_150, 181_990, 210_700, 240_330, 270_850, 300_420, 331_100].map(d => T0 + d)
  let fired: number | undefined
  for (const at of times) {
    const items = detect(input({ procs: parsePs(psAt(at, born), at) }), w, at)
    if (items.length && fired === undefined) fired = at
    ids.push(...items.map(i => i.id))
  }
  assert.ok(fired !== undefined && fired - T0 >= STUCK.cpuForMs && fired - T0 < STUCK.cpuForMs + STUCK.sampleMs, `fired at ${fired && fired - T0}`)
  assert.equal(new Set(ids).size, 1)
  snoozes.set(ids[0], times.at(-1)!)
  const later = T0 + 361_300
  assert.deepEqual(snoozed(detect(input({ procs: parsePs(psAt(later, born), later) }), w, later), snoozes, later), [])
})

test('a moving clock: a memory item and a job item read the same each sample, start and all', () => {
  const born = T0 - 40 * MIN - 700
  const w = newWatch()
  const job = prog({ jobs: [{ id: 'j1', command: 'node hot.js', startedAt: T0 - 40 * MIN }] })
  const at1 = T0 + 200, at2 = T0 + 30_900
  const mem = (at: number) => detect(input({ procs: parsePs(psAt(at, born, 1, 3 * 1024 ** 2), at) }), w, at)
  assert.deepEqual(mem(at1).map(i => [i.id, i.started]), mem(at2).map(i => [i.id, i.started]))
  const j = (at: number) => detect(input({ progress: [job], procs: parsePs(psAt(at, born, 1), at) }), w, at).map(i => JSON.stringify(i))
  assert.deepEqual(j(at1), j(at2))
})

test('canStop refuses a target with a protected process anywhere under it', () => {
  // 300 runs a dev server on port 3000 (protected) as its child.
  const ps = [...tree(), proc(500, 300, { command: 'next dev -p 3000', start: T0 - 20 * MIN })]
  const at = (pid: number) => ({ pid, start: ps.find(p => p.pid === pid)!.start })
  assert.match(canStop(ps, at(200), 100, new Set([500]))!, /protected/)
  assert.match(canStop(ps, at(300), 100, new Set([500]))!, /protected/)
  assert.equal(canStop(ps, at(400), 100, new Set([500])), undefined)
})

test('sampling cadence: every 30 s while a chat works, every 5 min when all are idle', () => {
  assert.equal(sampleDue(undefined, false, T0), true)
  assert.equal(sampleDue(T0, true, T0 + 29_000), false)
  assert.equal(sampleDue(T0, true, T0 + 30_000), true)
  assert.equal(sampleDue(T0, false, T0 + 4 * MIN), false)
  assert.equal(sampleDue(T0, false, T0 + 5 * MIN), true)
})
