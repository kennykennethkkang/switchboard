import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { HubService } from '../src/hub/hub-service'
import { handleHub } from '../src/hub/routes'

// hub-new-chat and hub-todo-run carry the run's own picks: model, effort, ultracode, auto, research.
describe('run fields on hub-new-chat and hub-todo-run', () => {
  const setup = () => {
    const h = new HubService()
    const seen: Array<Record<string, unknown>> = []
    h.runner = c => { seen.push(c as Record<string, unknown>); return true }
    const post = (c: unknown) => handleHub(h, 'POST', `/hub/command?token=${h.token}`, JSON.stringify(c)) as { status: number; body: string }
    return { seen, post }
  }
  const chat = { type: 'hub-new-chat', path: '/a', remote: false }
  const run = { type: 'hub-todo-run', path: '/a', ids: ['x'] }

  it('passes valid picks through to the runner unchanged', () => {
    const { seen, post } = setup()
    const picks = { model: 'opus[1m]', effort: 'xhigh', ultracode: true, auto: false, research: true }
    assert.equal(post({ ...chat, ...picks }).status, 204)
    assert.equal(post({ ...run, ...picks }).status, 204)
    assert.deepEqual(seen.map(c => ({ model: c.model, effort: c.effort, ultracode: c.ultracode, auto: c.auto, research: c.research })), [picks, picks])
  })

  it('stays optional: a command with none still starts', () => {
    const { post } = setup()
    assert.equal(post(chat).status, 204)
    assert.equal(post(run).status, 204)
  })

  it('refuses a model that cannot be a model, an effort off the list and a wrong type', () => {
    const { seen, post } = setup()
    for (const c of [chat, run]) {
      assert.equal(post({ ...c, model: 'opus; ls' }).status, 400)
      assert.equal(post({ ...c, model: '' }).status, 400)
      assert.equal(post({ ...c, model: 7 }).status, 400)
      assert.equal(post({ ...c, effort: 'ultracode' }).status, 400)
      assert.equal(post({ ...c, effort: 'High' }).status, 400)
      assert.equal(post({ ...c, ultracode: 'yes' }).status, 400)
      assert.equal(post({ ...c, auto: 1 }).status, 400)
      assert.equal(post({ ...c, research: 'true' }).status, 400)
    }
    assert.deepEqual(seen, [])
    assert.match(post({ ...chat, effort: 'huge' }).body, /effort/)
  })
})
