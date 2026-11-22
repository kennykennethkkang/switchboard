import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chatStory, groupMessages, parseReport } from './chat-story'
import type { ChatOutputs } from './chat-view'

const empty: ChatOutputs = { questions: [], reports: [], tests: [], errors: [], files: [], shots: [] }

test('parseReport splits status and sections, lists keep their items', () => {
  const r = parseReport('Status: done\nChanged:\n- a.ts: one\n- b.ts: two\nChecked:\n- pnpm test, 538 passed\nFound: nothing blocking.')
  assert.equal(r.status, 'done')
  assert.equal(r.tone, 'ok')
  assert.deepEqual(r.sections.map(s => s.label), ['Changed', 'Checked', 'Found'])
  assert.deepEqual(r.sections[0].items, ['a.ts: one', 'b.ts: two'])
  assert.deepEqual(r.sections[2].items, ['nothing blocking.'])
})

test('parseReport tones and plain text', () => {
  assert.equal(parseReport('Status: done with concerns').tone, 'warn')
  assert.equal(parseReport('Status: blocked\nOpen:\n- need a key').tone, 'bad')
  const p = parseReport('Just some words\nmore words')
  assert.equal(p.status, undefined)
  assert.deepEqual(p.sections, [{ label: 'Notes', items: ['Just some words', 'more words'] }])
})

test('chatStory writes the headline and the needs-you line', () => {
  const s = chatStory({
    ...empty,
    reports: [1, 2, 3].map(i => ({ id: `r${i}`, label: 'x', text: 'Status: done' })),
    tests: [{ command: 'a', ok: true, total: 5 }, { command: 'a', ok: false, failed: 1, total: 5, first: 'auth redirect' }],
    files: ['a', 'b', 'c'],
    questions: [{ question: 'q', answer: 'yes' }],
  })
  assert.equal(s.headline, '3 agents reported. Tests: 1 of 2 runs failing (auth redirect). 3 files changed. 1 question answered.')
  assert.equal(s.tests.tone, 'bad')
  assert.deepEqual(s.needs, ['Tests are failing: auth redirect'])
})

test('chatStory flags errors and unanswered questions, quiet when clean', () => {
  const s = chatStory({ ...empty, errors: [{ tool: 'Bash', text: 'x' }], questions: [{ question: 'q' }, { question: 'r', answer: 'a' }] })
  assert.equal(s.headline, '2 questions, 1 still open.')
  assert.equal(s.needs.length, 2)
  assert.match(s.needs[0], /1 error/)
  assert.equal(s.needs[1], '1 question still open')
  assert.equal(chatStory({ ...empty, questions: [{ question: 'q' }] }).headline, '1 question still open.')
  const ok = chatStory({ ...empty, tests: [{ command: 'a', ok: true }], files: ['a'] })
  assert.deepEqual(ok.needs, [])
  assert.equal(ok.headline, 'Tests: all 1 run passing. 1 file changed.')
  assert.equal(chatStory(empty).headline, 'Nothing recorded yet.')
})

test('parseReport reads the leading status word', () => {
  assert.equal(parseReport('Status: done, no failures').tone, 'ok')
  assert.equal(parseReport('Status: done; error paths covered').tone, 'ok')
  assert.equal(parseReport('Status: Done with concerns, one flaky test').tone, 'warn')
  assert.equal(parseReport('Status: blocked on the API key').tone, 'bad')
  assert.equal(parseReport('Status: failed').tone, 'bad')
  assert.equal(parseReport('Status: blocked on the API key').status, 'blocked on the API key')
})

test('chatStory names the latest failing run and reads a final-only chat', () => {
  const s = chatStory({ ...empty, tests: [{ command: 'a', ok: false, first: 'OLD' }, { command: 'a', ok: false, first: 'NEW' }] })
  assert.deepEqual(s.needs, ['Tests are failing: NEW'])
  assert.equal(s.tests.first, 'NEW')
  assert.equal(chatStory({ ...empty, final: 'All done.' }).headline, 'Final message below.')
  assert.equal(chatStory({ ...empty, final: 'Still working on it' }).headline, 'Nothing recorded yet.')
})

test('groupMessages folds runs of tool lines into one row', () => {
  const g = groupMessages([
    { role: 'you', text: 'a' }, { role: 'tool', text: 'x' }, { role: 'tool', text: 'y' }, { role: 'claude', text: 'b' }, { role: 'tool', text: 'z' },
  ])
  assert.deepEqual(g.map(x => ('tools' in x ? x.tools.length : x.role)), ['you', 2, 'claude', 1])
})
