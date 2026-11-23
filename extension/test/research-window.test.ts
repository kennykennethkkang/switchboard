import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as path from 'path'
import { REOPEN_MS, ResearchTrigger, SWEEP_GRACE_MS, staleResearch } from '../src/hub/research-window'
import { RESEARCH_ROOT } from '../src/hub/research'

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

  it('opens on any web call from a chat in the research folder', () => {
    const cwd = path.join(RESEARCH_ROOT, 'topic')
    assert.equal(new ResearchTrigger().hook(pre('WebSearch', { query: 'x' }, { cwd })), 's1')
    assert.equal(new ResearchTrigger().hook(pre('WebFetch', { url: 'u' }, { cwd: RESEARCH_ROOT })), 's1')
    assert.equal(new ResearchTrigger().hook(pre('Read', { file_path: '/a' }, { cwd })), undefined)
    assert.equal(new ResearchTrigger().hook(pre('WebSearch', { query: 'x' }, { cwd: '/w/app' })), undefined)
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

describe('staleResearch', () => {
  it('closes tabs whose chat is gone, after the grace period only', () => {
    const now = 10 * SWEEP_GRACE_MS
    const open: [string, number][] = [['gone', 0], ['live', 0], ['young', now - 1000]]
    assert.deepEqual(staleResearch(open, new Set(['live']), now), ['gone'])
  })

  it('keeps a long-open tab through one missed sweep once its chat was seen live lately', () => {
    const now = 10 * SWEEP_GRACE_MS
    assert.deepEqual(staleResearch([['s1', now - 60_000]], new Set(), now), [])
  })
})

describe('ResearchTrigger scope', () => {
  it('opens only for payloads whose cwd is in scope', () => {
    const t = new ResearchTrigger(cwd => cwd === '/r')
    assert.equal(t.hook(pre('Skill', { skill: 'deep-research' }, { cwd: '/proj' })), undefined)
    assert.equal(t.hook(pre('Skill', { skill: 'deep-research' }, { cwd: '/r' })), 's1')
  })
})
