import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { commandProblem } from '../src/hub/routes'

describe('hub-live-dismiss validation', () => {
  it('takes run and sim ids only', () => {
    assert.equal(commandProblem({ type: 'hub-live-dismiss', kind: 'crowd', id: '1700000000-123' }), undefined)
    assert.equal(commandProblem({ type: 'hub-live-dismiss', kind: 'mirofish', id: 'sim_abc-1' }), undefined)
    for (const id of ['../x', 'a b', 'a\nb', '', 'x'.repeat(81)]) assert.ok(commandProblem({ type: 'hub-live-dismiss', kind: 'crowd', id }), id)
  })
})
