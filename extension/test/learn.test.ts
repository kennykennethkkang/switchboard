/**
 * Learn automatically: when improve-system is due, which self-improve runs get applied, which ended chats get an aar.
 */

import { describe, it } from 'node:test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import assert from 'node:assert/strict'
import { execFileSync } from 'child_process'
import { aarWanted, applyRun, betterOrNot, EVERY_MS, hashOf, improveDue, jobArgs, learnEnv, lineDiff, proposeRun, tooBig, usageOk } from '../src/hub/learn'

const row = (id: string, side: string, pass: boolean[]) => ({ id, side, pass })
const won = { verdict: { baseline: 0.9, candidate: 1, regressed: [] }, judged: [row('a', 'baseline', [true, false]), row('a', 'candidate', [true, true]), row('b', 'baseline', [true]), row('b', 'candidate', [true])] }

describe('schedule', () => {
  it('runs twice a week', () => {
    assert.equal(improveDue(1_000 + EVERY_MS, 1_000), true)
    assert.equal(improveDue(1_000 + EVERY_MS - 1, 1_000), false)
    assert.ok(EVERY_MS === 3.5 * 86_400_000)
  })

  it('waits while usage is at the pause threshold or a pause or retry is on', () => {
    const w = (p: number) => [{ percentUsed: p }]
    assert.equal(usageOk({ windows: w(50), pauseAt: 99, paused: false, retrying: false }), true)
    assert.equal(usageOk({ windows: w(99), pauseAt: 99, paused: false, retrying: false }), false)
    assert.equal(usageOk({ windows: w(80), pauseAt: 80, paused: false, retrying: false }), false)
    // undefined is the default 99, null is the pause off: only a spent limit stops it
    assert.equal(usageOk({ windows: w(98), pauseAt: undefined, paused: false, retrying: false }), true)
    assert.equal(usageOk({ windows: w(99), pauseAt: undefined, paused: false, retrying: false }), false)
    assert.equal(usageOk({ windows: w(99), pauseAt: null, paused: false, retrying: false }), true)
    assert.equal(usageOk({ windows: w(100), pauseAt: null, paused: false, retrying: false }), false)
    assert.equal(usageOk({ windows: [], pauseAt: 99, paused: true, retrying: false }), false)
    assert.equal(usageOk({ windows: [], pauseAt: 99, paused: false, retrying: true }), false)
  })
})

describe('better or not', () => {
  it('applies a held-out win with nothing lost and the source unchanged', () => {
    assert.deepEqual(betterOrNot(won, 'x', 'x'), { apply: true, why: 'pass rate 90% -> 100%' })
  })

  it('keeps everything else a proposal', () => {
    assert.equal(betterOrNot({ ...won, verdict: { baseline: 1, candidate: 1, regressed: [] } }, 'x', 'x').apply, false)
    assert.equal(betterOrNot({ ...won, verdict: { baseline: 0.5, candidate: 0.8, regressed: ['b'] } }, 'x', 'x').apply, false)
    // the verdict says no regression but a judged item went from pass to fail
    const lost = { ...won, judged: [...won.judged.slice(0, 2), row('b', 'baseline', [true]), row('b', 'candidate', [false])] }
    assert.match(betterOrNot(lost, 'x', 'x').why, /regressed on b/)
    const short = { ...won, judged: won.judged.slice(0, 3) }
    assert.match(betterOrNot(short, 'x', 'x').why, /incomplete/)
    assert.match(betterOrNot(won, 'x', 'y').why, /changed since/)
    assert.match(betterOrNot(won, 'x', undefined).why, /not found/)
    assert.equal(betterOrNot({}, 'x', 'x').apply, false)
  })

  it('writes the source, keeps the old file next to the run, and says how to undo', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-'))
    try {
      const mods = path.join(tmp, 'claude-mods'), run = path.join(tmp, 'run'), target = path.join(mods, 'kit', 'agents', 'ops.md')
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.mkdirSync(run)
      fs.writeFileSync(target, 'old\n'); fs.writeFileSync(path.join(run, 'baseline.md'), 'old\n'); fs.writeFileSync(path.join(run, 'candidate.md'), 'new\n')
      fs.writeFileSync(path.join(run, 'results.json'), JSON.stringify(won))
      // a winning run only becomes a card: nothing written until Kenneth approves
      const p = proposeRun(run, mods)
      assert.equal(fs.readFileSync(target, 'utf8'), 'old\n')
      assert.equal(p?.ready?.target, 'kit/agents/ops.md')
      assert.deepEqual([p?.ready?.before, p?.ready?.after], [0.9, 1])
      assert.match(p!.ready!.diff, /^-old$/m)
      assert.match(p!.ready!.diff, /^\+new$/m)
      assert.equal(p?.ready?.hash, hashOf('new\n'))
      // candidate swapped after the card was made: refused
      fs.writeFileSync(path.join(run, 'candidate.md'), 'evil\n')
      assert.equal(applyRun(run, mods, p!.ready!.hash)?.applied, false)
      assert.equal(fs.readFileSync(target, 'utf8'), 'old\n')
      fs.writeFileSync(path.join(run, 'candidate.md'), 'new\n')
      const r = applyRun(run, mods, p!.ready!.hash)
      assert.equal(r?.applied, true)
      assert.equal(fs.readFileSync(target, 'utf8'), 'new\n')
      assert.equal(fs.readFileSync(path.join(run, 'previous.md'), 'utf8'), 'old\n')
      assert.match(r!.text, /kit\/agents\/ops\.md/)
      assert.match(r!.text, /Undo: cp /)
      // the source moved on since: proposal, nothing written
      fs.writeFileSync(target, 'edited\n')
      fs.writeFileSync(path.join(run, 'results.json'), JSON.stringify({ ...won, target }))
      const again = applyRun(run, mods, hashOf('new\n'))
      assert.equal(again?.applied, false)
      assert.equal(fs.readFileSync(target, 'utf8'), 'edited\n')
      // a target outside claude-mods/kit is never written
      const out = path.join(tmp, 'elsewhere.md'); fs.writeFileSync(out, 'old\n')
      fs.writeFileSync(path.join(run, 'results.json'), JSON.stringify({ ...won, target: out }))
      assert.equal(applyRun(run, mods, hashOf('new\n'))?.applied, false)
      assert.equal(fs.readFileSync(out, 'utf8'), 'old\n')
      assert.equal(applyRun(path.join(tmp, 'none'), mods, ''), undefined)
      assert.equal(proposeRun(path.join(tmp, 'none'), mods), undefined)
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })
})

describe('learning card', () => {
  it('diffs in order, so moved and removed duplicate lines show, and never truncates', () => {
    assert.equal(lineDiff('a\nNever commit or push.\nb\n', 'a\nb\nNever commit or push.\n'), '-Never commit or push.\n+Never commit or push.')
    assert.equal(lineDiff('x\nx\ny\n', 'x\ny\n'), '-x')
    const added = Array.from({ length: 41 }, (_, i) => `line ${i}`).concat('PAYLOAD').join('\n')
    const d = lineDiff('', added)
    assert.match(d, /\+PAYLOAD$/)
    assert.doesNotMatch(d, /more/)
    assert.equal(lineDiff('same\n', 'same\n'), '')
  })

  it('marks CR and trailing blanks so a line-ending edit is not blank', () => {
    assert.equal(lineDiff('a\n', 'a\r\n'), '-a\n+a\u23CE')
    assert.equal(lineDiff('a\n', 'a  \n'), '-a\n+a  (trailing space)')
  })

  it('refuses a candidate far bigger than its target, before diffing it', () => {
    assert.equal(tooBig('x\n'.repeat(1_000), 'y\n'.repeat(300)), false)
    assert.equal(tooBig('x\n'.repeat(200_000), 'y\n'.repeat(300)), true)
    assert.equal(tooBig('x'.repeat(300_000), 'y'), true)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-'))
    try {
      const mods = path.join(tmp, 'claude-mods'), run = path.join(tmp, 'run'), target = path.join(mods, 'kit', 'agents', 'ops.md')
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.mkdirSync(run)
      fs.writeFileSync(target, 'old\n'); fs.writeFileSync(path.join(run, 'baseline.md'), 'old\n'); fs.writeFileSync(path.join(run, 'candidate.md'), 'x\n'.repeat(200_000))
      fs.writeFileSync(path.join(run, 'results.json'), JSON.stringify(won))
      const p = proposeRun(run, mods)
      assert.equal(p?.ready, undefined)
      assert.match(p!.text!, /far bigger than the target/)
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('a card already decided elsewhere refreshes the list and says so', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-home-'))
    try {
      fs.mkdirSync(path.join(home, '.claude', 'switchboard'), { recursive: true })
      fs.writeFileSync(path.join(home, '.claude', 'switchboard', 'learn.json'), JSON.stringify({ ready: [{ id: 'keep', target: 't', before: 0, after: 1, diff: '', run: '/r', hash: 'h' }] }))
      const src = path.resolve(__dirname, '../src/hub/learn.ts'), hubSrc = path.resolve(__dirname, '../src/hub/hub-service.ts')
      const script = path.join(home, 'c.ts')
      fs.writeFileSync(script, `import { decideLearn } from ${JSON.stringify(src)}\nimport { hub } from ${JSON.stringify(hubSrc)}\nvoid decideLearn('gone', true).then(m => process.stdout.write(JSON.stringify({ m, ids: hub.get().learnReady?.map(c => c.id) })))\n`)
      const out = JSON.parse(execFileSync(process.execPath, [...process.execArgv, script], { env: { ...process.env, HOME: home }, encoding: 'utf8' })) as { m: string; ids: string[] }
      assert.deepEqual(out, { m: 'Already handled', ids: ['keep'] })
    } finally { fs.rmSync(home, { recursive: true, force: true }) }
  })
})

describe('aar filter', () => {
  const turns = (n: number) => Array.from({ length: n }, (_, i) => JSON.stringify({ type: 'assistant', message: { id: `m${i}`, content: [] } })).join('\n')
  it('wants long chats that have not had one', () => {
    assert.equal(aarWanted(turns(21), 's1', []), true)
    assert.equal(aarWanted(turns(20), 's1', []), false)
  })
  it('counts one turn per message, not per content block', () => {
    const split = Array.from({ length: 30 }, (_, i) => JSON.stringify({ type: 'assistant', message: { id: `m${i % 10}` } })).join('\n')
    assert.equal(aarWanted(split, 's1', []), false)
  })
  it('skips chats already reviewed, by the Skill call or the marker list', () => {
    const ran = `${turns(30)}\n${JSON.stringify({ type: 'assistant', message: { id: 'z', content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'aar' } }] } })}`
    assert.equal(aarWanted(ran, 's1', []), false)
    assert.equal(aarWanted(turns(30), 's1', ['s1']), false)
  })
})

describe('headless runs', () => {
  const flag = (a: string[], f: string) => a[a.indexOf(f) + 1].split(',')
  it('never bypass permissions and carry an allow list', () => {
    for (const a of [jobArgs('aar', 'p', 'id'), jobArgs('improve', 'p', 'id', ['/s/scan.mjs'])]) {
      assert.ok(!a.some(x => /dangerously|bypassPermissions/.test(x)))
      assert.equal(a[a.indexOf('--permission-mode') + 1], 'dontAsk')
      assert.ok(flag(a, '--allowedTools').includes('Read'))
      assert.ok(!flag(a, '--allowedTools').some(x => x === 'Bash' || x === 'Edit' || x === 'Write'))
      assert.ok(flag(a, '--disallowedTools').includes('WebFetch') && flag(a, '--disallowedTools').includes('WebSearch'))
    }
  })
  it('aar: no shell, writes only to memory and the vault wiki', () => {
    const a = jobArgs('aar', 'p', 'id')
    assert.ok(flag(a, '--disallowedTools').includes('Bash'))
    assert.ok(!flag(a, '--allowedTools').some(x => x.startsWith('Bash')))
    assert.deepEqual(flag(a, '--allowedTools').filter(x => /^(Edit|Write)\(/.test(x)).map(x => x.replace(/^\w+\(|\)$/g, '')).sort(),
      ['~/.claude/projects/*/memory/**', '~/.claude/projects/*/memory/**', '~/Documents/vault/wiki/**', '~/Documents/vault/wiki/**'])
  })
  it('improve: Bash only for the named scripts, writes under self-improve and notes, never claude-mods', () => {
    const allow = flag(jobArgs('improve', 'p', 'id', ['/s/scan.mjs']), '--allowedTools')
    assert.deepEqual(allow.filter(x => x.startsWith('Bash')), ['Bash(node /s/scan.mjs:*)'])
    assert.ok(allow.includes('Edit(~/.claude/self-improve/**)'))
    assert.ok(!allow.some(x => /claude-mods/.test(x)))
  })
  it('no Skill tool in either job; improve denies shells, fetchers and the web', () => {
    for (const a of [jobArgs('aar', 'p', 'id'), jobArgs('improve', 'p', 'id', ['/s/scan.mjs'])]) {
      assert.ok(!flag(a, '--allowedTools').some(x => x.startsWith('Skill')))
      assert.ok(flag(a, '--disallowedTools').includes('Skill'))
    }
    const deny = flag(jobArgs('improve', 'p', 'id', ['/s/scan.mjs']), '--disallowedTools')
    for (const d of ['Bash(curl:*)', 'Bash(wget:*)', 'Bash(sh:*)', 'Bash(bash:*)', 'Bash(zsh:*)', 'WebFetch', 'WebSearch']) assert.ok(deny.includes(d), d)
  })
  it('passes only an env allow list', () => {
    const env = learnEnv({ HOME: '/h', PATH: '/p', GITHUB_TOKEN: 'x', OPENROUTER_API_KEY: 'y' })
    assert.deepEqual(env, { HOME: '/h', PATH: '/p', CLAUDE_CODE_CHILD_SESSION: '1', SWITCHBOARD_HEADLESS: '1' })
  })
})
