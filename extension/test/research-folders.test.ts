import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { addFolder, autoFileResearch, beginOrganizeResearch, deleteFolder, finishOrganizeResearch, listFolders, moveResearch, organizePrompt, organizeResearch, parseOrganizeReply, researchState, renameFolder, undoOrganize } from '../src/hub/research-folders'
import { listResearch, saveResearch } from '../src/hub/research-library'

const dirs: string[] = []
const root = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'research-folders-')); dirs.push(d); return d }
afterEach(() => { dirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })) })

describe('research folders', () => {
  it('adds, renames and deletes a folder without deleting reports', () => {
    const r = root(), item = saveResearch(r, { question: 'Q', answer: '# Q', chat: 'c', sessionId: 's', date: '2026-11-24', at: 1 }).item!
    addFolder(r, 'Markets')
    moveResearch(r, [item.id], 'Markets')
    renameFolder(r, 'Markets', 'Industry')
    assert.equal(listResearch(r)[0].folder, 'Industry')
    deleteFolder(r, 'Industry')
    assert.equal(listResearch(r)[0].folder, undefined)
    assert.equal(fs.existsSync(path.join(r, item.id)), true)
  })

  it('cleans names and defaults auto organization on', () => {
    const r = root()
    addFolder(r, '  One\n  line  ')
    assert.throws(() => addFolder(r, 'one line'), /already exists/)
    assert.throws(() => addFolder(r, 'unfiled'), /pick another/)
    assert.deepEqual(listFolders(r).names, ['One line'])
    assert.equal(listFolders(r).auto, true)
  })

  it('undoes only its own assignments and keeps a created folder with user filed reports', () => {
    const r = root(), a = saveResearch(r, { question: 'A', answer: '# A', chat: 'c', sessionId: 'a', date: '2026-11-24', at: 1 }).item!, b = saveResearch(r, { question: 'B', answer: '# B', chat: 'c', sessionId: 'b', date: '2026-11-24', at: 2 }).item!
    addFolder(r, 'User')
    organizeResearch(r, { [a.id]: 'Science', [b.id]: 'Science' }, ['Science'])
    moveResearch(r, [b.id], 'User')
    moveResearch(r, [a.id], undefined)
    undoOrganize(r)
    assert.equal(listResearch(r).find(x => x.id === a.id)?.folder, undefined)
    assert.equal(listResearch(r).find(x => x.id === b.id)?.folder, 'User')
    assert.deepEqual(listFolders(r).names, ['User'])
  })

  it('validates all ids before creating a folder and allows case-only rename', () => {
    const r = root(), item = saveResearch(r, { question: 'Q', answer: '# Q', chat: 'c', sessionId: 's', date: '2026-11-24', at: 1 }).item!
    addFolder(r, 'Markets')
    renameFolder(r, 'Markets', 'MARKETS')
    assert.deepEqual(listFolders(r).names, ['MARKETS'])
    assert.throws(() => moveResearch(r, [item.id, 'bad/id/no.md'], 'New folder'))
    assert.deepEqual(listFolders(r).names, ['MARKETS'])
  })

  it('ignores malformed undo data and keeps the organize time', () => {
    const r = root(), item = saveResearch(r, { question: 'Q', answer: '# Q', chat: 'c', sessionId: 's', date: '2026-11-24', at: 1 }).item!
    organizeResearch(r, { [item.id]: 'Science' }, ['Science'], 1234)
    assert.equal(listFolders(r).undo?.at, 1234)
    fs.writeFileSync(path.join(r, '.folders.json'), JSON.stringify({ names: ['Science'], of: {}, undo: { of: null, after: 'bad', created: null } }))
    assert.doesNotThrow(() => listFolders(r))
    assert.doesNotThrow(() => undoOrganize(r))
  })

  it('parses fenced and line replies, ignores invalid numbers, and limits folder names', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    const parsed = parseOrganizeReply('```json\n{"1":"Power Grid Markets Research","2":"Climate Policy and Economics","3":"Too Many Words Should Be Dropped","4":"Ocean Data Review","0":"Bad Index","9":"Ignore Me"}\n```', rows, [])
    assert.deepEqual(parsed.assignments, { a: 'Power Grid Markets', b: 'Climate Policy and', d: 'Ocean Data Review' })
    assert.deepEqual(parsed.created, ['Power Grid Markets', 'Climate Policy and', 'Ocean Data Review'])
    assert.deepEqual(parseOrganizeReply('junk\n99: Bad\n2: A valid folder', rows, []).assignments, { b: 'A valid folder' })
  })

  it('keeps organize busy and problem through a state relist and blocks duplicate runs', async () => {
    const r = root(), item = saveResearch(r, { question: 'Q', answer: '# Q', chat: 'c', sessionId: 's', date: '2026-11-24', at: 1 }).item!
    assert.equal(beginOrganizeResearch(r), true)
    assert.equal(beginOrganizeResearch(r), false)
    assert.equal(researchState(r).researchFolders.busy, true)
    assert.match(organizePrompt(researchState(r)), /"Q"/)
    finishOrganizeResearch(r, 'Smart organize could not sort these reports. Try again.')
    assert.equal(researchState(r).researchFolders.busy, undefined)
    assert.equal(researchState(r).researchFolders.problem, 'Smart organize could not sort these reports. Try again.')
    let calls = 0
    addFolder(r, 'Pinned')
    moveResearch(r, [item.id], 'Pinned')
    await autoFileResearch(r, item, async () => { calls++; return 'Other' })
    assert.equal(calls, 0)
    assert.equal(researchState(r).researchFolders.problem, 'Smart organize could not sort these reports. Try again.')
    undoOrganize(r)
    assert.equal(researchState(r).researchFolders.problem, undefined)
  })

  it('does not override a folder assigned while auto-file is waiting on the model', async () => {
    const r = root(), item = saveResearch(r, { question: 'Q', answer: '# Q', chat: 'c', sessionId: 's', date: '2026-11-24', at: 1 }).item!
    let answer!: (value: string) => void
    const pending = autoFileResearch(r, item, () => new Promise(resolve => { answer = resolve }))
    addFolder(r, 'Pinned')
    moveResearch(r, [item.id], 'Pinned')
    answer('Other')
    await pending
    assert.equal(listResearch(r)[0].folder, 'Pinned')
  })
})
