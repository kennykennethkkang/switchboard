import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { codexUsable, jevRole, keywordRole, pickAi } from '../src/hub/picker'

describe('keywordRole', () => {
  it('sends code jobs to engineer and everything else to its own role', () => {
    assert.equal(keywordRole('fix the failing test in hub-service'), 'engineer')
    assert.equal(keywordRole('refactor the todo parser'), 'engineer')
    assert.equal(keywordRole('review the diff for bugs'), 'qa')
    assert.equal(keywordRole('make the new chat dialog look better, tweak the layout'), 'designer')
    assert.equal(keywordRole('write the launch post copy'), 'growth')
    assert.equal(keywordRole('find out how the request queue works'), 'researcher')
    assert.equal(keywordRole('deploy the build and rotate the key'), 'ops')
    assert.equal(keywordRole('hello'), 'unknown')
  })
  it('UI words beat code words', () => {
    assert.equal(keywordRole('fix the button styling'), 'designer')
  })
})

describe('pickAi', () => {
  it('picks Codex for code roles when it is ready', () => {
    const p = pickAi({ text: 'implement retry in the fetcher', codexReady: true })
    assert.equal(p.ai, 'codex')
    assert.match(p.reason, /code/)
  })
  it('falls back to Claude when Codex is not ready', () => {
    const p = pickAi({ text: 'implement retry in the fetcher', codexReady: false })
    assert.equal(p.ai, 'claude')
    assert.match(p.reason, /Codex is signed out or out of usage/)
  })
  it('keeps Claude for design, writing, research and plugin work', () => {
    for (const t of ['redesign the settings screen', 'write the release copy', 'research how Codex hooks work', 'use the mods to add a skill'])
      assert.equal(pickAi({ text: t, codexReady: true }).ai, 'claude', t)
  })
  it('a Jev label wins over the keywords', () => {
    assert.equal(pickAi({ text: 'hello', codexReady: true, label: 'qa' }).ai, 'codex')
    assert.equal(pickAi({ text: 'fix the test', codexReady: true, label: 'designer' }).ai, 'claude')
  })
  it('empty text goes to Claude', () => {
    assert.equal(pickAi({ text: '  ', codexReady: true }).ai, 'claude')
  })
})

describe('jevRole', () => {
  const run = (out: string | undefined) => async () => out
  it('reads the role when it is sure enough', async () => {
    assert.equal(await jevRole('x', '/p.json', run('{"_id":"0","role":"engineer","role_conf":0.93}\n')), 'engineer')
  })
  it('is undefined when unsure, failed or garbled', async () => {
    assert.equal(await jevRole('x', '/p.json', run('{"_id":"0","role":"engineer","role_conf":0.4}')), undefined)
    assert.equal(await jevRole('x', '/p.json', run(undefined)), undefined)
    assert.equal(await jevRole('x', '/p.json', run('nope')), undefined)
  })
  it('gives up at the timeout', async () => {
    const slow = () => new Promise<string>(r => setTimeout(() => r('{"role":"engineer","role_conf":0.9}'), 200))
    assert.equal(await jevRole('x', '/p.json', slow, 20), undefined)
  })
})

describe('codexUsable', () => {
  it('needs Codex installed and not signed out', () => {
    const c = (o: object) => [{ id: 'codex', name: 'Codex', chats: 0, installed: true, ...o }] as never
    assert.equal(codexUsable(c({})), true)
    assert.equal(codexUsable(c({ signedIn: false })), false)
    assert.equal(codexUsable(c({ installed: false })), false)
    assert.equal(codexUsable([]), false)
  })
})
