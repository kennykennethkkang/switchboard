/** Saved research runs: the markdown folder, the list, seen state, reads and trash. */
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { researchReadReply } from '../src/hub/routes'
import { CLAIM_MAX_AGE, LIST_MAX, deleteResearch, pruneClaims, listResearch, markSeen, readResearch, saveResearch as rawSave, sourceCount, summaryOf } from '../src/hub/research-library'

const dirs: string[] = []
const root = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'research-lib-')); dirs.push(d); return d }
afterEach(() => { dirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })) })

const REPORT = [
  '# Solid-state batteries',
  '',
  '**Answer:** Sulfide electrolytes lead on conductivity, oxides on stability.',
  '',
  '## Findings',
  'Two sources disagree on cost. See https://example.com/a and https://example.com/b.',
  '',
  '## Sources',
  '- https://example.com/a',
  '- https://example.com/c',
].join('\n')

// item typed as set; the deleted-run tests only read created
const saveResearch = (...a: Parameters<typeof rawSave>) => rawSave(...a) as { item: NonNullable<ReturnType<typeof rawSave>['item']>; created: boolean }

const run = (over: Partial<Parameters<typeof rawSave>[1]> = {}) => ({
  question: 'Which solid-state electrolyte wins?',
  answer: REPORT,
  chat: 'Battery scan',
  sessionId: 's-1',
  project: '/Users/me/Documents/GitHub/cell-lab',
  date: '2026-11-22',
  at: 1_800_000_000_000,
  ...over,
})

describe('saveResearch', () => {
  it('writes a project run under the project folder base name, with frontmatter', () => {
    const r = root()
    const { item, created } = saveResearch(r, run())
    assert.equal(created, true)
    assert.equal(item.id, 'cell-lab/2026-11-22-which-solid-state-electrolyte-wins.md')
    assert.equal(item.project, '/Users/me/Documents/GitHub/cell-lab')
    assert.equal(item.sources, 3)
    const text = fs.readFileSync(path.join(r, item.id), 'utf8')
    assert.match(text, /^---\nquestion: "Which solid-state electrolyte wins\?"\n/)
    assert.match(text, /\nsessionId: "s-1"\n/)
    assert.match(text, /\nproject: "\/Users\/me\/Documents\/GitHub\/cell-lab"\n/)
    assert.match(text, /\nsources: 3\n---\n\n# Solid-state batteries/)
  })

  it('files a Research-space run under general with project none', () => {
    const r = root()
    const { item } = saveResearch(r, run({ project: undefined, sessionId: 's-2' }))
    assert.equal(item.id.split('/')[0], 'general')
    assert.equal(item.project, undefined)
    assert.match(fs.readFileSync(path.join(r, item.id), 'utf8'), /\nproject: none\n/)
  })

  it('does not write the same report twice for one session and question', () => {
    const r = root()
    const first = saveResearch(r, run())
    const again = saveResearch(r, run({ date: '2026-11-23' }))
    assert.equal(again.created, false)
    assert.equal(again.item.id, first.item.id)
    assert.equal(listResearch(r).length, 1)
  })

  it('saves a rerun of the same question in one chat when the report differs', () => {
    const r = root()
    saveResearch(r, run())
    const again = saveResearch(r, run({ answer: `${REPORT}\nA newer finding.` }))
    assert.equal(again.created, true)
    assert.equal(listResearch(r).length, 2)
  })

  it('lets a run save later when its first write failed', () => {
    const r = root()
    fs.writeFileSync(path.join(r, 'cell-lab'), 'in the way')
    assert.throws(() => saveResearch(r, run()))
    fs.rmSync(path.join(r, 'cell-lab'))
    assert.equal(saveResearch(r, run()).created, true)
  })

  it('keeps two same-day runs with the same question apart', () => {
    const r = root()
    const a = saveResearch(r, run({ sessionId: 's-a' }))
    const b = saveResearch(r, run({ sessionId: 's-b' }))
    assert.notEqual(a.item.id, b.item.id)
    assert.equal(listResearch(r).length, 2)
  })

  it('redacts the question and the report with the given scrub', () => {
    const r = root()
    const scrub = (s: string) => s.replaceAll('SECRET', '[redacted]')
    const { item } = saveResearch(r, run({ answer: `${REPORT}\nkey SECRET`, question: 'Is SECRET safe?' }), scrub)
    const text = fs.readFileSync(path.join(r, item.id), 'utf8')
    assert.equal(text.includes('SECRET'), false)
    assert.equal(item.question, 'Is [redacted] safe?')
  })

  it('round-trips quotes in the question through the frontmatter', () => {
    const r = root()
    saveResearch(r, run({ question: 'What is "stable"?' }))
    assert.equal(listResearch(r)[0].question, 'What is "stable"?')
  })
})

describe('summaryOf and sourceCount', () => {
  it('takes the Answer line, else the first body line', () => {
    assert.equal(summaryOf(REPORT), 'Sulfide electrolytes lead on conductivity, oxides on stability.')
    assert.equal(summaryOf('# Title\n\nFirst para here.\n\nMore.'), 'First para here.')
  })

  it('caps the summary at 240 characters', () => {
    assert.equal(summaryOf(`**Answer:** ${'x'.repeat(400)}`).length, 240)
  })

  it('counts distinct links', () => {
    assert.equal(sourceCount(REPORT), 3)
  })
})

describe('listResearch', () => {
  it('lists newest first and caps the list', () => {
    const r = root()
    for (let i = 0; i < LIST_MAX + 2; i++) saveResearch(r, run({ question: `Question ${i}`, sessionId: `s-${i}`, at: 1_000 + i }))
    const list = listResearch(r)
    assert.equal(list.length, LIST_MAX)
    assert.equal(list[0].question, `Question ${LIST_MAX + 1}`)
    assert.ok(list.every((x, i) => i === 0 || list[i - 1].at >= x.at))
  })

  it('answers an empty list when nothing was saved', () => {
    assert.deepEqual(listResearch(path.join(root(), 'missing')), [])
  })
})

describe('seen, read, delete', () => {
  it('keeps seen state across reads', () => {
    const r = root()
    const { item } = saveResearch(r, run())
    assert.equal(listResearch(r)[0].seen, false)
    markSeen(r, item.id)
    assert.equal(listResearch(r)[0].seen, true)
  })

  it('reads the saved markdown back', () => {
    const r = root()
    const { item } = saveResearch(r, run())
    assert.match(readResearch(r, item.id), /# Solid-state batteries/)
  })

  it('refuses ids outside the library and the trash folder', () => {
    const r = root()
    saveResearch(r, run())
    assert.throws(() => readResearch(r, '../secret.md'))
    assert.throws(() => readResearch(r, '/etc/passwd'))
    assert.throws(() => readResearch(r, '.trash/cell-lab/x.md'))
    assert.throws(() => markSeen(r, '../x.md'))
  })

  it('moves a deleted run to .trash instead of removing it', () => {
    const r = root()
    const { item } = saveResearch(r, run())
    deleteResearch(r, item.id)
    assert.deepEqual(listResearch(r), [])
    assert.equal(fs.existsSync(path.join(r, item.id)), false)
    const trashed = fs.readdirSync(path.join(r, '.trash', 'cell-lab'))
    assert.equal(trashed.length, 1)
  })
})

describe('browser read reply', () => {
  it('answers the markdown in the reply, or 400 for an unknown id', () => {
    const r = root()
    const { item } = saveResearch(r, run())
    const ok = researchReadReply(r, item.id)
    assert.equal(ok.status, 200)
    assert.match(ok.body, /# Solid-state batteries/)
    assert.equal(researchReadReply(r, '../x.md').status, 400)
  })
})

describe('one save per run, and safe reads', () => {
  it('does not save a deleted run again, from the library or the trash', () => {
    const r = root()
    const { item } = saveResearch(r, run())
    deleteResearch(r, item!.id)
    const again = saveResearch(r, run({ date: '2026-11-23' }))
    assert.equal(again.created, false)
    assert.deepEqual(listResearch(r), [])
    assert.equal(fs.readdirSync(path.join(r, '.trash', 'cell-lab')).length, 1)
  })

  it('keeps the claim as the dedupe key when the saved file is gone', () => {
    const r = root()
    const { item } = saveResearch(r, run())
    fs.rmSync(path.join(r, item!.id))
    assert.equal(saveResearch(r, run()).created, false)
    assert.deepEqual(listResearch(r), [])
  })

  it('prunes old claims except for runs still in the library or the trash', () => {
    const r = root()
    saveResearch(r, run())
    const trashed = saveResearch(r, run({ sessionId: 's-2' })).item!
    const gone = saveResearch(r, run({ sessionId: 's-3' })).item!
    deleteResearch(r, trashed.id)
    fs.rmSync(path.join(r, gone.id))
    const claims = path.join(r, '.claims')
    const old = new Date(Date.now() - CLAIM_MAX_AGE - 1000)
    for (const f of fs.readdirSync(claims)) fs.utimesSync(path.join(claims, f), old, old)
    fs.writeFileSync(path.join(claims, 'fresh'), '')
    pruneClaims(r)
    assert.equal(fs.readdirSync(claims).length, 3)
    assert.equal(saveResearch(r, run()).created, false)
    assert.equal(saveResearch(r, run({ sessionId: 's-2' })).created, false)
    assert.equal(saveResearch(r, run({ sessionId: 's-3' })).created, true)
  })

  it('caps the saved answer at 1 MiB', () => {
    const r = root()
    const { item } = saveResearch(r, run({ answer: `**Answer:** ok\n${'x'.repeat(3 << 20)}` }))
    assert.ok(fs.statSync(path.join(r, item!.id)).size <= (1 << 20) + 4096)
  })

  it('reads at most 1 MiB of a report', () => {
    const r = root()
    const { item } = saveResearch(r, run())
    fs.writeFileSync(path.join(r, item!.id), `# Big\n${'y'.repeat(3 << 20)}`)
    assert.ok(readResearch(r, item!.id).length < (1 << 20) + 200)
  })

  it('refuses a report that is a symlink to a file outside the library', () => {
    const r = root(), outside = path.join(root(), 'secret.md')
    fs.writeFileSync(outside, '# secret')
    fs.mkdirSync(path.join(r, 'general'), { recursive: true })
    fs.symlinkSync(outside, path.join(r, 'general', 'link.md'))
    assert.throws(() => readResearch(r, 'general/link.md'))
  })

  it('refuses a folder that is a symlink out of the library', () => {
    const r = root(), outside = root()
    fs.writeFileSync(path.join(outside, 'x.md'), '# x')
    fs.symlinkSync(outside, path.join(r, 'general'))
    assert.throws(() => readResearch(r, 'general/x.md'))
  })
})
