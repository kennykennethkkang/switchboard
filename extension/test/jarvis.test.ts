/**
 * Unit tests for the Jarvis box: local answers first, a start proposal for an instruction, the brain for the rest.
 *
 * The invariant: nothing here starts a chat; a start comes back as a proposal for the Confirm tap.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { jarvis, jarvisLocal, jarvisStart } from '../src/hub/jarvis'
import { emptyHub } from '../src/hub/hub-service'
import { commandProblem } from '../src/hub/routes'
import type { ChatProgress, HubState } from '../src/hub/types'

const NOW = new Date(2026, 9, 31, 15).getTime()
const prog = (sessionId: string, state: ChatProgress['state'], extra: Partial<ChatProgress> = {}): ChatProgress =>
  ({ sessionId, cwd: '/w/claude-mods', state, roles: [], tasks: [], startedAt: NOW - 3600e3, at: NOW - 60e3, ...extra })

const hub = (extra: Partial<HubState> = {}): HubState => ({
  ...emptyHub(),
  projects: [{ name: 'Armasu', path: '/w/Armasu', kind: 'repo', isOpen: false }, { name: 'claude-mods', path: '/w/claude-mods', kind: 'repo', isOpen: true }],
  chats: [
    { pid: 1, sessionId: 'a', name: 'Fix login', cwd: '/w/claude-mods', link: '', live: true, why: [] },
    { pid: 2, sessionId: 'b', name: 'Cache layer', cwd: '/w/claude-mods', link: '', live: true, why: [] },
  ],
  installed: [{ kind: 'plugin', name: 'superpowers@superpowers-dev', enabled: true, skills: ['brainstorming'] }, { kind: 'skill', name: 'code-review', enabled: true }],
  ...extra,
})

describe('jarvis local answers', () => {
  it('lists the working chats and the stuck ones', () => {
    const s = hub({ progress: [prog('a', 'working'), prog('b', 'done')], stuck: [{ id: 'x', kind: 'agent', sessionId: 'b', what: 'qa', since: NOW - 600e3 }] })
    const a = jarvisLocal(s, 'what is running?', NOW)!
    assert.match(a, /Fix login/)
    assert.doesNotMatch(a.split('\n')[0], /Cache layer/)
    assert.match(jarvisLocal(s, 'anything stuck', NOW)!, /qa in Cache layer/)
  })

  it('says so when nothing runs', () => {
    assert.equal(jarvisLocal(hub(), 'what is running', NOW), 'No chat is working right now.')
  })

  it('lists the open to-dos by project', () => {
    const s = hub({ todos: { '/w/claude-mods': { todo: [{ id: 't1', text: 'Ship the box', at: 1 }] }, '/w/Armasu': { todo: [] } } })
    assert.equal(jarvisLocal(s, 'open todos?', NOW), '1 open to-do.\nclaude-mods: Ship the box')
    assert.equal(jarvisLocal(hub(), 'show my to-do list', NOW), 'No open to-dos.')
  })

  it('gives the standup from the chats done today', () => {
    const s = hub({ progress: [prog('a', 'done', { report: { done: ['Fixed the cookie'], left: ['Deploy'], you: ['Reload the window'] } }), prog('b', 'done', { at: NOW - 3 * 86400e3 })] })
    const a = jarvisLocal(s, "today's standup", NOW)!
    assert.match(a, /Fix login: Fixed the cookie/)
    assert.match(a, /Left: Deploy/)
    assert.match(a, /For you: Reload the window/)
    assert.doesNotMatch(a, /Cache layer/)
    assert.match(jarvisLocal(s, "what's done", NOW)!, /Fix login/)
  })

  it('leaves other questions to the brain', () => {
    for (const q of ['why is the build slow', 'why is the login not working?', 'is the build working', 'what is the weather today', 'what is left to be done on the cache?', 'how do I mark a to-do done?'])
      assert.equal(jarvisLocal(hub(), q, NOW), undefined, q)
  })

  it('still takes the plain phrasings', () => {
    for (const q of ["what's running", 'which chats are stuck', 'open to-dos', 'standup', 'what got done today', 'show my to-do list'])
      assert.ok(jarvisLocal(hub(), q, NOW), q)
  })

  it('takes the curly apostrophe a phone keyboard types', () => {
    for (const q of ['what\u2019s running?', 'today\u2019s standup', 'what\u2019s done today?'])
      assert.ok(jarvisLocal(hub(), q, NOW), q)
  })
})

describe('jarvis start proposals', () => {
  it('turns "start a chat to" into the open project and the goal', () => {
    assert.deepEqual(jarvisStart(hub(), 'start a chat to fix the login redirect'), { folder: '/w/claude-mods', project: 'claude-mods', goal: 'fix the login redirect' })
  })

  it('takes a project named in the text', () => {
    assert.deepEqual(jarvisStart(hub(), 'Start a new chat in armasu to add a size chart'), { folder: '/w/Armasu', project: 'Armasu', goal: 'add a size chart' })
  })

  it('keeps a run <skill> instruction whole as the goal', () => {
    assert.deepEqual(jarvisStart(hub(), 'run superpowers:brainstorming on the cache in Armasu'), { folder: '/w/Armasu', project: 'Armasu', goal: 'run superpowers:brainstorming on the cache in Armasu' })
  })

  it('ignores questions and an empty goal', () => {
    assert.equal(jarvisStart(hub(), 'what is running'), undefined)
    assert.equal(jarvisStart(hub(), 'start a chat'), undefined)
  })

  it('keeps an unknown "for/on X" in the goal on the open project', () => {
    assert.deepEqual(jarvisStart(hub(), 'start a chat for fixing the login'), { folder: '/w/claude-mods', project: 'claude-mods', goal: 'for fixing the login' })
    assert.equal(jarvisStart(hub(), 'start a chat on the cache bug')?.goal, 'on the cache bug')
    assert.equal(jarvisStart(hub(), 'start a chat for Armasu to add a size chart')?.project, 'Armasu')
  })

  it('matches a multi-word project name in any case', () => {
    const s = hub({ projects: [...hub().projects, { name: 'My App', path: '/w/My App', kind: 'project', isOpen: false }] })
    assert.deepEqual(jarvisStart(s, 'start a chat in my app to add login'), { folder: '/w/My App', project: 'My App', goal: 'add login' })
  })

  it('matches a project name heard without its spaces or hyphens', () => {
    for (const q of ['start a chat in ClaudeMods to fix it', 'start a chat in claude mods to fix it'])
      assert.deepEqual(jarvisStart(hub(), q), { folder: '/w/claude-mods', project: 'claude-mods', goal: 'fix it' }, q)
  })

  it('drops a comma before the goal', () => {
    assert.equal(jarvisStart(hub(), 'start a chat in Armasu, to add a size chart')?.goal, 'add a size chart')
  })

  it('takes a project only right after the start phrase, not from inside the goal', () => {
    const s = hub({ projects: [...hub().projects, { name: 'a', path: '/w/a', kind: 'repo', isOpen: false }, { name: 'web', path: '/w/web', kind: 'repo', isOpen: false }] })
    assert.deepEqual(jarvisStart(s, 'start a chat to work on a bug'), { folder: '/w/claude-mods', project: 'claude-mods', goal: 'work on a bug' })
    assert.deepEqual(jarvisStart(s, 'start a chat to fix login on web'), { folder: '/w/claude-mods', project: 'claude-mods', goal: 'fix login on web' })
    assert.equal(jarvisStart(s, 'start a chat in web to fix login')?.project, 'web')
  })

  it('takes a closing "in X" on a start and drops it from the goal', () => {
    const s = hub({ projects: [{ name: 'Armasu', path: '/w/Armasu', kind: 'repo', isOpen: true }, { name: 'claude-mods', path: '/w/claude-mods', kind: 'repo', isOpen: false }] })
    assert.deepEqual(jarvisStart(s, 'start a chat to fix the tests in claude-mods'), { folder: '/w/claude-mods', project: 'claude-mods', goal: 'fix the tests' })
    assert.deepEqual(jarvisStart(s, 'Start a chat to fix the tests in ClaudeMods.'), { folder: '/w/claude-mods', project: 'claude-mods', goal: 'fix the tests' })
    assert.equal(jarvisStart(s, 'start a chat to fix login on claude-mods')?.project, 'Armasu')
  })

  it('takes a run project right after the skill or as a closing "in X"', () => {
    const s = hub({ projects: [...hub().projects, { name: 'web', path: '/w/web', kind: 'repo', isOpen: false }] })
    assert.equal(jarvisStart(s, 'run code-review on web')?.project, 'web')
    assert.equal(jarvisStart(s, 'run code-review on the diff for web')?.project, 'claude-mods')
    assert.equal(jarvisStart(s, 'run code-review on the diff in web')?.project, 'web')
  })

  it('treats run as a start only for an installed skill', () => {
    assert.equal(jarvisStart(hub(), 'run me through what got done today'), undefined)
    assert.equal(jarvisStart(hub(), 'run code-review on the diff')?.goal, 'run code-review on the diff')
    assert.equal(jarvisStart(hub(), 'run brainstorming on the cache')?.project, 'claude-mods')
  })
})

describe('jarvis', () => {
  const never = () => Promise.reject(new Error('no model call expected'))

  it('answers locally without the brain', async () => {
    const r = await jarvis(hub(), 'open todos', [], never, NOW)
    assert.deepEqual(r, { q: 'open todos', at: NOW, answer: 'No open to-dos.' })
  })

  it('proposes a start and never asks the brain for it', async () => {
    const r = await jarvis(hub(), 'start a chat to write the docs', [], never, NOW)
    assert.deepEqual(r.start, { folder: '/w/claude-mods', project: 'claude-mods', goal: 'write the docs' })
  })

  it('asks the brain with the open project as context', async () => {
    let seen = ''
    const r = await jarvis(hub(), 'why is it slow', [], async (q, ctx) => { seen = ctx; return `brain: ${q}` }, NOW)
    assert.equal(r.answer, 'brain: why is it slow')
    assert.match(seen, /board/)
  })

  it('says when Ask the brain is off instead of calling it', async () => {
    const s = hub()
    s.controls.switchboard.askBrain = false
    const r = await jarvis(s, 'why is it slow', [], never, NOW)
    assert.match(r.answer!, /off/)
  })

  it('asks which project when the named one is not listed', async () => {
    const r = await jarvis(hub(), 'start a chat in Nowhere to fix it', [], never, NOW)
    assert.equal(r.start, undefined)
    assert.match(r.answer!, /which project/i)
  })

  it('asks what the chat should do when there is no goal', async () => {
    for (const q of ['open a chat for Armasu', 'start a chat', 'start a chat in Armasu.', 'start a chat in Armasu, ']) {
      const r = await jarvis(hub(), q, [], never, NOW)
      assert.equal(r.start, undefined, q)
      assert.match(r.answer!, /what should the chat do/i, q)
    }
  })

  it('sends run-me-through questions to the brain, not a start', async () => {
    const r = await jarvis(hub(), 'run me through what got done today', [], async () => 'brain', NOW)
    assert.equal(r.answer, 'brain')
  })

  it('asks for a project when none is open or named', async () => {
    const s = hub({ projects: [{ name: 'Armasu', path: '/w/Armasu', kind: 'repo', isOpen: false }] })
    const r = await jarvis(s, 'start a chat to fix it', [], never, NOW)
    assert.equal(r.start, undefined)
    assert.match(r.answer!, /which project/i)
  })
})

describe('hub-jarvis command', () => {
  it('takes a question and refuses a huge or missing one', () => {
    assert.equal(commandProblem({ type: 'hub-jarvis', q: 'open todos' }), undefined)
    assert.ok(commandProblem({ type: 'hub-jarvis' }))
    assert.ok(commandProblem({ type: 'hub-jarvis', q: 'x'.repeat(2001) }))
  })
})
