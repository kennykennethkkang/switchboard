/** The Jev card: a project's jobs, newest runs and cost, and what Set up Jev types into its chat. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { jevView, setupPrompt } from './jev'
import { demoHub } from './hub-demo'

test('names every job with on or off, and the newest runs with their result and cost', () => {
  const v = jevView({ project: 'demo', jobs: { done: true, gate: true, tells: false, route: false }, costUsd: 0.00062,
    runs: [{ job: 'gate', at: 10, items: 1, costUsd: 0.00002, result: 'ask' }, { job: 'done', at: 5, items: 3, costUsd: 0.0002 }] }, 70_000)
  assert.deepEqual(v.jobs.map(j => `${j.label}:${j.on}`), ['Done-check:true', 'Risky commands:true', 'AI-tell check:false', 'Roles:false'])
  assert.deepEqual(v.runs, ['gate · ask · 1 min ago', 'done · 3 items · 1 min ago'])
  assert.equal(v.cost, '$0.0006')
  assert.equal(v.anyOn, true)
})

test('no Jev for the project yet shows every job off', () => {
  const v = jevView(undefined, 0)
  assert.equal(v.anyOn, false)
  assert.deepEqual(v.runs, [])
})

test('the Set up Jev chat names the task and the folder', () => {
  assert.match(setupPrompt('/x/demo'), /\/jev-setup-project/)
  assert.match(setupPrompt('/x/demo'), /\/x\/demo/)
})

test('the demo shows a project with Jev on and a few runs', () => {
  const v = jevView(demoHub(0).jevProjects?.['/Users/k/GitHub/Armasu'], 0)
  assert.equal(v.anyOn, true)
  assert.equal(v.runs.length, 4)
})
