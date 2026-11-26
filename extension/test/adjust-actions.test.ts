import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseActions, splitActions } from '../src/hub/adjust-actions'
import type { ReportAction } from '../src/hub/types'

describe('parseActions', () => {
  it('reads several Actions sections, list styles, areas, asks, cites and undo text', () => {
    const actions = parseActions(`# Actions
 - [mac] **Set display scale:** Set the scale. [1] [3]
 * [other, ask] **Review setting**: Ask before changing it.
   Undo: none, asked first.
 1. [project] **Update repo**: Change the project files. [2]

# Other
- [dev] **Ignored**: outside the section

## Actions
- [kit ask] **Update kit**: Change the shared kit.`)
    assert.deepEqual(actions, [
      { key: 'set-display-scale', area: 'mac', ask: false, title: 'Set display scale', detail: 'Set the scale.', undo: undefined, cites: [1, 3] },
      { key: 'review-setting', area: 'other', ask: true, title: 'Review setting', detail: 'Ask before changing it.', undo: 'none, asked first.', cites: [] },
      { key: 'update-repo', area: 'project', ask: false, title: 'Update repo', detail: 'Change the project files.', undo: undefined, cites: [2] },
      { key: 'update-kit', area: 'kit', ask: true, title: 'Update kit', detail: 'Change the shared kit.', undo: undefined, cites: [] },
    ])
  })

  it('ignores fenced examples, unknown areas, duplicate keys and actions beyond the cap', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `- [dev] **Action ${i}**: Do ${i}.`).join('\n')
    const actions = parseActions(`## Actions\n\`\`\`md\n- [mac] **Fake**: ignored\n\`\`\`\n- [unknown] **Lost**: ignored\n- [dev] **Same!**: first\n- [dev] **Same!**: second\n${lines}`)
    assert.equal(actions.length, 36)
    assert.equal(actions[0].detail, 'first')
    assert.ok(!actions.some(a => a.title === 'Fake' || a.title === 'Lost'))
  })

  it('reads a follow-up filed under its own Added heading, headings demoted', () => {
    const actions = parseActions('## Actions\n- [mac] **One**: a. [1]\n\n## Added 2026-11-25: more?\n\n#### Findings\nx\n\n#### Actions\n- [dev] **Two**: b. [7]\n\n#### Sources\n- [dev] **Three**: no')
    assert.deepEqual(actions.map(a => a.key), ['one', 'two'])
  })

  it('exports the project split without changing action objects', () => {
    const actions = parseActions('## Actions\n- [project] **Repo**: edit\n- [mac] **Device**: edit')
    const split = splitActions(actions)
    assert.deepEqual(split.project.map(a => a.title), ['Repo'])
    assert.deepEqual(split.workbench.map(a => a.title), ['Device'])
  })
})
