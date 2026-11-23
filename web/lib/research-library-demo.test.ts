import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { demoResearch, demoResearchBody } from './hub-demo'

describe('demo research runs', () => {
  it('lists three runs, two in projects and one general', () => {
    const runs = demoResearch(0)
    assert.equal(runs.length, 3)
    assert.equal(runs.filter(r => r.project).length, 2)
    assert.equal(runs.filter(r => !r.project).length, 1)
  })

  it('has a markdown body for every listed run', () => {
    for (const r of demoResearch(0)) assert.match(demoResearchBody(r.id) ?? '', /^## Answer\n/)
  })

  it('answers nothing for an id it does not hold', () => {
    assert.equal(demoResearchBody('general/none.md'), undefined)
  })
})
