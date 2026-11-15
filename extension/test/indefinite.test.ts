import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { codexRound } from '../src/hub/indefinite'
import { lastCodexTurn } from '../src/hub/ais'

const chat = (o: object = {}) => ({ pid: 0, sessionId: 'c1', cwd: '/x', link: '', live: true, why: [], ai: 'codex' as const, status: 'idle', updatedAt: 2000, ...o }) as never
const prog = (state: string) => ({ sessionId: 'c1', state }) as never

describe('codexRound', () => {
  it('sends another round once per ended turn', () => {
    const once = new Map<string, number>()
    assert.equal(codexRound(chat(), undefined, { on: 1000 }, once), 'send')
    once.set('c1', 2000)
    assert.equal(codexRound(chat(), undefined, { on: 1000 }, once), undefined)
    assert.equal(codexRound(chat({ updatedAt: 3000 }), undefined, { on: 1000 }, once), 'send')
  })
  it('stops when the answer ends with the done line', () => {
    assert.equal(codexRound(chat(), undefined, { on: 1000, answer: 'All clear.\nRun indefinitely: done' }, new Map()), 'done')
    assert.equal(codexRound(chat(), undefined, { on: 1000, answer: 'not Run indefinitely: done yet' }, new Map()), 'send')
  })
  it('leaves working, asking, interrupted, held and off chats alone', () => {
    const go = (o: object, c = chat(), p?: unknown) => codexRound(c, p as never, { on: 1000, ...o }, new Map())
    assert.equal(go({}, chat({ status: 'busy' })), undefined)
    assert.equal(go({}, chat(), prog('working')), undefined)
    assert.equal(go({}, chat(), prog('needs-you')), undefined)
    assert.equal(go({ aborted: true }), undefined)
    assert.equal(go({ held: true }), undefined)
    assert.equal(go({ on: undefined }), undefined)
    assert.equal(go({}, chat({ updatedAt: 900 })), undefined)
    assert.equal(go({}, chat({ ai: 'claude' })), undefined)
  })
  it('reads the last answer and an interrupt from a rollout', () => {
    const ev = (payload: object) => JSON.stringify({ type: 'event_msg', payload })
    assert.deepEqual(lastCodexTurn([ev({ type: 'agent_message', message: 'a' }), ev({ type: 'task_complete', last_agent_message: 'b\nRun indefinitely: done' })]), { answer: 'b\nRun indefinitely: done', aborted: false })
    assert.equal(lastCodexTurn([ev({ type: 'task_started' }), ev({ type: 'turn_aborted' })]).aborted, true)
    assert.equal(lastCodexTurn([ev({ type: 'turn_aborted' }), ev({ type: 'task_started' })]).aborted, false)
  })
})

import { runGate, budgetEnd, usageLine, roundText, INDEFINITE_ROUND } from '../src/hub/indefinite'

describe('runGate', () => {
  it('passes on exit 0', async () => {
    assert.deepEqual(await runGate('npm test', '/x', async () => ({ code: 0, out: 'ok' })), { ok: true })
  })
  it('keeps the last 20 lines of a failure, redacted', async () => {
    const out = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n') + '\nkey sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'
    const r = await runGate('npm test', '/x', async () => ({ code: 1, out }))
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.out.split('\n').length, 20)
    assert.ok(!r.out.includes('line 5\n'))
    assert.ok(!r.out.includes('abcdefghijklmnopqrstuvwxyz0123456789'))
  })
  it('treats a throw as a failure', async () => {
    const r = await runGate('x', '/x', async () => { throw new Error('timed out') })
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.out, /gate did not finish: timed out/)
  })
})

describe('runGate throw', () => {
  it('redacts a thrown error', async () => {
    const r = await runGate('x', '/x', async () => { throw new Error('boom sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789') })
    assert.equal(r.ok, false)
    if (!r.ok) assert.ok(!r.out.includes('abcdefghijklmnopqrstuvwxyz0123456789'))
  })
})

describe('budgetEnd', () => {
  const H = 3_600_000
  it('ends on hours or cost, not before', () => {
    assert.equal(budgetEnd({ maxHours: 2 }, 0, 1 * H, undefined), undefined)
    assert.match(budgetEnd({ maxHours: 2 }, 0, 2 * H, undefined)!, /budget reached \(not a success\)/)
    assert.match(budgetEnd({ maxCostUsd: 5 }, 0, 1, 5)!, /budget reached/)
    assert.equal(budgetEnd({ maxCostUsd: 5 }, 0, 1, 4.9), undefined)
  })
  it('skips the cost cap when cost is unknown', () => {
    assert.equal(budgetEnd({ maxCostUsd: 5 }, 0, 1, undefined), undefined)
  })
  it('no budget never ends', () => assert.equal(budgetEnd(undefined, 0, 99 * H, 99), undefined))
})

describe('usageLine and roundText', () => {
  it('formats cost and hours', () => {
    assert.equal(usageLine(0, 90 * 60_000, 1.234), 'used $1.23 over 1.5h')
    assert.equal(usageLine(0, 3_600_000, undefined), 'used over 1h')
  })
  it('appends a failed gate to the round', () => {
    assert.equal(roundText(undefined, ''), INDEFINITE_ROUND)
    const t = roundText('npm test', 'boom')
    assert.ok(t.startsWith(INDEFINITE_ROUND))
    assert.match(t, /gate `npm test` failed[\s\S]*boom/)
  })
})

import { goalFor, goalCheck } from '../src/hub/indefinite'

describe('goal files for Codex rounds', () => {
  const files: Record<string, string> = { '/repo/.switchboard/goals/t1.md': '# Goal\n\nCheck: `make check`\n' }
  const read = (p: string) => { if (p in files) return files[p]; throw new Error('missing') }
  it('finds the goal from a subfolder by walking up to the project root', () => {
    assert.deepEqual(goalFor('/repo/web/app', 't1', read), { file: '/repo/.switchboard/goals/t1.md', dir: '/repo', text: files['/repo/.switchboard/goals/t1.md'] })
    assert.equal(goalFor('/repo', 'other', read), undefined)
  })
  it('reads the Check line, none when missing', () => {
    assert.equal(goalCheck('x\nCheck: `pnpm test auth` \n'), 'pnpm test auth')
    assert.equal(goalCheck('no check here'), undefined)
  })
  it('points the round at the goal file and keeps the failed output', () => {
    const t = roundText('make check', 'boom', '/repo/.switchboard/goals/t1.md')
    assert.match(t, /goal in \/repo\/\.switchboard\/goals\/t1\.md/)
    assert.match(t, /Run indefinitely: done/)
    assert.match(t, /boom/)
    assert.doesNotMatch(t, /audit the project/)
  })
})

import { goalHandoffLine } from '../src/hub/indefinite'

describe('goal across a Codex handoff', () => {
  it('tells the fresh Codex chat to copy the goal under its own id', () => {
    const line = goalHandoffLine({ file: '/repo/.switchboard/goals/old.md', dir: '/repo' })
    assert.match(line, /\/repo\/\.switchboard\/goals\/old\.md/)
    assert.match(line, /\$CODEX_THREAD_ID/)
    assert.match(line, /\/goal/)
  })
})
