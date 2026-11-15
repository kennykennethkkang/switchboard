import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cliArgs, discuss, otherAi, turnPrompt, summaryOf, failureText, type Ai } from '../src/hub/discuss'

type Call = { ai: Ai; prompt: string; cwd: string }
const fake = (replies: string[]) => {
  const calls: Call[] = []
  const spawn = async (ai: Ai, prompt: string, cwd: string) => { calls.push({ ai, prompt, cwd }); return replies[calls.length - 1] ?? 'more' }
  return { calls, spawn }
}

describe('discuss', () => {
  it('picks the other AI by default', () => {
    assert.equal(otherAi('claude'), 'codex')
    assert.equal(otherAi('codex'), 'claude')
  })

  it('one round asks the other AI once, in the chat cwd, and reads its Agreed/Disagreed lines', async () => {
    const { calls, spawn } = fake(['Use a map.\nAgreed on: a map is fine\nDisagreed on: the name'])
    const r = await discuss({ question: 'Map or array?', from: 'claude', cwd: '/p', context: 'hot path' }, spawn)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].ai, 'codex')
    assert.equal(calls[0].cwd, '/p')
    assert.match(calls[0].prompt, /Map or array\?/)
    assert.match(calls[0].prompt, /hot path/)
    assert.match(r.text, /codex/)
    assert.match(r.text, /Agreed on: a map is fine/)
    assert.match(r.text, /Disagreed on: the name/)
    assert.equal(r.turns.length, 1)
  })

  it('rounds above one feed each reply back to the other side', async () => {
    const { calls, spawn } = fake(['codex one', 'claude reply', 'codex two\nAgreed on: x\nDisagreed on: none'])
    const r = await discuss({ question: 'Q', from: 'claude', cwd: '/p', rounds: 2 }, spawn)
    assert.deepEqual(calls.map(c => c.ai), ['codex', 'claude', 'codex'])
    assert.match(calls[1].prompt, /codex one/)
    assert.match(calls[2].prompt, /claude reply/)
    assert.equal(r.turns.length, 3)
  })

  it('clamps rounds to 1 to 3 and honors with', async () => {
    const a = fake([])
    await discuss({ question: 'Q', from: 'claude', cwd: '/p', rounds: 9 }, a.spawn)
    assert.equal(a.calls.length, 5)
    const b = fake([])
    await discuss({ question: 'Q', from: 'claude', with: 'claude', cwd: '/p', rounds: 0 }, b.spawn)
    assert.deepEqual(b.calls.map(c => c.ai), ['claude'])
  })

  it('a missing summary says so; a failing CLI becomes a clear error', async () => {
    assert.equal(summaryOf('no lines here'), 'Agreed on: not stated\nDisagreed on: not stated')
    const r = await discuss({ question: 'Q', from: 'claude', cwd: '/p' }, async () => { throw new Error('boom') })
    assert.match(r.error ?? '', /codex/)
  })

  it('names secrets by name only in the prompt', () => {
    assert.match(turnPrompt('codex', 'Q', [], true), /\.env/)
  })

  it('classifies signed out, usage limit and timeout', () => {
    assert.match(failureText('codex', 'Error: not logged in, run codex login'), /codex login/)
    assert.match(failureText('claude', 'Please run /login'), /claude/)
    assert.match(failureText('codex', 'You hit your usage limit'), /usage limit/)
    assert.match(failureText('claude', 'x', true), /timed out/)
  })
})

describe('discuss cli argv', () => {
  it('runs Codex in the read-only sandbox, never bypassing it', () => {
    const [cmd, args] = cliArgs('codex')
    assert.equal(cmd, 'codex')
    assert.deepEqual(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2), ['--sandbox', 'read-only'])
    assert.ok(!args.some(a => a.includes('dangerously')))
  })
  it('gives Claude read tools only', () => {
    const [, args] = cliArgs('claude')
    assert.equal(args[args.indexOf('--tools') + 1], 'Read,Grep,Glob')
  })
})
