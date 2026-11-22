import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import { autoOn, codexUsable, fiveHour, jevLabels, jevRole, keywordRole, pickAi, pickCodexRun, pickRun, scoreTask, withUltrathink, type Effort, type PickInput } from '../src/hub/picker'

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

type Row = { n: number; role: string; ai?: 'codex'; text: string; files?: number; unattended?: boolean; usage5h?: number; learned?: number; sentBack?: number; pinEffort?: Effort; expect: string }
const ROWS: Row[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pick-cases.json'), 'utf8'))
const inputOf = (r: Row): PickInput => ({
  text: r.text, role: r.role, ai: r.ai ?? 'claude', files: r.files, unattended: r.unattended, usage5h: r.usage5h ?? 0, learned: r.learned, sentBack: r.sentBack,
  explicit: r.pinEffort ? { effort: r.pinEffort } : undefined,
})
const show = (p: { model: string; effort: string; ultracode: boolean; ultrathink: boolean }, codex: boolean) =>
  codex ? `${p.model}@${p.effort}` : `${p.model}/${p.effort}${p.ultracode ? '+uc' : ''}${p.ultrathink ? '+ut' : ''}`

describe('pickRun: the labelled set', () => {
  it('has the 45 rows', () => assert.equal(ROWS.length, 45))
  for (const r of ROWS) {
    it(`#${r.n} ${r.role}: ${r.text.slice(0, 50).replace(/\n/g, ' ')}`, () => {
      const p = r.ai === 'codex' ? pickCodexRun(inputOf(r)) : pickRun(inputOf(r))
      assert.equal(show(p, r.ai === 'codex'), r.expect)
      assert.ok(p.reason.length > 0)
    })
  }
})

describe('pickRun: explicit picks and the 5h gate', () => {
  const big = 'Rework the hub across the app:\n- move limits.ts reads into hub-service.ts\n- split routes.ts by area\n- port the phone app to the new hub-types.ts\n- update every test in extension/test/hub.test.ts'
  it('an explicit model or effort wins and is never gated', () => {
    const p = pickRun({ text: big, role: 'lead', ai: 'claude', usage5h: 90, explicit: { model: 'fable', effort: 'max' } })
    assert.equal(p.model, 'fable')
    assert.equal(p.effort, 'max')
  })
  it('an explicit ultracode stays on at 90%, and an explicit off stays off', () => {
    assert.equal(pickRun({ text: 'fix the typo in the README', role: 'lead', ai: 'claude', usage5h: 90, explicit: { ultracode: true } }).ultracode, true)
    assert.equal(pickRun({ text: big, role: 'lead', ai: 'claude', usage5h: 0, explicit: { ultracode: false } }).ultracode, false)
  })
  it('an explicit model leaves the effort to the pick', () => {
    const p = pickRun({ text: 'fix the bug where the usage meter shows 0% after reload in extension/src/hub/hub-service.ts', role: 'engineer', ai: 'claude', usage5h: 0, explicit: { model: 'opus' } })
    assert.deepEqual([p.model, p.effort], ['opus', 'high'])
  })
  it('the reason names what the gate held', () => {
    const p = pickRun({ text: big, role: 'lead', ai: 'claude', usage5h: 72 })
    assert.equal(p.effort, 'high')
    assert.equal(p.ultracode, false)
    assert.match(p.reason, /5h at 72%: held ultracode, xhigh/)
  })
  it('59% is under the gate and 60% is not', () => {
    assert.equal(pickRun({ text: big, role: 'lead', ai: 'claude', usage5h: 59 }).effort, 'xhigh')
    assert.equal(pickRun({ text: big, role: 'lead', ai: 'claude', usage5h: 60 }).effort, 'high')
  })
  it('fable is held like xhigh', () => {
    const t = 'audit the whole repo for security holes in the shell and network paths and find the root cause of the intermittent crash'
    assert.equal(pickRun({ text: t, role: 'lead', ai: 'claude', unattended: true, usage5h: 0 }).model, 'fable')
    const held = pickRun({ text: t, role: 'lead', ai: 'claude', unattended: true, usage5h: 61 })
    assert.deepEqual([held.model, held.effort], ['opus', 'high'])
    assert.match(held.reason, /held .*max.*fable|held .*fable.*max/)
  })
  it('a role with no entry in the table is a lead chat', () => {
    assert.equal(pickRun({ text: 'fix the typo in the README', role: 'unknown', ai: 'claude', usage5h: 0 }).model, 'sonnet')
    assert.equal(pickRun({ text: 'fix the typo in the README', ai: 'claude', usage5h: 0 }).model, 'sonnet')
  })
  it('ai codex answers with the Codex pick', () => {
    const p = pickRun({ text: 'implement the scorer in extension/src/hub/picker.ts', role: 'engineer', ai: 'codex', usage5h: 0 })
    assert.deepEqual([p.model, p.effort, p.ultracode, p.ultrathink], ['gpt-5.6-terra', 'medium', false, false])
  })
})

describe('pickRun: clamps', () => {
  it('haiku never runs at xhigh or above: sonnet at high instead', () => {
    // easy words pull C down to haiku, 3 parts and a risky word push T up to xhigh
    const p = pickRun({ text: 'rename the auth helper in every file', role: 'engineer', ai: 'claude', usage5h: 0, parts: 3 })
    assert.deepEqual([p.model, p.effort], ['sonnet', 'high'])
  })
  it('fable only when C is 6 or more', () => {
    assert.equal(pickRun({ text: 'rewrite the scheduler', role: 'lead', ai: 'claude', usage5h: 0 }).model, 'opus')
    assert.equal(pickRun({ text: 'rewrite the scheduler as a state machine', role: 'lead', ai: 'claude', usage5h: 0 }).model, 'fable')
  })
  it('max only when unattended, T 6 or more and C 6 or more', () => {
    const t = 'audit the whole repo for security holes in the shell and network paths and find the root cause of the intermittent crash'
    assert.equal(pickRun({ text: t, role: 'lead', ai: 'claude', unattended: true, usage5h: 0 }).effort, 'max')
    assert.notEqual(pickRun({ text: t, role: 'lead', ai: 'claude', usage5h: 0 }).effort, 'max')
  })
  it('qa goes to opus for risky work, whatever the words', () => {
    assert.equal(pickRun({ text: 'review the change', role: 'qa', ai: 'claude', usage5h: 0, files: 5 }).model, 'sonnet')
    assert.equal(pickRun({ text: 'review the permissions change', role: 'qa', ai: 'claude', usage5h: 0, files: 3 }).model, 'opus')
  })
})

describe('pickRun: Jev difficulty', () => {
  const t = 'update the settings copy'
  const at = (jevDifficulty?: 'trivial' | 'routine' | 'hard' | 'frontier') => pickRun({ text: t, role: 'engineer', ai: 'claude', usage5h: 0, jevDifficulty })
  it('replaces the keyword part of C', () => {
    assert.equal(at('trivial').model, 'haiku')
    assert.equal(at('routine').model, 'sonnet')
    assert.equal(at('hard').model, 'opus')
    assert.equal(at('frontier').model, 'fable')
  })
  it('without a label the keywords stand', () => {
    assert.equal(at(undefined).model, 'sonnet')
    const hardWords = pickRun({ text: 'fix the race in chat-wait where two chats write links.json at once', role: 'engineer', ai: 'claude', usage5h: 0 })
    assert.equal(hardWords.model, 'opus')
    assert.equal(pickRun({ text: 'fix the race in chat-wait where two chats write links.json at once', role: 'engineer', ai: 'claude', usage5h: 0, jevDifficulty: 'routine' }).model, 'sonnet')
  })
})

describe('scoreTask', () => {
  it('reads files, parts and hard words from the text', () => {
    const s = scoreTask({ text: 'fix the race in extension/src/hub/a.ts and extension/src/hub/b.ts, also the deadlock', role: 'engineer', ai: 'claude', usage5h: 0 })
    assert.equal(s.files, 2)
    assert.equal(s.parts, 2)
    assert.equal(s.hard, 1)
  })
  it('files and parts can be given', () => {
    const s = scoreTask({ text: 'review it', role: 'qa', ai: 'claude', usage5h: 0, files: 9, parts: 4 })
    assert.deepEqual([s.files, s.parts], [9, 4])
  })
})

describe('withUltrathink', () => {
  it('adds the word once at the end', () => {
    assert.equal(withUltrathink('why does it drop?'), 'why does it drop? ultrathink')
    assert.equal(withUltrathink('why does it drop? ultrathink'), 'why does it drop? ultrathink')
    assert.equal(withUltrathink('Ultrathink about this'), 'Ultrathink about this')
  })
  it('leaves an empty message and a slash command alone', () => {
    assert.equal(withUltrathink(''), '')
    assert.equal(withUltrathink('/review the diff'), '/review the diff')
  })
})

describe('fiveHour', () => {
  const win = (kind: string, percentUsed: number, resetsAt?: string) => ({ kind, percentUsed, resetsAt })
  const reset = (v = '') => Date.parse(v)
  const now = Date.parse('2026-11-20T12:00:00Z')
  it('takes the highest five_hour window that has not reset', () => {
    assert.equal(fiveHour([win('five_hour', 30, '2026-11-20T15:00:00Z'), win('five_hour', 45, '2026-11-20T14:00:00Z'), win('seven_day', 90)], 'five_hour', reset, now), 45)
  })
  it('ignores a window past its reset and other kinds', () => {
    assert.equal(fiveHour([win('five_hour', 80, '2026-11-20T11:00:00Z'), win('codex_five_hour', 70)], 'five_hour', reset, now), 0)
    assert.equal(fiveHour([win('codex_five_hour', 70)], 'codex_five_hour', reset, now), 70)
  })
  it('is 0 with no windows', () => assert.equal(fiveHour([], 'five_hour', reset, now), 0))
})

describe('jevLabels', () => {
  const run = (out: string | undefined) => async () => out
  it('reads role and difficulty when each is sure', async () => {
    const out = '{"_id":"0","role":"engineer","role_conf":0.93,"difficulty":"hard","difficulty_conf":0.8}\n'
    assert.deepEqual(await jevLabels('x', '/p.json', run(out)), { role: 'engineer', difficulty: 'hard' })
  })
  it('drops a label under 0.7 and keeps the other', async () => {
    const out = '{"_id":"0","role":"engineer","role_conf":0.93,"difficulty":"hard","difficulty_conf":0.5}'
    assert.deepEqual(await jevLabels('x', '/p.json', run(out)), { role: 'engineer' })
  })
  it('ignores a difficulty that is not one of the four', async () => {
    const out = '{"_id":"0","role":"qa","role_conf":0.9,"difficulty":"extreme","difficulty_conf":0.99}'
    assert.deepEqual(await jevLabels('x', '/p.json', run(out)), { role: 'qa' })
  })
  it('is empty on failure or timeout', async () => {
    assert.deepEqual(await jevLabels('x', '/p.json', run(undefined)), {})
    const slow = () => new Promise<string>(r => setTimeout(() => r('{"role":"engineer","role_conf":0.9}'), 200))
    assert.deepEqual(await jevLabels('x', '/p.json', slow, 20), {})
  })
})

describe('autoOn', () => {
  it('follows the gear when the command says nothing', () => {
    assert.equal(autoOn(undefined, undefined), true)
    assert.equal(autoOn(undefined, true), true)
    assert.equal(autoOn(undefined, false), false)
  })
  it('lets the run pick over the gear', () => {
    assert.equal(autoOn(true, false), true)
    assert.equal(autoOn(false, true), false)
  })
})
