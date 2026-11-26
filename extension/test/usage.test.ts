import { it } from 'node:test'
import assert from 'node:assert/strict'
import { HistoryScanner } from '../src/hub/history'
import { projectOf, UsageScanner } from '../src/hub/usage'
import { projectName } from '../src/hub/projects'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

it('deduplicates repeated Claude message ids and restores a cached report', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-test-'))
  const cache = path.join(root, 'cache.json')
  const projects = path.join(root, 'projects')
  const dir = path.join(projects, 'repo')
  fs.mkdirSync(dir, { recursive: true })
  const message = (id: string, n: number) => JSON.stringify({ type: 'assistant', timestamp: '2026-11-23T10:00:00Z', cwd: '/tmp/repo', message: { id, model: 'claude-opus-4-1', usage: { input_tokens: n, output_tokens: 2 } } })
  const file = path.join(dir, 's.jsonl')
  fs.writeFileSync(file, [message('m1', 1), message('m1', 10)].join('\n') + '\n')
  const one = await new HistoryScanner(projects, 14, path.join(root, 'codex'), cache).report(Date.parse('2026-11-23T12:00:00Z'))
  assert.equal(one.rows[0].input, 10)
  const two = await new HistoryScanner(projects, 14, path.join(root, 'codex'), cache).report(Date.parse('2026-11-23T12:00:00Z'))
  assert.deepEqual(two, one)
})

it('keeps the first file for a shared Claude message id and replaces streaming versions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-dedupe-')), projects = path.join(root, 'projects'), dir = path.join(projects, 'repo')
  fs.mkdirSync(dir, { recursive: true })
  const msg = (id: string, input: number) => JSON.stringify({ type: 'assistant', timestamp: '2026-11-23T10:00:00Z', cwd: '/tmp/repo', message: { id, model: 'claude-opus-4-1', usage: { input_tokens: input, output_tokens: 2 } } })
  fs.writeFileSync(path.join(dir, 'a.jsonl'), `${msg('shared', 10)}\n${msg('stream', 5)}\n${msg('stream', 20)}\n`)
  fs.writeFileSync(path.join(dir, 'b.jsonl'), `${msg('shared', 90)}\n`)
  const report = await new UsageScanner(projects, 30, path.join(root, 'codex'), path.join(root, 'cache.json')).report(Date.parse('2026-11-23T12:00:00Z'))
  assert.equal(report.rows[0].input, 30)
  assert.equal(report.rows[0].calls, 2)
})

it('keeps and completes a partial line, and ignores a corrupt cache', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-partial-')), projects = path.join(root, 'projects'), dir = path.join(projects, 'repo'), cache = path.join(root, 'cache.json')
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(cache, '{broken')
  const file = path.join(dir, 's.jsonl'), line = JSON.stringify({ type: 'assistant', timestamp: '2026-11-23T10:00:00Z', cwd: '/tmp/repo', message: { id: 'partial', model: 'claude-opus-4-1', usage: { input_tokens: 12, output_tokens: 3 } } })
  fs.writeFileSync(file, line)
  const scanner = new UsageScanner(projects, 30, path.join(root, 'codex'), cache)
  assert.equal((await scanner.report(Date.parse('2026-11-23T12:00:00Z'))).rows.length, 0)
  fs.appendFileSync(file, '\n')
  assert.equal((await scanner.report(Date.parse('2026-11-23T12:02:00Z'))).rows[0].input, 12)
})

it('keeps UTF-8 intact when a multibyte character crosses a read chunk', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-utf8-')), projects = path.join(root, 'projects'), dir = path.join(projects, 'repo')
  fs.mkdirSync(dir, { recursive: true })
  const prefix = '{"padding":"', padding = 'x'.repeat((1 << 20) - Buffer.byteLength(prefix) - 1)
  const line = `${prefix}${padding}😀","type":"assistant","timestamp":"2026-11-23T10:00:00Z","cwd":"/tmp/repo","message":{"id":"utf8","model":"claude-opus-4-1","usage":{"input_tokens":7,"output_tokens":1}}}`
  fs.writeFileSync(path.join(dir, 's.jsonl'), `${line}\n`)
  const report = await new UsageScanner(projects, 30, path.join(root, 'codex'), path.join(root, 'cache.json')).report(Date.parse('2026-11-23T12:00:00Z'))
  assert.equal(report.rows[0].input, 7)
})

it('counts Codex token totals once and detects role prompts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-codex-')), codex = path.join(root, 'sessions'), dir = path.join(codex, '2026', '11', '23')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 's.jsonl'), ev = (type: string, payload: unknown) => JSON.stringify({ timestamp: '2026-11-23T10:00:00Z', type, payload })
  const count = (total: number) => ev('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: total, output_tokens: total }, last_token_usage: { input_tokens: total, cached_input_tokens: 20, cache_write_input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 2 } } })
  fs.writeFileSync(file, [ev('session_meta', { id: 's', cwd: '/tmp/repo', originator: 'codex' }), ev('turn_context', { model: 'gpt-6-sol', cwd: '/tmp/repo' }), ev('event_msg', { type: 'user_message', message: 'You are the engineer. Make it work.' }), count(100), count(100), count(200)].join('\n') + '\n')
  const report = await new UsageScanner(path.join(root, 'claude'), 30, codex, path.join(root, 'cache.json')).report(Date.parse('2026-11-23T12:00:00Z'))
  assert.equal(report.rows.length, 1)
  assert.equal(report.rows[0].role, 'engineer-codex')
  assert.equal(report.rows[0].input, 240)
  assert.equal(report.rows[0].calls, 2)
})

it('restores Codex parser state after a restart and uses calendar days for the window', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-restart-')), codex = path.join(root, 'sessions'), dir = path.join(codex, '2026', '11', '23'), cache = path.join(root, 'cache.json')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 's.jsonl'), ev = (type: string, payload: unknown, timestamp = '2026-11-23T10:00:00Z') => JSON.stringify({ timestamp, type, payload })
  const count = (total: number) => ev('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: total }, last_token_usage: { input_tokens: total, output_tokens: 1 } } })
  fs.writeFileSync(file, [ev('session_meta', { id: 'session-1', cwd: '/tmp/my-worktree/repo' }), ev('turn_context', { model: 'gpt-6-sol' }), ev('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'You are the engineer. Do work.' }] }), count(1)].join('\n') + '\n')
  const now = Date.parse('2026-11-23T12:00:00')
  await new UsageScanner(path.join(root, 'claude'), 30, codex, cache).report(now)
  fs.appendFileSync(file, count(2) + '\n')
  const resumed = await new UsageScanner(path.join(root, 'claude'), 30, codex, cache).report(now)
  assert.equal(resumed.from, '2026-10-25')
  assert.equal(resumed.rows[0].model, 'gpt-6-sol')
  assert.equal(resumed.rows[0].role, 'engineer-codex')
  assert.equal(resumed.rows[0].project, 'Temporary runs')
  assert.equal(resumed.rows[0].calls, 2)
})

it('names a worktree by its repository', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-project-')), repo = path.join(root, 'switchboard'), worktree = path.join(repo, '.claude', 'worktrees', 'usage-test')
  try {
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true }); fs.mkdirSync(worktree, { recursive: true }); fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: /tmp/gitdir')
    assert.equal(projectName(worktree), 'switchboard')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

it('projectOf: temp folders fold into one row, a deleted folder keeps its own name', () => {
  assert.equal(projectOf('/private/tmp/x/y'), 'Temporary runs')
  assert.equal(projectOf('/var/folders/4d/T/bench-1'), 'Temporary runs')
  assert.equal(projectOf(path.join(os.homedir(), 'gone-repo-zz', 'extension')), 'gone-repo-zz')
})

it('reads a same-size rewrite again, drops bad cache entries and prunes old records', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-rewrite-')), projects = path.join(root, 'projects'), dir = path.join(projects, 'repo'), cache = path.join(root, 'cache.json')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 's.jsonl'), now = Date.parse('2026-11-23T12:00:00Z')
  const msg = (id: string, input: number, at = '2026-11-23T10:00:00Z') => JSON.stringify({ type: 'assistant', timestamp: at, cwd: '/tmp/repo', message: { id, model: 'claude-opus-4-1', usage: { input_tokens: input, output_tokens: 2 } } })
  fs.writeFileSync(file, `${msg('old', 7, '2026-01-01T10:00:00Z')}\n${msg('a', 11)}\n`)
  const scanner = new UsageScanner(projects, 30, path.join(root, 'codex'), cache)
  assert.equal((await scanner.report(now)).rows[0].input, 11)
  assert.equal(JSON.parse(fs.readFileSync(cache, 'utf8')).files[file].records.length, 1)
  fs.writeFileSync(file, `${msg('old', 7, '2026-01-01T10:00:00Z')}\n${msg('b', 22)}\n`)
  fs.utimesSync(file, new Date(now + 1000), new Date(now + 1000))
  assert.equal((await scanner.report(now + 61_000)).rows[0].input, 22)
  const bad = JSON.parse(fs.readFileSync(cache, 'utf8'))
  for (const broken of [{ records: null }, { state: { project: 5 } }, { offset: -1 }, { records: [[1]] }]) {
    fs.writeFileSync(cache, JSON.stringify({ ...bad, files: { [file]: { ...bad.files[file], ...broken } } }))
    assert.equal((await new UsageScanner(projects, 30, path.join(root, 'codex'), cache).report(now)).rows[0].input, 22)
  }
})
