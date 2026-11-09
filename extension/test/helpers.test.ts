import { test } from 'node:test'
import assert from 'node:assert/strict'
import { helperCall, step } from '../src/hub/progress'

const ev = (hook_event_name: string, extra: Record<string, unknown> = {}, session_id = 'abc') => ({ session_id, cwd: '/r', hook_event_name, ...extra })
const run = (events: Record<string, unknown>[]) => events.reduce((p, e, i) => step(p, e, 1000 + i), undefined as ReturnType<typeof step>)
const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } })

test('helperCall: jev.py with a model verb, any path; other verbs and tools are not jev', () => {
  assert.deepEqual(helperCall('Bash', { command: 'python3 ~/.claude/skills/claude-x-jev/scripts/jev.py ask --preset web-route < items.jsonl' }), { ai: 'jev', label: 'ask web-route' })
  assert.deepEqual(helperCall('Bash', { command: 'cd /x && python3 /opt/jev.py classify --labels a,b' }), { ai: 'jev', label: 'classify' })
  assert.equal(helperCall('Bash', { command: 'python3 jev.py setup' }), undefined)
  assert.equal(helperCall('Bash', { command: 'cat jev.py' }), undefined)
  assert.equal(helperCall('Read', { file_path: 'jev.py' }), undefined)
})

test('helperCall: jev.py only at a command position; mentions and quoted --preset do not count', () => {
  assert.equal(helperCall('Bash', { command: 'grep -n "jev.py ask" README.md' }), undefined)
  assert.equal(helperCall('Bash', { command: 'echo "python3 jev.py score it"' }), undefined)
  assert.deepEqual(helperCall('Bash', { command: 'python3 jev.py ask "use --preset fake in the prompt"' }), { ai: 'jev', label: 'ask' })
  assert.deepEqual(helperCall('Bash', { command: "python3 jev.py ask --preset 'web-route' < x" }), { ai: 'jev', label: 'ask web-route' })
  assert.deepEqual(helperCall('Bash', { command: 'ls; ./jev.py gate' }), { ai: 'jev', label: 'gate' })
  assert.deepEqual(helperCall('Bash', { command: 'cat x | python "/a b/jev.py" check' }), { ai: 'jev', label: 'check' })
  assert.deepEqual(helperCall('Bash', { command: 'true || jev.py verify --preset=p1' }), { ai: 'jev', label: 'verify p1' })
})

test('helperCall: perplexity and gemini tools, the gemini script, codex subagents', () => {
  assert.deepEqual(helperCall('mcp__perplexity__perplexity_search', { query: 'secret plans' }), { ai: 'perplexity', label: 'perplexity_search' })
  assert.deepEqual(helperCall('perplexity_ask', {}), { ai: 'perplexity', label: 'ask' })
  assert.deepEqual(helperCall('mcp__gemini__generate', {}), { ai: 'gemini', label: 'generate' })
  assert.deepEqual(helperCall('Bash', { command: `zsh -ic 'python3 ~/.claude/skills/gemini/gemini.py "$@"' _ image "a lighthouse"` }), { ai: 'gemini', label: 'image' })
  assert.deepEqual(helperCall('Agent', { subagent_type: 'kit:engineer-codex', description: 'Fix the parser' }), { ai: 'codex', role: 'engineer-codex', label: 'Fix the parser' })
  assert.equal(helperCall('Agent', { subagent_type: 'engineer', description: 'x' }), undefined)
})

test('a Claude lead\'s jev call is a jev helper on that chat: working, then done, counted', () => {
  const p = run([ev('SessionStart'), ev('PreToolUse', bash('python3 jev.py score --preset p')), ev('PostToolUse', bash('python3 jev.py score --preset p')), ev('PreToolUse', bash('python3 jev.py gate'))])
  assert.deepEqual(p?.helpers, [{ ai: 'jev', label: 'gate', state: 'working', since: 1003, last: 1003, count: 2 }])
  const q = step(p, ev('PostToolUseFailure', bash('python3 jev.py gate')), 2000)
  assert.equal(q?.helpers?.[0].state, 'done')
})

test('codex subagent: helper with its role desk, done on its SubagentStop', () => {
  const p = run([
    ev('SessionStart'),
    ev('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'qa-codex', description: 'Review diff' } }),
    ev('SubagentStart', { agent_type: 'qa-codex', agent_id: 'q1' }),
  ])
  assert.deepEqual(p?.helpers, [{ ai: 'codex', role: 'qa-codex', label: 'Review diff', state: 'working', since: 1001, last: 1001, count: 1 }])
  const q = step(p, ev('SubagentStop', { agent_type: 'qa-codex', agent_id: 'q1' }), 1500)
  assert.deepEqual([q?.helpers?.[0].state, q?.helpers?.[0].last], ['done', 1500])
})

test('a Codex chat\'s perplexity call stems from that Codex chat, not a Claude one', () => {
  const p = run([ev('SessionStart', {}, 'cx'), ev('PreToolUse', { tool_name: 'mcp__perplexity__search', tool_input: { query: 'q' } }, 'cx')])
  assert.equal(p?.sessionId, 'cx')
  assert.deepEqual(p?.helpers?.map(h => [h.ai, h.label, h.state]), [['perplexity', 'search', 'working']])
})

test('a subagent\'s helper call counts for its chat too', () => {
  const p = run([ev('SessionStart'), ev('PreToolUse', { ...bash('python3 jev.py verify'), agent_id: 'e1', agent_type: 'engineer' })])
  assert.equal(p?.helpers?.[0].ai, 'jev')
})

test('a helper still working when the chat settles goes idle', () => {
  const p = run([ev('SessionStart'), ev('PreToolUse', bash('python3 jev.py ask')), ev('Stop', { last_assistant_message: 'ok' })])
  assert.equal(p?.helpers?.[0].state, 'idle')
})

test('helperCall: claude -p from a shell is a Claude helper, with its --agent role', () => {
  assert.deepEqual(helperCall('Bash', { command: 'claude -p --agent qa "review the diff"' }), { ai: 'claude', role: 'qa', label: 'qa' })
  assert.deepEqual(helperCall('Bash', { command: 'cd /r && claude --print "fix it" --agent=engineer' }), { ai: 'claude', role: 'engineer', label: 'engineer' })
  assert.deepEqual(helperCall('Bash', { command: '/opt/homebrew/bin/claude -p "summarize"' }), { ai: 'claude', label: 'claude -p' })
  assert.equal(helperCall('Bash', { command: 'claude mcp list' }), undefined)
  assert.equal(helperCall('Bash', { command: 'grep -n "claude -p" README.md' }), undefined)
  assert.equal(helperCall('Bash', { command: 'echo claude -p x' }), undefined)
})

test('a Codex lead running claude -p --agent qa gets a Claude helper on qa, done when the shell returns', () => {
  const cmd = bash('claude -p --agent qa "check it"')
  const p = run([ev('SessionStart', {}, 'cx'), ev('PreToolUse', cmd, 'cx')])
  assert.deepEqual(p?.helpers, [{ ai: 'claude', role: 'qa', label: 'qa', state: 'working', since: 1001, last: 1001, count: 1 }])
  assert.equal(step(p, ev('PostToolUse', cmd, 'cx'), 2000)?.helpers?.[0].state, 'done')
})
