/** Saved research runs: the markdown folder, the list, seen state, reads and trash. */
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ADDED } from '../src/hub/research-question'
import { researchReadReply } from '../src/hub/routes'
import { CLAIM_MAX_AGE, LIST_MAX, addResearchAsk, addToResearch, bindResearchAsk, cancelResearchAsk, deleteResearch, pruneClaims, listResearch, markSeen, readResearch, removeResearchAsk, saveResearch as rawSave, sourceCount, summaryOf } from '../src/hub/research-library'
import { moveResearch } from '../src/hub/research-folders'

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
    assert.match(text, /\nsources: 3\nclaims: \["[a-f0-9]+"\]\n---\n\n# Solid-state batteries/)
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
    assert.equal('asks' in list[0], false)
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
    // The report only: the page shows this text as it is, so the file's header stays out.
    assert.ok(readResearch(r, item.id).startsWith('# Solid-state batteries'), readResearch(r, item.id).slice(0, 80))
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

describe('addToResearch', () => {
  it('replaces the added header fields across three additions and keeps every claim', () => {
    const r = root(), first = saveResearch(r, run())
    const times = [1_800_000_100_000, 1_800_000_200_000, 1_800_000_300_000]
    for (let i = 0; i < times.length; i++) {
      addToResearch(r, first.item.id, { ...run({ sessionId: `follow-${i}`, question: `More ${i}`, answer: `**Answer:** Added ${i}.` }), at: times[i] }, s => s)
    }
    const text = fs.readFileSync(path.join(r, first.item.id), 'utf8')
    assert.equal(listResearch(r).find(x => x.id === first.item.id)?.added?.n, 3)
    assert.match(text, /addedAt: 1800000300000/)
    const claims = text.match(/^claims: (.+)$/m)!
    assert.equal(new Set(JSON.parse(claims[1])).size, 4)
    assert.equal((text.match(/^claims:/gm) ?? []).length, 1)
    const claimDir = path.join(r, '.claims'), old = new Date(Date.now() - CLAIM_MAX_AGE - 1000)
    for (const file of fs.readdirSync(claimDir)) fs.utimesSync(path.join(claimDir, file), old, old)
    pruneClaims(r)
    assert.equal(saveResearch(r, run()).created, false)
    for (let i = 0; i < times.length; i++) assert.equal(saveResearch(r, run({ sessionId: `follow-${i}`, question: `More ${i}`, answer: `**Answer:** Added ${i}.` })).created, false)
  })

  it('preserves original and unparsed source lines and ignores Sources-like headings', () => {
    const r = root(), original = '# First\n\nOriginal [1].\n\n## Sources of income\nKeep this heading.\n\n## Sources\n- [1] Alpha https://example.com/a\n- [unknown source syntax]\n'
    const first = saveResearch(r, run({ answer: original }))
    addToResearch(r, first.item.id, { ...run({ sessionId: 'follow', question: 'More', answer: '# Follow\n\n##### Deep\n\n###### Deepest\n\nNew [1].\n\n## Sources\n[1] Beta https://example.com/b\n- odd source row\n```md\n## Sources\n[8] code https://example.com/code\n```\n' }), at: 1_800_000_100_000 }, s => s)
    const body = readResearch(r, first.item.id)
    assert.ok(body.includes('## Sources of income\nKeep this heading.'))
    assert.ok(body.includes('###### Deep\n\n###### Deepest'))
    assert.ok(body.includes('## Sources\n- [1] Alpha https://example.com/a\n- [unknown source syntax]\n- [2] Beta https://example.com/b\n- odd source row'))
    assert.ok(body.includes('```md\n## Sources\n[8] code https://example.com/code\n```'), body)
    assert.equal((body.match(/^## Sources$/gm) ?? []).length, 2)
  })

  it('uses the last exact Sources heading and leaves earlier source blocks untouched', () => {
    const r = root(), first = saveResearch(r, run({ answer: '# First\n\n## Sources:\n- [1] Alpha https://example.com/a\n\n## Appendix\nKeep it.\n\n### Sources (2)\n- [2] Beta https://example.com/b\n' }))
    addToResearch(r, first.item.id, { ...run({ sessionId: 'follow', question: 'More', answer: '# Follow\n\nNew [1].\n\n## Sources\n[1] Gamma https://example.com/c\n' }), at: 1_800_000_100_000 }, s => s)
    const body = readResearch(r, first.item.id)
    assert.ok(body.includes('## Sources:\n- [1] Alpha https://example.com/a\n'))
    assert.ok(body.includes('### Sources (2)\n- [2] Beta https://example.com/b\n- [3] Gamma https://example.com/c'))
    assert.ok(body.includes('New [3].'))
    assert.ok(body.includes('## Appendix\nKeep it.'))
  })

  it('reads markdown link sources, so a follow-up never reuses a taken number', () => {
    const dir = root()
    const one = saveResearch(dir, run({ answer: '**Answer:** Yes [1].\n\n## Sources\n- [1] [Rockstar, VI](https://a.test/VI)\n- [2] [PC Gamer](https://b.test/x), read 2026' })).item
    const add = '**Answer:** More [1][2].\n\n## Sources\n- [1] [New one](https://c.test/n) (2026)\n- [2] [Rockstar again](https://a.test/VI)'
    addToResearch(dir, one.id, run({ question: 'And?', answer: add, sessionId: 's2' }))
    const text = readResearch(dir, one.id)
    assert.match(text, /More \[3\]\[1\]\./)
    assert.ok(text.split('\n').some(l => l.startsWith('## ') && ADDED.test(l.slice(3))))
    assert.ok(text.endsWith('- [1] [Rockstar, VI](https://a.test/VI)\n- [2] [PC Gamer](https://b.test/x), read 2026\n- [3] [New one](https://c.test/n) (2026)\n'))
  })

  it('merges sources by URL, renumbers citations and keeps the original answer', () => {
    const r = root(), first = saveResearch(r, run({ answer: '# First\n\nOriginal [1].\n\n## Sources\n- [1] Alpha https://example.com/a\n' }))
    const added = addToResearch(r, first.item.id, { ...run({ sessionId: 'follow', question: 'New angle', answer: '# Follow-up\n\nNew [1] and [2](https://example.com/a).\n\n## Sources\n[1] Alpha. https://example.com/a\n[2] Beta https://example.com/b\n' }), at: 1_800_000_100_000 }, s => s)
    const body = readResearch(r, first.item.id)
    assert.equal(added.item?.id, first.item.id)
    assert.match(body, /Original \[1\]\./)
    assert.match(body, /## Added .*: New angle\n\nNew \[1\] and \[2\]\(https:\/\/example.com\/a\)/)
    assert.match(body, /\[2\] Beta https:\/\/example.com\/b/)
    assert.equal((body.match(/^## Sources$/gm) ?? []).length, 1)
    assert.equal(listResearch(r)[0].added?.n, 1)
  })

  it('falls back to a separate report when appending would exceed 1 MiB', () => {
    const r = root(), first = saveResearch(r, run({ answer: '# First\n\n' + 'x'.repeat((1 << 20) - 1000) }))
    moveResearch(r, [first.item.id], 'Pinned')
    const added = addToResearch(r, first.item.id, { ...run({ sessionId: 'follow', question: 'More', project: undefined, answer: '# More\n\n' + 'y'.repeat(2000) }) }, s => s)
    assert.notEqual(added.item?.id, first.item.id)
    assert.ok(fs.statSync(path.join(r, first.item.id)).size <= 1 << 20)
    assert.equal(added.item?.project, first.item.project)
    assert.equal(listResearch(r).find(item => item.id === added.item?.id)?.folder, 'Pinned')
  })

  it('keeps original text after Sources and the original claim when pruning', () => {
    const r = root(), original = run({ answer: '# First\n\nOriginal text.\n\n## Sources\n- [1] Alpha https://example.com/a\n\n## Appendix\nKeep this.' }), first = saveResearch(r, original)
    addToResearch(r, first.item.id, { ...run({ sessionId: 'follow', question: 'More', answer: '# More\n\nNew [1].\n\n## Sources\n[1] Beta. https://example.com/b' }), at: 1_800_000_100_000 }, s => s)
    const text = fs.readFileSync(path.join(r, first.item.id), 'utf8')
    assert.match(text, /## Appendix\nKeep this\./)
    const claims = path.join(r, '.claims'), old = new Date(Date.now() - CLAIM_MAX_AGE - 1000)
    for (const f of fs.readdirSync(claims)) fs.utimesSync(path.join(claims, f), old, old)
    pruneClaims(r)
    assert.equal(saveResearch(r, original).created, false)
  })

  it('does not rewrite unchanged ask state and catches storage failures', () => {
    const r = root(), item = saveResearch(r, run()).item
    addResearchAsk(r, item.id, 'More')
    bindResearchAsk(r, 'ask-session', item.id, 'More')
    const file = path.join(r, '.asks.json'), inode = fs.statSync(file).ino
    bindResearchAsk(r, 'ask-session', item.id, 'More')
    removeResearchAsk(r, 'absent')
    cancelResearchAsk(r, item.id, 'absent')
    assert.equal(fs.statSync(file).ino, inode)
    fs.rmSync(file)
    fs.mkdirSync(file)
    assert.doesNotThrow(() => removeResearchAsk(r, 'ask-session'))
    assert.doesNotThrow(() => bindResearchAsk(r, 'ask-session', item.id, 'More'))
    assert.doesNotThrow(() => cancelResearchAsk(r, item.id, 'More'))
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
