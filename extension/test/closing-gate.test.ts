/** closingGate: the Approve question waits for the aar. */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { CLOSING_DENY, closingGate } from '../src/hub/approve'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'closing-gate-'))
after(() => fs.rmSync(dir, { recursive: true, force: true }))

const prompt = (text: string) => ({ type: 'user', message: { content: text } })
const result = () => ({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } })
const say = (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
const use = (name: string, input: unknown) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })
const STANDUP = '**Done**\n- the fix\n\n**For you**\n- reload\n\n**Left**\n- none\n\n**Risks**\n- none'
const edit = use('Edit', { file_path: '/p/a.ts' })

let n = 0
const gate = (entries: unknown[], question = 'Approve this chat as finished?', options = ['Approve', 'Send back']) => {
  const file = path.join(dir, `t${n++}.jsonl`)
  fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n')
  return closingGate({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', transcript_path: file, tool_input: { questions: [{ question, options: options.map(label => ({ label })) }] } })
}

describe('closingGate', () => {
  it('denies with no standup and no aar', () => {
    assert.equal(gate([prompt('fix it'), edit, result(), say('Fixed.')]), CLOSING_DENY)
  })
  it('denies a standup without the aar', () => {
    assert.equal(gate([prompt('fix it'), edit, result(), say(STANDUP)]), CLOSING_DENY)
  })
  it('allows the aar when the standup text is missing from the transcript', () => {
    assert.equal(gate([prompt('fix it'), edit, result(), use('Skill', { skill: 'aar' }), result()]), undefined)
  })
  it('allows the aar skill plus the standup', () => {
    assert.equal(gate([prompt('fix it'), edit, result(), use('Skill', { skill: 'aar' }), result(), say(STANDUP)]), undefined)
  })
  it('allows a Read of aar/SKILL.md', () => {
    assert.equal(gate([prompt('fix it'), edit, result(), use('Read', { file_path: '/k/kit/skills/aar/SKILL.md' }), result(), say(STANDUP)]), undefined)
  })
  it('allows a write to the wiki aar page', () => {
    assert.equal(gate([prompt('fix it'), edit, result(), use('Edit', { file_path: '/v/wiki/aar-switchboard.md' }), result(), say(STANDUP)]), undefined)
  })
  it('counts only what came after the last typed prompt', () => {
    const old = [prompt('fix it'), edit, result(), use('Skill', { skill: 'aar' }), result(), say(STANDUP)]
    assert.equal(gate([...old, prompt('one more thing'), say('Done.')]), CLOSING_DENY)
  })
  it('does not treat tool results or task notices as a prompt', () => {
    assert.equal(gate([prompt('fix it'), edit, use('Skill', { skill: 'aar' }), result(), { type: 'user', message: { content: '<task-notification>qa done</task-notification>' } }, say(STANDUP)]), undefined)
  })
  it('does not treat a mod nudge as a prompt', () => {
    const nudge = { type: 'user', origin: { kind: 'plugin', name: 'usage-meter', asUser: true }, message: { content: 'Subagent qa (a1) has been quiet 134 min' } }
    assert.equal(gate([prompt('fix it'), edit, use('Skill', { skill: 'aar' }), result(), say(STANDUP), nudge]), undefined)
    assert.equal(gate([{ ...prompt('fix it'), origin: { kind: 'human' } }, edit, result(), say('Fixed.')]), CLOSING_DENY)
  })
  it('lets it through when the turn started before the tail', () => {
    assert.equal(gate([edit, result(), say('Fixed.')]), undefined)
  })
  it('skips a chat that changed no files', () => {
    assert.equal(gate([prompt('close it'), say('Closing.')]), undefined)
  })
  it('ignores other questions', () => {
    assert.equal(gate([prompt('fix it'), edit, result(), say('Fixed.')], 'Approve this design?'), undefined)
    assert.equal(gate([prompt('fix it'), edit, result(), say('Fixed.')], 'Approve this chat as finished?', ['Yes', 'No']), undefined)
  })
  it('lets it through with no readable transcript', () => {
    assert.equal(closingGate({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', transcript_path: path.join(dir, 'none.jsonl'), tool_input: { questions: [{ question: 'Approve this chat as finished?', options: [{ label: 'Approve' }, { label: 'Send back' }] }] } }), undefined)
  })
})
