/**
 * To-do fields added in the revamp: needsOk, notBefore, short; stale suggestion closing, recent-done repeats, titles at intake.
 */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { addTodo, afterEnd, afterFinish, autoStartPlan, acceptSuggestion, changelogFiles, claimItems, clearGone, commitCovered, dropped, editTodo, emptyDoc, filterAsk, finishItem, laterOnly, laterPrompt, laterTitled, mergeDocs, parseDoc, parseTitled, readDoc, restoreTicked, shippedSince, storeFor, todoFinished, toolStep, upcoming } from '../src/hub/todo'
import type { ChatProgress, TodoDoc, TodoItem } from '../src/hub/types'

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-home-'))
process.env.HOME = HOME
process.env.USERPROFILE = HOME
after(() => fs.rmSync(HOME, { recursive: true, force: true }))

const chat = (over: Partial<ChatProgress> = {}): ChatProgress => ({ sessionId: 's1', cwd: '/p', state: 'done', roles: [], tasks: [], startedAt: 0, at: 0, ...over })
const item = (id: string, more: Partial<TodoItem> = {}): TodoItem => ({ id, text: `do ${id}`, at: 0, ...more })
const doc = (more: Partial<TodoDoc> = {}): TodoDoc => ({ ...emptyDoc(), ...more })
const DAY = 864e5
const LONG = 'Check that the nightly sync still keeps the worktree folders it created after a failed merge'

describe('needsOk and notBefore', () => {
  const now = 10 * 60_000
  const base = { on: true, folder: '/p', busy: false, limited: false, tried: new Set<string>(), now }
  const ids = (p: ReturnType<typeof autoStartPlan>) => p?.items.map(t => t.id)

  it('reads both from disk and drops malformed values', () => {
    const raw = { version: 1, removed: {}, todo: [
      { id: 'a', text: 'x', at: 1, needsOk: true, notBefore: 5000 },
      { id: 'b', text: 'x2', at: 1, needsOk: false, notBefore: 0 },
      { id: 'c', text: 'x3', at: 1, needsOk: 'yes', notBefore: 'soon' },
      { id: 'd', text: 'x4', at: 1, notBefore: -3 },
    ] }
    const t = parseDoc(JSON.stringify(raw)).todo
    assert.deepEqual(t.map(x => [x.needsOk, x.notBefore]), [[true, 5000], [false, 0], [undefined, undefined], [undefined, undefined]])
  })

  it('auto-start skips an item that needs OK or waits for its date, Start does not', () => {
    const todo = [item('ok', { needsOk: true }), item('later', { notBefore: now + 1 }), item('go')]
    assert.deepEqual(ids(autoStartPlan({ ...base, todo })), ['go'])
    assert.equal(autoStartPlan({ ...base, todo: todo.slice(0, 2) }), undefined)
    // The date passed, or the OK was given: it runs.
    assert.deepEqual(ids(autoStartPlan({ ...base, todo: [item('x', { notBefore: now }), item('y', { needsOk: false })] })), ['x'])
    // Start (manual claim) runs a gated item.
    const d = claimItems(doc({ todo }), ['ok'], 'c1', new Set(), now, true)
    assert.equal(d.todo.find(t => t.id === 'ok')?.chat, 'c1')
  })

  it('Start clears the gates it overrode, so the chat ending does not ask for the OK again', () => {
    const todo = [item('ok', { needsOk: true }), item('later', { notBefore: now + 9 }), item('go')]
    const d = claimItems(doc({ todo }), ['ok', 'later', 'go'], 'c1', new Set(), now, true)
    const by = (id: string) => d.todo.find(t => t.id === id)!
    assert.equal(by('ok').needsOk, false)
    assert.equal(by('later').notBefore, 0)
    assert.equal('needsOk' in by('go') || 'notBefore' in by('go'), false)
    // Its chat ends unfinished: the item is stopped, not back to waiting for an OK or a date.
    const gone = clearGone(d, new Set(), now + 10 * 60_000)
    assert.deepEqual(upcoming(gone.todo, 0, new Set(), now + 10 * 60_000).held.map(h => [h.id, h.why]), [['ok', 'stopped'], ['later', 'stopped'], ['go', 'stopped']])
  })

  it('an item waiting on a gated prerequisite is held with that reason', () => {
    const p = upcoming([item('p', { needsOk: true, before: 'x' }), item('x'), item('d', { notBefore: now + 5 }), item('s', { stopped: true, needsOk: true })], 0, new Set(), now)
    assert.deepEqual(p.runs, [])
    assert.deepEqual(p.held, [{ id: 'p', why: 'ok' }, { id: 'x', why: 'ok' }, { id: 'd', why: 'date' }, { id: 's', why: 'ok' }])
    // Later, the date has passed.
    assert.deepEqual(upcoming([item('d', { notBefore: now + 5 })], 0, new Set(), now + 5).runs, [{ n: 1, ids: ['d'] }])
  })

  it('blocked and hand steps outrank a gate in the held reason', () => {
    const p = upcoming([item('k', { why: 'you', before: 'x' }), item('g', { needsOk: true, before: 'x' }), item('x')], 0, new Set(), now)
    assert.deepEqual(p.held.find(h => h.id === 'x'), { id: 'x', why: 'you' })
  })

  it('an older device that drops the fields cannot clear them in a merge or a sync check', () => {
    const mine = doc({ todo: [item('a', { at: 1, needsOk: true, notBefore: 9000 })] })
    const old = doc({ todo: [{ id: 'a', text: 'do a', at: 2 }] })
    const m = mergeDocs(mine, old).todo[0]
    assert.equal(m.needsOk, true)
    assert.equal(m.notBefore, 9000)
    assert.equal(dropped(mine, old), true)
    assert.equal(dropped(mine, mine), false)
    // A device that gave the OK says false, which is not the same as unset.
    const given = doc({ todo: [item('a', { at: 3, needsOk: false, notBefore: 0 })] })
    const g = mergeDocs(mine, given).todo[0]
    assert.equal(g.needsOk, false)
    assert.equal(g.notBefore, 0)
    assert.equal(dropped(mine, given), false)
  })

  it('todo_add marks an item as needing OK', () => {
    const r = toolStep(doc(), { op: 'add', text: 'Proposed fix: rotate the staging key', needsOk: true, session: 'c1' }, 5, 'n1')
    assert.equal(r.doc.todo[0].needsOk, true)
    assert.match(r.said, /needs your OK/)
    assert.equal('needsOk' in toolStep(doc(), { op: 'add', text: 'plain item', session: 'c1' }, 5, 'n2').doc.todo[0], false)
  })
})

describe('stale suggestions', () => {
  const sug = (id: string, text: string, from: string): TodoItem => ({ id, text, at: 1, from, why: 'later' })

  it('doing an item closes the same chat\'s suggestions about the same thing, nothing else', () => {
    const d = doc({
      todo: [item('cf', { text: 'Release the Tailscale phone 403 fix', from: 'c83' })],
      suggested: [
        sug('f0', 'Tailscale viewing is broken on phone', 'c83'),
        sug('f1', 'Rotate the staging deploy keys', 'c83'),
        sug('f2', 'Tailscale viewing is broken on phone, retest', 'other'),
      ],
    })
    const out = finishItem(d, 'cf', 'c83', 100)
    assert.deepEqual(out?.suggested?.map(s => s.id), ['f1', 'f2'])
    assert.equal(out.removed.f0, 100)
  })

  it('an item with no source closes nothing', () => {
    const d = doc({ todo: [item('a', { text: 'Release the Tailscale phone fix' })], suggested: [sug('f0', 'Tailscale viewing is broken on phone', 'c83')] })
    assert.equal(finishItem(d, 'a', undefined, 100).suggested?.length, 1)
  })

  it('a commit message ticks the suggestions and items the model says it covers, with the commit as proof', async () => {
    const dir = path.join(HOME, 'todo-files'), folder = path.join(HOME, 'not-a-repo')
    fs.mkdirSync(folder, { recursive: true })
    const s = await storeFor(folder, dir)
    const seed = doc({ todo: [item('t1', { text: 'Fix worktree merges into main' })], suggested: [sug('s1', 'Allow select all for design library in tools', 'c1'), sug('s2', 'Add a dark theme', 'c1')] })
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(s.file!, JSON.stringify(seed))
    let asked = ''
    const out = await commitCovered(s, { sha: 'dbe3933abc', message: 'Switchboard 0.21.87: All and None for the design library\n\n- select all in tools' }, async q => { asked = q; return 's1' }, 200)
    assert.match(asked, /All and None for the design library/)
    assert.match(asked, /s1: Allow select all/)
    assert.deepEqual(out?.suggested?.map(x => x.id), ['s2'])
    assert.deepEqual(out?.ticked?.map(x => [x.id, x.shipped?.sha]), [['s1', 'dbe3933']])
    assert.deepEqual((await readDoc(s)).todo.map(t => t.id), ['t1'])
    // Nothing covered, or the model failing: the list is as it was.
    assert.equal(await commitCovered(s, { sha: 'abc1234', message: 'x' }, async () => 'none', 300), undefined)
    assert.equal(await commitCovered(s, { sha: 'abc1234', message: 'x' }, async () => { throw new Error('offline') }, 300), undefined)
    assert.equal((await readDoc(s)).ticked?.length, 1)
  })

  it('shippedSince: first look records only; later looks give the new head and only unseen release notes', () => {
    const first = shippedSince({}, '/r', 'h1', ['Old line one about the map', 'Old line two about sync'])
    assert.equal(first.was, undefined)
    assert.deepEqual(first.notes, [])
    const next = shippedSince(first.seen, '/r', 'h2', ['Design library in Tools has All and None', 'Old line one about the map', 'Old line two about sync'])
    assert.equal(next.was, 'h1')
    assert.deepEqual(next.notes, ['Design library in Tools has All and None'])
    const same = shippedSince(next.seen, '/r', 'h2', ['Design library in Tools has All and None', 'Old line one about the map', 'Old line two about sync'])
    assert.equal(same.was, undefined)
    assert.deepEqual(same.notes, [])
    assert.deepEqual(same.seen, next.seen)
    // Past the room, the rest wait for the next look instead of being lost.
    const many = ['note number one is here', 'note number two is here', 'note number three is here']
    const a = shippedSince(first.seen, '/r', 'h1', many, 30)
    assert.deepEqual(a.notes, ['note number one is here'])
    const b = shippedSince(a.seen, '/r', 'h1', many, 30)
    assert.deepEqual(b.notes, ['note number two is here'])
  })

  it('changelogFiles: tracked root and one-down CHANGELOGs only, never vendored, deeper or untracked', async () => {
    const root = fs.mkdtempSync(path.join(HOME, 'cl-'))
    execFileSync('git', ['init', '-q'], { cwd: root })
    const files = ['CHANGELOG.md', 'extension/CHANGELOG.md', 'vendor/CHANGELOG.md', 'a/b/CHANGELOG.md', 'untracked/CHANGELOG.md']
    for (const f of files) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), '# c\n') }
    execFileSync('git', ['add', ...files.slice(0, 4)], { cwd: root })
    assert.deepEqual(await changelogFiles(root), ['CHANGELOG.md', 'extension/CHANGELOG.md'].map(f => path.join(root, f)))
  })

  it('kept survives a read from disk and a merge with an older device\'s newer copy', () => {
    const raw = JSON.stringify(doc({ todo: [item('k1', { kept: true }), item('k2', { kept: undefined })] }))
    assert.deepEqual(parseDoc(raw).todo.map(t => t.kept), [true, undefined])
    const mine = doc({ todo: [item('k1', { at: 1, kept: true })] })
    assert.equal(mergeDocs(mine, doc({ todo: [item('k1', { at: 9 })] })).todo[0].kept, true)
  })

  it('a commit never ticks a kept item or a For you hand step, same as the shipped check', async () => {
    const dir = path.join(HOME, 'todo-files-guard'), folder = path.join(HOME, 'not-a-repo-guard')
    fs.mkdirSync(folder, { recursive: true })
    const s = await storeFor(folder, dir)
    const hid = crypto.createHash('sha1').update('c\nyou\nSign in to the store').digest('hex').slice(0, 8)
    const seed = doc({ todo: [item('k1', { text: 'Fix worktree merges', kept: true }), item(hid, { text: 'Sign in to the store', why: 'you', from: 'c' }), item('t1', { text: 'Fix the sync' })] })
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(s.file!, JSON.stringify(seed))
    let asked = ''
    const out = await commitCovered(s, { sha: 'abcdef0123', message: 'fix worktree merges, sign in, fix the sync' }, async q => { asked = q; return `k1, ${hid}, t1` }, 5)
    assert.doesNotMatch(asked, /Fix worktree merges|Sign in to the store/)
    assert.deepEqual(out?.ticked?.map(x => x.id), ['t1'])
    assert.deepEqual((await readDoc(s)).todo.map(t => t.id).sort(), [hid, 'k1'].sort())
  })

  it('the filter and later-work checks run on sonnet', async () => {
    const calls: unknown[][] = []
    await filterAsk(async (...a) => { calls.push(a); return 'x' })('q', 5)
    assert.deepEqual(calls, [['q', 5, 'sonnet']])
  })
})

describe('recent done repeats', () => {
  it('todo_add refuses the same text as an item done in the last 7 days, not an older one or another wording', () => {
    const now = 20 * DAY
    const d = finishItem(addTodo(emptyDoc(), 'Merge or drop the Fable 5.2 audit', 1, 'a'), 'a', 'c1', now - 3 * DAY)
    const r = toolStep(d, { op: 'add', text: '  merge OR drop the fable 5.2 audit ', session: 'c2' }, now, 'b')
    assert.equal(r.doc, d)
    assert.match(r.said, /Already done .*: Merge or drop the Fable 5.2 audit/)
    assert.equal(toolStep(d, { op: 'add', text: 'Merge or drop the Fable 5.2 audit tests', session: 'c2' }, now, 'b').doc.todo.length, 1)
    assert.equal(toolStep(d, { op: 'add', text: 'Merge or drop the Fable 5.2 audit', session: 'c2' }, now + 5 * DAY, 'b').doc.todo.length, 1)
  })

  it('an open repeat still answers with the open item', () => {
    const d = addTodo(emptyDoc(), 'Ship the thing', 1, 'a')
    assert.match(toolStep(d, { op: 'add', text: 'ship the thing' }, 5, 'b').said, /Already on the list as a/)
  })
})

describe('short titles', () => {
  it('asks for titles with the later-work check and reads them back, numbers alone still work', async () => {
    assert.match(laterPrompt(['x']), /60 characters/)
    assert.deepEqual(parseTitled('1: Check worktree cleanup\n3. Rotate keys', 3), [{ i: 0, title: 'Check worktree cleanup' }, { i: 2, title: 'Rotate keys' }])
    assert.deepEqual(parseTitled('1, 3', 3), [{ i: 0 }, { i: 2 }])
    assert.deepEqual(parseTitled('none', 3), [])
    assert.deepEqual(parseTitled('1-3', 3), [{ i: 0 }, { i: 2 }])
    assert.equal(parseTitled('not sure', 3), undefined)
    // A digit inside a title is not a pick; an out of range line is ignored.
    assert.deepEqual(parseTitled('2: Fix the 1 bug\n7: far', 3), [{ i: 1, title: 'Fix the 1 bug' }])
    const p = chat({ report: { done: ['x'], left: [LONG, 'Add rate limits'] } })
    assert.deepEqual(await laterTitled(p, async () => `1: ${'t'.repeat(90)}\n2: Rate limits`), [{ text: LONG, short: 't'.repeat(60) }, { text: 'Add rate limits', short: 'Rate limits' }])
    assert.deepEqual(await laterOnly(p, async () => '1: Worktrees\n2: Limits'), [LONG, 'Add rate limits'])
    assert.deepEqual(await laterTitled(p, async () => { throw new Error('x') }), [{ text: LONG }, { text: 'Add rate limits' }])
  })

  it('a suggestion over 60 characters gets the model title, else a cut of its own words; short ones get none', async () => {
    const p = chat({ sessionId: 'tt', report: { done: ['a'], left: [LONG, 'Add rate limits', 'Tidy the sync logs in the worktree cleanup job for the other repos too'] } })
    const was = emptyDoc()
    const out = await todoFinished({ file: path.join(HOME, 'titles.json') }, p, async q => (/Which open items/.test(q) ? 'none' : '1: Keep worktrees after merge fail\n2: Limits\n3'))
    const s = out.suggested ?? []
    assert.equal(s.length, 3)
    assert.equal(s.find(x => x.text === LONG)?.short, 'Keep worktrees after merge fail')
    assert.equal(s.find(x => x.text === 'Add rate limits')?.short, undefined)
    const third = s.find(x => x.text.startsWith('Tidy'))!
    assert.ok(third.short && third.short.length <= 60 && third.text.startsWith(third.short.replace(/\.\.\.$/, '')))
    assert.equal(was.suggested, undefined)
  })

  it('the title follows accept, done and put back, and a text edit drops a stale one', () => {
    const d = afterFinish(emptyDoc(), chat({ report: { done: [], left: [LONG] } }), [], 1, [LONG], { [LONG]: 'Keep worktrees' })
    const id = d.suggested![0].id
    assert.equal(d.suggested![0].short, 'Keep worktrees')
    assert.equal(parseDoc(JSON.stringify(d)).suggested![0].short, 'Keep worktrees')
    const took = acceptSuggestion(d, id, 2)
    assert.equal(took.todo[0].short, 'Keep worktrees')
    const done = finishItem(took, took.todo[0].id, undefined, 3)
    assert.equal(done.ticked![0].short, 'Keep worktrees')
    assert.equal(restoreTicked(done, took.todo[0].id, 4, 'n1').todo[0].short, 'Keep worktrees')
    const edited = editTodo(took, took.todo[0].id, 'Keep the worktree folders after a merge fails', 5)
    assert.equal('short' in edited.todo[0], false)
    // The older copy, merged back, does not bring the stale title over the new text.
    assert.equal(mergeDocs(took, edited).todo[0].short, undefined)
    // The same text keeps its title through a merge with a copy that lost it.
    assert.equal(mergeDocs(took, { ...took, todo: [{ id: took.todo[0].id, text: took.todo[0].text, at: 9 }] }).todo[0].short, 'Keep worktrees')
  })

  it('todo_add keeps working with long text and no title', () => {
    const r = toolStep(emptyDoc(), { op: 'add', text: LONG, session: 'c1' }, 5, 'n1')
    assert.ok((r.doc.todo[0].short ?? '').length <= 60)
  })
})
