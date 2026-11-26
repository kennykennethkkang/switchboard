import { it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { readWindows } from '../src/hub/dev'
import { endedCodex } from '../src/hub/ais'
import { fieldsJson, stateJson } from '../src/hub/state-json'
import { Posters, tickWork, UNFOCUSED_EVERY_MS } from '../src/hub/posters'
import { UsageScanner } from '../src/hub/usage'
import { HistoryScanner } from '../src/hub/history'
import { tickShipped, emptyDoc } from '../src/hub/todo'
import { jevProject } from '../src/hub/jev-project'
import type { ChatRow } from '../src/hub/types'

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-lag-'))

it('readWindows opens window files only, never the big caches beside them', () => {
  const dir = temp()
  const win = { port: 1, pid: process.pid, hubToken: 't', workspace: '/r' }
  fs.writeFileSync(path.join(dir, `0e595c5cde82bff2-${process.pid}.json`), JSON.stringify(win))
  fs.writeFileSync(path.join(dir, 'usage-cache.json'), JSON.stringify(win))
  fs.writeFileSync(path.join(dir, 'retries-0e595c5cde82bff2.json'), JSON.stringify(win))
  assert.equal(readWindows(dir).length, 1)
})

it('the usage cache lives in its own folder, and an old one is moved there or dropped', async () => {
  const dir = temp(), cache = path.join(dir, 'usage', 'cache.json'), old = path.join(dir, 'usage-cache.json')
  const scanner = new UsageScanner(path.join(dir, 'projects'), 30, path.join(dir, 'codex'), cache)
  await scanner.moveOldCache()
  assert.equal(fs.existsSync(cache), false)
  fs.writeFileSync(old, 'first')
  await scanner.moveOldCache()
  assert.equal(fs.readFileSync(cache, 'utf8'), 'first')
  // An older window wrote it again: the newer copy stays.
  fs.writeFileSync(old, 'second')
  await scanner.moveOldCache()
  assert.equal(fs.existsSync(old), false)
  assert.equal(fs.readFileSync(cache, 'utf8'), 'first')
})

it('the usage records leave memory when idle, and the next report reads them back', async () => {
  const dir = temp(), root = path.join(dir, 'projects'), file = path.join(root, '-r-app', 's1.jsonl'), now = Date.now()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ type: 'assistant', cwd: '/r/app', timestamp: new Date(now - 1000).toISOString(), message: { id: 'a', model: 'claude-opus-5-5', usage: { input_tokens: 7, output_tokens: 2 } } }) + '\n')
  const scanner = new UsageScanner(root, 30, path.join(dir, 'codex'), path.join(dir, 'usage', 'cache.json'))
  const first = await scanner.report(now)
  scanner.drop(now)
  assert.equal(Object.keys((scanner as unknown as { cache: { files: object } }).cache.files).length, 0)
  const again = await scanner.report(now + 120_000)
  assert.deepEqual(again.rows, first.rows)
  assert.equal(again.rows[0].input, 7)
})

it('the transcript scan survives a reload: only appended lines are read, and totals match a cold scan', async () => {
  const dir = temp(), root = path.join(dir, 'projects'), save = path.join(dir, 'history.json'), file = path.join(root, '-r-app', 's1.jsonl')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const now = Date.now()
  const line = (id: string, out: number, at = now - 60_000) => JSON.stringify({ type: 'assistant', cwd: '/r/app', timestamp: new Date(at).toISOString(), message: { id, usage: { input_tokens: 1, output_tokens: out, cache_read_input_tokens: 5 } } }) + '\n'
  fs.writeFileSync(file, JSON.stringify({ type: 'user', cwd: '/r/app', timestamp: new Date(now).toISOString(), message: { role: 'user', content: 'Fix the lag' } }) + '\n' + line('a', 2) + line('b', 3))
  const scanner = () => new HistoryScanner(root, 14, path.join(dir, 'codex'), path.join(dir, 'usage', 'cache.json'), save)
  await scanner().scan(now)
  assert.ok(fs.existsSync(save))
  // b grows (the same message, more usage), a copy of a lands in another chat, c is new.
  fs.appendFileSync(file, line('b', 9) + line('c', 1))
  fs.writeFileSync(path.join(root, '-r-app', 's2.jsonl'), line('a', 2) + line('d', 1))
  const warm = scanner()
  const read: string[] = []
  const real = fs.promises.open
  fs.promises.open = (async (f: string, ...a: unknown[]) => { const h = await (real as unknown as (...x: unknown[]) => Promise<fs.promises.FileHandle>)(f, ...a); const r = h.read.bind(h) as (...x: unknown[]) => unknown; (h as { read: unknown }).read = (b: Buffer, o: number, n: number, pos: number) => { if (String(f) === file) read.push(String(pos)); return r(b, o, n, pos) }; return h }) as never
  let after
  try { after = await warm.scan(now + 1) } finally { fs.promises.open = real }
  assert.ok(read.length > 0 && !read.includes('0'), `read from ${read}`)
  assert.deepEqual(after, await new HistoryScanner(root, 14, path.join(dir, 'codex'), path.join(dir, 'x', 'cache.json')).scan(now + 1))
  fs.writeFileSync(save, '{"version":1,"files":{"x":{"offset":"bad"}}}')
  assert.deepEqual(await scanner().scan(now + 1), after)
})

it('a temp-folder Codex chat is never archived: the hub drops it, so it would be written again every tick', () => {
  const row = (cwd: string) => ({ sessionId: cwd, cwd, ai: 'codex', live: false, updatedAt: 0, pid: 0, link: '', why: [] }) as ChatRow
  const got = endedCodex([row('/private/tmp/claude-501/ws'), row('/Users/k/repo')], () => false, new Set())
  assert.deepEqual(got.map(c => c.cwd), ['/Users/k/repo'])
})

it('stateJson is JSON.stringify, whole or by field, and a replaced big field is written again', () => {
  const s = { archive: [{ a: 1 }], chats: [1], none: undefined, phoneUrls: null, 'odd"key': 1 }
  assert.deepEqual(JSON.parse(stateJson(s)), JSON.parse(JSON.stringify(s)))
  assert.deepEqual(JSON.parse(stateJson(s, new Set(['chats', 'missing']))), { chats: [1] })
  assert.equal(stateJson({}), '{}')
  assert.equal(fieldsJson({ archive: [{ a: 2 }] }).archive, '[{"a":2}]')
})

it('sendState: whole first, then only what moved, nothing when still, whole again after forget', () => {
  const posters = new Posters<unknown>()
  const a: unknown[] = []
  posters.add(m => a.push(m))
  const send = (s: Record<string, unknown>) => posters.sendState(fieldsJson(s), () => ['whole'], (set, del) => ({ set, del }))
  send({ x: 1, y: 1 })
  send({ x: 1, y: 1 })
  send({ x: 2, y: 1 })
  send({ x: 2 })
  posters.forget()
  send({ x: 2 })
  assert.deepEqual(a, [['whole'], { set: ['x'], del: [] }, { set: [], del: ['y'] }, ['whole']])
})

it('sendState: a view hidden for some pushes gets all it missed when shown', () => {
  const posters = new Posters<unknown>()
  const got: unknown[] = []
  let shown = true
  posters.add(m => got.push(m), () => shown)
  const send = (s: Record<string, unknown>) => posters.sendState(fieldsJson(s), () => 'whole', (set, del) => ({ set, del }))
  send({ x: 1, y: 1 })
  shown = false
  send({ x: 2, y: 1 })
  send({ x: 2, y: 2 })
  shown = true
  send({ x: 2, y: 2 })
  assert.deepEqual(got, ['whole', { set: ['x', 'y'], del: [] }])
})

it('an unfocused window reads everything once a minute; a focused one or one the app reads, every tick', () => {
  assert.equal(tickWork(1, false, false, 15_000), 'essentials')
  assert.equal(tickWork(1, false, false, UNFOCUSED_EVERY_MS), 'full')
  assert.equal(tickWork(1, false, true, 15_000), 'full')
  assert.equal(tickWork(0, true, false, 15_000), 'full')
  assert.equal(tickWork(0, false, true, Infinity), 'essentials')
})

it('tickShipped matches as before and stays quick over a long list and changelog', () => {
  const item = (id: string, text: string) => ({ id, text, at: 1 })
  const todo = [item('a', 'Archive rewrite storm every refresh tick'), item('b', 'Something unrelated entirely different')]
  const src = { commits: [{ sha: 's1', subject: 'Archive rewrite storm every refresh tick fixed', at: 2 }], changelog: [] as string[] }
  const d = tickShipped({ ...emptyDoc(), todo } as never, src)
  assert.deepEqual(d.todo.map(t => t.id), ['b'])
  const many = { commits: [], changelog: Array.from({ length: 4000 }, (_, i) => `Release note number ${i} talks about panels, windows, chats and worktrees ${i}`) }
  const doc = { ...emptyDoc(), todo: Array.from({ length: 120 }, (_, i) => item(`t${i}`, `Pending improvement ${i} concerning memory graphs and voice clips`)) } as never
  tickShipped(doc, many)
  const t = performance.now()
  tickShipped(doc, many)
  assert.ok(performance.now() - t < 400, `took ${performance.now() - t} ms`)
})

it('jevProject parses a run file again only when it changed', () => {
  const dir = temp(), presets = path.join(dir, 'presets'), live = path.join(dir, 'live')
  fs.mkdirSync(presets); fs.mkdirSync(live)
  const folder = path.join(dir, 'app'), file = path.join(live, '1.jsonl')
  const write = (items: number) => fs.writeFileSync(file, `${JSON.stringify({ t: 'start', preset: 'app-done', at: 1, items })}\n${JSON.stringify({ t: 'end', cost: 1 })}\n`)
  write(3)
  assert.equal(jevProject(folder, presets, live).runs[0]?.items, 3)
  write(12)
  assert.equal(jevProject(folder, presets, live).runs[0]?.items, 12)
})
