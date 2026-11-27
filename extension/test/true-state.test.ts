/** A chat whose hooks a busy window missed: Claude Code's own status puts it right, the same in every window. */
import { afterEach, describe, it, test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { HubService } from '../src/hub/hub-service'
import { step } from '../src/hub/progress'
import { chatRows } from '../src/hub/sessions'
import { lastTurn, missedHook } from '../src/hub/true-state'
import type { Ask, ChatProgress, ChatRow } from '../src/hub/types'

const NOW = 1_800_000_000_000
const row = (o: Partial<ChatRow> = {}): ChatRow => ({ pid: 1, sessionId: 's', cwd: '/u/Armasu', live: true, link: '', why: [], status: 'idle', statusAt: NOW - 20_000, ...o })
const prog = (o: Partial<ChatProgress> = {}): ChatProgress => ({ sessionId: 's', cwd: '/u/Armasu', state: 'working', roles: [], tasks: [], startedAt: NOW - 500_000, at: NOW - 60_000, ...o })
const ended = () => ({ text: 'All good.' })
const name = (p: ChatProgress | undefined, c: ChatRow, last: Parameters<typeof missedHook>[3] = ended) => missedHook(p, c, NOW, last)?.hook_event_name
const ask: Ask = { id: 'a', kind: 'question', tool: 'AskUserQuestion', options: [], questions: [{ header: 'H', question: 'Q?', options: [], multi: false }] } as unknown as Ask

test('a lost Stop: the chat sits idle while it reads working', () => {
  assert.deepEqual(missedHook(prog(), row(), NOW, ended), { session_id: 's', cwd: '/u/Armasu', hook_event_name: 'Stop', last_assistant_message: 'All good.' })
  assert.equal(name(prog(), row({ status: 'shell' })), 'Stop')
  // An open prompt goes with it: an idle chat has no dialog up.
  assert.equal(name(prog({ state: 'needs-you', ask, asks: [ask] }), row()), 'Stop')
  // A hook that came just before idle (a notification) still leaves it stale, but not for a minute.
  assert.equal(name(prog({ at: NOW - 15_000 }), row({ statusAt: NOW - 90_000 })), undefined)
  assert.equal(name(prog({ at: NOW - 70_000 }), row({ statusAt: NOW - 90_000 })), 'Stop')
})

test('an interrupted turn goes idle, an API error stays one', () => {
  assert.equal(name(prog(), row(), () => ({ text: '', cut: true })), 'SwitchboardIdle')
  assert.equal(name(prog(), row(), () => undefined), 'SwitchboardIdle')
  const limit = missedHook(prog(), row(), NOW, () => ({ text: 'You hit your limit', error: 'rate_limit' }))
  assert.equal(limit?.hook_event_name, 'StopFailure')
  assert.equal(limit?.error, 'rate_limit')
})

test('nothing is made up while hooks may still be on their way, or for what is right', () => {
  assert.equal(name(prog(), row({ statusAt: NOW - 4000 })), undefined)
  assert.equal(name(prog({ at: NOW - 4000 }), row()), undefined)
  for (const state of ['idle', 'done', 'needs-you'] as const) assert.equal(name(prog({ state, question: 'plain' }), row()), undefined)
  // Subagents or jobs still run after the lead's turn.
  assert.equal(name(prog({ waiting: true }), row()), undefined)
  assert.equal(name(prog(), row({ live: false })), undefined)
  assert.equal(name(prog(), row({ statusAt: undefined })), undefined)
  assert.equal(name(prog(), row({ status: 'busy' })), undefined)
  // A question from the ask tool waits in the hub, not in a dialog.
  const hub = { ...ask, via: 'hub' } as Ask
  assert.equal(name(prog({ state: 'needs-you', ask: hub, asks: [hub] }), row()), undefined)
  assert.equal(name(prog({ state: 'needs-you', ask: hub, asks: [hub] }), row({ status: 'busy', statusAt: NOW - 40_000 })), undefined)
})

test('a lost prompt or answer: the chat is busy while it reads done, idle or needs you', () => {
  const busy = row({ status: 'busy', statusAt: NOW - 40_000 })
  for (const state of ['idle', 'done'] as const) assert.equal(name(prog({ state }), busy), 'SwitchboardBusy')
  assert.equal(name(prog({ state: 'needs-you', ask, asks: [ask] }), busy), 'SwitchboardBusy')
  // A cache ping is busy for seconds only, and a Stop's own hooks run while it is still busy.
  assert.equal(name(prog({ state: 'done' }), row({ status: 'busy', statusAt: NOW - 20_000 })), undefined)
  assert.equal(name(prog({ state: 'done', at: NOW - 60_000 }), row({ status: 'busy', statusAt: NOW - 400_000 })), undefined)
  assert.equal(name(prog({ state: 'done', at: NOW - 130_000 }), row({ status: 'busy', statusAt: NOW - 400_000 })), 'SwitchboardBusy')
  // A Code Mode question: busy since before it was asked.
  assert.equal(name(prog({ state: 'needs-you', ask, asks: [ask], at: NOW - 300_000 }), row({ status: 'busy', statusAt: NOW - 400_000 })), undefined)
  // Out of usage, it waits for its reset.
  assert.equal(name(prog({ state: 'needs-you', limited: { at: 1, error: 'rate_limit' } }), busy), undefined)
})

test('a lost question: the terminal shows a prompt while the chat reads working', () => {
  const waits = row({ status: 'waiting', waitingFor: 'permission prompt' })
  assert.equal(name(prog(), waits), 'SwitchboardWaiting')
  assert.equal(name(prog({ state: 'needs-you' }), waits), undefined)
  // A menu Kenneth opened himself is not a question.
  assert.equal(name(prog(), row({ status: 'waiting', waitingFor: 'dialog open' })), undefined)
  assert.equal(missedHook(prog(), waits, NOW, ended, true), undefined)
})

test('a window that knows nothing of a chat yet reads its last turn', () => {
  assert.equal(name(undefined, row()), 'Stop')
  assert.equal(name(undefined, row({ status: 'busy', statusAt: NOW - 1000 })), 'SwitchboardBusy')
})

test('step: the made-up events', () => {
  const at = (e: string, p?: ChatProgress, more = {}) => step(p, { session_id: 's', cwd: '/u/Armasu', hook_event_name: e, ...more }, NOW)!
  assert.equal(at('SwitchboardBusy', prog({ state: 'done' })).state, 'working')
  const answered = at('SwitchboardBusy', prog({ state: 'needs-you', ask, asks: [ask], question: 'Q?' }))
  assert.deepEqual([answered.state, answered.asks, answered.question], ['working', undefined, undefined])
  const idle = at('SwitchboardIdle', prog({ state: 'needs-you', ask, asks: [ask] }))
  assert.deepEqual([idle.state, idle.asks], ['idle', undefined])
  const waits = at('SwitchboardWaiting', prog(), { message: 'Waiting for you in the terminal' })
  assert.deepEqual([waits.state, waits.question], ['needs-you', 'Waiting for you in the terminal'])
  assert.equal(step(waits, { session_id: 's', cwd: '/u', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} }, NOW)!.state, 'working')
})

test('a late score never brings an ended chat back as working', () => {
  assert.equal(step(undefined, { session_id: 's', cwd: '/u/Armasu', hook_event_name: 'SwitchboardCovered', scores: [0.9] }, NOW), undefined)
})

test('lastTurn: the last answer of the last turn, from the transcript', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'true-')), 't.jsonl')
  const write = (...l: object[]) => fs.writeFileSync(file, l.map(x => JSON.stringify(x)).join('\n') + '\n')
  const user = (content: unknown) => ({ type: 'user', message: { content } }), said = (text: string, o = {}) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] }, ...o })
  write(user('go'), said('Working on it'), { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } }, user([{ type: 'tool_result', content: 'ok' }]), said('Finished.'), { type: 'system', subtype: 'turn_duration' })
  assert.deepEqual(lastTurn(file), { text: 'Finished.' })
  write(user('go'), said('Finished.'), user('more'), user([{ type: 'text', text: '[Request interrupted by user]' }]))
  assert.deepEqual(lastTurn(file), { text: '', cut: true })
  write(said('old'), user('go'), said('sub', { isSidechain: true }), said('You hit your limit', { isApiErrorMessage: true, error: 'rate_limit' }))
  assert.deepEqual(lastTurn(file), { text: 'You hit your limit', error: 'rate_limit' })
  assert.equal(lastTurn(path.join(path.dirname(file), 'none.jsonl')), undefined)
})

test('chatRows carries when the status changed and what it waits for', () => {
  const [r] = chatRows([{ pid: 1, sessionId: 's', cwd: '/u', status: 'waiting', waitingFor: 'input needed', updatedAt: NOW, statusUpdatedAt: NOW - 5 }], () => true, NOW)
  assert.deepEqual([r.statusAt, r.waitingFor], [NOW - 5, 'input needed'])
})

test('trueUp: the owner goes the full way, a fresh window only learns the state, a limited chat is left alone', () => {
  const hub = new HubService(), seen: { event: unknown; mirror: boolean }[] = []
  hub.onMissed(m => seen.push({ event: m.payload.hook_event_name, mirror: m.mirror }))
  const hook = (e: string, mirror = false) => hub.hook({ session_id: 's', cwd: '/u/Armasu', hook_event_name: e }, NOW - 60_000, mirror)
  hook('UserPromptSubmit')
  hub.set({ chats: [row()] }, NOW)
  hub.trueUp(NOW, () => ({ text: 'All good.' }))
  assert.deepEqual(seen, [{ event: 'Stop', mirror: false }])
  // Two live rows of one session (the panel and a terminal) say two things.
  seen.length = 0
  hub.set({ chats: [row(), row({ pid: 2, status: 'busy' })] }, NOW)
  hub.trueUp(NOW, ended)
  assert.deepEqual(seen, [])
  const fresh = new HubService(), none: unknown[] = []
  fresh.onMissed(m => none.push(m))
  fresh.set({ chats: [row()] }, NOW)
  fresh.trueUp(NOW, () => ({ text: '**Done**\n- it\n\nCommit message:\n```\nx\n```' }))
  assert.deepEqual([none.length, fresh.get().progress[0]?.state], [0, 'done'])
  const mirror = new HubService(), mine: boolean[] = []
  mirror.onMissed(m => mine.push(m.mirror))
  mirror.hook({ session_id: 's', cwd: '/u/Armasu', hook_event_name: 'UserPromptSubmit' }, NOW - 60_000, true)
  mirror.set({ chats: [row()] }, NOW)
  mirror.trueUp(NOW, ended)
  assert.deepEqual(mine, [true])
})

test('the open chat: newest wins, another window posts it', () => {
  const hub = new HubService(), shown: string[] = []
  hub.onOpened(id => shown.push(id))
  hub.open('a', NOW)
  assert.deepEqual(hub.get().openChat, { sessionId: 'a', at: NOW })
  const token = (hub as unknown as { token: string }).token
  assert.equal(hub.ingest({ token, kind: 'open-chat', sessionId: 'b', show: true }, NOW + 1), true)
  assert.deepEqual([hub.get().openChat?.sessionId, shown], ['b', ['b']])
  hub.ingest({ token, kind: 'open-chat', sessionId: 'c' }, NOW + 2)
  assert.deepEqual([hub.get().openChat?.sessionId, shown], ['c', ['b']])
  // Posts that cross: both windows end on the one opened later.
  hub.ingest({ token, kind: 'open-chat', sessionId: 'late', at: NOW + 1 }, NOW + 5)
  assert.equal(hub.get().openChat?.sessionId, 'c')
  // Opened again: later than a post still on its way.
  hub.open('c', NOW + 9)
  hub.ingest({ token, kind: 'open-chat', sessionId: 'late', at: NOW + 8, show: true }, NOW + 10)
  assert.deepEqual([hub.get().openChat?.sessionId, shown], ['c', ['b']])
  assert.equal(hub.ingest({ token, kind: 'open-chat' }, NOW), false)
})

describe('an Approve whose PostToolUse hook was lost', () => {
  const Q = 'Approve this chat as finished?', CWD = '/u/Armasu', home = process.env.HOME, userProfile = process.env.USERPROFILE
  const ask = { questions: [{ question: Q, header: 'Approve', options: [{ label: 'Approve', description: 'a' }, { label: 'Send back', description: 'b' }], multiSelect: false }] }
  const at = (ms: number) => new Date(ms).toISOString()
  /** 1007fb31, 2026-11-25 05:41 UTC: the pair Code Mode writes for a call made by code. */
  const answered = (pick: string, o: { id?: string; ms?: number; side?: true; tool?: string; response?: unknown } = {}) => {
    const line = { isSidechain: !!o.side, isVirtual: true, timestamp: at(o.ms ?? NOW - 90_000), sessionId: 's' }, id = o.id ?? 'repl_0f7f816d'
    return [
      { ...line, type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: o.tool ?? 'AskUserQuestion', input: ask }] } },
      { ...line, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: '', is_error: false }] }, toolUseResult: o.response ?? { questions: ask.questions, answers: { [Q]: pick }, annotations: {} } },
    ]
  }
  const typed = (text: string, ms: number) => ({ type: 'user', timestamp: at(ms), origin: { kind: 'human' }, message: { role: 'user', content: text } })
  const said = { type: 'assistant', timestamp: at(NOW - 30_000), message: { content: [{ type: 'text', text: 'Standup.' }] } }
  /** A window up since NOW - 10 min whose hooks for this turn came, all but the answer's. */
  const window = (o: { since?: number; stop?: boolean } = {}) => {
    const hub = new HubService(), got: string[] = []
    ;(hub as unknown as { since: number }).since = o.since ?? NOW - 600_000
    hub.onApproved(id => got.push(id))
    const hook = (e: string, ms: number, more = {}) => hub.hook({ session_id: 's', cwd: CWD, hook_event_name: e, ...more }, NOW + ms)
    hook('UserPromptSubmit', -300_000, { prompt: 'go' })
    hook('PreToolUse', -100_000, { tool_name: 'AskUserQuestion', tool_use_id: 'repl_0f7f816d', tool_input: ask })
    if (o.stop !== false) hook('Stop', -25_000, { last_assistant_message: 'Standup.' })
    hub.set({ chats: [row()] }, NOW)
    return { hub, got, hook }
  }
  const transcript = (...lines: object[]) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lost-approve-')), p = path.join(dir, '.claude', 'projects', '-u-Armasu')
    fs.mkdirSync(p, { recursive: true })
    fs.writeFileSync(path.join(p, 's.jsonl'), lines.map(l => JSON.stringify(l)).join('\n') + '\n')
    process.env.HOME = dir
    process.env.USERPROFILE = dir
  }
  afterEach(() => {
    process.env.HOME = home
    if (userProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = userProfile
  })

  it('is taken from the transcript once the turn is over', () => {
    transcript(typed('go', NOW - 300_000), ...answered('Approve'), said)
    const { hub, got } = window()
    hub.trueUp(NOW)
    assert.deepEqual(got, ['s'])
    // Once: not on the next look, nor when the chat goes busy and idle again.
    hub.trueUp(NOW + 15_000)
    hub.set({ chats: [row({ statusAt: NOW + 20_000 })] }, NOW + 40_000)
    hub.trueUp(NOW + 40_000)
    assert.deepEqual(got, ['s'])
    // The ended turn stays ended: no late hook marks the chat working.
    assert.notEqual(hub.get().progress[0].state, 'working')
  })
  it('is taken from the ask tool too', () => {
    transcript(typed('go', NOW - 300_000), ...answered('Approve', { tool: 'mcp__switchboard__ask', response: `"${Q}": Approve` }), said)
    const { hub, got } = window()
    hub.trueUp(NOW)
    assert.deepEqual(got, ['s'])
  })
  it('never fires for an answer from before the window started, or one whose hook came', () => {
    transcript(typed('go', NOW - 300_000), ...answered('Approve'), said)
    const reloaded = window({ since: NOW - 60_000 })
    reloaded.hub.trueUp(NOW)
    assert.deepEqual(reloaded.got, [])
    for (const mirror of [false, true]) {
      const { hub, got } = window()
      hub.hook({ session_id: 's', cwd: CWD, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'repl_0f7f816d', tool_input: ask, tool_response: { answers: { [Q]: 'Approve' } } }, NOW - 90_000, mirror)
      hub.hook({ session_id: 's', cwd: CWD, hook_event_name: 'Stop', last_assistant_message: 'Standup.' }, NOW - 25_000)
      got.length = 0
      hub.trueUp(NOW)
      assert.deepEqual(got, [])
    }
  })
  it('reads the transcript again only once it grew', () => {
    const full = [typed('go', NOW - 300_000), ...answered('Approve'), said].map(l => JSON.stringify(l)).join('\n') + '\n'
    transcript({})
    const file = path.join(process.env.HOME!, '.claude', 'projects', '-u-Armasu', 's.jsonl'), { hub, got } = window()
    fs.writeFileSync(file, ' '.repeat(Buffer.byteLength(full)))
    hub.trueUp(NOW)
    fs.writeFileSync(file, full)
    hub.trueUp(NOW + 15_000)
    assert.deepEqual(got, [])
    // A line written late still counts.
    fs.appendFileSync(file, '\n')
    hub.trueUp(NOW + 30_000)
    assert.deepEqual(got, ['s'])
  })
  it('waits for the turn to be over, and leaves it to the owning window', () => {
    transcript(typed('go', NOW - 300_000), ...answered('Approve'), said)
    const { hub, got } = window()
    hub.set({ chats: [row({ status: 'busy' })] }, NOW)
    hub.trueUp(NOW)
    hub.set({ chats: [row({ statusAt: NOW - 4000 })] }, NOW)
    hub.trueUp(NOW)
    hub.set({ chats: [row({ live: false })] }, NOW)
    hub.trueUp(NOW)
    assert.deepEqual(got, [])
    const mirror = new HubService(), none: string[] = []
    ;(mirror as unknown as { since: number }).since = NOW - 600_000
    mirror.onApproved(id => none.push(id))
    for (const e of ['UserPromptSubmit', 'Stop']) mirror.hook({ session_id: 's', cwd: CWD, hook_event_name: e, prompt: 'go', last_assistant_message: 'Standup.' }, NOW - 25_000, true)
    mirror.set({ chats: [row()] }, NOW)
    mirror.trueUp(NOW)
    assert.deepEqual(none, [])
  })
  it('a lost Stop as well: the Stop is made up first, the Approve on the next look', () => {
    transcript(typed('go', NOW - 300_000), ...answered('Approve'), said)
    const { hub, got } = window({ stop: false })
    hub.onMissed(m => hub.hook(m.payload, NOW, m.mirror))
    hub.trueUp(NOW)
    hub.trueUp(NOW + 15_000)
    assert.deepEqual(got, ['s'])
  })
  it('is dropped once Kenneth typed after it, asked again, or it was not an Approve by the lead', () => {
    const queued = { type: 'attachment', attachment: { type: 'queued_command', prompt: 'wait', commandMode: 'prompt', origin: { kind: 'human' } } }
    const again = answered('Approve', { id: 'repl_2', ms: NOW - 60_000 })[0]
    for (const lines of [
      [...answered('Approve'), typed('one more', NOW - 80_000), said],
      [...answered('Approve'), queued, said],
      [...answered('Approve'), again, said],
      [...answered('Approve', { side: true }), said],
      [...answered('Something else'), said],
      [...answered('Approve', { response: 'Error: PreToolUse hook error' }), said],
      [said],
    ]) {
      transcript(typed('go', NOW - 300_000), ...lines)
      const { hub, got } = window()
      hub.trueUp(NOW)
      assert.deepEqual(got, [])
    }
  })
  it('still refuses one with an open task, and says so in the log', () => {
    transcript(typed('go', NOW - 300_000), ...answered('Approve'), said)
    const { hub, got, hook } = window({ stop: false })
    hub.approveLog = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'approve-log-')), 'approve.log')
    hook('PreToolUse', -30_000, { tool_name: 'TodoWrite', tool_use_id: 't1', tool_input: { todos: [{ content: 'a', status: 'pending' }] } })
    hook('Stop', -25_000, { last_assistant_message: 'Standup.' })
    hub.trueUp(NOW)
    assert.deepEqual(got, [])
    assert.deepEqual(JSON.parse(fs.readFileSync(hub.approveLog, 'utf8').trim()), { at: NOW, sessionId: 's', why: '1 open task' })
  })
})
