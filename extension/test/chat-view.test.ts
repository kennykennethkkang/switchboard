/**
 * The chat view: outputs and paged transcript read from a chat's JSONL in chunks, never whole.
 */
import { before, describe, it } from 'node:test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import assert from 'node:assert/strict'
import { HubService } from '../src/hub/hub-service'
import { handleHub, type HubReply } from '../src/hub/routes'
import { chatOutputs, chatShot, chatTranscript, pageBack, scanLines, SKIPPED, type ChatOutputs } from '../src/hub/chat-view'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chat-view-'))

describe('scanLines', () => {
  it('reads every complete line across small chunks and skips a partial last one', async () => {
    const f = path.join(tmp(), 'a.jsonl')
    const lines = Array.from({ length: 30 }, (_, i) => JSON.stringify({ i, pad: 'x'.repeat(i * 3) }))
    fs.writeFileSync(f, `${lines.join('\n')}\n{"partial":`)
    const seen: string[] = []
    const end = await scanLines(f, 0, l => { seen.push(l) }, 7)
    assert.deepEqual(seen, lines)
    assert.equal(end, Buffer.byteLength(`${lines.join('\n')}\n`))
  })

  it('starts at the offset given', async () => {
    const f = path.join(tmp(), 'a.jsonl')
    fs.writeFileSync(f, 'one\ntwo\nthree\n')
    const seen: string[] = []
    const end = await scanLines(f, 4, l => { seen.push(l) }, 3)
    assert.deepEqual(seen, ['two', 'three'])
    assert.equal(end, 14)
  })
})

describe('pageBack', () => {
  const f = path.join(tmp(), 'b.jsonl')
  const lines = Array.from({ length: 20 }, (_, i) => `line-${i}-${'y'.repeat(i % 5 * 4)}`)
  const body = `${lines.join('\n')}\n`
  fs.writeFileSync(f, `${body}half`)

  it('returns the last n lines before the end, oldest first, with their offsets', async () => {
    const r = await pageBack(f, fs.statSync(f).size, 5, 8)
    assert.deepEqual(r.lines.map(l => l.text), lines.slice(15))
    assert.equal(r.lines[0].at, body.indexOf(lines[15]))
    assert.equal(r.before, body.indexOf(lines[15]))
  })

  it('pages on from before, across window edges, to null at the start', async () => {
    let before: number | null = fs.statSync(f).size
    const got: string[] = []
    while (before !== null) {
      const r = await pageBack(f, before, 3, 5)
      got.unshift(...r.lines.map(l => l.text))
      before = r.before
    }
    assert.deepEqual(got, lines)
  })

  it('handles a line longer than the window', async () => {
    const g = path.join(tmp(), 'c.jsonl')
    const long = 'z'.repeat(100)
    fs.writeFileSync(g, `a\n${long}\nb\n`)
    const r = await pageBack(g, fs.statSync(g).size, 10, 16)
    assert.deepEqual(r.lines.map(l => l.text), ['a', long, 'b'])
    assert.equal(r.before, null)
  })
})

const KEY = `sk-${'a'.repeat(24)}`
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const SID = '11111111-2222-3333-4444-555555555555'
const asst = (...content: unknown[]) => JSON.stringify({ type: 'assistant', cwd: '/repo', message: { role: 'assistant', content } })
const user = (content: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ type: 'user', cwd: '/repo', message: { role: 'user', content }, ...extra })
const use = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input })
const result = (id: string, content: unknown, is_error = false) => ({ type: 'tool_result', tool_use_id: id, content, ...(is_error ? { is_error } : {}) })

/** A home with one chat transcript (and optional subagents); returns the home and the transcript path. */
function chatHome(lines: string[]) {
  const home = tmp()
  const dir = path.join(home, '.claude', 'projects', '-repo')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${SID}.jsonl`)
  fs.writeFileSync(file, `${lines.join('\n')}\n`)
  return { home, dir, file }
}

describe('chatOutputs', () => {
  const shotDir = tmp()
  const shot = path.join(shotDir, 'shot.png')
  fs.writeFileSync(shot, 'png')
  const lines = [
    user('build it'),
    asst({ type: 'text', text: 'Working on it.' }),
    asst(use('w1', 'Write', { file_path: '/repo/a.ts', content: 'x' })),
    user([result('w1', 'ok')]),
    asst(use('e1', 'Edit', { file_path: '/repo/b.ts' }), use('e2', 'Edit', { file_path: '/repo/a.ts' })),
    asst(use('n1', 'NotebookEdit', { notebook_path: '/repo/n.ipynb' })),
    asst(use('q1', 'AskUserQuestion', { questions: [{ question: 'Which color?', options: [{ label: 'Red' }, { label: 'Blue' }] }] })),
    user([result('q1', 'The user answered: "Which color?"="Blue"')], { toolUseResult: { answers: { 'Which color?': 'Blue' } } }),
    asst(use('s1', 'mcp__switchboard__ask', { questions: [{ question: 'Ship now?' }] })),
    user([result('s1', [{ type: 'text', text: 'Ship now?: Yes' }])]),
    asst(use('a1', 'Agent', { description: 'Fix the parser', subagent_type: 'engineer', prompt: 'p' })),
    user([result('a1', [{ type: 'text', text: `Status: done\nChanged: a.ts ${KEY}` }])]),
    asst(use('a2', 'Agent', { description: 'Review it', subagent_type: 'qa', run_in_background: true })),
    user([result('a2', [{ type: 'text', text: 'Async agent launched successfully.\nagentId: x' }])]),
    user(`<task-notification>\n<tool-use-id>a2</tool-use-id>\n<status>completed</status>\n<result>Status: done\n${'r'.repeat(9000)}</result>\n</task-notification>`),
    asst(use('b1', 'Bash', { command: 'npm test' })),
    user([result('b1', 'ℹ tests 4\nℹ pass 3\nℹ fail 1\nnot ok 2 - parses dates')]),
    asst(use('b2', 'Bash', { command: 'ls' })),
    user([result('b2', `boom ${KEY} ${'e'.repeat(400)}`, true)]),
    asst(use('p1', 'mcp__plugin_playwright_playwright__browser_take_screenshot', { filename: shot })),
    user([result('p1', `Saved to ${shot} and /nope/gone.png`)]),
    asst({ type: 'text', text: `All done ${KEY}.\n\n**Done**\n- built it\n\n**Left**\n- deploy\n\nCommit message:\n\`\`\`\nAdd it\n\n- built it\n\`\`\`` }),
  ]
  const { home } = chatHome(lines)
  const noRuns = async () => []
  let out: ChatOutputs
  before(async () => { out = (await chatOutputs(SID, { home, runs: noRuns }))! })

  it('takes the last assistant text as final, with its standup and commit', () => {
    assert.match(out.final!, /^All done \[removed\]\./)
    assert.deepEqual(out.standup, { done: ['built it'], left: ['deploy'] })
    assert.equal(out.commit, 'Add it\n\n- built it')
  })

  it('caps final at 20k', async () => {
    const { home: h } = chatHome([asst({ type: 'text', text: 'f'.repeat(30_000) })])
    const o = (await chatOutputs(SID, { home: h, runs: noRuns }))!
    assert.ok(o.final!.length <= 20_001)
  })

  it('lists questions with their answers, from both tools', () => {
    assert.deepEqual(out.questions, [{ question: 'Which color?', answer: 'Blue' }, { question: 'Ship now?', answer: 'Ship now?: Yes' }])
  })

  it('lists subagent reports by description, from results and task notifications, capped at 8k', () => {
    assert.deepEqual(out.reports.map(r => [r.label, r.role]), [['Fix the parser', 'engineer'], ['Review it', 'qa']])
    assert.match(out.reports[0].text, /Changed: a\.ts \[removed\]/)
    assert.match(out.reports[1].text, /^Status: done/)
    assert.ok(out.reports[1].text.length <= 8001)
  })

  it('reads test outcomes from Bash results', () => {
    assert.deepEqual(out.tests, [{ command: 'npm test', ok: false, failed: 1, total: 4, first: 'parses dates' }])
  })

  it('counts a test run that exited non-zero as a failed test too', async () => {
    const { home: h } = chatHome([asst(use('t1', 'Bash', { command: 'pnpm test' })), user([result('t1', 'Exit code 1\n3 passed, 2 failed', true)])])
    const o = (await chatOutputs(SID, { home: h, runs: noRuns }))!
    assert.deepEqual(o.tests, [{ command: 'pnpm test', ok: false, failed: 2, total: 5 }])
    assert.equal(o.errors.length, 1)
  })

  it('keeps errors with the tool name, cut to 300 and redacted', () => {
    assert.equal(out.errors.length, 1)
    assert.equal(out.errors[0].tool, 'Bash')
    assert.match(out.errors[0].text, /^boom \[removed\]/)
    assert.ok(out.errors[0].text.length <= 301)
  })

  it('lists edited files once, in order', () => {
    assert.deepEqual(out.files, ['/repo/a.ts', '/repo/b.ts', '/repo/n.ipynb'])
  })

  it('lists screenshots that exist on disk', () => {
    assert.deepEqual(out.shots, [shot])
  })

  it('keeps the newest 50 errors', async () => {
    const many = Array.from({ length: 60 }, (_, i) => [asst(use(`x${i}`, 'Read', { file_path: `/f${i}` })), user([result(`x${i}`, `err ${i}`, true)])]).flat()
    const { home: h } = chatHome(many)
    const o = (await chatOutputs(SID, { home: h, runs: noRuns }))!
    assert.equal(o.errors.length, 50)
    assert.equal(o.errors.at(-1)!.text, 'err 59')
    assert.equal(o.errors[0].text, 'err 10')
  })

  it('reads only new bytes on the next call and merges them', async () => {
    const { home: h, file } = chatHome([asst({ type: 'text', text: 'first' })])
    const froms: number[] = []
    const scan: typeof scanLines = (f, from, onLine, chunk) => { froms.push(from); return scanLines(f, from, onLine, chunk) }
    assert.equal((await chatOutputs(SID, { home: h, runs: noRuns, scan }))!.final, 'first')
    const size = fs.statSync(file).size
    fs.appendFileSync(file, `${asst(use('w9', 'Write', { file_path: '/repo/z.ts' }))}\n${asst({ type: 'text', text: 'second' })}\n`)
    const o = (await chatOutputs(SID, { home: h, runs: noRuns, scan }))!
    assert.deepEqual(froms, [0, size])
    assert.equal(o.final, 'second')
    assert.deepEqual(o.files, ['/repo/z.ts'])
  })

  it('adds reports from subagent files the main transcript lacks, and skips an unreadable one', async () => {
    const { home: h, dir } = chatHome([asst(use('a1', 'Agent', { description: 'Fix the parser', subagent_type: 'engineer' })), user([result('a1', [{ type: 'text', text: 'Status: done' }])])])
    const sub = path.join(dir, SID, 'subagents')
    fs.mkdirSync(sub, { recursive: true })
    fs.writeFileSync(path.join(sub, 'agent-aa.meta.json'), JSON.stringify({ agentType: 'engineer', toolUseId: 'a1' }))
    fs.writeFileSync(path.join(sub, 'agent-bb.meta.json'), JSON.stringify({ agentType: 'designer', toolUseId: 'd1', description: 'Draw it' }))
    fs.writeFileSync(path.join(sub, 'agent-cc.meta.json'), '{broken')
    const runs = async (_s: string, role: string) => {
      if (role === 'qa') throw new Error('unreadable')
      return role === 'engineer' ? [{ id: 'aa', role, title: 'Fix the parser', reportText: 'dup' }] : [{ id: 'bb', role, title: 'Draw it', reportText: `Status: done ${KEY}` }]
    }
    fs.writeFileSync(path.join(sub, 'agent-dd.meta.json'), JSON.stringify({ agentType: 'qa', toolUseId: 'q9' }))
    const o = (await chatOutputs(SID, { home: h, runs: runs as never }))!
    assert.deepEqual(o.reports.map(r => [r.label, r.text]), [['Fix the parser', 'Status: done'], ['Draw it', 'Status: done [removed]']])
  })

  it('answers null for an unknown or unsafe session', async () => {
    assert.equal(await chatOutputs('00000000-0000-0000-0000-000000000000', { home, runs: noRuns }), null)
    assert.equal(await chatOutputs('../x', { home, runs: noRuns }), null)
  })
})

describe('chatTranscript', () => {
  const meta = [JSON.stringify({ type: 'summary', summary: 'x' }), JSON.stringify({ type: 'file-history-snapshot', snapshot: {} })]
  const lines = [
    user('hello there'),
    ...meta,
    asst({ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: `Sure ${KEY}` }),
    asst(use('r1', 'Read', { file_path: '/repo/src/a.ts' })),
    user([result('r1', 'line one\nline two')]),
    asst(use('r2', 'Bash', { command: 'ls -la' })),
    user([result('r2', 'nope', true)]),
    user('<task-notification>\n<tool-use-id>a1</tool-use-id>\n<summary>Agent "Fix it" completed</summary>\n<result>Status: done</result>\n</task-notification>'),
    user('m'.repeat(5000)),
  ]

  it('turns lines into messages, oldest first, skipping meta', async () => {
    const { home } = chatHome(lines)
    const t = (await chatTranscript(SID, undefined, { home }))!
    assert.equal(t.before, null)
    assert.deepEqual(t.messages.slice(0, 7), [
      { role: 'you', text: 'hello there' },
      { role: 'claude', text: 'Sure [removed]' },
      { role: 'tool', text: 'Read src/a.ts' },
      { role: 'tool', text: 'result: line one' },
      { role: 'tool', text: 'Bash ls -la' },
      { role: 'tool', text: 'error: nope' },
      { role: 'subagent', text: 'Agent "Fix it" completed\nStatus: done' },
    ])
    assert.equal(t.messages[7].role, 'you')
    assert.ok(t.messages[7].text.length <= 4001)
    assert.equal(t.messages.length, 8)
  })

  it('pages 50 at a time with before for Load earlier', async () => {
    const many = Array.from({ length: 60 }, (_, i) => user(`msg ${i}`))
    const { home, file } = chatHome([...meta, ...many, ...meta])
    const first = (await chatTranscript(SID, undefined, { home }))!
    assert.equal(first.messages.length, 50)
    assert.equal(first.messages[0].text, 'msg 10')
    assert.equal(first.messages.at(-1)!.text, 'msg 59')
    assert.ok(first.before! > 0 && first.before! < fs.statSync(file).size)
    const rest = (await chatTranscript(SID, first.before!, { home }))!
    assert.deepEqual(rest.messages.map(m => m.text), Array.from({ length: 10 }, (_, i) => `msg ${i}`))
    assert.equal(rest.before, null)
  })

  it('answers null for an unknown session', async () => {
    const { home } = chatHome([])
    assert.equal(await chatTranscript('nope', undefined, { home }), null)
  })
})

describe('GET /hub/chat/*', () => {
  const h = new HubService()
  const dir = tmp()
  const png = path.join(dir, 'a.png'), txt = path.join(dir, 'a.txt'), big = path.join(dir, 'big.png'), other = path.join(dir, 'other.png')
  fs.writeFileSync(png, PNG)
  fs.writeFileSync(txt, 'secret')
  fs.writeFileSync(other, PNG)
  fs.writeFileSync(big, Buffer.alloc(11 * 1024 * 1024))
  const outputs = async (session: string): Promise<ChatOutputs | null> => session === 's1' ? { questions: [], reports: [], tests: [], errors: [], files: [], shots: [png, txt, big] } : session === 's2' ? { questions: [], reports: [], tests: [], errors: [], files: [], shots: [other] } : null
  const transcript = async (session: string, before?: number) => session === 's1' ? { messages: [{ role: 'you' as const, text: `at ${before}` }], before: null } : null
  const get = (q: string) => handleHub(h, 'GET', q, '', undefined, undefined, undefined, undefined, { outputs, transcript }) as HubReply | Promise<HubReply>
  const t = () => `token=${h.token}`

  it('needs the token', async () => {
    assert.equal((await get('/hub/chat/outputs?session=s1')).status, 403)
    assert.equal((await get('/hub/chat/transcript?session=s1&token=x')).status, 403)
    assert.equal((await get(`/hub/chat/shot?session=s1&path=${png}`)).status, 403)
  })

  it('serves outputs, 404 for an unknown chat', async () => {
    const r = await get(`/hub/chat/outputs?session=s1&${t()}`)
    assert.equal(r.status, 200)
    assert.equal(r.contentType, 'application/json')
    assert.deepEqual(JSON.parse(r.body).shots, [png, txt, big])
    assert.equal((await get(`/hub/chat/outputs?session=zz&${t()}`)).status, 404)
  })

  it('pages the transcript, 400 on a bad before', async () => {
    assert.equal(JSON.parse((await get(`/hub/chat/transcript?session=s1&before=12&${t()}`)).body).messages[0].text, 'at 12')
    assert.equal(JSON.parse((await get(`/hub/chat/transcript?session=s1&${t()}`)).body).messages[0].text, 'at undefined')
    for (const b of ['-1', 'x', '1.5', '']) assert.equal((await get(`/hub/chat/transcript?session=s1&before=${b}&${t()}`)).status, 400, b)
    assert.equal((await get(`/hub/chat/transcript?session=zz&${t()}`)).status, 404)
  })

  it('answers a Codex chat from its progress, with no transcript', async () => {
    h.get().progress.push({ sessionId: 'cx', cwd: '/r', state: 'done', roles: [], tasks: [], startedAt: 1, at: 2, commit: 'Fix it', report: { done: ['a'], left: [] }, tests: { command: 'go test', ok: true, at: 2, total: 3 } })
    const o = JSON.parse((await get(`/hub/chat/outputs?session=cx&${t()}`)).body)
    assert.equal(o.codex, true)
    assert.equal(o.commit, 'Fix it')
    assert.deepEqual(o.standup, { done: ['a'], left: [] })
    assert.deepEqual(o.tests, [{ command: 'go test', ok: true, total: 3 }])
    assert.equal(JSON.parse((await get(`/hub/chat/transcript?session=cx&${t()}`)).body).transcript, 'unsupported')
  })

  it('serves only an image listed in that chat, under 10 MB', async () => {
    const ok = await get(`/hub/chat/shot?session=s1&path=${encodeURIComponent(png)}&${t()}`)
    assert.equal(ok.status, 200)
    assert.equal(ok.contentType, 'image/png')
    assert.deepEqual(ok.bytes, PNG)
    for (const p of [txt, big, other, `${dir}/../${path.basename(dir)}/a.png`, '']) {
      assert.equal((await get(`/hub/chat/shot?session=s1&path=${encodeURIComponent(p)}&${t()}`)).status, 404, p)
    }
    assert.equal((await get(`/hub/chat/shot?session=zz&path=${encodeURIComponent(png)}&${t()}`)).status, 404)
  })
})

describe('chat view under load and abuse', () => {
  const noRuns = async () => []
  const qa = [asst(use('q1', 'AskUserQuestion', { questions: [{ question: 'Which?' }] })), user([result('q1', 'x')], { toolUseResult: { answers: { 'Which?': 'A' } } }),
    asst(use('b1', 'Bash', { command: 'npm test' })), user([result('b1', 'ℹ tests 2\nℹ fail 1', true)])]

  it('two reads of the same chat at once count each line once', async () => {
    const { home: h } = chatHome(qa)
    const [a, b] = await Promise.all([chatOutputs(SID, { home: h, runs: noRuns }), chatOutputs(SID, { home: h, runs: noRuns })])
    for (const o of [a!, b!]) { assert.equal(o.questions.length, 1); assert.equal(o.tests.length, 1); assert.equal(o.errors.length, 1) }
    const c = (await chatOutputs(SID, { home: h, runs: noRuns }))!
    assert.equal(c.questions.length, 1)
  })

  it('a result seen twice for one call counts once', async () => {
    const { home: h } = chatHome([...qa, user([result('b1', 'again', true)])])
    assert.equal((await chatOutputs(SID, { home: h, runs: noRuns }))!.errors.length, 1)
  })

  it('reads a chat whose final message is nine million hex characters', async () => {
    const { home: h } = chatHome([asst({ type: 'text', text: 'f'.repeat(9e6) })])
    const o = (await chatOutputs(SID, { home: h, runs: noRuns }))!
    assert.ok(o.final!.length <= 20_001)
    assert.ok(!/f{40}/.test(o.final!))
  })

  it('redacts labels, roles, test commands and answers, even where a cap cuts a key', async () => {
    const { home: h, dir } = chatHome([
      asst(use('a1', 'Agent', { description: `Use ${KEY}`, subagent_type: `role-${KEY}` })), user([result('a1', [{ type: 'text', text: 'Status: done' }])]),
      asst(use('b1', 'Bash', { command: `npm test ${'x'.repeat(140)} ${KEY}` })), user([result('b1', 'ℹ tests 1')]),
      asst(use('q1', 'AskUserQuestion', { questions: [{ question: `Q ${KEY}` }] })), user([result('q1', 'x')], { toolUseResult: { answers: { [`Q ${KEY}`]: `${'y'.repeat(490)} ${KEY}` } } }),
    ])
    const sub = path.join(dir, SID, 'subagents')
    fs.mkdirSync(sub, { recursive: true })
    fs.writeFileSync(path.join(sub, 'agent-zz.meta.json'), JSON.stringify({ agentType: 'designer', toolUseId: 'd9' }))
    const runs = async () => [{ id: 'zz', role: 'designer', title: `Draw ${KEY}`, reportText: 'ok' }]
    const o = (await chatOutputs(SID, { home: h, runs: runs as never }))!
    const all = JSON.stringify(o)
    assert.ok(!all.includes('sk-'), all.slice(all.indexOf('sk-') - 40, all.indexOf('sk-') + 20))
  })

  it('redacts a key that a tool call line cuts short in the transcript', async () => {
    const { home: h } = chatHome([asst(use('b1', 'Bash', { command: `${'x'.repeat(30)} ${KEY}` }))])
    const t = (await chatTranscript(SID, undefined, { home: h }))!
    assert.ok(!JSON.stringify(t).includes('sk-'), JSON.stringify(t))
  })

  it('starts over when the transcript is replaced by another file', async () => {
    const { home: h, file } = chatHome([asst({ type: 'text', text: 'old' }), ...qa])
    assert.equal((await chatOutputs(SID, { home: h, runs: noRuns }))!.questions.length, 1)
    const next = `${file}.new`
    fs.writeFileSync(next, `${[asst({ type: 'text', text: `new ${'n'.repeat(4000)}` })].join('\n')}\n`)
    fs.renameSync(next, file)
    const o = (await chatOutputs(SID, { home: h, runs: noRuns }))!
    assert.match(o.final!, /^new/)
    assert.equal(o.questions.length, 0)
  })
})

describe('giant lines', () => {
  it('scanLines skips a line over the cap and keeps the rest', async () => {
    const f = path.join(tmp(), 'g.jsonl')
    fs.writeFileSync(f, `a\n${'z'.repeat(500)}\nb\n`)
    const seen: string[] = []
    const end = await scanLines(f, 0, l => { seen.push(l) }, 16, 100)
    assert.deepEqual(seen, ['a', 'b'])
    assert.equal(end, fs.statSync(f).size)
  })

  it('pageBack gives a placeholder for a line over the cap', async () => {
    const f = path.join(tmp(), 'g.jsonl')
    fs.writeFileSync(f, `a\n${'z'.repeat(500)}\nb\n`)
    const r = await pageBack(f, fs.statSync(f).size, 10, 16, 100)
    assert.deepEqual(r.lines.map(l => l.text), ['a', SKIPPED, 'b'])
    assert.deepEqual(r.lines.map(l => l.at), [0, 2, 503])
  })

  it('the transcript says when it skipped a giant line', async () => {
    const { home: h } = chatHome([user('hi')])
    fs.appendFileSync(path.join(h, '.claude', 'projects', '-repo', `${SID}.jsonl`), `${'q'.repeat(17 * 1024 * 1024)}\n${user('after')}\n`)
    const t = (await chatTranscript(SID, undefined, { home: h }))!
    assert.deepEqual(t.messages.map(m => m.text), ['hi', 'A line over 16 MB was skipped', 'after'])
  })
})

describe('chatShot', () => {
  const dir = tmp()
  const png = path.join(dir, 'real.png'), txt = path.join(dir, 'secret.txt'), fake = path.join(dir, 'fake.png'), link = path.join(dir, 'link.png'), good = path.join(dir, 'good.png')
  fs.writeFileSync(png, PNG)
  fs.writeFileSync(txt, 'secret')
  fs.writeFileSync(fake, 'not an image')
  fs.symlinkSync(txt, link)
  fs.symlinkSync(png, good)
  const all = [png, txt, fake, link, good]

  it('serves a real image, by its bytes', async () => {
    assert.equal((await chatShot(all, png))?.type, 'image/png')
    assert.equal((await chatShot(all, good))?.type, 'image/png')
  })

  it('refuses a link to a non image and a file that is not an image inside', async () => {
    assert.equal(await chatShot(all, link), undefined)
    assert.equal(await chatShot(all, fake), undefined)
  })
})

describe('chatTranscript for a Codex rollout', () => {
  const id = '01a1b917-9d24-7430-b590-c3623b80d155'
  const ri = (payload: object) => JSON.stringify({ type: 'response_item', payload })
  const msg = (role: string, text: string) => ri({ type: 'message', role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }] })
  const write = (home: string, lines: string[]) => {
    const dir = path.join(home, '.codex', 'sessions', '2026', '11', '07')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `rollout-2026-11-07T18-58-14-${id}.jsonl`), `${lines.join('\n')}\n`)
  }

  it('reads prompts, replies and tool calls, skipping injections, redacted', async () => {
    const home = tmp()
    write(home, [
      JSON.stringify({ type: 'session_meta', payload: { id, cwd: '/repo' } }),
      msg('developer', '<permissions instructions>x'),
      msg('user', '<environment_context>\n<cwd>/repo</cwd>\n</environment_context>'),
      msg('user', 'fix the bug'),
      msg('assistant', `On it ${KEY}`),
      ri({ type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'ls -la' }), call_id: 'c1' }),
      ri({ type: 'function_call_output', call_id: 'c1', output: 'a.ts\nb.ts' }),
      ri({ type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Update File: /repo/a.ts\n', call_id: 'c2' }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'dup' } }),
    ])
    const t = (await chatTranscript(id, undefined, { home }))!
    assert.equal(t.transcript, undefined)
    assert.deepEqual(t.messages.slice(0, 2), [{ role: 'you', text: 'fix the bug' }, { role: 'claude', text: 'On it [removed]' }])
    assert.deepEqual(t.messages.slice(2).map(m => m.role), ['tool', 'tool', 'tool'])
    assert.match(t.messages[2].text, /^exec_command .*ls -la/)
    assert.match(t.messages[3].text, /^result: a\.ts/)
    assert.equal(t.messages[4].text, 'apply_patch /repo/a.ts')
  })

  it('pages 50 at a time and refuses an id that is not a uuid', async () => {
    const home = tmp()
    write(home, Array.from({ length: 70 }, (_, i) => msg('user', `m${i}`)))
    const t = (await chatTranscript(id, undefined, { home }))!
    assert.equal(t.messages.length, 50)
    assert.equal(t.messages[0].text, 'm20')
    const back = (await chatTranscript(id, t.before!, { home }))!
    assert.deepEqual([back.messages.length, back.messages[0].text, back.before], [20, 'm0', null])
    assert.equal(await chatTranscript('../x', undefined, { home }), null)
  })
})
