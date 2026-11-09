/**
 * The node drawer's run details: one subagent transcript read into brief, report, files, calls, loops and tokens.
 */
import { describe, it } from 'node:test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import assert from 'node:assert/strict'
import { parseReport, parseRun, readRuns } from '../src/hub/runs'
import { HubService } from '../src/hub/hub-service'
import { handleHub, type HubReply } from '../src/hub/routes'

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'subagent-run.jsonl'), 'utf8')
const META = { agentType: 'engineer', description: 'Fix a.ts', model: 'opus', finished: true }
const at = (s: number) => Date.parse('2026-10-31T10:00:00.000Z') + s * 1000

describe('parseRun', () => {
  const r = parseRun(FIXTURE, META, 'a1', '/x/agent-a1.jsonl')

  it('reads the brief, title, model and clock', () => {
    assert.equal(r.id, 'a1')
    assert.equal(r.role, 'engineer')
    assert.equal(r.title, 'Fix a.ts')
    assert.equal(r.model, 'claude-opus-5-5')
    assert.match(r.brief, /^Goal: fix a\.ts\./)
    assert.equal(r.startedAt, at(0))
    assert.equal(r.endedAt, at(90))
    assert.equal(r.finished, true)
    assert.equal(r.file, '/x/agent-a1.jsonl')
  })

  it('counts tokens once per message and prices them', () => {
    assert.deepEqual(r.tokens, { input: 15, output: 150, cacheRead: 1000, cacheWrite: 200 })
    // opus 5.5: $4 in, $20 out, $0.20 cache read, 1.25x input to write.
    assert.ok(Math.abs((r.costUsd ?? 0) - 0.00426) < 1e-9)
  })

  it('lists every tool call with its target, oldest first', () => {
    assert.deepEqual(r.calls.map(c => c.tool), ['Read', 'Edit', 'Write', 'Edit', 'Bash'])
    assert.equal(r.calls[0].target, 'app/a.ts')
    assert.equal(r.calls[0].at, at(5))
    assert.equal(r.callCount, 5)
  })

  it('counts lines per file from the patch, a new file from its content, and skips failed edits', () => {
    assert.deepEqual(r.files, [{ path: 'app/a.ts', added: 2, removed: 1 }, { path: 'app/new.ts', added: 3, removed: 0 }])
  })

  it('finds each time the work was sent back, and by whom', () => {
    assert.equal(r.loops.length, 1)
    assert.equal(r.loops[0].by, 'qa')
    assert.equal(r.loops[0].at, at(60))
    assert.match(r.loops[0].text, /^qa found a bug in a\.ts/)
  })

  it('parses the report from the final message and redacts it', () => {
    assert.equal(r.report?.status, 'done')
    assert.deepEqual(r.report?.changed, ['`app/a.ts:3` guard', 'app/new.ts'])
    assert.deepEqual(r.report?.checked, ['npm test, 4 passed'])
    assert.equal(r.report?.open.length, 2)
    assert.match(r.report!.open[1], /\[removed\]/)
    assert.doesNotMatch(r.reportText ?? '', /sk-abc/)
    assert.match(r.reportText ?? '', /^Fixed the guard\./)
  })

  it('redacts the title', () => {
    assert.equal(parseRun('', { description: 'Use key sk-ant-abcdefghijklmnopqrstuv now' }, 'x', '').title, 'Use key [removed] now')
  })

  it('makes every path relative to the repo root, whatever folder each call ran in', () => {
    const ev = (cwd: string, id: string, p: string) => [
      JSON.stringify({ type: 'assistant', cwd, timestamp: '2026-10-31T00:00:00Z', message: { content: [{ type: 'tool_use', id, name: 'Write', input: { file_path: p, content: 'a\nb' } }] } }),
      JSON.stringify({ type: 'user', cwd, timestamp: '2026-10-31T00:00:01Z', message: { content: [{ type: 'tool_result', tool_use_id: id }] } }),
    ]
    const raw = [JSON.stringify({ type: 'user', cwd: '/r/web', timestamp: '2026-10-31T00:00:00Z', message: { content: 'brief' } }),
      ...ev('/r/web', '1', '/r/web/x.ts'), ...ev('/r', '2', '/r/ext/y.ts'), ...ev('/r/web', '3', 'rel/z.ts'), ...ev('/r', '4', '/elsewhere/w.ts')].join('\n')
    const paths = (root?: string) => parseRun(raw, {}, 'x', '', root).files.map(f => f.path)
    assert.deepEqual(paths('/r'), ['web/x.ts', 'ext/y.ts', 'web/rel/z.ts', '/elsewhere/w.ts'])
    // No repo: the folder every call ran under.
    assert.deepEqual(paths(), ['web/x.ts', 'ext/y.ts', 'web/rel/z.ts', '/elsewhere/w.ts'])
  })

  it('cuts the brief and keeps only the newest 200 calls', () => {
    const lines = [JSON.stringify({ type: 'user', timestamp: '2026-10-31T10:00:00Z', message: { role: 'user', content: 'x'.repeat(20_000) } })]
    for (let i = 0; i < 250; i++) lines.push(JSON.stringify({ type: 'assistant', timestamp: '2026-10-31T10:00:01Z', message: { id: `m${i}`, content: [{ type: 'tool_use', id: `t${i}`, name: 'Read', input: { file_path: `/w/f${i}.ts` } }] } }))
    const big = parseRun(lines.join('\n'), {}, 'b', '')
    assert.ok(big.brief.length <= 6001)
    assert.equal(big.calls.length, 200)
    assert.equal(big.callCount, 250)
    assert.equal(big.calls[0].target, 'w/f50.ts')
  })
})

describe('parseRun dispatches', () => {
  it("lists the lead's Agent calls: who got which brief, oldest first", () => {
    const raw = [
      JSON.stringify({ type: 'user', timestamp: '2026-10-31T10:00:00Z', message: { content: 'Build it' } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-10-31T10:00:05Z', message: { content: [{ type: 'tool_use', id: 't1', name: 'Agent', input: { subagent_type: 'researcher', description: 'Find the files', prompt: 'Goal: find. Key sk-ant-abcdefghijklmnopqrstuv' } }] } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-10-31T10:01:00Z', message: { content: [{ type: 'tool_use', id: 't2', name: 'Task', input: { prompt: 'Goal: fix' } }, { type: 'text', text: 'Sent the engineer.' }] } }),
    ].join('\n')
    const r = parseRun(raw, { agentType: 'lead' }, 's', '')
    assert.deepEqual(r.dispatches?.map(d => [d.role, d.title, d.at]), [['researcher', 'Find the files', at(5)], ['general-purpose', undefined, at(60)]])
    assert.match(r.dispatches![0].brief, /^Goal: find\. Key \[removed\]/)
    assert.equal(r.reportText, 'Sent the engineer.')
  })

  it('leaves dispatches out of a run that made none', () => {
    assert.equal(parseRun(FIXTURE, META, 'a1', '').dispatches, undefined)
  })
})

describe('parseReport', () => {
  it('takes headings in any common form and leaves sentences that start with a section word', () => {
    const r = parseReport('Status: blocked\nFound: x.ts:4 is wrong\nOpen the file first.\nChecked\n- tsc clean\n* lint clean\nOpen: ask Kenneth')
    assert.equal(r?.status, 'blocked')
    assert.deepEqual(r?.changed, ['x.ts:4 is wrong', 'Open the file first.'])
    assert.deepEqual(r?.checked, ['tsc clean', 'lint clean'])
    assert.deepEqual(r?.open, ['ask Kenneth'])
  })

  it('knows the other names for checked, changed and open, and drops a note in brackets', () => {
    const r = parseReport('**Changed (switchboard)**\n- a.ts\n**Checks**\n- pnpm test: pass\n### Verified\n- tsc\nTests: 12 pass\nFindings:\n- b.ts:3\n**Open items**\n- none\nRemaining: ship it')
    assert.deepEqual(r?.changed, ['a.ts', 'b.ts:3'])
    assert.deepEqual(r?.checked, ['pnpm test: pass', 'tsc', '12 pass'])
    assert.deepEqual(r?.open, ['none', 'ship it'])
  })

  it('is undefined for a message with no sections', () => {
    assert.equal(parseReport('All good, nothing to report.'), undefined)
  })
})

describe('readRuns', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'))
  const dir = path.join(home, '.claude', 'projects', '-w', 's-123', 'subagents')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'agent-a1.jsonl'), FIXTURE)
  fs.writeFileSync(path.join(dir, 'agent-a1.meta.json'), JSON.stringify(META))
  const later = FIXTURE.replace(/2026-10-31T10:/g, '2026-10-31T11:')
  fs.writeFileSync(path.join(dir, 'agent-a2.jsonl'), later)
  fs.writeFileSync(path.join(dir, 'agent-a2.meta.json'), JSON.stringify(META))
  fs.writeFileSync(path.join(dir, 'agent-q1.jsonl'), FIXTURE)
  fs.writeFileSync(path.join(dir, 'agent-q1.meta.json'), JSON.stringify({ agentType: 'qa' }))

  it("returns the role's runs in that chat, newest first", async () => {
    const runs = await readRuns('s-123', 'engineer', home)
    assert.deepEqual(runs.map(r => r.id), ['a2', 'a1'])
    assert.equal(runs[0].file, path.join(dir, 'agent-a2.jsonl'))
    assert.deepEqual((await readRuns('s-123', 'qa', home)).map(r => r.id), ['q1'])
  })

  it('reuses a parsed run until the transcript or its meta changes', async () => {
    const f = path.join(dir, 'agent-a1.jsonl'), t = new Date(Math.floor(Date.now() / 1000) * 1000)
    fs.utimesSync(f, t, t)
    const first = (await readRuns('s-123', 'engineer', home)).find(r => r.id === 'a1')!
    // Same size and time: the cached parse comes back.
    fs.writeFileSync(f, FIXTURE.replace('Goal: fix a.ts.', 'Goal: fix b.ts.'))
    fs.utimesSync(f, t, t)
    assert.equal((await readRuns('s-123', 'engineer', home)).find(r => r.id === 'a1')!.brief, first.brief)
    const later = new Date(t.getTime() + 5000)
    fs.utimesSync(f, later, later)
    assert.match((await readRuns('s-123', 'engineer', home)).find(r => r.id === 'a1')!.brief, /fix b\.ts/)
    fs.writeFileSync(path.join(dir, 'agent-a1.meta.json'), JSON.stringify({ ...META, description: 'Renamed' }))
    assert.equal((await readRuns('s-123', 'engineer', home)).find(r => r.id === 'a1')!.title, 'Renamed')
    fs.writeFileSync(f, FIXTURE)
    fs.writeFileSync(path.join(dir, 'agent-a1.meta.json'), JSON.stringify(META))
  })

  it("reads the lead from the chat's own transcript, not its subagents", async () => {
    fs.writeFileSync(path.join(home, '.claude', 'projects', '-w', 's-123.jsonl'), FIXTURE)
    const [lead, ...rest] = await readRuns('s-123', 'lead', home)
    assert.equal(rest.length, 0)
    assert.equal(lead.id, 's-123')
    assert.equal(lead.role, 'lead')
    assert.equal(lead.file, path.join(home, '.claude', 'projects', '-w', 's-123.jsonl'))
    assert.equal(lead.callCount, 5)
    assert.deepEqual(await readRuns('nope', 'lead', home), [])
  })

  it('reads only what was appended to a growing transcript, waits for a whole line, and starts over when it shrinks', async () => {
    const f = path.join(home, '.claude', 'projects', '-w', 's-inc.jsonl')
    const ev = (s: number, id: string) => JSON.stringify({ type: 'assistant', timestamp: `2026-10-31T10:00:${String(s).padStart(2, '0')}Z`, message: { content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: `/w/${id}.ts` } }] } }) + '\n'
    const head = JSON.stringify({ type: 'user', timestamp: '2026-10-31T10:00:00Z', message: { content: 'Goal: aaaa' } }) + '\n'
    fs.writeFileSync(f, head + ev(1, 'a'))
    assert.equal((await readRuns('s-inc', 'lead', home))[0].callCount, 1)
    // Same file, an earlier byte changed in place and two lines appended, the second cut mid-line:
    // only the new bytes are parsed, so the old brief stays and the half line waits.
    const fd = fs.openSync(f, 'r+')
    fs.writeSync(fd, 'b', head.indexOf('aaaa'))
    fs.closeSync(fd)
    const half = ev(3, 'c')
    fs.appendFileSync(f, ev(2, 'b') + half.slice(0, 20))
    let lead = (await readRuns('s-inc', 'lead', home))[0]
    assert.equal(lead.brief, 'Goal: aaaa')
    assert.deepEqual(lead.calls.map(c => c.target), ['w/a.ts', 'w/b.ts'])
    fs.appendFileSync(f, half.slice(20))
    lead = (await readRuns('s-inc', 'lead', home))[0]
    assert.deepEqual(lead.calls.map(c => c.target), ['w/a.ts', 'w/b.ts', 'w/c.ts'])
    assert.equal(lead.endedAt, Date.parse('2026-10-31T10:00:03Z'))
    // Shorter than what was read: a new file, read from the start.
    fs.writeFileSync(f, JSON.stringify({ type: 'user', timestamp: '2026-10-31T11:00:00Z', message: { content: 'Goal: new' } }) + '\n')
    lead = (await readRuns('s-inc', 'lead', home))[0]
    assert.equal(lead.brief, 'Goal: new')
    assert.equal(lead.callCount, 0)
  })

  it('finds nothing for an unknown chat and refuses a path in the id', async () => {
    assert.deepEqual(await readRuns('nope', 'engineer', home), [])
    await assert.rejects(readRuns('../s-123', 'engineer', home))
    await assert.rejects(readRuns('s-123', '../qa', home))
  })
})

describe('GET /hub/runs', () => {
  const h = new HubService()
  const runs = async (session: string, role: string) => [{ ...parseRun(FIXTURE, META, 'a1', ''), title: `${session}/${role}` }]
  const ask = (q: string) => handleHub(h, 'GET', `/hub/runs?${q}`, '', undefined, undefined, undefined, runs) as HubReply | Promise<HubReply>

  it('answers only with the token', async () => {
    assert.equal((await ask('token=wrong&session=s&role=qa')).status, 403)
    assert.equal((await ask('session=s&role=qa')).status, 403)
    const ok = await ask(`token=${h.token}&session=s&role=qa`)
    assert.equal(ok.status, 200)
    assert.equal(JSON.parse(ok.body)[0].title, 's/qa')
  })

  it('needs a chat and a role', async () => {
    assert.equal((await ask(`token=${h.token}&role=qa`)).status, 400)
    assert.equal((await ask(`token=${h.token}&session=s`)).status, 400)
  })
})
