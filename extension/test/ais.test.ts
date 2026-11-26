/**
 * The AI registry: a Codex rollout read as a chat row, and each AI's start and resume commands.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AIS, chatTerminal, hermesMcp, pickCli, shareKitWithHermes, signedIn, closeChatTerminal, codexPaste, codexReady, codexRow, endedCodex, readCodexOwn, saveCodexOwn, isCodexCommand, lastCodexPrompt, rolloutLines } from '../src/hub/ais'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const meta = JSON.stringify({ type: 'session_meta', payload: { id: 'c0de', cwd: '/u/GitHub/Armasu' } })
const ask = JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'Fix the closet regen button please' } })

describe('ais', () => {
  const user = (text: string) => JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } })
  it('names a Codex row from its thread title, else the first real response_item user text', () => {
    const lines = [meta, user('# AGENTS.md instructions\n\n<INSTRUCTIONS>x'), user('<environment_context>\n<cwd>/x</cwd>'), user('Fix   the closet\nbutton')]
    assert.equal(codexRow(lines, 0, 0)?.name, 'Fix the closet button')
    assert.equal(codexRow(lines, 0, 0, undefined, new Map([['c0de', 'Closet work']]))?.name, 'Fix the closet button')
    assert.equal(codexRow([meta], 0, 0, undefined, new Map([['c0de', 'Closet work']]))?.name, 'Closet work')
    assert.equal(codexRow([meta, user('<environment_context>')], 0, 0)?.name, undefined)
  })
  it('shows the title Switchboard gave a chat it started, and keeps it on disk', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'titles-')), 'codex-titles.json')
    saveCodexOwn('c0de', 'Closet regen', file)
    saveCodexOwn('beef', 'Other', file)
    const own = readCodexOwn(file)
    assert.equal(own.get('c0de'), 'Closet regen')
    assert.equal(codexRow([meta, ask], 0, 0, undefined, new Map([['c0de', 'Thread']]), own)?.name, 'Closet regen')
    assert.equal(readCodexOwn(path.join(os.tmpdir(), 'no-such-titles.json')).size, 0)
  })
  it('skips the brief and notes block when naming a row', () => {
    const msg = user('Switchboard brief for Armasu. Ask the hub_ask tool for more.\nSwitchboard notes: you are X.\n\nFix the closet button')
    assert.equal(codexRow([meta, msg], 0, 0)?.name, 'Fix the closet button')
    assert.equal(codexRow([meta, user('Switchboard notes: you are X.\n\nDo the thing')], 0, 0)?.name, 'Do the thing')
  })
  it('archives an ended Codex row only with no running terminal and an exit or long silence', () => {
    const now = 10 * 3_600_000
    const row = (sessionId: string, updatedAt: number, live = false) => ({ ai: 'codex', sessionId, cwd: '/Users/k/repo', updatedAt, live } as never)
    const none = (_id: string) => false
    const ids = (cs: unknown[], tied = none, exited = new Set<string>()) => endedCodex(cs as never, tied, exited, now).map(c => c.sessionId)
    assert.deepEqual(ids([row('exit', now - 60_000)], none, new Set(['exit'])), ['exit'])
    assert.deepEqual(ids([row('old', now - 3 * 3_600_000)]), ['old'])
    assert.deepEqual(ids([row('quiet', now - 3 * 3_600_000)], id => id === 'quiet'), [])
    assert.deepEqual(ids([row('recent', now - 3_600_000), row('live', now - 5 * 3_600_000, true)]), [])
  })
  it('reads a Codex rollout as a chat row named by its first message', () => {
    const now = 1_000_000_000
    const row = codexRow([meta, ask], now - 60_000, now)
    assert.equal(row?.ai, 'codex')
    assert.equal(row?.sessionId, 'c0de')
    assert.equal(row?.cwd, '/u/GitHub/Armasu')
    assert.equal(row?.name, 'Fix the closet regen button please')
    assert.equal(row?.live, true)
    assert.equal(codexRow([meta, ask], now - 3_600_000, now)?.live, false)
  })
  it('does not show Codex role runs as chats', () => {
    const role = user('You are the engineer. Read the task and the code it touches.')
    assert.equal(codexRow([meta, role], 0, 0), undefined)
    assert.equal(codexRow([meta, user('You are qa. Review the change.')], 0, 0), undefined)
    assert.ok(codexRow([meta, user('Why does this prompt say:\nYou are the engineer. Read the task')], 0, 0))
  })

  it('reads the context fill from the last token count', () => {
    const tokens = (n: number) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: n }, model_context_window: 200_000 } } })
    assert.equal(codexRow([meta, ask, tokens(50_000), tokens(180_000)], 0, 0)?.fill, 0.9)
    assert.equal(codexRow([meta, ask], 0, 0)?.fill, undefined)
  })

  it('names a handed-off Codex chat from its note', () => {
    const cont = JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'Brief\n\nContinue from /h/Armasu/n-c0de.md: read it first' } })
    const read = (p: string) => (p === '/h/Armasu/n-c0de.md' ? '# Handoff 2 · Armasu · continued\nFrom: x (c0de)\nTo:   Armasu · continued · 2\n' : undefined)
    const row = codexRow([meta, cont], 0, 0, read)
    assert.equal(row?.name, 'Armasu · continued · 2')
  })

  it('names a handed-off Codex chat when the note path has a space', () => {
    const cont = JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'Continue from /h/My Proj/n-c0de.md: read it first, then carry on.' } })
    const read = (p: string) => (p === '/h/My Proj/n-c0de.md' ? '# Handoff 2 · My Proj\nTo:   My Proj v2\n' : undefined)
    assert.equal(codexRow([meta, cont], 0, 0, read)?.name, 'My Proj v2')
  })

  it('never names a Codex chat from the Switchboard brief in front of its first message', () => {
    const brief = 'Switchboard brief for Armasu. Ask the hub_ask tool for more.\nDev site: http://localhost:3010'
    const msg = (m: string) => JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: m } })
    assert.equal(codexRow([meta, msg(`${brief}\n\nFix the login bug`)], 0, 0)?.name, 'Fix the login bug')
    assert.equal(codexRow([meta, msg(brief)], 0, 0)?.name, undefined)
  })

  it('reads whether the last Codex turn ended: idle after task_complete or turn_aborted, busy after task_started, unknown without either', () => {
    const ev = (type: string) => JSON.stringify({ type: 'event_msg', payload: { type } })
    assert.equal(codexRow([meta, ask, ev('task_started'), ev('agent_message'), ev('task_complete')], 0, 0)?.status, 'idle')
    assert.equal(codexRow([meta, ask, ev('task_started'), ev('turn_aborted')], 0, 0)?.status, 'idle')
    assert.equal(codexRow([meta, ask, ev('task_complete'), ev('task_started'), ev('agent_message')], 0, 0)?.status, 'busy')
    assert.equal(codexRow([meta, ask, ev('agent_message')], 0, 0)?.status, undefined)
  })

  it('finds the last prompt', () => {
    const later = JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'now the doors' } })
    assert.equal(lastCodexPrompt([meta, ask, later]), 'now the doors')
  })

  it('skips a file without session_meta', () => {
    assert.equal(codexRow([ask], 0, 0), undefined)
  })

  it('starts and resumes each AI with its own CLI', () => {
    assert.equal(AIS.codex.startCommand({ text: "it's" }, 'posix'), `codex 'it'\\''s'`)
    assert.equal(AIS.codex.startCommand({ text: 'it\u2019s' }, 'powershell'), "codex 'it\u2019\u2019s'")
    assert.equal(AIS.codex.resumeCommand('abc'), 'codex resume --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust abc')
    assert.equal(AIS.claude.resumeCommand('abc'), 'claude --resume abc')
    assert.equal(AIS.claude.startCommand({ name: 'x' }, 'posix'), `claude --name 'x'`)
  })
})

it('reads an unchanged rollout once: the same mtime returns the lines it read before', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-')), 'r.jsonl')
  fs.writeFileSync(file, 'one\n')
  assert.deepEqual(await rolloutLines(file, 1), ['one', ''])
  fs.writeFileSync(file, 'two\n')
  assert.deepEqual(await rolloutLines(file, 1), ['one', ''])
  assert.deepEqual(await rolloutLines(file, 2), ['two', ''])
  assert.deepEqual(await rolloutLines(file), ['two', ''])
})

it('wraps a Codex message in one bracketed paste, and refuses one with control characters', () => {
  assert.equal(codexPaste('fix it\n\tthen test'), '\x1b[200~fix it\n\tthen test\x1b[201~')
  assert.equal(codexPaste('a\x1b[201~b'), undefined)
  assert.equal(codexPaste('a\rb'), undefined)
})

it('knows a Codex process from a shell by its command line', () => {
  assert.equal(isCodexCommand('node /opt/homebrew/bin/codex resume abc'), true)
  assert.equal(isCodexCommand('/Users/k/.local/bin/codex'), true)
  assert.equal(isCodexCommand('-zsh'), false)
  assert.equal(isCodexCommand('/bin/zsh -il'), false)
  assert.equal(isCodexCommand("/bin/zsh -c codex resume abc"), false)
  assert.equal(isCodexCommand('bash /opt/homebrew/bin/codex'), false)
  assert.equal(isCodexCommand(''), false)
})

describe('codexReady', () => {
  const term = (pid?: number, exited = false) => ({ processId: Promise.resolve(pid), exitStatus: exited ? { code: 0 } : undefined })
  const ps = (cmd: string) => async () => cmd
  const base = { live: true, startedAt: 0, now: 10_000 }
  it('passes a live chat whose terminal process is codex', async () => {
    assert.equal(await codexReady({ ...base, terminal: term(42) }, ps('node /opt/homebrew/bin/codex')), undefined)
  })
  it('refuses a terminal whose process is not codex, so a shell never gets the text', async () => {
    assert.match((await codexReady({ ...base, terminal: term(42) }, ps('-zsh')))!, /not running Codex/)
  })
  it('refuses a missing or ended terminal, a chat that is not live, and one still starting', async () => {
    assert.ok(await codexReady({ ...base, terminal: undefined }, ps('codex')))
    assert.ok(await codexReady({ ...base, terminal: term(42, true) }, ps('codex')))
    assert.ok(await codexReady({ ...base, terminal: term(undefined) }, ps('codex')))
    assert.ok(await codexReady({ ...base, live: false, terminal: term(42) }, ps('codex')))
    assert.match((await codexReady({ ...base, startedAt: 9_000, terminal: term(42) }, ps('codex')))!, /starting/)
  })
})

describe('closeChatTerminal', () => {
  const term = (pid: number) => { const t = { processId: Promise.resolve(pid), disposed: false, dispose() { t.disposed = true } }; return t }
  const opts = (ppid: number, aliveFor: number) => { let n = 0; return { parent: async () => ppid, alive: () => n++ < aliveFor, waitMs: 50, stepMs: 1 } }

  it('disposes the terminal whose shell started the chat, once the chat has exited', async () => {
    const shell = term(10), other = term(11)
    assert.equal(await closeChatTerminal(99, [other, shell], opts(10, 3)), true)
    assert.equal(shell.disposed, true)
    assert.equal(other.disposed, false)
  })

  it('leaves terminals alone when no shell of theirs started the chat', async () => {
    const t = term(10)
    assert.equal(await closeChatTerminal(99, [t], opts(7, 0)), false)
    assert.equal(t.disposed, false)
  })

  it('leaves the terminal open when the chat never exits', async () => {
    const t = term(10)
    assert.equal(await closeChatTerminal(99, [t], opts(10, Infinity)), false)
    assert.equal(t.disposed, false)
  })
})

describe('chatTerminal', () => {
  it('finds the terminal whose shell started the chat, and none when no shell did', async () => {
    const terms = [{ processId: Promise.resolve(10) }, { processId: Promise.resolve(11) }]
    assert.equal(await chatTerminal(99, terms, async () => 11), terms[1])
    assert.equal(await chatTerminal(99, terms, async () => 7), undefined)
    assert.equal(await chatTerminal(99, terms, async () => 0), undefined)
  })
})

describe('pickCli', () => {
  it('takes which\'s line, and on Windows the runnable one where lists', () => {
    assert.equal(pickCli('/opt/homebrew/bin/gh\n', 'darwin'), '/opt/homebrew/bin/gh')
    assert.equal(pickCli('C:\\npm\\codex\r\nC:\\npm\\codex.cmd\r\n', 'win32'), 'C:\\npm\\codex.cmd')
    assert.equal(pickCli('C:\\Program Files\\GitHub CLI\\gh.exe\r\n', 'win32'), 'C:\\Program Files\\GitHub CLI\\gh.exe')
    assert.equal(pickCli('', 'win32'), undefined)
  })
})

describe('signedIn', () => {
  it('reads codex login status', () => {
    assert.equal(signedIn('codex', 'Logged in using ChatGPT\n'), true)
    assert.equal(signedIn('codex', 'Not logged in\n'), false)
    assert.equal(signedIn('codex', ''), undefined)
  })
  it('reads claude auth status json', () => {
    assert.equal(signedIn('claude', '{"loggedIn": true, "authMethod": "claude.ai"}'), true)
    assert.equal(signedIn('claude', '{"loggedIn": false}'), false)
    assert.equal(signedIn('claude', 'garbage'), undefined)
  })
  it('has a sign in command per AI', () => {
    // One command PowerShell 5.1 runs too; device auth is named in the button's tooltip.
    assert.equal(AIS.codex.loginCommand, 'codex login')
    assert.equal(AIS.claude.loginCommand, 'claude auth login')
  })
})

describe('hermes', () => {
  it('starts with the message seeded and resumes by id', () => {
    assert.equal(AIS.hermes.startCommand({}, 'posix'), 'hermes')
    assert.equal(AIS.hermes.startCommand({ text: "fix it's bug" }, 'posix'), `hermes -q 'fix it'\\''s bug'`)
    assert.equal(AIS.hermes.resumeCommand('abc-123'), 'hermes --resume abc-123')
    assert.equal(AIS.hermes.optional, true)
  })

  it('shares the Claude skills and the ask server with Hermes, once', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-'))
    assert.equal(shareKitWithHermes(home), false)
    fs.mkdirSync(path.join(home, '.claude/skills/foo'), { recursive: true })
    fs.writeFileSync(path.join(home, '.claude/skills/foo/SKILL.md'), '---\nname: foo\n---\n')
    fs.mkdirSync(path.join(home, '.claude/skills/bar'), { recursive: true })
    fs.mkdirSync(path.join(home, '.hermes'))
    fs.writeFileSync(path.join(home, '.hermes/config.yaml'), 'model:\n  default: x\nmcp_servers:\n  other:\n    command: npx\n')
    assert.equal(shareKitWithHermes(home), true)
    assert.ok(fs.existsSync(path.join(home, '.hermes/skills/claude-kit/foo/SKILL.md')))
    assert.ok(!fs.existsSync(path.join(home, '.hermes/skills/claude-kit/bar')))
    const yaml = fs.readFileSync(path.join(home, '.hermes/config.yaml'), 'utf8')
    assert.equal(yaml, `model:\n  default: x\nmcp_servers:\n  switchboard-ask:\n    command: node\n    args: [${JSON.stringify(path.join(home, '.claude/switchboard/ask/ask-server.mjs'))}]\n  other:\n    command: npx\n`)
    shareKitWithHermes(home)
    assert.equal(fs.readFileSync(path.join(home, '.hermes/config.yaml'), 'utf8'), yaml)
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('adds the ask server to a config with no mcp_servers or none at all', () => {
    assert.match(hermesMcp('', '/a.mjs') ?? '', /^mcp_servers:\n {2}switchboard-ask:\n {4}command: node\n {4}args: \["\/a.mjs"\]\n$/)
    assert.equal(hermesMcp('mcp_servers: {}\n', '/a.mjs'), 'mcp_servers:\n  switchboard-ask:\n    command: node\n    args: ["/a.mjs"]\n')
    assert.equal(hermesMcp('x: 1', '/a.mjs'), 'x: 1\nmcp_servers:\n  switchboard-ask:\n    command: node\n    args: ["/a.mjs"]\n')
  })

  it('keeps a 4-space indented mcp_servers at its own indent', () => {
    assert.equal(hermesMcp('mcp_servers:\n    other:\n        command: npx\n', '/a.mjs'), 'mcp_servers:\n    switchboard-ask:\n        command: node\n        args: ["/a.mjs"]\n    other:\n        command: npx\n')
    const done = 'mcp_servers:\n    switchboard-ask:\n        command: node\n'
    assert.equal(hermesMcp(done, '/a.mjs'), done)
  })

  it('refuses a flow map or list it cannot edit safely', () => {
    assert.equal(hermesMcp('mcp_servers: {foo: {command: x}}\n', '/a.mjs'), undefined)
    assert.equal(hermesMcp('mcp_servers: [a]\n', '/a.mjs'), undefined)
    assert.equal(hermesMcp('mcp_servers: &m\n  foo: 1\n', '/a.mjs'), undefined)
  })

  it('backs config.yaml up once before writing, and leaves a refused one alone', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-hermes-bak-'))
    fs.mkdirSync(path.join(home, '.hermes'))
    const cfg = path.join(home, '.hermes/config.yaml')
    fs.writeFileSync(cfg, 'model: x\n')
    shareKitWithHermes(home)
    assert.equal(fs.readFileSync(`${cfg}.switchboard-bak`, 'utf8'), 'model: x\n')
    fs.writeFileSync(cfg, 'mcp_servers: {foo: 1}\n')
    shareKitWithHermes(home)
    assert.equal(fs.readFileSync(cfg, 'utf8'), 'mcp_servers: {foo: 1}\n')
    assert.equal(fs.readFileSync(`${cfg}.switchboard-bak`, 'utf8'), 'model: x\n')
    fs.rmSync(home, { recursive: true, force: true })
  })
})


it('compaction keeps the first and the last session_meta of a forked rollout', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-fork-')), file = path.join(dir, 'r.jsonl')
  const m = (id: string, cwd: string) => JSON.stringify({ type: 'session_meta', payload: { id, cwd } })
  const lines = [m('aaaaaaaa-1', '/a'), m('bbbbbbbb-2', '/b'), JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'Fix it' } })]
  fs.writeFileSync(file, lines.join('\n') + '\n')
  assert.deepEqual(codexRow(await rolloutLines(file, 1), 0, 0), codexRow(lines, 0, 0))
})

it('keeps only copied rollout lines needed by row and turn readers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-compact-'))
  const file = path.join(dir, 'r.jsonl')
  const event = (type: string, extra = {}) => JSON.stringify({ type: 'event_msg', payload: { type, ...extra } })
  const lines = [meta, JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'Fix the doors' } }), JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix the doors' }] } }), ...Array.from({ length: 1000 }, (_, i) => JSON.stringify({ type: 'response_item', payload: { type: 'reasoning', text: `discard-${i}` } })), ask, event('agent_message', { message: 'done' }), event('turn_complete')]
  fs.writeFileSync(file, lines.join('\n') + '\n')
  const kept = await rolloutLines(file, 1)
  assert.ok(kept.length < 10)
  assert.equal(codexRow(kept, 0, 0)?.name, 'Fix the doors')
  assert.equal(codexRow(kept, 0, 0)?.status, 'idle')
  assert.equal(lastCodexPrompt(kept), 'Fix the closet regen button please')
  assert.deepEqual((await import('../src/hub/ais')).lastCodexTurn(kept), { answer: 'done', aborted: false })
})
