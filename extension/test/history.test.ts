/**
 * Unit tests for the Hub's usage history.
 *
 * The invariant: each transcript line is counted once, however many scans
 * run, and a scan after new lines reads only what was added.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { HistoryScanner, dayKey } from '../src/hub/history'

const at = (iso: string) => new Date(iso).getTime()
const usage = (ts: string, sessionId: string, cacheRead: number) => JSON.stringify({
  type: 'assistant', timestamp: ts, sessionId, cwd: '/Users/k/Documents/GitHub/Armasu',
  message: { role: 'assistant', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 100 } },
})
const prompt = (ts: string, sessionId: string, text: string) => JSON.stringify({
  type: 'user', timestamp: ts, sessionId, cwd: '/Users/k/Documents/GitHub/Armasu', message: { role: 'user', content: text },
})

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-history-'))
  const dir = path.join(root, '-Users-k-Documents-GitHub-Armasu')
  fs.mkdirSync(dir)
  const file = path.join(dir, 's1.jsonl')
  fs.writeFileSync(file, [
    prompt('2026-10-22T10:00:00', 's1', '<command-name>/model</command-name>'),
    prompt('2026-10-22T10:00:05', 's1', 'Set up the hub'),
    usage('2026-10-22T10:00:10', 's1', 1000),
    usage('2026-10-23T09:00:00', 's1', 3000),
  ].join('\n') + '\n')
  return { root, file }
}

describe('history', () => {
  it('sums each day and labels the session by its first real prompt', async () => {
    const { root } = fixture()
    const scan = await new HistoryScanner(root).scan(at('2026-10-23T12:00:00'))
    const byDay = Object.fromEntries(scan.history.map(d => [d.day, d]))
    assert.equal(byDay[dayKey(at('2026-10-22T10:00:10'))].reread, 1000)
    assert.equal(byDay[dayKey(at('2026-10-23T09:00:00'))].reread, 3000)
    assert.equal(byDay[dayKey(at('2026-10-23T09:00:00'))].io, 15)
    assert.equal(scan.sessions.length, 1)
    assert.equal(scan.sessions[0].label, 'Set up the hub')
    assert.equal(scan.sessions[0].project, 'Armasu')
    assert.equal(scan.sessions[0].reread, 4000)
    assert.equal(scan.sessions[0].calls, 2)
  })

  it('counts appended lines once and nothing twice', async () => {
    const { root, file } = fixture()
    const scanner = new HistoryScanner(root)
    await scanner.scan(at('2026-10-23T12:00:00'))
    fs.appendFileSync(file, usage('2026-10-23T09:30:00', 's1', 500) + '\n')
    const again = await scanner.scan(at('2026-10-23T12:00:00'))
    assert.equal(again.sessions[0].reread, 4500)
    assert.equal(again.sessions[0].calls, 3)
  })

  it('counts each line once when scans overlap', async () => {
    const { root } = fixture()
    const scanner = new HistoryScanner(root)
    const [a, b] = await Promise.all([scanner.scan(at('2026-10-23T12:00:00')), scanner.scan(at('2026-10-23T12:00:00'))])
    assert.equal(a.sessions[0].calls, 2)
    assert.equal(b.sessions[0].calls, 2)
  })

  it("names a chat by its custom title, else by a slash command's arguments", async () => {
    const { root, file } = fixture()
    const other = path.join(path.dirname(file), 's2.jsonl')
    fs.writeFileSync(other, [
      prompt('2026-10-23T08:00:00', 's2', '<command-message>superpowers:using-superpowers</command-message>\n<command-name>/superpowers:using-superpowers</command-name>\n<command-args>Clean up my files</command-args>'),
      usage('2026-10-23T08:00:05', 's2', 10),
    ].join('\n') + '\n')
    fs.appendFileSync(file, JSON.stringify({ type: 'custom-title', customTitle: 'Setupfeatures', sessionId: 's1' }) + '\n')
    const scan = await new HistoryScanner(root).scan(at('2026-10-23T12:00:00'))
    const labels = Object.fromEntries(scan.sessions.map(s => [s.sessionId, s.label]))
    assert.equal(labels.s1, 'Setupfeatures')
    assert.equal(labels.s2, 'Clean up my files')
    fs.writeFileSync(path.join(path.dirname(file), 's3.jsonl'), [
      prompt('2026-10-23T08:10:00', 's3', '<pasted_content id="ea2b">\nFix the closet tabs\n</pasted_content>'),
      usage('2026-10-23T08:10:05', 's3', 10),
    ].join('\n') + '\n')
    const third = await new HistoryScanner(root).scan(at('2026-10-23T12:00:00'))
    assert.equal(third.sessions.find(s => s.sessionId === 's3')?.label, 'Pasted: Fix the closet tabs')
  })

  it('keeps fourteen days and every day in them, empty ones too', async () => {
    const { root } = fixture()
    const scan = await new HistoryScanner(root).scan(at('2026-10-23T12:00:00'))
    assert.equal(scan.history.length, 14)
    assert.equal(scan.history[13].day, dayKey(at('2026-10-23T12:00:00')))
  })
})


it('drops tallies after saving and restores them without recounting lines', async () => {
  const { root, file } = fixture()
  const cache = path.join(root, 'history.json')
  const now = at('2026-10-23T12:00:00')
  const first = new HistoryScanner(root, 14, path.join(root, 'codex'), path.join(root, 'usage.json'), cache)
  const before = await first.scan(now)
  await first.drop(now + 5 * 60_000)
  assert.ok(fs.statSync(cache).size > 0)
  const restored = await new HistoryScanner(root, 14, path.join(root, 'codex'), path.join(root, 'usage.json'), cache).scan(now + 6 * 60_000)
  assert.deepEqual(restored.sessions.map(s => [s.reread, s.calls]), before.sessions.map(s => [s.reread, s.calls]))
  fs.appendFileSync(file, usage('2026-10-23T10:00:00', 's1', 50) + '\n')
  const resumed = await new HistoryScanner(root, 14, path.join(root, 'codex'), path.join(root, 'usage.json'), cache).scan(now + 12 * 60_000)
  assert.equal(resumed.sessions[0].reread, 4050)
  assert.equal(resumed.sessions[0].calls, 3)
})


it('an open view that scans every five minutes does not keep the totals in memory between scans', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { root } = fixture()
  const cache = path.join(root, 'history.json')
  const now = at('2026-10-23T12:00:00')
  const scanner = new HistoryScanner(root, 14, path.join(root, 'codex'), path.join(root, 'usage.json'), cache)
  const tallies = (scanner as unknown as { tallies: Map<string, unknown> }).tallies
  const first = await scanner.scan(now)
  for (let i = 1; i <= 2; i++) {
    assert.ok(tallies.size > 0)
    t.mock.timers.tick(4 * 60_000)
    for (let turn = 0; turn < 500 && tallies.size; turn++) await new Promise(resolve => setImmediate(resolve))
    assert.equal(tallies.size, 0)
    assert.deepEqual(await scanner.scan(now + i * 5 * 60_000), first)
  }
})

it('drops after save only when no scan started during drop', async () => {
  const { root } = fixture()
  const cache = path.join(root, 'history.json')
  const now = at('2026-10-23T12:00:00')
  const scanner = new HistoryScanner(root, 14, path.join(root, 'codex'), path.join(root, 'usage.json'), cache)
  await scanner.scan(now)
  const dropping = scanner.drop(now + 5 * 60_000)
  const scanning = scanner.scan(now + 6 * 60_000)
  await Promise.all([dropping, scanning])
  assert.ok((scanner as any).tallies.size > 0)
})

it('loads duplicate message owners once, keeping the first file', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'history-owner-'))
  const project = path.join(root, 'project')
  fs.mkdirSync(project)
  const fileA = path.join(project, 'a.jsonl'), fileB = path.join(project, 'b.jsonl')
  const message = (n: number) => JSON.stringify({ type: 'assistant', timestamp: '2026-10-23T10:00:00', cwd: '/tmp/repo', message: { id: 'shared', role: 'assistant', usage: { input_tokens: n, output_tokens: 1, cache_read_input_tokens: n } } })
  fs.writeFileSync(fileA, message(10) + '\n')
  fs.writeFileSync(fileB, message(90) + '\n')
  const cache = path.join(root, 'history.json'), now = at('2026-10-23T12:00:00')
  await new HistoryScanner(root, 14, path.join(root, 'codex'), path.join(root, 'usage.json'), cache).scan(now)
  const saved = JSON.parse(fs.readFileSync(cache, 'utf8'))
  const owner = saved.files[fileA], duplicate = saved.files[fileB]
  saved.files[fileB] = { ...duplicate, reread: owner.reread, calls: owner.calls, startedAt: owner.startedAt, lastAt: owner.lastAt, days: owner.days, messages: owner.messages }
  fs.writeFileSync(cache, JSON.stringify(saved))
  const loaded = await new HistoryScanner(root, 14, path.join(root, 'codex'), path.join(root, 'usage.json'), cache).scan(now)
  assert.equal(loaded.sessions[0].reread, 10)
  assert.equal(loaded.sessions[0].calls, 1)
})

it('removes tallies older than the window from the saved history', async () => {
  const { root } = fixture()
  const cache = path.join(root, 'history.json')
  const now = Date.now()
  await new HistoryScanner(root, 14, path.join(root, 'codex'), path.join(root, 'usage.json'), cache).scan(now)
  await new HistoryScanner(root, 14, path.join(root, 'codex'), path.join(root, 'usage.json'), cache).scan(now + 20 * 86_400_000)
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(cache, 'utf8')).files), [])
})
