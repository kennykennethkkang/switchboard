/** Finished research read from hook payloads: no webview needed. */
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ResearchCapture, captureSaved, looksLikeAnswer, transcriptReply } from '../src/hub/research-capture'
import { listResearch } from '../src/hub/research-library'

const dirs: string[] = []
const dir = (name: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`)); dirs.push(d); return d }
afterEach(() => { dirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })) })

const REPORT = '# Electrolytes\n\n**Answer:** Sulfides lead on conductivity.\n\n## Findings\n- Sulfides react with moisture.\n\n## Sources\n- https://example.com/a\n'

describe('ResearchCapture', () => {
  it('reads a real-shaped Stop for a deep-research skill run', () => {
    const c = new ResearchCapture()
    const sid = 'sess-1'
    c.hook({ session_id: sid, hook_event_name: 'UserPromptSubmit', prompt: 'Which solid electrolyte wins?', cwd: '/p/cell-lab' })
    c.hook({ session_id: sid, hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'deep-research', args: 'Which solid electrolyte wins?' }, cwd: '/p/cell-lab' })
    const done = c.hook({ session_id: sid, hook_event_name: 'Stop', cwd: '/p/cell-lab', last_assistant_message: REPORT, stop_hook_active: false })
    assert.deepEqual(done, { sessionId: sid, question: 'Which solid electrolyte wins?', answer: REPORT, cwd: '/p/cell-lab' })
  })

  it('reads the report from the transcript when the payload has no last message', () => {
    const file = path.join(dir('tx'), 'session.jsonl')
    fs.writeFileSync(file, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'x' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: REPORT }] } }),
    ].join('\n'))
    const c = new ResearchCapture()
    c.hook({ session_id: 's', hook_event_name: 'UserPromptSubmit', prompt: '/deep-research Which electrolyte?', cwd: '/p' })
    const done = c.hook({ session_id: 's', hook_event_name: 'Stop', cwd: '/p', transcript_path: file })
    assert.equal(done?.answer, REPORT.trim())
    assert.equal(done?.question, 'Which electrolyte?')
  })

  it('waits for a Stop that carries a report, and reads a researcher subagent as real', () => {
    const c = new ResearchCapture()
    c.hook({ session_id: 's', hook_event_name: 'UserPromptSubmit', prompt: 'Compare sulfides', cwd: '/p' })
    c.hook({ session_id: 's', hook_event_name: 'SubagentStart', agent_type: 'researcher', agent_id: 'a1', cwd: '/p' })
    assert.equal(c.hook({ session_id: 's', hook_event_name: 'Stop', cwd: '/p', last_assistant_message: 'Still working.' }), undefined)
    const done = c.hook({ session_id: 's', hook_event_name: 'Stop', cwd: '/p', last_assistant_message: REPORT })
    assert.equal(done?.question, 'Compare sulfides')
  })

  it('saves nothing for a coding chat with a web fetch and a Findings reply', () => {
    const c = new ResearchCapture()
    c.hook({ session_id: 'code', hook_event_name: 'UserPromptSubmit', prompt: 'fix the login bug', cwd: '/p' })
    c.hook({ session_id: 'code', hook_event_name: 'PreToolUse', tool_name: 'WebFetch', tool_input: { url: 'https://example.com' }, cwd: '/p' })
    assert.equal(c.hook({ session_id: 'code', hook_event_name: 'Stop', cwd: '/p', last_assistant_message: '## Findings\nThe fix is in auth.ts.' }), undefined)
  })

  it('forgets a session that ends before its report', () => {
    const c = new ResearchCapture()
    c.hook({ session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'deep-research', args: 'q' }, cwd: '/p' })
    c.hook({ session_id: 's', hook_event_name: 'SessionEnd', cwd: '/p' })
    assert.equal(c.hook({ session_id: 's', hook_event_name: 'Stop', cwd: '/p', last_assistant_message: REPORT }), undefined)
  })
})

describe('turns and titles', () => {
  it('saves nothing for a coding turn that follows a research turn', () => {
    const d = new ResearchCapture()
    d.hook({ session_id: 'D', hook_event_name: 'UserPromptSubmit', prompt: '/deep-research best sqlite orm' })
    assert.equal(d.hook({ session_id: 'D', hook_event_name: 'Stop', last_assistant_message: 'Which runtime, node or bun?' }), undefined)
    d.hook({ session_id: 'D', hook_event_name: 'UserPromptSubmit', prompt: 'never mind, fix the failing test in auth.ts' })
    d.hook({ session_id: 'D', hook_event_name: 'PreToolUse', tool_name: 'WebFetch', tool_input: { url: 'https://x' } })
    assert.equal(d.hook({ session_id: 'D', hook_event_name: 'Stop', last_assistant_message: '## Findings\nThe test mocked the clock wrong.' }), undefined)
  })

  it('titles a later research turn with its own prompt, not the first one', () => {
    const k = new ResearchCapture()
    k.hook({ session_id: 'C', hook_event_name: 'UserPromptSubmit', prompt: 'fix the login button colour' })
    k.hook({ session_id: 'C', hook_event_name: 'Stop', last_assistant_message: 'done' })
    k.hook({ session_id: 'C', hook_event_name: 'UserPromptSubmit', prompt: 'now research what OAuth PKCE libraries exist' })
    k.hook({ session_id: 'C', hook_event_name: 'SubagentStart', agent_type: 'researcher' })
    assert.equal(k.hook({ session_id: 'C', hook_event_name: 'Stop', last_assistant_message: REPORT })?.question, 'now research what OAuth PKCE libraries exist')
  })

  it('reads no transcript that is not a regular file', () => {
    assert.equal(transcriptReply(os.tmpdir()), '')
  })
})

describe('research-space turns', () => {
  const space = path.join(os.homedir(), 'Documents', 'Research', 'ai-agents')
  it('saves a Research-space turn that searches the web and ends with an Answer', () => {
    const c = new ResearchCapture()
    c.hook({ session_id: 'R', hook_event_name: 'UserPromptSubmit', prompt: 'how do tides work', cwd: space })
    c.hook({ session_id: 'R', hook_event_name: 'PreToolUse', tool_name: 'WebSearch', tool_input: { query: 'tides' }, cwd: space })
    assert.equal(c.hook({ session_id: 'R', hook_event_name: 'Stop', cwd: space, last_assistant_message: REPORT })?.question, 'how do tides work')
  })

  it('saves a follow-up "go on" turn in the Research space', () => {
    const c = new ResearchCapture()
    c.hook({ session_id: 'G', hook_event_name: 'UserPromptSubmit', prompt: 'how do tides work', cwd: space })
    c.hook({ session_id: 'G', hook_event_name: 'Stop', cwd: space, last_assistant_message: 'Want the lunar part too?' })
    c.hook({ session_id: 'G', hook_event_name: 'UserPromptSubmit', prompt: 'go on', cwd: space })
    c.hook({ session_id: 'G', hook_event_name: 'PreToolUse', tool_name: 'WebFetch', tool_input: { url: 'https://x' }, cwd: space })
    assert.ok(c.hook({ session_id: 'G', hook_event_name: 'Stop', cwd: space, last_assistant_message: REPORT }))
  })

  it('saves nothing for a project-folder turn with the same web search and Answer', () => {
    const c = new ResearchCapture()
    c.hook({ session_id: 'P', hook_event_name: 'UserPromptSubmit', prompt: 'how do tides work', cwd: '/p/app' })
    c.hook({ session_id: 'P', hook_event_name: 'PreToolUse', tool_name: 'WebSearch', tool_input: { query: 'tides' }, cwd: '/p/app' })
    assert.equal(c.hook({ session_id: 'P', hook_event_name: 'Stop', cwd: '/p/app', last_assistant_message: REPORT }), undefined)
  })
})

describe('looksLikeAnswer', () => {
  it('matches the web rule: Answer, Sources or Findings headings', () => {
    assert.equal(looksLikeAnswer(REPORT), true)
    assert.equal(looksLikeAnswer('plain reply'), false)
  })
})

describe('captureSaved', () => {
  it('writes the library file for a project chat outside the window folder, and no memory note', () => {
    const project = path.join(dir('zellizard-tracker'), 'Zellizard-Tracker')
    fs.mkdirSync(project, { recursive: true })
    const root = dir('lib'), home = dir('home')
    const c = new ResearchCapture()
    c.hook({ session_id: 'proj', hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'deep-research', args: 'Which electrolyte?' }, cwd: project })
    const done = c.hook({ session_id: 'proj', hook_event_name: 'Stop', cwd: project, last_assistant_message: REPORT })
    assert.ok(done)
    const { item, created } = captureSaved(done, { root, projects: [project], chat: 'Zellizard chat', now: Date.parse('2026-11-23T10:00:00Z') })
    assert.equal(created, true)
    assert.equal(item?.project, project)
    assert.equal(listResearch(root).length, 1)
    assert.ok(fs.readFileSync(path.join(root, item!.id), 'utf8').includes('Sulfides lead'))
    assert.equal(fs.existsSync(path.join(home, '.claude')), false)
  })

  it('dates the report by the local day, not the UTC one', () => {
    const c = new ResearchCapture()
    c.hook({ session_id: 'late', hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'deep-research', args: 'Late question?' }, cwd: '/tmp' })
    const done = c.hook({ session_id: 'late', hook_event_name: 'Stop', cwd: '/tmp', last_assistant_message: REPORT })
    assert.ok(done)
    const now = new Date(2026, 10, 22, 23, 40).getTime()
    const { item } = captureSaved(done, { root: dir('late'), projects: [], chat: 'c', now })
    assert.match(item!.id, /^general\/2026-11-22-/)
  })

  it('reports created once when two windows capture the same run', () => {
    const root = dir('lib')
    const done = { sessionId: 's', question: 'Q?', answer: REPORT, cwd: '/general' }
    const first = captureSaved(done, { root, projects: [], chat: 'c', now: Date.now() })
    const second = captureSaved(done, { root, projects: [], chat: 'c', now: Date.now() })
    assert.equal(first.created, true)
    assert.equal(second.created, false)
    assert.equal(listResearch(root).length, 1)
  })
})
