import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { pickRun, roleBounds } from '../src/hub/pick-run'
import { questionAsk } from '../src/hub/progress'
import { buildSmart, computeStats, logDrafts, logSmart, questionBucket, smartRun, readSmartRows, smartPick, taskLabel, verdictOf, type SmartRow, type Stats } from '../src/hub/smart-select'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-smart-'))
type PickRow = Extract<SmartRow, { t: 'pick' }>
const pick = (o: Partial<PickRow> = {}): PickRow => ({ t: 'pick', at: 1, session: 's1', cwd: '/x/p', kind: 'model', task: 'fix', pick: 'sonnet', why: 'routine', key: 'model:1', ...o } as PickRow)
const fin = (final: string, o: Partial<SmartRow> = {}): SmartRow => ({ t: 'final', at: 2, session: 's1', kind: 'model', key: 'model:1', final, ...o } as SmartRow)
const done = { approvedAt: 5 }

describe('verdictOf', () => {
  it('useful when kept, approved, nothing against it', () => assert.equal(verdictOf(pick(), undefined, done), 'useful'))
  it('pending until the chat is approved', () => assert.equal(verdictOf(pick(), undefined, {}), 'pending'))
  it('pending with no outcome row', () => assert.equal(verdictOf(pick(), undefined, undefined), 'pending'))
  it('switched is not useful at once', () => assert.equal(verdictOf(pick(), 'opus', undefined), 'not'))
  it('a final equal to the pick still waits for approval', () => assert.equal(verdictOf(pick(), 'sonnet', {}), 'pending'))
  it('sent back is not useful', () => assert.equal(verdictOf(pick(), undefined, { approvedAt: 5, sentBack: 1 }), 'not'))
  it('done-check missing is not useful', () => assert.equal(verdictOf(pick(), undefined, { ...done, doneMissing: true }), 'not'))
  it('an escalation hurts model and role picks only', () => {
    assert.equal(verdictOf(pick(), undefined, { ...done, escalated: true }), 'not')
    assert.equal(verdictOf(pick({ kind: 'effort' }), undefined, { ...done, escalated: true }), 'useful')
  })
})

describe('computeStats', () => {
  it('counts verdicts per kind, task and pick; pending is skipped', () => {
    const rows = [pick(), pick({ session: 's2', key: 'model:2', at: 3 }), fin('opus', { session: 's2', key: 'model:2' }), pick({ session: 's3', key: 'model:3' })]
    const out = new Map([['s1', done], ['s2', done]])
    const { stats, verdicts } = computeStats(rows, s => out.get(s))
    assert.deepEqual(stats.model.fix.sonnet, { n: 2, useful: 1 })
    assert.equal(verdicts.get('s2|model:2'), 'not')
    assert.equal(verdicts.get('s3|model:3'), 'pending')
    assert.equal(stats.model.fix.opus, undefined)
  })
})

describe('smartPick', () => {
  const stats = (n: number, useful: number, rn = 0, ru = 0): Stats => ({ model: { fix: { opus: { n, useful }, ...(rn ? { sonnet: { n: rn, useful: ru } } : {}) } } })
  it('keeps the rule pick with nothing learned', () => assert.deepEqual(smartPick('model', 'fix', 'sonnet', ['sonnet', 'opus'], {}), { pick: 'sonnet' }))
  it('switches to a clearly better learned option', () => {
    const r = smartPick('model', 'fix', 'sonnet', ['sonnet', 'opus'], stats(8, 8, 8, 3))
    assert.equal(r.pick, 'opus')
    assert.match(r.why ?? '', /^learned: opus kept 100% of 8$/)
  })
  it('needs n >= 5', () => assert.equal(smartPick('model', 'fix', 'sonnet', ['sonnet', 'opus'], stats(4, 4, 8, 3)).pick, 'sonnet'))
  it('needs a 0.15 lead', () => assert.equal(smartPick('model', 'fix', 'sonnet', ['sonnet', 'opus'], stats(10, 8, 10, 7)).pick, 'sonnet'))
  it('ignores options not on offer', () => assert.equal(smartPick('model', 'fix', 'sonnet', ['sonnet'], stats(8, 8)).pick, 'sonnet'))
})

describe('taskLabel', () => {
  it('maps words to the contract labels', () => {
    assert.equal(taskLabel('fix the crash in login'), 'fix')
    assert.equal(taskLabel('add a button to the settings screen'), 'ui')
    assert.equal(taskLabel('review the diff'), 'review')
    assert.equal(taskLabel('audit the auth flow'), 'audit')
    assert.equal(taskLabel('research how X works'), 'research')
    assert.equal(taskLabel('rename a typo'), 'tiny')
    assert.equal(taskLabel('hello'), 'other')
  })
})

describe('ledger io', () => {
  it('reads the last rows and skips torn lines', () => {
    const dir = tmp(), file = path.join(dir, 'smart-picks.jsonl')
    try {
      logSmart(pick(), file); logSmart(fin('opus'), file)
      fs.appendFileSync(file, '{"t":"pick","at":')
      assert.equal(readSmartRows(file).length, 2)
      assert.equal(readSmartRows(file, 1).length, 1)
      assert.deepEqual(readSmartRows(path.join(dir, 'none')), [])
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
  it('buildSmart joins archive and done-check, writes smart-learned.json, titles the picks', () => {
    const dir = tmp()
    try {
      const f = (n: string) => path.join(dir, n)
      logSmart(pick({ at: 10, key: 'model:10' }), f('p.jsonl'))
      fs.writeFileSync(f('a.json'), JSON.stringify([{ sessionId: 's1', name: 'Fix login', cwd: '/x/p', project: 'p', approvedAt: 20, archivedAt: 21 }]))
      const s = buildSmart({ picks: f('p.jsonl'), archive: f('a.json'), doneCheck: f('dc'), learn: f('none.json'), learned: f('l.json') }, () => undefined)
      assert.equal(s.picks[0].verdict, 'useful')
      assert.equal(s.picks[0].title, 'Fix login')
      assert.deepEqual(s.rates, [{ kind: 'model', task: 'fix', pick: 'sonnet', n: 1, useful: 1 }])
      const learned = JSON.parse(fs.readFileSync(f('l.json'), 'utf8'))
      assert.deepEqual(learned.stats.model.fix.sonnet, { n: 1, useful: 1 })
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('smartRun', () => {
  const input = { text: 'fix the crash', role: 'lead', ai: 'claude' as const, usage5h: 0 }
  it('keeps the rule when nothing is learned and writes drafts with the rule reason', () => {
    const rule = pickRun(input)
    const { run, drafts } = smartRun(input, rule, 'fix the crash', {})
    assert.equal(run.model, rule.model)
    assert.equal(run.effort, rule.effort)
    assert.deepEqual(drafts.map(d => [d.kind, d.pick, d.why, d.final]), [['model', rule.model, rule.reason, undefined], ['effort', rule.effort, rule.reason, undefined]])
  })
  it('lets a learned model win and says so', () => {
    const rule = pickRun(input), other = rule.model === 'sonnet' ? 'opus' : 'sonnet'
    const { run, drafts } = smartRun(input, rule, 'fix the crash', { model: { fix: { [other]: { n: 9, useful: 9 }, [rule.model]: { n: 9, useful: 2 } } } })
    assert.equal(run.model, other)
    assert.match(drafts[0].why, /^learned: /)
  })
  it('an explicit model is the run and the final; the draft keeps what the rule would pick', () => {
    const rule = pickRun(input)
    const { run, drafts } = smartRun({ ...input, explicit: { model: 'haiku' } }, pickRun({ ...input, explicit: { model: 'haiku' } }), 'fix the crash', {})
    assert.equal(run.model, 'haiku')
    assert.equal(drafts[0].pick, rule.model)
    assert.equal(drafts[0].final, 'haiku')
  })
  it('logDrafts writes a pick, and a final when switched', () => {
    const dir = tmp(), file = path.join(dir, 'l.jsonl')
    try {
      logDrafts([{ kind: 'model', task: 'fix', pick: 'opus', why: 'w', options: ['opus'], final: 'haiku' }], 's9', '/x', 7, file)
      assert.deepEqual(readSmartRows(file).map(r => r.t), ['pick', 'final'])
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('question smart option', () => {
  const input = { questions: [{ header: 'Scope', question: 'Which?', options: [{ label: 'A (Recommended)' }, { label: 'B' }] }] }
  it('marks the recommended option, with its rate when learned', () => {
    assert.deepEqual(questionAsk('i', input, {})?.questions?.[0].smart, { option: 0 })
    assert.deepEqual(questionAsk('i', input, { question: { scope: { A: { n: 4, useful: 3 }, Z: { n: 4, useful: 1 } } } })?.questions?.[0].smart, { option: 0, rate: 0.5, n: 8 })
  })
  it('moves to a learned better option', () => {
    const s = questionAsk('i', input, { question: { scope: { A: { n: 8, useful: 2 }, B: { n: 8, useful: 8 } } } })?.questions?.[0].smart
    assert.deepEqual(s, { option: 1, rate: 1, n: 8 })
  })
  it('marks nothing without a recommendation', () => {
    assert.equal(questionAsk('i', { questions: [{ question: 'Q', options: [{ label: 'A' }] }] }, {})?.questions?.[0].smart, undefined)
  })
})

describe('questionBucket', () => {
  it('maps real headers to the fixed set', () => {
    const want: Record<string, string> = { scope: 'scope', design: 'design', 'phone https': 'setup', rename: 'naming', 'wait picker': 'design', 'aws root': 'setup', 'auto effort': 'approach', 'next step': 'priority', 'sign off': 'finish', 'on finish': 'finish', direction: 'approach', 'spend cap': 'setup', 'board look': 'design' }
    for (const [h, b] of Object.entries(want)) assert.equal(questionBucket(h), b, h)
  })
  it('falls back to the question text, then other', () => {
    assert.equal(questionBucket('zzz', 'Which layout do you want?'), 'design')
    assert.equal(questionBucket('zzz', 'hmm'), 'other')
    assert.equal(questionBucket(undefined), 'other')
  })
  it('keeps other under 20% on a sample of real headers', () => {
    const headers = 'scope direction design backups placement to-do engineer deploy hero mirofish layout fix qa sync export refunds plugins memory map panel vault location phone https depth logo install rename $10 ceiling build codex desk aws root cloudflare header stamp designer stage ui wait picker auto pick accounts ui pick ntfy gate read spike disclosure channel3 meaning who category rows categorizer regen model structure outfits dresses split execute filters jev allow note names chat names branches auto effort aws profile tailscale send pick tools runs where phone view away access dress words just me add admins sign-in mode tie new admins measurements pair token style history policy pages activity style codes legal copy delete acct age archive colors title bar phone hero errors 404 page install path personal bits cloudtrail cf analytics subagent ask defaults ses key admin access review grant design prep depth aws timing provider rollout downgrade commitments rds cap nginx typo sources copy approach public repos enforce resend old rc'
    const known = ['to-do', 'phone https', 'aws root', 'wait picker', 'auto pick', 'ui pick', 'ntfy gate', 'read spike', 'codex desk', 'stage ui', 'memory map', 'regen model', 'jev allow', 'note names', 'chat names', 'auto effort', 'aws profile', 'pick tools', 'runs where', 'phone view', 'away access', 'dress words', 'just me', 'add admins', 'mode tie', 'new admins', 'pair token', 'style history', 'policy pages', 'style codes', 'legal copy', 'delete acct', 'title bar', 'phone hero', '404 page', 'install path', 'personal bits', 'cf analytics', 'subagent ask', 'ses key', 'admin access', 'grant design', 'prep depth', 'aws timing', 'rds cap', 'nginx typo', 'public repos', 'old rc', 'phone view', 'sign-in', '$10 ceiling', 'ntfy gate']
    let rest = headers
    const list: string[] = []
    for (const k of known) if (rest.includes(k)) { list.push(k); rest = rest.replace(k, ' ') }
    list.push(...rest.split(/\s+/).filter(Boolean))
    const other = list.filter(h => questionBucket(h) === 'other').length
    assert.ok(other / list.length < 0.2, `${other} of ${list.length} fell to other`)
  })
})

describe('mod rows', () => {
  it('a question row with a header task and a marked label joins the bucket and the bare label', () => {
    const dir = tmp(), file = path.join(dir, 'l.jsonl')
    try {
      logSmart({ t: 'pick', at: 1, session: 's', kind: 'question', task: 'phone hero', pick: 'A (Recommended)', why: 'w', key: 'question:1' }, file)
      logSmart({ t: 'final', at: 2, session: 's', kind: 'question', key: 'question:1', final: 'A (Recommended)' }, file)
      const rows = readSmartRows(file)
      assert.deepEqual(rows.map(r => r.t === 'pick' ? [r.task, r.pick] : r.final), [['design', 'A'], 'A'])
      assert.equal(questionBucket('naming'), 'naming')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('floor and mod files', () => {
  const input = { text: 'fix the crash', role: 'lead', ai: 'claude' as const, usage5h: 0 }
  it('a strong learned haiku and low cannot pull a lead run below its floor', () => {
    const rule = pickRun(input)
    const strong = { haiku: { n: 20, useful: 20 }, low: { n: 20, useful: 20 }, [rule.model]: { n: 20, useful: 0 }, [rule.effort]: { n: 20, useful: 0 } }
    const { run, drafts } = smartRun(input, rule, 'fix the crash', { model: { fix: strong }, effort: { fix: strong } })
    assert.notEqual(run.model, 'haiku')
    assert.notEqual(run.effort, 'low')
    assert.ok(!drafts[0].options.includes('haiku') && !drafts[1].options.includes('low'))
    assert.equal(roleBounds('lead').model[0], 'sonnet')
  })
  it('reads the ledger plus every mod file in smart-picks.d, by time, skipping torn lines', () => {
    const dir = tmp(), file = path.join(dir, 'smart-picks.jsonl')
    try {
      logSmart(pick({ at: 5 }), file)
      fs.mkdirSync(path.join(dir, 'smart-picks.d'))
      const mod = (n: string, ...r: SmartRow[]) => fs.writeFileSync(path.join(dir, 'smart-picks.d', n), r.map(x => JSON.stringify(x)).join('\n') + '\n{"t":"pick","at":')
      mod('s1-ponytail.jsonl', pick({ at: 3, kind: 'ponytail', key: 'ponytail:3' }))
      mod('s1-role.jsonl', pick({ at: 9, kind: 'role', key: 'role:9' }))
      fs.writeFileSync(path.join(dir, 'smart-picks.d', 'notes.txt'), 'x')
      assert.deepEqual(readSmartRows(file).map(r => r.at), [3, 5, 9])
      assert.deepEqual(readSmartRows(file, 2).map(r => r.at), [5, 9])
      const old = new Date(Date.now() - 61 * 86_400_000)
      fs.utimesSync(path.join(dir, 'smart-picks.d', 's1-role.jsonl'), old, old)
      assert.deepEqual(readSmartRows(file).map(r => r.at), [3, 5])
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})
