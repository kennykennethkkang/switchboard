import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { summaryView } from './summary'

describe('summaryView', () => {
  it('asks once when there is nothing yet and shows loading', () => assert.deepEqual(summaryView(undefined), { kind: 'busy', ask: true }))
  it('waits while busy', () => assert.deepEqual(summaryView({ busy: true }), { kind: 'busy', ask: false }))
  it('keeps the old text while a refresh runs', () => assert.deepEqual(summaryView({ busy: true, text: 'Old.' }), { kind: 'done', text: 'Old.', refreshing: true, ask: false }))
  it('shows the error and asks again on the next open', () => assert.deepEqual(summaryView({ error: 'Summary failed: x' }), { kind: 'error', text: 'Summary failed: x', ask: true }))
  it('shows a cached summary without asking', () => assert.deepEqual(summaryView({ text: 'Done.', at: 1 }), { kind: 'done', text: 'Done.', ask: false }))
})
