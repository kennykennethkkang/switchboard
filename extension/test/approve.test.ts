/** Approve: the done-check read, the chat's own Approve answer, temp folders and which terminals close. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { approvalBlock, approvedAnswer, closingPick, approvedFields, closeApproved, LIVE_SUB_MS, isTempDir, ourTerminal, readDoneCheck, stampedChats } from '../src/hub/approve'
import { HubService } from '../src/hub/hub-service'
import type { ChatProgress } from '../src/hub/types'

describe('readDoneCheck', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'done-check-'))
  it('reads verified and missing', () => {
    fs.writeFileSync(path.join(dir, 'abc.json'), JSON.stringify({ verified: false, missing: ['tests', 42, 'lint'] }))
    assert.deepEqual(readDoneCheck('abc', dir), { verified: false, missing: ['tests', 'lint'] })
    fs.writeFileSync(path.join(dir, 'ok.json'), JSON.stringify({ verified: true }))
    assert.deepEqual(readDoneCheck('ok', dir), { verified: true })
  })
  it('is undefined when absent, broken or shaped wrong', () => {
    assert.equal(readDoneCheck('none', dir), undefined)
    fs.writeFileSync(path.join(dir, 'bad.json'), '{')
    assert.equal(readDoneCheck('bad', dir), undefined)
    fs.writeFileSync(path.join(dir, 'odd.json'), JSON.stringify({ verified: 'yes' }))
    assert.equal(readDoneCheck('odd', dir), undefined)
    assert.equal(readDoneCheck('../etc/passwd', dir), undefined)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('approvedAnswer', () => {
  const Q = 'Approve this chat as finished?'
  const ask = (question = Q, options = ['Approve', 'Send back']) => ({ questions: [{ question, options: options.map(label => ({ label })) }] })
  const post = (answers: unknown, tool = 'AskUserQuestion', event = 'PostToolUse', input: unknown = ask()) => ({ hook_event_name: event, tool_name: tool, tool_input: input, tool_response: { answers } })
  const chat = (o: Partial<ChatProgress> = {}): ChatProgress => ({ sessionId: 's', cwd: '/p', state: 'needs-you', roles: [], tasks: [], startedAt: 0, at: 0, ...o })
  it('is true only for the kit closing question answered Approve', () => {
    assert.equal(approvedAnswer(post({ [Q]: 'Approve' })), true)
    assert.equal(approvedAnswer(post({ [Q]: 'Approve' }), chat({ state: 'done' })), true)
  })
  it('is false for any other Approve question', () => {
    assert.equal(approvedAnswer(post({ 'Approve this design?': 'Approve' }, 'AskUserQuestion', 'PostToolUse', ask('Approve this design?'))), false)
    assert.equal(approvedAnswer(post({ [Q]: 'Approve' }, 'AskUserQuestion', 'PostToolUse', ask(Q, ['Approve', 'Change it']))), false)
    assert.equal(approvedAnswer(post({ [Q]: 'approve and close' })), false)
  })
  it('is false while the chat still works', () => {
    assert.equal(approvedAnswer(post({ [Q]: 'Approve' }), chat({ state: 'working' })), false)
    assert.equal(approvedAnswer(post({ [Q]: 'Approve' }), chat({ running: ['a1'], roles: [{ id: 'a1', role: 'qa', state: 'active', startedAt: Date.now(), at: Date.now() }] })), false)
    assert.equal(approvedAnswer(post({ [Q]: 'Approve' }), chat({ tasks: [{ id: '1', subject: 'x', status: 'in_progress' }] })), false)
  })
  it('a subagent quiet past LIVE_SUB_MS (killed without SubagentStop) does not hold it', () => {
    const now = 100 * 60 * 1000
    const sub = (at: number) => chat({ running: ['a1'], roles: [{ id: 'a1', role: 'engineer', state: 'active', startedAt: 0, at }] })
    assert.equal(approvedAnswer(post({ [Q]: 'Approve' }), sub(now - LIVE_SUB_MS - 1), now), true)
    assert.equal(approvedAnswer(post({ [Q]: 'Approve' }), sub(now - 60_000), now), false)
    assert.match(approvalBlock(sub(now - 60_000), now) ?? '', /a1/)
  })
  it('accepts Codex request_user_input, answers by question text or wrapped by id', () => {
    assert.equal(approvedAnswer(post({ [Q]: 'Approve' }, 'request_user_input')), true)
    assert.equal(approvedAnswer({ hook_event_name: 'PostToolUse', tool_name: 'request_user_input', tool_input: { questions: [{ id: 'q1', question: Q, options: [{ label: 'Approve' }, { label: 'Send back' }] }] }, tool_response: { answers: { q1: { answers: ['Approve'] } } } }), true)
    assert.equal(approvedAnswer(post({ [Q]: 'Send back' }, 'request_user_input')), false)
  })
  it('accepts the Switchboard ask tool, whose reply is text lines', () => {
    const mcp = (text: unknown, tool = 'mcp__switchboard__ask', input: unknown = ask()) => ({ hook_event_name: 'PostToolUse', tool_name: tool, tool_input: input, tool_response: text })
    const line = `"${Q}": Approve`
    for (const r of [line, { content: [{ type: 'text', text: line }] }, [{ type: 'text', text: line }], { text: line }]) assert.equal(approvedAnswer(mcp(r)), true)
    assert.equal(approvedAnswer(mcp(line, 'switchboard.ask')), true)
    assert.equal(approvedAnswer(mcp(`"${Q}": Send back`)), false)
    assert.equal(approvedAnswer(mcp(`"${Q}": Approve; other: not yet`)), false)
    assert.equal(approvedAnswer(mcp('The user declined to answer. Decide yourself and say what you decided.')), false)
    assert.equal(approvedAnswer(mcp(`"Approve this design?": Approve`, 'mcp__switchboard__ask', ask('Approve this design?'))), false)
    assert.equal(approvedAnswer(mcp(line, 'mcp__other__ask')), false)
    assert.equal(approvedAnswer(mcp(line), chat({ state: 'working' })), false)
  })
  it('is false for other answers, tools and events', () => {
    assert.equal(approvedAnswer(post({ [Q]: 'Send back' })), false)
    assert.equal(approvedAnswer(post({ [Q]: 'Approve' }, 'Bash')), false)
    assert.equal(approvedAnswer(post({ [Q]: 'Approve' }, 'AskUserQuestion', 'PreToolUse')), false)
    assert.equal(approvedAnswer({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion' }), false)
  })
})

describe('isTempDir', () => {
  it('matches tmp, private tmp, var folders and scratchpads', () => {
    for (const p of ['/tmp/x', '/private/tmp/claude-501/proj/abc/scratchpad', '/var/folders/zz/T/bench', '/private/var/folders/zz/T/bench', path.join(os.tmpdir(), 'run')]) assert.equal(isTempDir(p), true, p)
  })
  it('matches the temp folder itself (Codex runs in /private/tmp)', () => {
    for (const p of ['/tmp', '/private/tmp', '/tmp/', os.tmpdir()]) assert.equal(isTempDir(p), true, p)
  })
  it('leaves real projects alone', () => {
    for (const p of ['/Users/k/Documents/GitHub/agent-flow', '/Users/k/tmpfiles', '/Users/k/tmp', '/Users/k/tmp/myapp', '/Users/k/var/folders/x/']) assert.equal(isTempDir(p), false, p)
  })
})

describe('HubService temp filter', () => {
  it('keeps temp chats out of chats and progress', () => {
    const hub = new HubService()
    const row = (sessionId: string, cwd: string) => ({ pid: 1, sessionId, cwd, link: '', live: true, why: [] })
    hub.set({ chats: [row('a', '/Users/k/proj'), row('b', '/private/tmp/bench')] })
    assert.deepEqual(hub.get().chats.map(c => c.sessionId), ['a'])
    hub.hook({ hook_event_name: 'UserPromptSubmit', session_id: 't', cwd: '/var/folders/x/T/run', prompt: 'hi' })
    assert.equal(hub.get().progress.some(p => p.sessionId === 't'), false)
  })
  it('fires onApproved when the chat is approved in its own AskUserQuestion', () => {
    const hub = new HubService()
    const got: string[] = []
    hub.onApproved(id => got.push(id))
    const Q = 'Approve this chat as finished?'
    const input = { questions: [{ question: Q, options: [{ label: 'Approve' }, { label: 'Send back' }] }] }
    const base = { hook_event_name: 'PostToolUse', cwd: '/Users/k/proj', tool_name: 'AskUserQuestion', tool_input: input, tool_response: { answers: { [Q]: 'Approve' } } }
    hub.hook({ ...base, session_id: 's1' })
    hub.hook({ ...base, session_id: 's2' }, Date.now(), true)
    // A subagent still running: not finished.
    hub.hook({ hook_event_name: 'SubagentStart', session_id: 's3', cwd: '/Users/k/proj', agent_id: 'a1', agent_type: 'engineer' })
    hub.hook({ ...base, session_id: 's3' })
    assert.deepEqual(got, ['s1'])
  })
  it('fires onApproved again at the Stop after an in-chat Approve, so the now idle chat closes', () => {
    const hub = new HubService()
    const got: { id: string; state?: string }[] = []
    hub.onApproved(id => got.push({ id, state: hub.get().progress.find(p => p.sessionId === id)?.state }))
    const Q = 'Approve this chat as finished?'
    const input = { questions: [{ question: Q, options: [{ label: 'Approve' }, { label: 'Send back' }] }] }
    const cwd = '/Users/k/proj'
    hub.hook({ hook_event_name: 'UserPromptSubmit', session_id: 'a1', cwd, prompt: 'go' })
    hub.hook({ hook_event_name: 'PreToolUse', session_id: 'a1', cwd, tool_name: 'AskUserQuestion', tool_input: input })
    hub.hook({ hook_event_name: 'PostToolUse', session_id: 'a1', cwd, tool_name: 'AskUserQuestion', tool_input: input, tool_response: { answers: { [Q]: 'Approve' } } })
    assert.equal(got.length, 1)
    assert.equal(got[0].state, 'needs-you')
    hub.hook({ hook_event_name: 'Stop', session_id: 'a1', cwd, last_assistant_message: 'done' })
    assert.equal(got.length, 2)
    assert.ok(got[1].state === 'done' || got[1].state === 'idle', got[1].state)
    // Only once: a later Stop is an ordinary turn.
    hub.hook({ hook_event_name: 'UserPromptSubmit', session_id: 'a1', cwd, prompt: 'more' })
    hub.hook({ hook_event_name: 'Stop', session_id: 'a1', cwd, last_assistant_message: 'ok' })
    assert.equal(got.length, 2)
  })
  it('closes at the Stop after Approve even when a background job keeps the chat marked working', () => {
    const hub = new HubService()
    const got: string[] = []
    hub.onApproved(id => got.push(id))
    const Q = 'Approve this chat as finished?'
    const input = { questions: [{ question: Q, options: [{ label: 'Approve' }, { label: 'Send back' }] }] }
    const cwd = '/Users/k/proj'
    hub.hook({ hook_event_name: 'UserPromptSubmit', session_id: 'j1', cwd, prompt: 'go' })
    hub.hook({ hook_event_name: 'PostToolUse', session_id: 'j1', cwd, tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'sleep 999', run_in_background: true, description: 'wait' }, tool_response: { backgroundTaskId: 'b1' } })
    hub.hook({ hook_event_name: 'PreToolUse', session_id: 'j1', cwd, tool_name: 'AskUserQuestion', tool_input: input })
    hub.hook({ hook_event_name: 'PostToolUse', session_id: 'j1', cwd, tool_name: 'AskUserQuestion', tool_input: input, tool_response: { answers: { [Q]: 'Approve' } } })
    hub.hook({ hook_event_name: 'Stop', session_id: 'j1', cwd, last_assistant_message: 'done' })
    const p = hub.get().progress.find(x => x.sessionId === 'j1')!
    assert.equal(p.state, 'working')
    assert.equal(p.waiting, true)
    assert.equal(got.length, 2)
  })
  it('takes an Approve answered from Switchboard, whose tap already marked the chat working', () => {
    const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'approve-log-')), 'approve.log')
    const hub = new HubService()
    hub.approveLog = log
    const got: string[] = []
    hub.onApproved(id => got.push(id))
    const Q = 'Approve this chat as finished?'
    const input = { questions: [{ question: Q, options: [{ label: 'Approve' }, { label: 'Send back' }] }] }
    const base = { session_id: 'r1', cwd: '/Users/k/proj', tool_name: 'AskUserQuestion', tool_input: input, tool_use_id: 'q1' }
    hub.hook({ hook_event_name: 'UserPromptSubmit', session_id: 'r1', cwd: '/Users/k/proj', prompt: 'go' })
    hub.hook({ ...base, hook_event_name: 'PreToolUse' })
    hub.answered('r1', 'q1')
    assert.equal(hub.get().progress.find(p => p.sessionId === 'r1')?.state, 'working')
    hub.hook({ ...base, hook_event_name: 'PostToolUse', tool_response: { answers: { [Q]: 'Approve' } } })
    assert.deepEqual(got, ['r1'])
    assert.equal(fs.existsSync(log), false)
  })
  it('still refuses a working chat whose Approve carries no tool_use_id and was never tapped', () => {
    const hub = new HubService()
    const got: string[] = []
    hub.onApproved(id => got.push(id))
    const Q = 'Approve this chat as finished?'
    const input = { questions: [{ question: Q, options: [{ label: 'Approve' }, { label: 'Send back' }] }] }
    hub.hook({ hook_event_name: 'UserPromptSubmit', session_id: 'p1', cwd: '/Users/k/proj', prompt: 'go' })
    hub.hook({ hook_event_name: 'PostToolUse', session_id: 'p1', cwd: '/Users/k/proj', tool_name: 'AskUserQuestion', tool_input: input, tool_response: { answers: { [Q]: 'Approve' } } })
    assert.deepEqual(got, [])
  })
  it('logs a refused Approve to a file that survives a reload', () => {
    const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'approve-log-')), 'approve.log')
    const hub = new HubService()
    hub.approveLog = log
    const Q = 'Approve this chat as finished?'
    const input = { questions: [{ question: Q, options: [{ label: 'Approve' }, { label: 'Send back' }] }] }
    const cwd = '/Users/k/proj'
    hub.hook({ hook_event_name: 'SubagentStart', session_id: 'r2', cwd, agent_id: 'a1', agent_type: 'engineer' })
    hub.hook({ hook_event_name: 'PostToolUse', session_id: 'r2', cwd, tool_name: 'AskUserQuestion', tool_input: input, tool_response: { answers: { [Q]: 'Approve' } } }, 1000)
    const row = JSON.parse(fs.readFileSync(log, 'utf8').trim())
    assert.deepEqual(row, { at: 1000, sessionId: 'r2', why: 'the chat is still working' })
  })
  it('keeps the approval log to its last 50 lines', () => {
    const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'approve-log-')), 'approve.log')
    fs.writeFileSync(log, Array.from({ length: 200 }, (_, i) => JSON.stringify({ at: i, sessionId: 'x', why: 'w'.repeat(60) })).join('\n') + '\n')
    const hub = new HubService()
    hub.approveLog = log
    const Q = 'Approve this chat as finished?'
    const input = { questions: [{ question: Q, options: [{ label: 'Approve' }, { label: 'Send back' }] }] }
    const cwd = '/Users/k/proj'
    hub.hook({ hook_event_name: 'SubagentStart', session_id: 'r3', cwd, agent_id: 'a1', agent_type: 'engineer' })
    hub.hook({ hook_event_name: 'PostToolUse', session_id: 'r3', cwd, tool_name: 'AskUserQuestion', tool_input: input, tool_response: { answers: { [Q]: 'Approve' } } }, 1000)
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n')
    assert.equal(lines.length, 50)
    assert.equal(JSON.parse(lines.at(-1)!).sessionId, 'r3')
  })
  it('drops the close when the chat is sent back instead', () => {
    const hub = new HubService()
    const got: string[] = []
    hub.onApproved(id => got.push(id))
    const Q = 'Approve this chat as finished?'
    const input = { questions: [{ question: Q, options: [{ label: 'Approve' }, { label: 'Send back' }] }] }
    const cwd = '/Users/k/proj'
    hub.hook({ hook_event_name: 'UserPromptSubmit', session_id: 'b1', cwd, prompt: 'go' })
    hub.hook({ hook_event_name: 'PreToolUse', session_id: 'b1', cwd, tool_name: 'AskUserQuestion', tool_input: input })
    hub.hook({ hook_event_name: 'PostToolUse', session_id: 'b1', cwd, tool_name: 'AskUserQuestion', tool_input: input, tool_response: { answers: { [Q]: 'Send back' } } })
    hub.hook({ hook_event_name: 'Stop', session_id: 'b1', cwd, last_assistant_message: 'done' })
    assert.deepEqual(got, [])
  })
})

describe('approvedFields', () => {
  it('stamps a chat approved through the closing question, which is never in done', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'done-check-'))
    fs.writeFileSync(path.join(dir, 'c1.json'), JSON.stringify({ verified: false, missing: ['lint'] }))
    const hub = new HubService()
    const Q = 'Approve this chat as finished?'
    const input = { questions: [{ question: Q, options: [{ label: 'Approve' }, { label: 'Send back' }] }] }
    const base = { session_id: 'c1', cwd: '/Users/k/proj', tool_name: 'AskUserQuestion', tool_input: input, tool_use_id: 'q1' }
    const got: { state?: string; fields: ReturnType<typeof approvedFields> }[] = []
    hub.onApproved(id => got.push({ state: hub.get().progress.find(p => p.sessionId === id)?.state, fields: approvedFields(id, undefined, 5, dir) }))
    hub.hook({ hook_event_name: 'UserPromptSubmit', session_id: 'c1', cwd: '/Users/k/proj', prompt: 'go' })
    hub.hook({ ...base, hook_event_name: 'PreToolUse' })
    assert.equal(hub.get().progress.find(p => p.sessionId === 'c1')?.state, 'needs-you')
    hub.hook({ ...base, hook_event_name: 'PostToolUse', tool_response: { answers: { [Q]: 'Approve' } } })
    assert.equal(got.length, 1)
    assert.notEqual(got[0].state, 'done')
    assert.deepEqual(got[0].fields, { approvedAt: 5, doneCheck: { verified: false, missing: ['lint'] } })
    assert.deepEqual(approvedFields('c1', 'abc123', 6, dir), { approvedAt: 6, commit: 'abc123', doneCheck: { verified: false, missing: ['lint'] } })
    assert.deepEqual(approvedFields('none', undefined, 7, dir), { approvedAt: 7 })
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('closeApproved', () => {
  const term = (name: string, pid: number) => { const t = { name, processId: Promise.resolve(pid), disposed: false, dispose() { t.disposed = true } }; return t }
  const fast = { parent: async (p: number) => p - 100, alive: () => false, waitMs: 10, stepMs: 1 }
  it('closes the Switchboard terminal whose shell runs the chat', async () => {
    const ours = term('Claude: fix login', 7), mine = term('zsh', 8)
    assert.equal(await closeApproved([107], [mine, ours], fast), 1)
    assert.equal(ours.disposed, true)
    assert.equal(mine.disposed, false)
  })
  it('never closes a terminal Kenneth opened himself', async () => {
    const mine = term('zsh', 9)
    assert.equal(await closeApproved([109], [mine], fast), 0)
    assert.equal(mine.disposed, false)
  })
  it('names Switchboard chat terminals', () => {
    assert.equal(ourTerminal({ name: 'Claude: x' }), true)
    assert.equal(ourTerminal({ name: 'Codex: x' }), true)
    assert.equal(ourTerminal({ name: 'Claude Code: x' }), true)
    assert.equal(ourTerminal({ name: 'claude' }), false)
  })
})

describe('temp chats stay hidden everywhere', () => {
  it('leaves a real repo named scratchpad alone', () => {
    assert.equal(isTempDir('/Users/k/Documents/GitHub/scratchpad'), false)
  })
  it('drops temp cwds from live, starred, archive and progress', () => {
    const hub = new HubService()
    const tmp = '/private/var/folders/4d/T/dr-new-abc', real = '/Users/k/proj'
    const live = (sessionId: string, cwd: string) => ({ sessionId, cwd, limits: [], at: Date.now() })
    const star = (sessionId: string, cwd: string) => ({ sessionId, ai: 'claude' as const, name: 'n', cwd, starredAt: 1, live: false, digest: { resume: '' } })
    const arch = (sessionId: string, cwd: string) => ({ sessionId, ai: 'claude' as const, name: 'n', origin: 'o', version: 1, cwd, project: 'p', archivedAt: 1 })
    const prog = (sessionId: string, cwd: string) => ({ sessionId, cwd, state: 'working', roles: [], tasks: [], startedAt: Date.now(), at: Date.now() }) as unknown as ChatProgress
    hub.set({ live: [live('a', real), live('b', tmp)], starred: [star('a', real), star('b', tmp)], archive: [arch('a', real), arch('b', tmp)], progress: [prog('a', real), prog('b', tmp)] })
    const s = hub.get()
    for (const list of [s.live, s.starred, s.archive, s.progress]) assert.deepEqual(list.map(c => c.sessionId), ['a'])
  })
  it('ignores hooks from headless runs Switchboard starts', () => {
    const hub = new HubService()
    assert.equal(hub.hook({ session_id: 'l', cwd: '/Users/k/agent-flow', hook_event_name: 'UserPromptSubmit', headless: true }), undefined)
    assert.equal(hub.get().progress.length, 0)
    assert.equal(hub.isHeadless('l'), true)
    assert.equal(hub.isHeadless('other'), false)
  })
})

describe('stampedChats', () => {
  const p = (sessionId: string, state: string, ask?: object) => ({ sessionId, cwd: '/p', state, roles: [], tasks: [], startedAt: 1, at: 1, ...(ask ? { ask } : {}) }) as unknown as ChatProgress
  const q = (question: string, options = ['Approve', 'Send back']) => ({ id: 't', kind: 'question', tool: 'AskUserQuestion', options: [], questions: [{ question, options }] })
  it('stamps done chats and chats asking the closing question', () => {
    assert.deepEqual(stampedChats([
      p('done', 'done'),
      p('closing', 'needs-you', q('Approve this chat as finished?')),
      p('other', 'needs-you', q('Keep Closet?', ['Keep', 'Rename'])),
      p('lookalike', 'needs-you', q('Approve this chat as finished?', ['Yes', 'No'])),
      p('perm', 'needs-you', { id: 'x', kind: 'permission', tool: 'Bash', options: ['Yes', 'No'] }),
      p('bare', 'needs-you'),
      p('work', 'working', q('Approve this chat as finished?')),
      p('sub', 'needs-you', { ...q('Approve this chat as finished?'), sub: true }),
    ]), ['done', 'closing'])
  })
  it('drops a stamp as soon as its chat moves to another prompt', () => {
    const hub = new HubService()
    hub.set({ progress: [p('a', 'done')], doneChecks: { a: { verified: true } } })
    assert.deepEqual(hub.get().doneChecks, { a: { verified: true } })
    hub.set({ progress: [p('a', 'needs-you', { id: 'x', kind: 'permission', tool: 'Bash', options: ['Yes', 'No'] })] })
    assert.deepEqual(hub.get().doneChecks, {})
  })
})

describe('closingPick', () => {
  const Q = 'Approve this chat as finished?'
  const input = { questions: [{ question: Q, options: [{ label: 'Approve' }, { label: 'Send back' }] }] }
  const post = (answers: unknown, tool = 'AskUserQuestion') => ({ hook_event_name: 'PostToolUse', tool_name: tool, tool_input: input, tool_response: { answers } })
  it('names the answer to the closing question', () => {
    assert.equal(closingPick(post({ [Q]: 'Send back' })), 'Send back')
    assert.equal(closingPick(post({ [Q]: 'Approve' })), 'Approve')
    assert.equal(closingPick(post({ [Q]: 'Send back' }, 'request_user_input')), 'Send back')
    assert.equal(closingPick({ hook_event_name: 'PostToolUse', tool_name: 'mcp__switchboard__ask', tool_input: input, tool_response: `"${Q}": Send back` }), 'Send back')
  })
  it('is undefined for other questions and answers', () => {
    assert.equal(closingPick(post({ [Q]: 'maybe' })), undefined)
    assert.equal(closingPick({ ...post({ [Q]: 'Send back' }), hook_event_name: 'PreToolUse' }), undefined)
  })
})
