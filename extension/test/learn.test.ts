/**
 * Learn automatically: when improve-system is due, which self-improve runs get applied, which ended chats get an aar.
 */

import { describe, it } from 'node:test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import assert from 'node:assert/strict'
import { execFileSync } from 'child_process'
import type { Runner } from '../src/hub/learn'
import { aarWanted, addedClaims, applyRun, betterOrNot, checkProposals, consolidate, EVERY_MS, hashOf, improveDue, jobArgs, learnEnv, lineDiff, markUnproven, proposalCount, proposeRun, stageMemory, syncMemory, tooBig, usageOk } from '../src/hub/learn'

const row = (id: string, side: string, pass: boolean[], items?: number) => ({ id, side, pass, items })
const yes = (n: number) => new Array<boolean>(n).fill(true)
// b ran 10 times on 3 items, so the candidate clears 30 approved results
const won = { verdict: { baseline: 0.9, candidate: 1, regressed: [] }, judged: [row('a', 'baseline', [true, false]), row('a', 'candidate', [true, true]), row('b', 'baseline', yes(30), 3), row('b', 'candidate', yes(30), 3)] }

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
    // a spent Codex window does not hold Claude work
    assert.equal(usageOk({ windows: [{ kind: 'codex_five_hour', percentUsed: 100 }, { kind: 'five_hour', percentUsed: 50 }], pauseAt: 99, paused: false, retrying: false }), true)
    assert.equal(usageOk({ windows: [], pauseAt: 99, paused: true, retrying: false }), false)
    assert.equal(usageOk({ windows: [], pauseAt: 99, paused: false, retrying: true }), false)
    // A window whose reset passed is stale: an idle chat keeps its last status line.
    const now = Date.UTC(2026, 10, 9, 12)
    const ago = new Date(now - 3_600_000).toISOString(), ahead = new Date(now + 3_600_000).toISOString()
    assert.equal(usageOk({ windows: [{ percentUsed: 99, resetsAt: ago }], pauseAt: 99, paused: false, retrying: false }, now), true)
    assert.equal(usageOk({ windows: [{ percentUsed: 99, resetsAt: String((now - 3_600_000) / 1000) }], pauseAt: 99, paused: false, retrying: false }, now), true)
    assert.equal(usageOk({ windows: [{ percentUsed: 99, resetsAt: ahead }], pauseAt: 99, paused: false, retrying: false }, now), false)
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

  it('needs 30 approved results before a new version counts', () => {
    const few = { ...won, judged: [row('a', 'baseline', [true, false]), row('a', 'candidate', [true, true]), row('b', 'baseline', yes(27), 3), row('b', 'candidate', yes(27), 3)] }
    assert.match(betterOrNot(few, 'x', 'x').why, /29 approved results, need 30/)
  })

  it('compares repeated runs by passes per item, not by slot', () => {
    // item 1 passed once on each side, in different runs: not a regression
    const moved = { ...won, judged: [...won.judged, row('c', 'baseline', [true, false, false, true], 2), row('c', 'candidate', [true, true, true, false], 2)] }
    assert.equal(betterOrNot(moved, 'x', 'x').apply, true)
    const fewer = { ...won, judged: [...won.judged, row('c', 'baseline', [true, true, true, true], 2), row('c', 'candidate', [true, true, false, true], 2)] }
    assert.match(betterOrNot(fewer, 'x', 'x').why, /regressed on c/)
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
      assert.equal(p?.ready?.target?.replace(/\\/g, '/'), 'kit/agents/ops.md')
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
      const out = JSON.parse(execFileSync(process.execPath, [...process.execArgv, script], { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' })) as { m: string; ids: string[] }
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

describe('aar memory folder', () => {
  // Runs the real tick in a throwaway home; the fake run leaves one note in the staged copy.
  const savedIn = (at: (repo: string, home: string) => string, sent?: string) => {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'learn-aar-')))
    try {
      const repo = path.join(home, 'Documents', 'GitHub', 'switchboard'), cwd = at(repo, home), slug = (p: string) => p.replace(/[^a-zA-Z0-9]/g, '-')
      const projects = path.join(home, '.claude', 'projects'), sb = path.join(home, '.claude', 'switchboard')
      for (const d of [path.join(repo, '.git'), path.join(repo, '..', 'claude-mods', 'kit'), path.join(projects, slug(cwd)), path.join(projects, slug(repo), 'memory'), sb]) fs.mkdirSync(d, { recursive: true })
      fs.writeFileSync(path.join(projects, slug(repo), 'memory', 'old.md'), 'old')
      fs.writeFileSync(path.join(projects, slug(cwd), 's1.jsonl'), Array.from({ length: 30 }, (_, i) => JSON.stringify({ type: 'assistant', message: { id: `m${i}`, content: [] } })).join('\n'))
      fs.writeFileSync(path.join(sb, 'learn.json'), JSON.stringify({ improveAt: Date.now() }))
      const script = path.join(home, 'c.ts')
      fs.writeFileSync(script, `import * as fs from 'fs'\nimport * as path from 'path'\nimport { learnTick, queueAar } from ${JSON.stringify(path.resolve(__dirname, '../src/hub/learn.ts'))}
queueAar({ sessionId: 's1', cwd: ${JSON.stringify(sent ?? cwd)} } as never)
void learnTick(async () => {
  const root = path.join(${JSON.stringify(home)}, '.cache', 'switchboard', 'learn'), stage = path.join(root, fs.readdirSync(root)[0], 'memory')
  fs.writeFileSync(path.join(stage, 'new.md'), fs.readdirSync(stage).join())
  return 0
})\n`)
      execFileSync(process.execPath, [...process.execArgv, script], { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' })
      const note = (p: string) => { const f = path.join(projects, slug(p), 'memory', 'new.md'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : undefined }
      return { main: note(repo), own: note(cwd) }
    } finally { fs.rmSync(home, { recursive: true, force: true }) }
  }
  it('a worktree chat gets the main checkout\'s memory, its folder gone or not', () => {
    assert.deepEqual(savedIn(repo => path.join(repo, '.claude', 'worktrees', 'x-71db')), { main: 'old.md', own: undefined })
    assert.deepEqual(savedIn(repo => { const wt = path.join(repo, '.claude', 'worktrees', 'x-71db'); fs.mkdirSync(wt, { recursive: true }); fs.writeFileSync(path.join(wt, '.git'), 'gitdir: x'); return wt }), { main: 'old.md', own: undefined })
  })
  it('a subfolder chat gets its repo\'s memory', () => {
    assert.deepEqual(savedIn(repo => path.join(repo, 'web')), { main: 'old.md', own: undefined })
  })
  it('a chat outside any repo keeps the folder its transcript is in', () => {
    assert.deepEqual(savedIn((_, home) => path.join(home, 'notes')), { main: undefined, own: '' })
  })
  it('a chat with no folder on record keeps it too, whatever folder this runs in', () => {
    assert.deepEqual(savedIn((_, home) => path.join(home, 'notes'), ''), { main: undefined, own: '' })
  })
  it('a chat in the repo itself still gets its memory', () => {
    assert.deepEqual(savedIn(repo => repo), { main: 'old.md', own: 'old.md' })
  })
})

describe('a newer build waiting for a reload', () => {
  // Each script is one window's life, so the next one starts like a reloaded window.
  const inHome = (learn: object, use: (w: { run: (body: string) => void; ran: () => number; queue: () => unknown; state: () => { improveAt?: number } }) => void) => {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'learn-hold-')))
    try {
      const repo = path.join(home, 'Documents', 'GitHub', 'switchboard'), sb = path.join(home, '.claude', 'switchboard')
      const projects = path.join(home, '.claude', 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'))
      for (const d of [path.join(repo, '.git'), path.join(repo, '..', 'claude-mods', 'kit'), path.join(projects, 'memory'), sb]) fs.mkdirSync(d, { recursive: true })
      fs.writeFileSync(path.join(projects, 's1.jsonl'), Array.from({ length: 30 }, (_, i) => JSON.stringify({ type: 'assistant', message: { id: `m${i}`, content: [] } })).join('\n'))
      fs.writeFileSync(path.join(sb, 'learn.json'), JSON.stringify(learn))
      const script = path.join(home, 'c.ts'), marks = path.join(home, 'marks'), file = path.join(sb, 'aars-x.json'), src = (f: string) => JSON.stringify(path.resolve(__dirname, '../src/hub', f))
      const run = (body: string) => {
        fs.writeFileSync(script, `import * as fs from 'fs'\nimport { holdForUpdate, keepAarQueue, learnTick, queueAar } from ${src('learn.ts')}\nimport { hub } from ${src('hub-service.ts')}
const mark = async () => { fs.appendFileSync(${JSON.stringify(marks)}, 'x'); return 0 }, todo = async () => undefined, s1 = { sessionId: 's1', cwd: ${JSON.stringify(repo)} } as never
keepAarQueue(${JSON.stringify(file)})\n${body}\n`)
        execFileSync(process.execPath, [...process.execArgv, script], { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' })
      }
      use({
        run, ran: () => (fs.existsSync(marks) ? fs.readFileSync(marks, 'utf8').length : 0),
        queue: () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined),
        state: () => JSON.parse(fs.readFileSync(path.join(sb, 'learn.json'), 'utf8')),
      })
    } finally { fs.rmSync(home, { recursive: true, force: true }) }
  }
  it('starts no aar and keeps the queue for the reloaded window, which runs it once', () => inHome({ improveAt: Date.now() }, w => {
    w.run('holdForUpdate(() => true); queueAar(s1); void learnTick(mark, todo)')
    assert.equal(w.ran(), 0)
    assert.equal((w.queue() as unknown[]).length, 1)
    w.run('holdForUpdate(() => false); void learnTick(mark, todo)')
    assert.equal(w.ran(), 1)
    assert.deepEqual(w.queue(), [])
    w.run('void learnTick(mark, todo)')
    assert.equal(w.ran(), 1)
  }))
  it('starts no improve run either, and leaves it due', () => inHome({ improveAt: 1 }, w => {
    w.run('holdForUpdate(() => true); void learnTick(mark, todo)')
    assert.equal(w.ran(), 0)
    assert.equal(w.state().improveAt, 1)
    w.run('void learnTick(mark, todo)')
    assert.ok(w.ran() > 0)
  }))
  it('a run that a reload cuts off is not queued again', () => inHome({ improveAt: Date.now() }, w => {
    w.run('queueAar(s1); void learnTick(async () => { await mark(); process.exit(0) }, todo)')
    assert.equal(w.ran(), 1)
    assert.deepEqual(w.queue(), [])
  }))
  it('Learn off drops the kept queue', () => inHome({ improveAt: Date.now() }, w => {
    w.run('queueAar(s1)')
    const off = 'hub.set({ controls: { ...hub.get().controls, switchboard: { ...hub.get().controls.switchboard, learn: false } } }); '
    w.run(`${off}void learnTick(mark, todo)`)
    assert.equal(w.ran(), 0)
    assert.deepEqual(w.queue(), [])
  }))
  it('a broken file, or rows without an id, start empty', () => inHome({ improveAt: Date.now() }, w => {
    for (const kept of ['{', '{}', '[null, 1, {"sessionId": 2, "cwd": "/"}, {"cwd": "/"}]']) {
      w.run(`fs.writeFileSync(process.env.HOME + '/.claude/switchboard/aars-x.json', ${JSON.stringify(kept)})`)
      w.run('queueAar(s1)')
      assert.deepEqual((w.queue() as Array<{ sessionId: string }>).map(q => q.sessionId), ['s1'])
    }
  }))
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
    assert.ok(flag(jobArgs('aar', 'p', 'id', [], '/h/.cache/s/memory'), '--allowedTools').includes('Write(//h/.cache/s/memory/**)'))
  })
  it('aar memory: staged copy syncs back new and changed notes, MEMORY.md only gains lines', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-mem-')), mem = path.join(root, 'memory'), stage = path.join(root, 'stage')
    fs.mkdirSync(mem)
    fs.writeFileSync(path.join(mem, 'MEMORY.md'), '- [A](a.md)\n')
    fs.writeFileSync(path.join(mem, 'a.md'), 'a')
    fs.writeFileSync(path.join(mem, 'b.md'), 'b')
    const before = stageMemory(mem, stage)
    assert.equal(fs.readFileSync(path.join(stage, 'a.md'), 'utf8'), 'a')
    fs.writeFileSync(path.join(stage, 'MEMORY.md'), '- [A](a.md)\n- [C](c.md)\n')
    fs.writeFileSync(path.join(stage, 'c.md'), 'c')
    fs.writeFileSync(path.join(stage, 'a.md'), 'a2')
    fs.rmSync(path.join(stage, 'b.md'))
    fs.appendFileSync(path.join(mem, 'MEMORY.md'), '- [D](d.md)\n')
    assert.deepEqual(syncMemory(stage, mem, before).sort(), ['MEMORY.md', 'a.md', 'c.md'])
    assert.equal(fs.readFileSync(path.join(mem, 'MEMORY.md'), 'utf8'), '- [A](a.md)\n- [D](d.md)\n- [C](c.md)\n')
    assert.equal(fs.readFileSync(path.join(mem, 'a.md'), 'utf8'), 'a2')
    assert.equal(fs.readFileSync(path.join(mem, 'c.md'), 'utf8'), 'c')
    assert.ok(fs.existsSync(path.join(mem, 'b.md')))
    const empty = stageMemory(path.join(root, 'none'), path.join(root, 's2'))
    assert.deepEqual(syncMemory(path.join(root, 's2'), path.join(root, 'fresh'), empty), [])
    assert.ok(!fs.existsSync(path.join(root, 'fresh')))
    fs.writeFileSync(path.join(mem, 'MEMORY.md'), '- [A](a.md) old\n- [D](d.md)\n')
    const b2 = stageMemory(mem, path.join(root, 's3'))
    fs.writeFileSync(path.join(root, 's3', 'MEMORY.md'), '- [A](a.md) new\n- [D](d.md)\n- [E](e.md)\n')
    fs.writeFileSync(path.join(mem, 'MEMORY.md'), '- [A](a.md) old\n- [F](f.md)\n')
    syncMemory(path.join(root, 's3'), mem, b2)
    assert.equal(fs.readFileSync(path.join(mem, 'MEMORY.md'), 'utf8'), '- [F](f.md)\n- [A](a.md) new\n- [E](e.md)\n')
    fs.rmSync(root, { recursive: true, force: true })
  })
  it('improve: Bash only for the named scripts, writes under self-improve and notes, never claude-mods', () => {
    const allow = flag(jobArgs('improve', 'p', 'id', ['/s/scan.mjs']), '--allowedTools')
    assert.deepEqual(allow.filter(x => x.startsWith('Bash')), ['Bash(node /s/scan.mjs:*)'])
    assert.ok(allow.includes('Edit(~/.claude/self-improve/**)'))
    assert.ok(!allow.some(x => /memory/.test(x)), 'headless refuses ~/.claude memory writes')
    assert.ok(flag(jobArgs('improve', 'p', 'id', [], '/h/.cache/s/memory'), '--allowedTools').includes('Write(//h/.cache/s/memory/**)'))
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
  it('consolidate: no shell, no to-do tool, writes only its staged proposals', () => {
    const a = jobArgs('consolidate', 'p', 'id', ['/s/scan.mjs'], '/h/.cache/s/c')
    const allow = flag(a, '--allowedTools'), deny = flag(a, '--disallowedTools')
    assert.deepEqual(allow.filter(x => /^(Edit|Write|Bash)/.test(x)), ['Edit(//h/.cache/s/c/**)', 'Write(//h/.cache/s/c/**)'])
    assert.ok(allow.includes('Read') && !allow.includes('mcp__switchboard__todo_add'))
    for (const d of ['Bash', 'Skill', 'WebFetch', 'mcp__switchboard__todo_add']) assert.ok(deny.includes(d), d)
    assert.equal(a[a.indexOf('--permission-mode') + 1], 'dontAsk')
  })
  it('consolidate: keeps the proposals file and files one to-do; none written means no to-do', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-con-')), keep = path.join(root, 'keep'), todos: string[] = []
    const todo = async (_f: string, t: string) => { todos.push(t) }
    let prompt = ''
    const writes: Runner = async (args) => {
      prompt = args[args.indexOf('-p') + 1]
      const out = /Write every proposal to (\S+?), nothing else/.exec(prompt)![1]
      fs.writeFileSync(out, '# Proposals\n\n## Merge a.md + b.md\nx\n\n## Rewrite c.md\ny\n')
      return 0
    }
    assert.equal(await consolidate({ flow: root, mods: '/m' }, writes, todo, ['/mem1', '/mem2'], keep), 'memory consolidation: 2 proposed')
    assert.ok(prompt.includes('/mem1, /mem2') && prompt.includes(path.join('/m', 'kit', 'skills', 'memory-fix', 'SKILL.md')) && /never edit/.test(prompt))
    const kept = fs.readdirSync(keep)
    assert.equal(kept.length, 1)
    assert.match(fs.readFileSync(path.join(keep, kept[0]), 'utf8'), /## Rewrite c\.md/)
    assert.equal(todos.length, 1)
    assert.ok(todos[0].includes(path.join(keep, kept[0])) && todos[0].includes('2 proposed'))
    assert.equal(await consolidate({ flow: root, mods: '/m' }, async () => 0, todo, ['/mem1'], keep), 'memory consolidation: nothing to merge')
    assert.equal(await consolidate({ flow: root, mods: '/m' }, async () => 0, todo, [], keep), 'no memory to consolidate')
    assert.equal(todos.length, 1)
    assert.equal(proposalCount('## Merge a.md + b.md\n```\n## Notes\n```\n## Rewrite c.md\n## Other'), 2)
    fs.rmSync(root, { recursive: true, force: true })
  })
  it('addedClaims: a new path, number or code word with no source is flagged; rewording and prose pass', () => {
    const old = 'Run `pnpm run test:root` from web/.\nThe cap is 30 rows in src/hub/learn.ts.'
    const note = '---\nname: x\nmodified: 2099-01-01\n---\nThe cap is 30 rows in src/hub/learn.ts.\nFrom web/, run `pnpm run   test:root`.\nKeep it short.\n- Limit: 45 rows, see src/hub/other.ts\n```sh\n## heading\n```'
    assert.deepEqual(addedClaims(note, old), ['- Limit: 45 rows, see src/hub/other.ts'])
    assert.deepEqual(addedClaims('Specs: docs/{a,b}-x.md', 'docs/a-x.md and b-x.md'), [])
    assert.deepEqual(addedClaims('Only 3 left, see `foo-bar`.', 'there were 30 in foo-bar-baz'), ['Only 3 left, see `foo-bar`.'])
    assert.deepEqual(addedClaims('Checked 2026-11-25 in web/ and extension/src/x.ts.', 'modified: 2026-11-25T07:00 web/lib, see extension/src/x.ts'), [])
  })
  it('markUnproven: adds the status, replaces another one, leaves a note without frontmatter', () => {
    assert.equal(markUnproven('---\nname: x\n---\nbody'), '---\nname: x\nstatus: unproven\n---\nbody')
    assert.equal(markUnproven('---\nmetadata:\n  status: proven\n---\nb'), '---\nmetadata:\n  status: unproven\n---\nb')
    assert.equal(markUnproven('body only'), 'body only')
    assert.equal(markUnproven('---\n---\nbody'), '---\nstatus: unproven\n---\nbody')
    assert.equal(markUnproven('---\ndescription: a---b\n---\nbody'), '---\ndescription: a---b\nstatus: unproven\n---\nbody')
  })
  it('checkProposals: lists added claims above the note and marks it; a clean proposal is left as it is', async () => {
    const text = ['# P', '', '## Rewrite a.md', 'Folder: /mem', 'Why: short', '```markdown', '---', 'name: a', '---', 'Uses 7 tries.', '```sh', 'run.sh', '```', '```', '',
      '## Merge b.md + c.md', 'Folder: /mem', '```markdown', '---', 'name: b', '---', 'Uses 3 tries.', '```', ''].join('\n')
    const asked: string[] = []
    const out = await checkProposals(text, async (folder, names) => { asked.push(`${folder}:${names.join(',')}`); return 'Uses 3 tries. run.sh' })
    assert.deepEqual(asked, ['/mem:b.md,c.md', '/mem:a.md'])
    assert.equal(out.flagged, 1)
    const lines = out.text.split('\n'), a = lines.indexOf('## Rewrite a.md'), b = lines.indexOf('## Merge b.md + c.md')
    assert.ok(lines.slice(a, b).some(l => l.startsWith('Added claims')))
    assert.ok(lines.slice(a, b).includes('- Uses 7 tries.') && lines.slice(a, b).includes('status: unproven'))
    assert.ok(lines.slice(a, b).includes('run.sh') && lines[b - 2] === '```')
    assert.deepEqual(lines.slice(b), text.split('\n').slice(text.split('\n').indexOf('## Merge b.md + c.md')))
    assert.equal(proposalCount(out.text), 2)
  })
  it('passes only an env allow list', () => {
    const env = learnEnv({ HOME: '/h', PATH: '/p', GITHUB_TOKEN: 'x', OPENROUTER_API_KEY: 'y' })
    assert.deepEqual(env, { HOME: '/h', PATH: '/p', CLAUDE_CODE_CHILD_SESSION: '1', SWITCHBOARD_HEADLESS: '1' })
  })
})
