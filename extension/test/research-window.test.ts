import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { REOPEN_MS, ResearchTrigger } from '../src/hub/research-window'

const pre = (tool: string, input: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  ({ session_id: 's1', hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, ...extra })

describe('ResearchTrigger', () => {
  it('opens on the deep-research skill, plugin prefix or not', () => {
    assert.equal(new ResearchTrigger().hook(pre('Skill', { skill: 'deep-research' })), 's1')
    assert.equal(new ResearchTrigger().hook(pre('Skill', { skill: 'kit:deep-research' })), 's1')
    assert.equal(new ResearchTrigger().hook(pre('Skill', { skill: 'aar' })), undefined)
  })

  it('opens on a researcher web call, not a file lookup or the main chat searching', () => {
    assert.equal(new ResearchTrigger().hook(pre('WebSearch', { query: 'x' }, { agent_type: 'researcher' })), 's1')
    assert.equal(new ResearchTrigger().hook(pre('Read', { file_path: '/a' }, { agent_type: 'researcher' })), undefined)
    assert.equal(new ResearchTrigger().hook(pre('WebSearch', { query: 'x' })), undefined)
    assert.equal(new ResearchTrigger().hook(pre('WebFetch', { url: 'u' }, { agent_type: 'engineer' })), undefined)
  })

  it('without agent_type, a web call counts while a researcher subagent is live', () => {
    const t = new ResearchTrigger()
    t.hook({ session_id: 's1', hook_event_name: 'SubagentStart', agent_type: 'researcher', agent_id: 'a' })
    assert.equal(t.hook(pre('WebFetch', { url: 'u' })), 's1')
    const u = new ResearchTrigger()
    u.hook({ session_id: 's1', hook_event_name: 'SubagentStart', agent_type: 'researcher', agent_id: 'a' })
    u.hook({ session_id: 's1', hook_event_name: 'SubagentStop', agent_type: 'researcher', agent_id: 'a' })
    assert.equal(u.hook(pre('WebFetch', { url: 'u' })), undefined)
  })

  it('opens once per session, and again only REOPEN_MS after a close', () => {
    const t = new ResearchTrigger()
    const ask = pre('Skill', { skill: 'deep-research' })
    assert.equal(t.hook(ask, 0), 's1')
    assert.equal(t.hook(ask, 1000), undefined)
    t.closed('s1', 2000)
    assert.equal(t.hook(ask, 2000 + REOPEN_MS - 1), undefined)
    assert.equal(t.hook(ask, 2000 + REOPEN_MS), 's1')
    assert.equal(t.hook({ ...ask, session_id: 's2' }, 3000), 's2')
  })
})

describe('ResearchTrigger question and slash command', () => {
  it('opens on /deep-research and takes its text as the question', () => {
    const t = new ResearchTrigger()
    assert.equal(t.hook({ session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: '/deep-research who built X' }), 's1')
    assert.equal(t.question('s1'), 'who built X')
    assert.equal(new ResearchTrigger().hook({ session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: 'research the deep-research skill' }), undefined)
  })

  it('the skill args beat the last prompt; a researcher trigger keeps the prompt', () => {
    const t = new ResearchTrigger()
    t.hook({ session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: 'compare heat pumps' })
    t.hook(pre('Skill', { skill: 'deep-research', args: 'heat pumps at -25 C' }))
    assert.equal(t.question('s1'), 'heat pumps at -25 C')
    const u = new ResearchTrigger()
    u.hook({ session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: 'compare heat pumps' })
    assert.equal(u.hook(pre('WebSearch', { query: 'q' }, { agent_type: 'researcher' })), 's1')
    assert.equal(u.question('s1'), 'compare heat pumps')
  })
})
