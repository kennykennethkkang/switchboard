/**
 * Per-project to-do lists: merging, the finish rules, and the hidden ref against temp repos
 * with a temp bare remote. Never touches a real repo.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { addTodo, afterEnd, afterFinish, backInChat, laterOnly, parseKept, clearGone, editTodo, emptyDoc, finishPrompt, hostId, mergeDocs, moveChat, ownerRepo, parseDoneIds, readDoc, readOptIn, removeItem, setOptIn, startTodo, storeFor, syncDoc, syncMode, todoFinished, todoEnded, updateDoc, withLock, TODO_REF, remoteSeen, replaceRemote, runOrder, runMessage, toolStep, mentions, restoreTicked, projectOf, finishItem, parseDoc, whyLeft, acceptSuggestion, dismissSuggestion, addMissed, approvedMissed, chatApproved, chatMissed, dropped, autoStartPlan, claimItems, claimRemote, claimTodo, prune, junkPath, extraTodoFolders, loadLocalTodos, tickShipped, optInFile, moveTodo, setPilot, runLabel, heldLabel, todoEnv, upcoming, START_GRACE_MS, holdReason , TodoStore , shortOf } from '../src/hub/todo'
import { commandProblem, handleHub } from '../src/hub/routes'
import { git } from '../src/hub/git'
import { approvedFields } from '../src/hub/approve'
import { archiveRow, recordArchive } from '../src/hub/chains'
import { HubService, hub } from '../src/hub/hub-service'
import type { ChatProgress, TodoDoc, TodoItem } from '../src/hub/types'

// The host id lands in a temp HOME, never the real ~/.claude.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-home-'))
process.env.HOME = HOME
process.env.USERPROFILE = HOME
after(() => fs.rmSync(HOME, { recursive: true, force: true }))

const chat = (over: Partial<ChatProgress> = {}): ChatProgress => ({ sessionId: 's1', cwd: '/p', state: 'done', roles: [], tasks: [], startedAt: 0, at: 0, ...over })

describe('todo project', () => {
  it('files a repo subfolder under the repo even when the subfolder is listed, so its items stay on one list', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-todo-proj-'))
    const was = hub.get().projects
    try {
      const repo = path.join(tmp, 'switchboard'), sub = path.join(repo, 'extension'), plain = path.join(tmp, 'notes')
      fs.mkdirSync(path.join(repo, '.git'), { recursive: true })
      fs.mkdirSync(sub)
      fs.mkdirSync(path.join(plain, 'a'), { recursive: true })
      hub.set({ projects: [{ name: 'extension', path: sub, kind: 'project', isOpen: false }, { name: 'notes', path: plain, kind: 'project', isOpen: false }] })
      assert.equal(projectOf(sub), repo)
      assert.equal(projectOf(path.join(plain, 'a')), plain)
      assert.equal(projectOf('/nowhere/x'), '/nowhere/x')
    } finally { hub.set({ projects: was }); fs.rmSync(tmp, { recursive: true, force: true }) }
  })
})

describe('todo merge', () => {
  it('unions by id, drops tombstones from either side, newer edit wins', () => {
    const a: TodoDoc = { version: 1, todo: [{ id: 't1', text: 'old', at: 1 }, { id: 't2', text: 'gone', at: 1 }], removed: { x: 5 } }
    const b: TodoDoc = { version: 1, todo: [{ id: 't1', text: 'new', at: 2, before: 't3', from: 's9' }, { id: 't3', text: 'b only', at: 1 }], removed: { t2: 3, x: 9 } }
    const m = mergeDocs(a, b, 10)
    assert.deepEqual(m.todo, [{ id: 't1', text: 'new', at: 2, before: 't3', from: 's9' }, { id: 't3', text: 'b only', at: 1 }])
    assert.deepEqual(m.removed, { x: 9, t2: 3 })
    assert.deepEqual(mergeDocs(b, a, 10).todo.map(t => t.text).sort(), ['b only', 'new'])
  })

  it('keeps an item marked done in the finished list, by the chat or by you, and puts it back', () => {
    let d = addTodo(emptyDoc(), 'Ship it', 1, 'aaaa1111')
    d = finishItem(d, 'aaaa1111', undefined, 2)
    assert.deepEqual(d.todo, [])
    assert.deepEqual(d.ticked, [{ id: 'aaaa1111', text: 'Ship it', at: 2 }])
    assert.ok(Object.hasOwn(d.removed, 'aaaa1111'))
    assert.deepEqual(parseDoc(JSON.stringify(d)).ticked, d.ticked)
    const t = toolStep(addTodo(emptyDoc(), 'Fix login', 1, 'bbbb2222'), { op: 'done', id: 'bbbb2222', session: 'c1' }, 3)
    assert.deepEqual(t.doc.ticked, [{ id: 'bbbb2222', text: 'Fix login', at: 3, by: 'c1' }])
    assert.deepEqual(restoreTicked(d, 'aaaa1111', 4, 'cccc3333').todo.map(x => x.text), ['Ship it'])
    assert.equal(finishItem(d, 'nope', undefined, 5), d)
  })

  it('Done on a suggestion ticks it, tombstoned', () => {
    const d = afterEnd(emptyDoc(), chat({ state: 'idle', report: { done: [], left: ['Add rate limits to export'] } }), 1)
    const id = d.suggested![0].id
    const out = finishItem(d, id, undefined, 2)
    assert.equal(out.suggested, undefined)
    assert.ok(out.removed[id])
    assert.deepEqual(out.ticked, [{ id, text: 'Add rate limits to export', at: 2, from: 's1', why: 'later' }])
    // Put back, it keeps its why and name, also after a round trip through the file.
    const named = { ...out, ticked: [{ ...out.ticked![0], name: 'Fix login' }] }
    assert.deepEqual(parseDoc(JSON.stringify(named)).ticked, named.ticked)
    const back = restoreTicked(parseDoc(JSON.stringify(named)), id, 3, 'r1').todo[0]
    assert.equal(back.why, 'later')
    assert.equal(back.name, 'Fix login')
  })

  it('unions ticked items by id, newest 10, and never brings back one put back', () => {
    const t = (id: string, at: number) => ({ id, text: id, at, by: 's1' })
    const a: TodoDoc = { version: 1, todo: [], removed: {}, ticked: [t('k1', 3), t('k2', 2)] }
    const b: TodoDoc = { version: 1, todo: [], removed: {}, ticked: [t('k2', 2), t('k3', 4)] }
    assert.deepEqual(mergeDocs(a, b, 10).ticked?.map(x => x.id), ['k3', 'k1', 'k2'])
    const back = restoreTicked(a, 'k1', 5, 'n1')
    const m = mergeDocs(back, b, 10)
    assert.deepEqual(m.ticked?.map(x => x.id), ['k3', 'k2'])
    assert.deepEqual(m.todo.map(x => x.id), ['n1'])
    assert.deepEqual(mergeDocs(m, a, 10).ticked?.map(x => x.id), ['k3', 'k2'])
    const lots: TodoDoc = { version: 1, todo: [], removed: {}, ticked: Array.from({ length: 12 }, (_, i) => t(`z${i}`, i)) }
    assert.equal(mergeDocs(lots, emptyDoc(), 20).ticked?.length, 10)
  })

  it('prunes tombstones older than 90 days', () => {
    const day = 24 * 60 * 60 * 1000, now = 100 * day
    const a: TodoDoc = { version: 1, todo: [], removed: { old: now - 91 * day, recent: now - 89 * day } }
    assert.deepEqual(mergeDocs(a, emptyDoc(), now).removed, { recent: now - 89 * day })
  })

  it('edits, removes with a tombstone and starts', () => {
    let d = addTodo(emptyDoc(), '  Ship the\nthing  ', 10, 'aa')
    assert.deepEqual(d.todo, [{ id: 'aa', text: 'Ship the thing', at: 10 }])
    d = startTodo(editTodo(d, 'aa', 'Ship it', 11), 'aa', 'sess', 12)
    assert.deepEqual(d.todo, [{ id: 'aa', text: 'Ship it', at: 12, chat: 'sess', host: hostId() }])
    d = removeItem(d, 'aa', 13)
    assert.deepEqual(d.todo, [])
    assert.equal(d.removed.aa, 13)
    assert.equal(addTodo(emptyDoc(), 'x'.repeat(2000), 1, 'b').todo[0].text.length, 2000)
    assert.equal(addTodo(emptyDoc(), 'x'.repeat(2500), 1, 'b').todo[0].text.length, 2000)
    assert.equal(addTodo(emptyDoc(), '   ', 1, 'b').todo.length, 0)
  })

  it('never adds an open item twice, whatever the case or spacing', () => {
    const d = addTodo(emptyDoc(), 'Reload VS Code', 1, 'a')
    assert.equal(addTodo(d, '  reload   vs CODE ', 2, 'b'), d)
    assert.equal(addTodo(d, 'Reload VS Code now', 2, 'b').todo.length, 2)
    // Accepting or putting back a repeat leaves the one open item.
    const s: TodoDoc = { ...d, suggested: [{ id: 's1', text: 'reload vs code', at: 2, why: 'you' }] }
    const took = acceptSuggestion(s, 's1', 3)
    assert.deepEqual(took.todo.map(t => t.id), ['a'])
    assert.equal(took.suggested, undefined)
    assert.ok(took.removed.s1)
    const back = restoreTicked(finishItem(addTodo(d, 'Ship', 2, 'b'), 'a', undefined, 3), 'a', 4, 'c')
    assert.deepEqual(addTodo(back, 'RELOAD vs code', 5, 'd').todo.map(t => t.text), ['Ship', 'Reload VS Code'])
  })
})

describe('todo finish', () => {
  it('reads the done ids out of the model answer, known ids only', () => {
    assert.deepEqual(parseDoneIds('ab12cd34, ff00ff00', ['ab12cd34', 'ff00ff00', '11111111']), ['ab12cd34', 'ff00ff00'])
    assert.deepEqual(parseDoneIds('Done: [ab12cd34]\nzz99zz99', ['ab12cd34']), ['ab12cd34'])
    assert.deepEqual(parseDoneIds('none', ['ab12cd34']), [])
    assert.deepEqual(parseDoneIds('xab12cd34x', ['ab12cd34']), [])
    assert.deepEqual(parseDoneIds('AB12CD34', ['ab12cd34']), ['ab12cd34'])
  })

  it('adds the standup Left items once; open tasks stay on the chat, not the to-do', () => {
    const p = chat({ report: { done: ['did a'], left: ['Write docs', 'Deploy'] }, tasks: [{ id: '1', subject: 'Open task', status: 'pending' }, { id: '2', subject: 'Closed', status: 'completed' }] })
    const d = afterFinish(emptyDoc(), p, [], 5)
    assert.deepEqual(d.todo, [])
    assert.deepEqual(d.suggested?.map(l => [l.text, l.from]), [['Write docs', 's1'], ['Deploy', 's1']])
    assert.deepEqual(afterFinish(d, p, [], 6).suggested, d.suggested)
    // The same chat finishing again with a shorter Left list drops what it no longer lists.
    const again = afterFinish(d, chat({ report: { done: [], left: ['Deploy'] } }), [], 7)
    assert.deepEqual(again.suggested?.map(l => l.text), ['Deploy'])
  })

  it('For you lines never land in the to-do; Left lines always do', () => {
    const p = chat({ report: { done: ['x'], left: ['Deploy', 'Add retries to your webhook handler'], you: ['Commit the repo'] } })
    assert.deepEqual(afterFinish(emptyDoc(), p, [], 1).suggested?.map(l => [l.text, l.why]), [['Deploy', 'later'], ['Add retries to your webhook handler', 'later']])
    assert.equal(afterEnd(emptyDoc(), chat({ state: 'idle', report: { done: [], left: [], you: ['Sign in'] } }), 1, []).suggested, undefined)
  })

  it('keeps only the Left lines the model calls later work; a failed answer keeps them all', async () => {
    assert.deepEqual(parseKept('1, 3', 3), [0, 2])
    assert.deepEqual(parseKept('None.', 3), [])
    assert.equal(parseKept('not sure', 3), undefined)
    assert.deepEqual(parseKept('9', 3), undefined)
    const p = chat({ report: { done: ['x'], left: ['Deploy to prod', 'nothing open. Request the chart again', 'Add rate limits'] } })
    assert.deepEqual(await laterOnly(p, async () => '1,3'), ['Deploy to prod', 'Add rate limits'])
    assert.deepEqual(await laterOnly(p, async () => 'none'), [])
    assert.deepEqual(await laterOnly(p, async () => { throw new Error('x') }), p.report?.left)
  })

  it('a filter answer that drops a line the chat still lists never tombstones it', () => {
    const p = chat({ report: { done: ['x'], left: ['Deploy to prod'] } })
    const one = afterFinish(emptyDoc(), p, [], 1, ['Deploy to prod'])
    const two = afterFinish(one, p, [], 3, [])
    assert.deepEqual(two.suggested?.map(l => l.text), ['Deploy to prod'])
    assert.deepEqual(two.removed, {})
    // Dropped by the filter on its first Done: not added, and still free to be added later.
    const skipped = afterFinish(emptyDoc(), p, [], 1, [])
    assert.equal(skipped.suggested, undefined)
    assert.deepEqual(afterFinish(skipped, p, [], 2, ['Deploy to prod']).suggested?.map(l => l.text), ['Deploy to prod'])
  })

  it('takes an older doc\'s auto added Left items back while Kenneth keeps working in it, and its next Done settles them', () => {
    const p = chat({ report: { done: ['x'], left: ['Run live test in two windows', 'Deploy'] } })
    // Before the Suggested tray, Left lines went straight into todo.
    const auto = afterFinish(emptyDoc(), p, [], 1)
    const d = addTodo({ ...auto, todo: auto.suggested!, suggested: undefined }, 'Kenneth item', 1, 'k1')
    const back = backInChat(d, 's1', 2)
    assert.deepEqual(back.todo.map(l => [l.text, l.chat]), [['Run live test in two windows', 's1'], ['Deploy', 's1'], ['Kenneth item', undefined]])
    // It did the test; only Deploy is still left.
    const next = afterFinish(back, chat({ report: { done: ['tested'], left: ['Deploy'] } }), [back.todo.find(l => l.text === 'Run live test in two windows')!.id], 3)
    assert.deepEqual(next.todo.map(l => [l.text, l.chat]), [['Deploy', undefined], ['Kenneth item', undefined]])
    assert.equal(next.suggested, undefined)
  })

  it('keeps an item a chat added with todo_add when that chat finishes', () => {
    const d = addTodo(emptyDoc(), 'Add rate limiting to the export route', 1, 'aaaa1111', { from: 's1' })
    assert.deepEqual(afterFinish(d, chat({ report: { done: ['x'], left: [] } }), [], 2).todo.map(l => l.id), ['aaaa1111'])
  })

  it('removes the Left ids the model named and keeps a ticked item gone', () => {
    const d: TodoDoc = { version: 1, todo: [{ id: 'aaaa1111', text: 'x', at: 1, from: 'old' }, { id: 'bbbb2222', text: 'y', at: 1, from: 'old' }], removed: {} }
    const after = afterFinish(d, chat({ sessionId: 's2', report: { done: ['x'], left: [] } }), ['aaaa1111'], 5)
    assert.deepEqual(after.todo.map(l => l.id), ['bbbb2222'])
    assert.equal(after.removed.aaaa1111, 5)
    const z = afterFinish(emptyDoc(), chat({ report: { done: [], left: ['Fix Z'] } }), [], 1)
    const dismissed = dismissSuggestion(z, z.suggested![0].id, 2)
    assert.equal(afterFinish(dismissed, chat({ report: { done: [], left: ['Fix Z'] } }), [], 3).suggested, undefined)
  })

  it('keeps the last 10 items the model ticked, with the chat, and puts one back under a new id', () => {
    const d = startTodo(addTodo(addTodo(emptyDoc(), 'Fix login', 1, 'aaaa1111', { from: 'c0' }), 'Mine', 1, 'm1'), 'm1', 's1', 2)
    const out = afterFinish(d, chat({ report: { done: ['x'], left: ['Deploy'] } }), ['aaaa1111'], 5)
    // Only the model named one; the chat's own started item and Left lines are not undoable.
    assert.deepEqual(out.ticked, [{ id: 'aaaa1111', text: 'Fix login', at: 5, by: 's1', from: 'c0' }])
    const back = restoreTicked(out, 'aaaa1111', 6, 'bbbb2222')
    assert.deepEqual(back.ticked, undefined)
    assert.deepEqual(back.todo.find(t => t.id === 'bbbb2222'), { id: 'bbbb2222', text: 'Fix login', at: 6, from: 'c0' })
    assert.equal(back.removed.aaaa1111, 5)
    assert.equal(restoreTicked(back, 'aaaa1111', 7), back)
    let many = emptyDoc()
    for (let i = 0; i < 12; i++) many = afterFinish(addTodo(many, `T${i}`, i, `t${i}`), chat(), [`t${i}`], 10 + i)
    assert.deepEqual(many.ticked?.map(t => t.id), ['t11', 't10', 't9', 't8', 't7', 't6', 't5', 't4', 't3', 't2'])
  })

  it('marks a started item done when its chat finishes and Left does not mention it, keeps it open (not started) when Left does', () => {
    const d = startTodo(addTodo(emptyDoc(), 'Add the receipts page', 1, 't1'), 't1', 's1', 2)
    assert.deepEqual(afterFinish(d, chat({ report: { done: ['Receipts'], left: [] } }), ['t1'], 3).todo, [])
    assert.equal(afterFinish(d, chat({ report: { done: ['Receipts'], left: [] } }), ['t1'], 3).removed.t1, 3)
    // Not judged done and not in Left: stopped, not removed.
    assert.deepEqual(afterFinish(d, chat({ report: { done: ['Receipts'], left: [] } }), [], 3).todo.map(t => [t.id, t.chat, t.stopped]), [['t1', undefined, true]])
    // Left with other lines only: done, and the lines join the to-do.
    const other = afterFinish(d, chat({ report: { done: [], left: ['Deploy to staging'] } }), ['t1'], 3)
    assert.deepEqual(other.todo, [])
    assert.deepEqual(other.suggested?.map(t => [t.text, t.from]), [['Deploy to staging', 's1']])
    // Left mentions it: open again, not started, and no duplicate line.
    const kept = afterFinish(d, chat({ report: { done: [], left: ['Add the receipts page (needs the API key)'] } }), [], 3)
    assert.deepEqual(kept.todo, [{ id: 't1', text: 'Add the receipts page', at: 3 }])
    // Another chat finishing leaves it in progress.
    assert.equal(afterFinish(d, chat({ sessionId: 'other' }), [], 3).todo[0].chat, 's1')
  })

  it('matches a Left line to an item by text, loosely', () => {
    assert.equal(mentions('Add the receipts page (blocked)', 'add the receipts page'), true)
    assert.equal(mentions('Wire receipts page totals into export', 'Receipts page totals export'), true)
    assert.equal(mentions('Deploy to staging', 'Add the receipts page'), false)
  })

  it('asks about the older Left items only', () => {
    const prompt = finishPrompt([{ id: 'aaaa1111', text: 'Fix login', at: 1 }], chat({ report: { done: ['Fixed login'], left: [] }, asked: ['fix the login'] }))
    assert.match(prompt, /aaaa1111: Fix login/)
    assert.match(prompt, /Fixed login/)
    assert.match(prompt, /fix the login/)
  })
})

describe('todo suggestions', () => {
  it('reads why a Left line was left from its text', () => {
    assert.equal(whyLeft('Blocked: needs the Stripe key'), 'blocked')
    assert.equal(whyLeft('Waiting on the API team for the schema'), 'blocked')
    // No hand-step guess from words: real work said "your" too.
    assert.equal(whyLeft('Kenneth to decide the pricing tiers'), 'later')
    assert.equal(whyLeft('Add retries to your webhook handler'), 'later')
    assert.equal(whyLeft('Out of scope: rewrite the router'), 'scope')
    assert.equal(whyLeft('Unrelated flaky test in billing'), 'scope')
    assert.equal(whyLeft('Add rate limits to export'), 'later')
  })

  it('suggests Left lines with the chat name and reason, never straight into the to-do', () => {
    const was = hub.get().chats
    try {
      hub.set({ chats: [{ pid: 1, sessionId: 's1', name: 'Fix login', cwd: '/p', link: '', live: false, why: [] }] })
      const d = afterFinish(emptyDoc(), chat({ report: { done: ['x'], left: ['Blocked on the Stripe key', 'Add rate limits'] } }), [], 5)
      assert.deepEqual(d.todo, [])
      assert.deepEqual(d.suggested?.map(t => [t.text, t.from, t.name, t.why, t.at]), [['Blocked on the Stripe key', 's1', 'Fix login', 'blocked', 5], ['Add rate limits', 's1', 'Fix login', 'later', 5]])
    } finally { hub.set({ chats: was }) }
  })

  it('accepts a suggestion into the to-do keeping where it came from, and dismisses one for good', () => {
    const d = afterEnd(emptyDoc(), chat({ state: 'idle', report: { done: [], left: ['Deploy', 'Write docs'] } }), 1)
    const [dep, docs] = d.suggested!
    const ok = acceptSuggestion(d, dep.id, 2, 'new11111')
    assert.deepEqual(ok.todo, [{ id: 'new11111', text: 'Deploy', at: 2, from: 's1', why: 'later' }])
    assert.deepEqual(ok.suggested?.map(t => t.id), [docs.id])
    assert.equal(ok.removed[dep.id], 2)
    const gone = dismissSuggestion(ok, docs.id, 3)
    assert.equal(gone.suggested, undefined)
    assert.equal(gone.removed[docs.id], 3)
    // Neither comes back when the chat ends again with the same Left.
    assert.deepEqual(afterEnd(gone, chat({ state: 'idle', report: { done: [], left: ['Deploy', 'Write docs'] } }), 4), gone)
    assert.equal(acceptSuggestion(gone, 'nope', 5), gone)
  })

  it('suggests the requests Jev found not covered, once', () => {
    const p = chat({ asked: ['fix the login', 'add dark mode'], covered: [0.9, 0.1] })
    const d = addMissed(emptyDoc(), p, 5)
    assert.deepEqual(d.suggested?.map(t => [t.text, t.why, t.from]), [['add dark mode', 'missed', 's1']])
    assert.deepEqual(addMissed(d, p, 6), d)
    assert.equal(addMissed(emptyDoc(), chat({ asked: ['x'] }), 5).suggested, undefined)
  })

  it('drops an approved chat\'s missed suggestions and keeps its Left and other chats\' rows', () => {
    const d = addMissed(emptyDoc(), chat({ asked: ['fix the login', 'add dark mode'], covered: [0.1, 0.1] }), 5)
    const other = addMissed(d, chat({ sessionId: 's2', asked: ['ship the docs'], covered: [0] }), 6)
    const withLeft = afterEnd(other, chat({ state: 'idle', report: { done: [], left: ['Deploy'] } }), 7)
    const out = approvedMissed(withLeft, 's1', 8)
    const kept = (x: typeof out) => (x.suggested ?? []).filter(t => !(t.from === 's1' && t.why === 'missed')).map(t => t.text)
    assert.deepEqual(out.suggested?.map(t => t.text), kept(withLeft))
    assert.ok(out.suggested?.some(t => t.from === 's2'))
    assert.equal(out.removed[withLeft.suggested!.find(t => t.text === 'add dark mode')!.id], 8)
    assert.equal(approvedMissed(out, 's1', 9), out)
  })

  it('a score after Approve files no missed rows and clears the chat\'s old ones', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-missed-')), repo = path.join(tmp, 'repo'), archive = path.join(tmp, 'archive.json')
    try {
      execFileSync('git', ['init', '-q', repo])
      const s = await storeFor(repo)
      const p = chat({ cwd: repo, asked: ['fix the login', 'add dark mode'], covered: [0.1, 0.1] })
      const texts = async () => (await readDoc(s)).suggested?.map(t => t.text) ?? []
      // Archived but not approved still files.
      recordArchive(archiveRow({ sessionId: 's1', cwd: repo }), archive)
      await chatMissed({ ...p, asked: ['fix the login'], covered: [0.1] }, archive)
      assert.deepEqual(await texts(), ['fix the login'])
      recordArchive({ ...archiveRow({ sessionId: 's1', cwd: repo }), ...approvedFields('s1') }, archive)
      await chatMissed(p, archive)
      assert.deepEqual(await texts(), [])
      // Another chat's approval does not hide this one's.
      await chatMissed({ ...p, sessionId: 's2' }, archive)
      assert.deepEqual(await texts(), ['fix the login', 'add dark mode'])
      // A row this window never showed goes too, even when the score finds nothing missed.
      await updateDoc(s, d => addMissed(d, { ...p, sessionId: 's3', asked: ['ship the docs'], covered: [0] }))
      recordArchive({ ...archiveRow({ sessionId: 's3', cwd: repo }), ...approvedFields('s3') }, archive)
      await chatMissed({ ...p, sessionId: 's3', asked: ['ship the docs'], covered: [0.9] }, archive)
      assert.deepEqual(await texts(), ['fix the login', 'add dark mode'])
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('Approve clears rows this window has not loaded', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-missed-'))
    try {
      execFileSync('git', ['init', '-q', repo])
      const s = await storeFor(repo)
      await updateDoc(s, d => addMissed(d, chat({ cwd: repo, asked: ['add dark mode'], covered: [0] })))
      await chatApproved('s1', repo)
      assert.deepEqual((await readDoc(s)).suggested ?? [], [])
    } finally { fs.rmSync(repo, { recursive: true, force: true }) }
  })

  it('leaves conversational asks out of the missed suggestions', () => {
    const asked = ['Give me a phone call if anything comes up', 'Call me when it is done', 'Continue from /Users/k/handoff.md', "What's the status?", 'how is it going', 'Are you done yet?', '[Cross-session idle notice] "Audit" is idle', 'Switchboard stopped background job "dev": no new output', 'Subagent engineer (a1) has been quiet 20 min.', '<agent-message from="a1"> my dev server is up', 'Developer: Reload Window', 'Complete what is left', 'add dark mode']
    const d = addMissed(emptyDoc(), chat({ asked, covered: asked.map(() => 0) }), 5)
    assert.deepEqual(d.suggested?.map(t => t.text), ['add dark mode'])
  })

  it('a to-do run prompt is not a missed ask, and old ones are pruned', () => {
    const asked = ['Switchboard to-do, in this order:\n1. Release the Research tab (id a9213073)']
    assert.equal(addMissed(emptyDoc(), chat({ asked, covered: [0] }), 5).suggested?.length ?? 0, 0)
    const old: TodoDoc = { ...emptyDoc(), suggested: [{ id: 'm1', text: 'Switchboard to-do, in this order: 1. Fix worktrees (id 4d7d52a4)', at: 1, from: 's1', why: 'missed' }] }
    assert.equal(prune(old, 2).suggested?.length ?? 0, 0)
  })

  it("ticking a chat's Release item ticks that chat's missed asks too", () => {
    const d: TodoDoc = { ...emptyDoc(),
      todo: [{ id: 'r1', text: 'Release the memory note panel fix after Merge back: bump, package, install', at: 1, from: 's1' }],
      suggested: [
        { id: 'm1', text: 'Inside of maps memory component still looks a bit weird when clicking an item', at: 1, from: 's1', why: 'missed' },
        { id: 'm2', text: 'Add dark mode', at: 1, from: 's2', why: 'missed' },
      ] }
    const out = finishItem(d, 'r1', 's9', 5)
    assert.deepEqual(out.suggested?.map(t => t.id), ['m2'])
    assert.deepEqual(out.ticked?.map(t => t.id).sort(), ['m1', 'r1'])
    // Any other item of that chat says nothing about its asks.
    const other: TodoDoc = { ...d, todo: [{ id: 'f1', text: 'Fix the login redirect bug', at: 1, from: 's1' }] }
    assert.deepEqual(finishItem(other, 'f1', 's9', 5).suggested?.map(t => t.id), ['m1', 'm2'])
    // A Release that shares no word with an ask leaves that ask: the chat may have skipped it.
    const skipped: TodoDoc = { ...d, suggested: [{ id: 'm3', text: 'Add dark mode to the settings header', at: 1, from: 's1', why: 'missed' }] }
    assert.deepEqual(finishItem(skipped, 'r1', 's9', 5).suggested?.map(t => t.id), ['m3'])
  })

  it('clears a not covered suggestion once Jev scores that request covered', () => {
    const d = addMissed(emptyDoc(), chat({ asked: ['fix the login', 'add dark mode'], covered: [0.9, 0.1] }), 5)
    // Resumed and finished again: now covered. A request that rolled out of asked is left alone.
    const again = addMissed(d, chat({ asked: ['add dark mode', 'ship it'], covered: [0.95, 0.9] }), 6)
    assert.equal(again.suggested, undefined)
    assert.ok(again.removed[d.suggested![0].id])
    assert.deepEqual(addMissed(d, chat({ asked: ['ship it'], covered: [0.9] }), 6), d)
  })

  it('todo_done closes a suggestion by id or text, into the finished list', () => {
    const d = afterEnd(emptyDoc(), chat({ state: 'idle', report: { done: [], left: ['Deploy to staging'] } }), 1)
    const id = d.suggested![0].id
    for (const key of [{ id }, { text: 'Deploy to staging' }]) {
      const r = toolStep(d, { op: 'done', session: 'c9', ...key }, 2)
      assert.equal(r.said, 'Done: Deploy to staging')
      assert.equal(r.doc.suggested, undefined)
      assert.ok(r.doc.removed[id])
      assert.deepEqual(r.doc.ticked, [{ id, text: 'Deploy to staging', at: 2, by: 'c9', from: 's1', why: 'later' }])
    }
    assert.throws(() => toolStep(d, { op: 'done', id: 'nothing' }), /no open to-do item/)
    const two = addTodo(addTodo(d, 'Deploy prod', 3, 'a1'), 'Deploy docs', 3, 'a2')
    assert.throws(() => toolStep(two, { op: 'done', text: 'deploy' }), /matches 2 items/)
  })

  it('keeps suggestions through a disk round trip and a merge, with tombstones', () => {
    const d = afterEnd(emptyDoc(), chat({ state: 'idle', report: { done: [], left: ['Deploy'] } }), 1)
    assert.deepEqual(parseDoc(JSON.stringify(d)).suggested, d.suggested)
    const id = d.suggested![0].id
    assert.deepEqual(mergeDocs(d, emptyDoc(), 10).suggested, d.suggested)
    assert.equal(mergeDocs(d, dismissSuggestion(d, id, 2), 10).suggested, undefined)
    // An older doc with no suggested field reads as none.
    assert.equal(parseDoc(JSON.stringify({ version: 1, todo: [], removed: {} })).suggested, undefined)
  })
})

describe('todo handoff and stale chats', () => {
  it('moves an item to the fresh chat on a handoff', () => {
    const d = startTodo(addTodo(emptyDoc(), 'Goal', 1, 't1'), 't1', 'old', 2)
    assert.equal(moveChat(d, 'old', 'new', 3).todo[0].chat, 'new')
    assert.equal(moveChat(d, 'other', 'new', 3), d)
  })

  it('unmarks an item whose chat is gone from this machine, after a grace period', () => {
    const d = startTodo(startTodo(addTodo(addTodo(emptyDoc(), 'A', 1, 'a'), 'B', 1, 'b'), 'a', 'gone', 1000), 'b', 'live', 1000)
    const far = { ...d, todo: [...d.todo, { id: 'c', text: 'C', at: 1000, chat: 'elsewhere', host: 'otherhost' }] }
    const out = clearGone(far, new Set(['live']), 1000 + 10 * 60_000)
    assert.deepEqual(out.todo.map(t => [t.id, t.chat]), [['a', undefined], ['b', 'live'], ['c', 'elsewhere']])
    assert.equal(clearGone(d, new Set(), 1000 + 1000), d)
  })
})

describe('todo host id', () => {
  it('is random, kept in ~/.claude/switchboard/host-id, and stable', () => {
    const id = hostId()
    assert.match(id, /^[0-9a-f]{16}$/)
    assert.equal(fs.readFileSync(path.join(HOME, '.claude', 'switchboard', 'host-id'), 'utf8').trim(), id)
    assert.equal(hostId(), id)
  })
})

describe('todo sync gate', () => {
  it('reads owner and repo from GitHub remotes only', () => {
    assert.equal(ownerRepo('https://github.com/k/app.git'), 'k/app')
    assert.equal(ownerRepo('git@github.com:k/app.git'), 'k/app')
    assert.equal(ownerRepo('https://gitlab.com/k/app.git'), undefined)
  })

  it('syncs private repos, keeps public, unknown and non-GitHub ones local unless opted in, asks gh once', async () => {
    let calls = 0
    const gh = (answer: string | undefined) => async (args: string[]) => { calls++; assert.deepEqual(args, ['api', `repos/${args[1].slice(6)}`, '--jq', '.private']); return answer }
    const mode = (url: string, answer: string | undefined, optIn = {}) => syncMode('/f', url, optIn, gh(answer))
    assert.equal((await mode('git@github.com:k/priv.git', 'true')).state, 'synced')
    assert.equal((await mode('git@github.com:k/priv.git', 'false')).state, 'synced')
    assert.equal(calls, 1)
    assert.deepEqual(await mode('git@github.com:k/pub.git', 'false'), { state: 'local', why: 'public repo', canSync: true })
    assert.equal((await mode('git@github.com:k/err.git', undefined)).state, 'local')
    assert.equal((await mode('https://gitlab.com/k/x.git', 'true')).why, 'origin is not on GitHub')
    assert.deepEqual(await mode('', 'true'), { state: 'local', why: 'no origin remote' })
    assert.deepEqual(await mode('git@github.com:k/pub.git', 'false', { '/f': true }), { state: 'synced', canSync: true, optIn: true })
  })

  it('asks gh again after a failure, keeps a yes or no', async () => {
    let calls = 0
    const fail = async () => { calls++; throw new Error('offline') }
    assert.equal((await syncMode('/f', 'git@github.com:k/retry.git', {}, fail)).state, 'local')
    assert.equal((await syncMode('/f', 'git@github.com:k/retry.git', {}, async () => { calls++; return undefined })).state, 'local')
    assert.equal((await syncMode('/f', 'git@github.com:k/retry.git', {}, async () => { calls++; return 'true\n' })).state, 'synced')
    assert.equal((await syncMode('/f', 'git@github.com:k/retry.git', {}, fail)).state, 'synced')
    assert.equal(calls, 3)
  })

  it('keeps the opt-in choice in a file', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-optin-')), 'todo-sync.json')
    setOptIn('/a', true, file); setOptIn('/b', true, file); setOptIn('/a', false, file)
    assert.deepEqual(readOptIn(file), { '/b': true })
    fs.writeFileSync(file, '{"__proto__": true, "/c": "yes"}')
    assert.deepEqual(readOptIn(file), {})
    fs.rmSync(path.dirname(file), { recursive: true })
  })
})

describe('todo end', () => {
  const tasks = [{ id: '1', subject: 'Open task', status: 'pending' as const }, { id: '2', subject: 'Closed', status: 'completed' as const }, { id: '3', subject: 'Fix already listed', status: 'in_progress' as const }]

  it('adds the standup Left items of a chat that ends unfinished, once, deduped by text, never its open tasks', () => {
    const d: TodoDoc = { ...emptyDoc(), todo: [{ id: 'x', text: 'already listed', at: 1, from: 'other' }] }
    const p = chat({ state: 'idle', tasks, report: { done: [], left: ['Write docs', 'Fix already listed'] } })
    const after = afterEnd(d, p, 5)
    assert.deepEqual(after.todo.map(l => l.text), ['already listed'])
    assert.deepEqual(after.suggested?.map(l => l.text), ['Write docs'])
    assert.deepEqual(afterEnd(after, p, 6), after)
  })

  it('skips a chat that reached Done, and unmarks its To-do item', () => {
    const d = startTodo(addTodo(emptyDoc(), 'Goal', 1, 't1'), 't1', 's1', 2)
    assert.deepEqual(afterEnd(d, chat({ state: 'done', tasks }), 3), d)
    const none = afterEnd(d, chat({ state: 'idle', tasks }), 3)
    assert.deepEqual(none.todo, [{ id: 't1', text: 'Goal', at: 3 }])
  })

  it('the hub reports a real end, never a handoff or a mirror', () => {
    const hub = new HubService()
    const ended: string[] = []
    hub.onEnded(p => ended.push(p.sessionId))
    const run = (id: string, mirror = false) => {
      hub.hook({ session_id: id, cwd: '/w', hook_event_name: 'SessionStart', source: 'startup' }, 1, mirror)
      hub.hook({ session_id: id, cwd: '/w', hook_event_name: 'PreToolUse', tool_name: 'TaskCreate', tool_input: { subject: 'T' } }, 2, mirror)
    }
    run('real'); run('handed'); run('mirror', true)
    hub.closeAfterFresh('handed', '/w')
    for (const [id, mirror] of [['real', false], ['handed', false], ['mirror', true]] as const) hub.hook({ session_id: id, cwd: '/w', hook_event_name: 'SessionEnd' }, 3, mirror)
    assert.deepEqual(ended, ['real'])
  })
})

describe('todo storage', () => {
  const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  let root = '', a = '', b = '', plain = '', files = ''
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-todo-'))
    sh(root, 'init', '-q', '--bare', '-b', 'main', 'remote.git')
    for (const name of ['a', 'b']) {
      sh(root, 'clone', '-q', 'remote.git', name)
      const dir = path.join(root, name)
      sh(dir, 'config', 'user.email', 't@t'); sh(dir, 'config', 'user.name', 'T'); sh(dir, 'config', 'commit.gpgsign', 'false')
    }
    a = path.join(root, 'a'); b = path.join(root, 'b')
    fs.writeFileSync(path.join(a, 'one.txt'), '1\n')
    sh(a, 'add', '.'); sh(a, 'commit', '-qm', 'init'); sh(a, 'push', '-q', '-u', 'origin', 'main')
    sh(b, 'pull', '-q', 'origin', 'main')
    plain = path.join(root, 'plain'); fs.mkdirSync(plain)
    files = path.join(root, 'files')
  })
  after(() => fs.rmSync(root, { recursive: true, force: true }))

  it('writes and reads the ref without touching the working tree, index or HEAD', async () => {
    fs.writeFileSync(path.join(a, 'one.txt'), 'dirty\n')
    const head = sh(a, 'rev-parse', 'HEAD'), status = sh(a, 'status', '--porcelain')
    const s = await storeFor(a, files)
    assert.equal(path.resolve(s.root!), path.resolve(fs.realpathSync.native(a)))
    await updateDoc(s, d => addTodo(d, 'First', 1, 't1'))
    await updateDoc(s, d => addTodo(d, 'Second', 2, 't2'))
    assert.deepEqual((await readDoc(s)).todo.map(t => t.text), ['First', 'Second'])
    assert.equal(sh(a, 'rev-parse', 'HEAD'), head)
    assert.equal(sh(a, 'status', '--porcelain'), status)
    assert.equal(sh(a, 'rev-list', '--count', TODO_REF), '2')
    assert.equal(sh(a, 'ls-tree', '--name-only', TODO_REF), 'todo.json')
    assert.ok(!fs.existsSync(path.join(a, 'todo.json')))
    sh(a, 'checkout', '-q', '--', 'one.txt')
  })

  it('syncs two clones through the bare remote and merges both sides', async () => {
    const sa = await storeFor(a, files), sb = await storeFor(b, files)
    await syncDoc(sa)
    assert.ok(sh(path.join(root, 'remote.git'), 'rev-parse', TODO_REF))
    await syncDoc(sb)
    assert.deepEqual((await readDoc(sb)).todo.map(t => t.id), ['t1', 't2'])
    // Both edit while apart: b removes t1 and adds t3, a edits t2 later than b does.
    const t = Date.now()
    await updateDoc(sb, d => editTodo(addTodo(removeItem(d, 't1', t), 'From b', t, 't3'), 't2', 'b edit', t + 1))
    await updateDoc(sa, d => editTodo(d, 't2', 'a edit', t + 2))
    await syncDoc(sb)
    await syncDoc(sa)
    await syncDoc(sb)
    for (const s of [sa, sb]) assert.deepEqual((await readDoc(s)).todo.map(t => [t.id, t.text]), [['t2', 'a edit'], ['t3', 'From b']])
    assert.equal(sh(a, 'rev-parse', TODO_REF), sh(b, 'rev-parse', TODO_REF))
    assert.equal(sh(a, 'rev-list', '--merges', '--count', TODO_REF), '1')
    // A merge commit has both parents; a second sync with nothing new makes no commit.
    const tip = sh(a, 'rev-parse', TODO_REF)
    await syncDoc(sa); await syncDoc(sb)
    assert.equal(sh(a, 'rev-parse', TODO_REF), tip)
  })

  it('never adopts or pushes over a remote list it cannot read', async () => {
    const sa = await storeFor(a, files)
    await syncDoc(sa)
    const tip = sh(a, 'rev-parse', TODO_REF)
    const empty = execFileSync('git', ['mktree'], { cwd: a, input: '' }).toString().trim()
    const bad = execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit-tree', empty, '-p', tip, '-m', 'bad'], { cwd: a }).toString().trim()
    const bare = path.join(root, 'remote.git')
    sh(a, 'push', '-q', bare, `${bad}:${TODO_REF}`)
    assert.match((await syncDoc(sa)) ?? '', /remote list unreadable/)
    assert.equal(sh(a, 'rev-parse', TODO_REF), tip)
    assert.ok((await readDoc(sa)).todo.length)
    // Diverged too: no merge, no push.
    await updateDoc(sa, d => addTodo(d, 'after bad', Date.now(), 'ab'))
    const mine = sh(a, 'rev-parse', TODO_REF)
    assert.match((await syncDoc(sa)) ?? '', /remote list unreadable/)
    assert.equal(sh(a, 'rev-parse', TODO_REF), mine)
    assert.equal(sh(bare, 'rev-parse', TODO_REF), bad)
    sh(bare, 'update-ref', TODO_REF, tip)
    await updateDoc(sa, d => removeItem(d, 'ab', Date.now()))
    await syncDoc(sa)
  })

  it('replaces an unreadable remote list on request, only under the lease it saw, and no other ref', async () => {
    const sa = await storeFor(a, files)
    await syncDoc(sa)
    const tip = sh(a, 'rev-parse', TODO_REF), bare = path.join(root, 'remote.git')
    const empty = execFileSync('git', ['mktree'], { cwd: a, input: '' }).toString().trim()
    const badCommit = (m: string) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit-tree', empty, '-p', tip, '-m', m], { cwd: a }).toString().trim()
    const bad = badCommit('bad'), bad2 = badCommit('bad2')
    sh(a, 'push', '-q', bare, `${bad}:${TODO_REF}`)
    assert.match((await syncDoc(sa)) ?? '', /remote list unreadable/)
    assert.equal(await remoteSeen(sa.root!), bad)
    // A local branch commit never goes with it.
    const main = sh(bare, 'rev-parse', 'main')
    fs.writeFileSync(path.join(a, 'one.txt'), 'local only\n'); sh(a, 'commit', '-qam', 'local only')
    // Someone else moved it since: the lease refuses.
    sh(a, 'push', '-q', bare, `+${bad2}:${TODO_REF}`)
    assert.ok(await replaceRemote(sa.root!, bad))
    assert.equal(sh(bare, 'rev-parse', TODO_REF), bad2)
    assert.equal(await replaceRemote(sa.root!, 'not-a-sha'), 'not a commit id')
    assert.equal(await replaceRemote(sa.root!, bad2), undefined)
    assert.equal(sh(bare, 'rev-parse', TODO_REF), tip)
    assert.equal(sh(bare, 'rev-parse', 'main'), main)
    assert.equal(await syncDoc(sa), undefined)
    sh(a, 'reset', '-q', '--hard', 'HEAD~1')
  })

  it('allows no forced push but the leased to-do ref alone', async () => {
    const sha = 'a'.repeat(40), lease = `--force-with-lease=${TODO_REF}:${sha}`
    for (const args of [
      ['push', '--force', 'origin', 'main'],
      ['push', `--force-with-lease=refs/heads/main:${sha}`, 'origin', 'main:main'],
      ['push', lease, 'origin', `${TODO_REF}:${TODO_REF}`, 'main:main'],
      ['push', lease, 'origin', `+${TODO_REF}:${TODO_REF}`],
      ['push', lease, '--force', 'origin', `${TODO_REF}:${TODO_REF}`],
    ]) assert.equal((await git(a, args)).err, 'Switchboard never force pushes', args.join(' '))
  })

  it('keeps both of two overlapping adds to a file list', async () => {
    const s = await storeFor(path.join(root, 'no-such-folder'), files)
    assert.ok(s.file)
    await Promise.all([updateDoc(s, d => addTodo(d, 'One', 1, 'o1')), updateDoc(s, d => addTodo(d, 'Two', 2, 'o2'))])
    assert.deepEqual((await readDoc(s)).todo.map(t => t.text).sort(), ['One', 'Two'])
  })

  it('keeps a repo with no origin local', async () => {
    const solo = path.join(root, 'solo')
    sh(root, 'init', '-q', 'solo')
    const s = await storeFor(solo, files)
    await updateDoc(s, d => addTodo(d, 'Solo', 1, 's'))
    await syncDoc(s)
    assert.deepEqual((await readDoc(s)).todo.map(t => t.text), ['Solo'])
  })

  it('loads an old doc\'s Left items as to-do items, keeping tombstones', async () => {
    const s = await storeFor(path.join(plain, 'old'), files)
    fs.mkdirSync(path.dirname(s.file!), { recursive: true })
    fs.writeFileSync(s.file!, JSON.stringify({ version: 1, todo: [{ id: 't1', text: 'Mine', at: 1 }], left: [{ id: 'l1', text: 'From a chat', at: 2, from: 'c1' }, { id: 't1', text: 'dup', at: 3 }, { id: 'l2', text: 'Ticked', at: 2 }], removed: { l2: 4 } }))
    const d = await readDoc(s)
    assert.deepEqual(d.todo, [{ id: 't1', text: 'Mine', at: 1 }, { id: 'l1', text: 'From a chat', at: 2, from: 'c1' }])
    assert.deepEqual(d.removed, { l2: 4 })
    assert.equal('left' in d, false)
  })

  it('syncs before, from and done tombstones between two devices', async () => {
    const sa = await storeFor(a, files), sb = await storeFor(b, files)
    await syncDoc(sa); await syncDoc(sb)
    const t = Date.now()
    await updateDoc(sa, d => toolStep(d, { op: 'add', text: 'Set up the db', before: 't2', session: 'cA' }, t, 'p1').doc)
    await updateDoc(sb, d => removeItem(addTodo(d, 'Later', t, 'f1', { from: 'cB' }), 't3', t))
    await syncDoc(sa); await syncDoc(sb); await syncDoc(sa)
    for (const s of [sa, sb]) {
      const d = await readDoc(s)
      assert.deepEqual(d.todo.map(x => [x.id, x.before, x.from]).sort(), [['f1', undefined, 'cB'], ['p1', 't2', 'cA'], ['t2', undefined, undefined]])
      assert.ok(d.removed.t3)
    }
  })

  it('keeps suggestions, name and why when an older device writes a doc without them', async () => {
    const sa = await storeFor(a, files), sb = await storeFor(b, files)
    await syncDoc(sa); await syncDoc(sb)
    const t = Date.now()
    await updateDoc(sa, d => afterEnd(addTodo(d, 'Named', t, 'nm1', { from: 'cA', name: 'Fix login', why: 'blocked' }), chat({ sessionId: 'oldnew', state: 'idle', report: { done: [], left: ['wire the deploy key for staging'] } }), t))
    await syncDoc(sa); await syncDoc(sb)
    // An older extension reads and writes only todo, ticked and removed.
    const old = (d: TodoDoc): TodoDoc => ({ version: 1, removed: d.removed, todo: d.todo.map(({ name: _n, why: _w, ...x }) => x) })
    await updateDoc(sb, d => old(addTodo(d, 'typed on the old laptop', t + 1, 'old1')))
    await syncDoc(sb); await syncDoc(sa)
    const d = await readDoc(sa)
    assert.deepEqual(d.suggested?.map(x => x.text), ['wire the deploy key for staging'])
    assert.deepEqual(d.todo.find(x => x.id === 'nm1'), { id: 'nm1', text: 'Named', at: t, from: 'cA', name: 'Fix login', why: 'blocked' })
    assert.ok(d.todo.some(x => x.id === 'old1'))
    // The merge is pushed, so the other device gets them back too.
    await syncDoc(sb)
    assert.equal((await readDoc(sb)).suggested?.length, 1)
  })

  it('accepting one suggestion on two devices makes one item', async () => {
    const sa = await storeFor(a, files), sb = await storeFor(b, files)
    await updateDoc(sa, d => afterEnd(d, chat({ sessionId: 'twice', state: 'idle', report: { done: [], left: ['rotate the staging tokens'] } })))
    await syncDoc(sa); await syncDoc(sb)
    const id = (await readDoc(sb)).suggested!.find(x => x.text === 'rotate the staging tokens')!.id
    await updateDoc(sa, d => acceptSuggestion(d, id))
    await updateDoc(sb, d => acceptSuggestion(d, id))
    await syncDoc(sa); await syncDoc(sb); await syncDoc(sa)
    assert.equal((await readDoc(sa)).todo.filter(x => x.text === 'rotate the staging tokens').length, 1)
  })

  it('reads ticked items and put-back tombstones back from disk', async () => {
    const s = await storeFor(path.join(plain, 'ticked'), files)
    await updateDoc(s, d => restoreTicked({ ...d, ticked: [{ id: 'k1', text: 'A', at: 1, by: 's1' }, { id: 'k2', text: 'B', at: 2, by: 's2' }] }, 'k1', 3, 'n1'))
    const d = await readDoc(s)
    assert.deepEqual(d.ticked, [{ id: 'k2', text: 'B', at: 2, by: 's2' }])
    assert.equal(d.removed['k1.back'], 3)
    assert.deepEqual(d.todo.map(t => t.id), ['n1'])
  })

  it('drops bad ids from a doc, keeps an id named like an Object member', async () => {
    const s = await storeFor(plain, path.join(root, 'bad'))
    fs.mkdirSync(path.dirname(s.file!), { recursive: true })
    fs.writeFileSync(s.file!, JSON.stringify({ version: 1, todo: [{ id: 'constructor', text: 'ok', at: 1 }, { id: 'a b', text: 'bad', at: 1 }, { id: 'x'.repeat(65), text: 'long', at: 1 }], left: [], removed: { __proto__: 5, 'a b': 1, good: 2 } }))
    const d = await readDoc(s)
    assert.deepEqual(d.todo.map(t => t.id), ['constructor'])
    assert.deepEqual(Object.keys(d.removed), ['good'])
    assert.deepEqual(mergeDocs(d, emptyDoc(), 3).todo.map(t => t.id), ['constructor'])
    // A broken file is an error, never an empty list that a write would save.
    fs.writeFileSync(s.file!, '{broken')
    await assert.rejects(readDoc(s))
    await assert.rejects(updateDoc(s, x => addTodo(x, 'new', 1)))
    assert.equal(fs.readFileSync(s.file!, 'utf8'), '{broken')
  })

  it('refuses to write over a ref it cannot read, and past the size cap', async () => {
    const r = path.join(root, 'odd')
    sh(root, 'init', '-q', 'odd')
    const s = await storeFor(r, files)
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: r, input: 'x' }).toString().trim()
    const tree = execFileSync('git', ['mktree'], { cwd: r, input: `100644 blob ${blob}\tother.txt\n` }).toString().trim()
    const c = execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit-tree', tree, '-m', 'x'], { cwd: r }).toString().trim()
    sh(r, 'update-ref', TODO_REF, c)
    await assert.rejects(readDoc(s))
    await assert.rejects(updateDoc(s, x => addTodo(x, 'new', 1)))
    assert.equal(sh(r, 'rev-parse', TODO_REF), c)
    sh(r, 'update-ref', '-d', TODO_REF)
    await updateDoc(s, x => ({ ...x, todo: Array.from({ length: 500 }, (_, i) => ({ id: `i${i}`, text: 't', at: 1 })) }))
    await assert.rejects(updateDoc(s, x => addTodo(x, 'one more', 2)))
    await updateDoc(s, x => removeItem(x, 'i0', Date.now()))
  })

  it('keeps a folder with no git in a file', async () => {
    const s = await storeFor(plain, files)
    assert.equal(s.root, undefined)
    assert.ok(s.file?.startsWith(files))
    await updateDoc(s, d => addTodo(d, 'Plain', 1, 'p'))
    assert.deepEqual((await readDoc(s)).todo.map(t => t.text), ['Plain'])
    await syncDoc(s)
  })

  it('a slower, older Done of the same chat never writes over a newer one', async () => {
    const s = await storeFor(fs.mkdtempSync(path.join(os.tmpdir(), 'race-')), fs.mkdtempSync(path.join(os.tmpdir(), 'race-files-')))
    const slow = todoFinished(s, chat({ sessionId: 'r1', report: { done: ['a'], left: ['Fix old A'] } }), () => new Promise(r => setTimeout(() => r('1'), 100)))
    await todoFinished(s, chat({ sessionId: 'r1', report: { done: ['b'], left: ['Fix new B'] } }), async () => '1')
    await slow
    const d = await readDoc(s)
    assert.deepEqual(d.suggested?.map(l => l.text), ['Fix new B'])
    assert.deepEqual(d.removed, {})
  })

  it('a finished chat adds its Left items and the model ticks older ones', async () => {
    const s = await storeFor(plain, files)
    // The Left filter keeps every line here; its own tests are above.
    const keep = (f: (q: string) => Promise<string>) => async (q: string) => q.startsWith("A coding chat's standup") ? '1, 2, 3, 4, 5' : f(q)
    await todoFinished(s, chat({ sessionId: 'c1', report: { done: [], left: ['Fix old thing'] } }), keep(async () => 'none'))
    const sug = (await readDoc(s)).suggested!.find(t => t.text === 'Fix old thing')!
    await updateDoc(s, d => acceptSuggestion(d, sug.id, 2, 'acc11111'))
    const id = 'acc11111'
    let asked = ''
    await todoFinished(s, chat({ sessionId: 'c2', report: { done: ['Old thing done'], left: ['Fix new thing'] } }), keep(async q => { asked = q; return id }))
    assert.match(asked, /Old thing/)
    assert.deepEqual((await readDoc(s)).todo.map(l => l.text), ['Plain'])
    const next = (await readDoc(s)).suggested!.find(t => t.text === 'Fix new thing')!
    await updateDoc(s, d => acceptSuggestion(d, next.id, 3, 'new11111'))
    assert.deepEqual((await readDoc(s)).todo.map(l => l.text), ['Plain', 'Fix new thing'])
    // A failed model call removes nothing.
    await todoFinished(s, chat({ sessionId: 'c3', report: { done: ['x'], left: [] } }), keep(async () => { throw new Error('offline') }))
    assert.deepEqual((await readDoc(s)).todo.map(l => l.text), ['Plain', 'Fix new thing'])
    // An item typed in by hand, or one this chat added itself, is ticked too; one in progress on a chat is not asked about.
    await updateDoc(s, d => startTodo(addTodo(addTodo(d, 'Mine', 2, 'm1', { from: 'c4' }), 'Busy', 2, 'b1'), 'b1', 'other', 3))
    await todoFinished(s, chat({ sessionId: 'c4', report: { done: ['did it'], left: [] } }), keep(async q => { asked = q; return 'p, m1, b1' }))
    assert.doesNotMatch(asked, /Busy/)
    assert.deepEqual((await readDoc(s)).todo.map(l => l.text), ['Fix new thing', 'Busy'])
    // Finishing again with the same Left line keeps it, whatever the model says.
    asked = ''
    await todoFinished(s, chat({ sessionId: 'c2', report: { done: ['part of it'], left: ['Fix new thing'] } }), keep(async q => { asked = q; return (await readDoc(s)).todo.map(l => l.id).join(',') }))
    assert.doesNotMatch(asked, /New thing/)
    assert.deepEqual((await readDoc(s)).todo.map(l => l.text), ['Fix new thing', 'Busy'])
  })

  it('any finished chat ticks tray lines another chat left when its work covers them; its own listed Left line is never asked about', async () => {
    const s = await storeFor(fs.mkdtempSync(path.join(os.tmpdir(), 'you-')), fs.mkdtempSync(path.join(os.tmpdir(), 'you-files-')))
    const keep = (f: (q: string) => Promise<string>) => async (q: string) => q.startsWith("A coding chat's standup") ? '1, 2' : f(q)
    await updateDoc(s, d => afterEnd(d, chat({ sessionId: 'y1', state: 'idle', report: { done: [], left: ['Save typed drafts across reloads', 'Add rate limits later'] } }), 1))
    const sug = (await readDoc(s)).suggested!
    const draft = sug.find(x => x.text.startsWith('Save'))!
    let asked = ''
    await todoFinished(s, chat({ sessionId: 'y2', report: { done: ['Drafts now survive a reload'], left: ['Write the deploy docs'] } }), keep(async q => { asked = q; return draft.id }))
    assert.match(asked, /Save typed drafts/)
    assert.match(asked, /rate limits/)
    const d = await readDoc(s)
    assert.deepEqual(d.ticked?.map(t => [t.id, t.by]), [[draft.id, 'y2']])
    assert.deepEqual(d.suggested?.map(x => x.text).sort(), ['Add rate limits later', 'Write the deploy docs'])
    // y2's own Left line, still listed, is not offered to the model.
    await todoFinished(s, chat({ sessionId: 'y2', report: { done: ['more'], left: ['Write the deploy docs'] } }), keep(async q => { asked = q; return 'none' }))
    assert.doesNotMatch(asked, /deploy docs/)
  })

  it('a chat that ends without Done still ticks what its Done list covers; what it was asked is not evidence', async () => {
    const s = await storeFor(fs.mkdtempSync(path.join(os.tmpdir(), 'end-')), fs.mkdtempSync(path.join(os.tmpdir(), 'end-files-')))
    await updateDoc(s, d => addTodo(addTodo(d, 'Fix the usage meter', 1, 'u1'), 'Add the Codex tab', 1, 'c1'))
    let asked = ''
    const ask = async (q: string) => q.startsWith("A coding chat's standup") ? 'none' : (asked = q, 'u1')
    const d = await todoEnded(s, chat({ sessionId: 'e1', state: 'idle', asked: ['please add the codex tab'], report: { done: ['Usage meter shows when usage is up'], left: [] } }), ask)
    assert.doesNotMatch(asked, /please add/)
    assert.deepEqual(d.todo.map(t => t.id), ['c1'])
    assert.deepEqual(d.ticked?.map(t => [t.id, t.by]), [['u1', 'e1']])
    // Nothing done: no question at all.
    asked = ''
    await todoEnded(s, chat({ sessionId: 'e2', state: 'idle', asked: ['x'], report: { done: [], left: [] } }), ask)
    assert.equal(asked, '')
    // A report an earlier Done already judged is not judged again, so a Put back item stays open.
    await todoEnded(s, chat({ sessionId: 'e3', state: 'working', finishedAt: 5, report: { done: ['Added the Codex tab'], left: [] } }), ask)
    assert.equal(asked, '')
  })

  it('a chat\'s own missed requests are never ticked by its own asks', async () => {
    const s = await storeFor(fs.mkdtempSync(path.join(os.tmpdir(), 'miss-')), fs.mkdtempSync(path.join(os.tmpdir(), 'miss-files-')))
    await updateDoc(s, d => addMissed(d, chat({ sessionId: 'm1', asked: ['Add a dark mode toggle to settings'], covered: [0.1] }), 1))
    await updateDoc(s, d => addMissed(d, chat({ sessionId: 'm0', asked: ['Add a CSV export button'], covered: [0.1] }), 1))
    let asked = ''
    await todoFinished(s, chat({ sessionId: 'm1', asked: ['Add a dark mode toggle to settings', 'bump it'], report: { done: ['Bumped the version'], left: [] } }), async q => q.startsWith("A coding chat's standup") ? 'none' : (asked = q, 'none'))
    assert.doesNotMatch(asked.split('\n\n')[0], /dark mode/)
    // Another chat's missed line is still offered.
    assert.match(asked, /CSV export/)
  })
})

describe('hub-todo route shapes', () => {
  it('checks every field', () => {
    assert.equal(commandProblem({ type: 'hub-todo-add', path: '/p', text: 'x' }), undefined)
    assert.equal(commandProblem({ type: 'hub-todo-edit', path: '/p', id: 'a', text: 'x' }), undefined)
    assert.equal(commandProblem({ type: 'hub-todo-remove', path: '/p', id: 'a' }), undefined)
    assert.equal(commandProblem({ type: 'hub-todo-run', path: '/p', ids: ['a', 'b'] }), undefined)
    assert.equal(commandProblem({ type: 'hub-todo-run', path: '/p', ids: ['a'], to: 's1' }), undefined)
    assert.match(commandProblem({ type: 'hub-todo-run', path: '/p', ids: [] }) ?? '', /ids/)
    assert.match(commandProblem({ type: 'hub-todo-run', path: '/p', ids: [1] }) ?? '', /ids/)
    assert.match(commandProblem({ type: 'hub-todo-add', path: '/p' }) ?? '', /text/)
    assert.equal(commandProblem({ type: 'hub-todo-sync', path: '/p', on: true }), undefined)
    assert.match(commandProblem({ type: 'hub-todo-sync', path: '/p', on: 'yes' }) ?? '', /on/)
    assert.equal(commandProblem({ type: 'hub-todo-replace', path: '/p', remote: 'a'.repeat(40) }), undefined)
    assert.match(commandProblem({ type: 'hub-todo-replace', path: '/p', remote: 'main' }) ?? '', /remote/)
    assert.equal(commandProblem({ type: 'hub-todo-restore', path: '/p', id: 'a' }), undefined)
    assert.match(commandProblem({ type: 'hub-todo-restore', path: '/p' }) ?? '', /id/)
    assert.equal(commandProblem({ type: 'hub-todo-accept', path: '/p', id: 'a' }), undefined)
    assert.equal(commandProblem({ type: 'hub-todo-dismiss', path: '/p', id: 'a' }), undefined)
    assert.match(commandProblem({ type: 'hub-todo-dismiss', path: '/p' }) ?? '', /id/)
  })
})

describe('todo run', () => {
  const list = [
    { id: 'a', text: 'Ship receipts', at: 1 },
    { id: 'p', text: 'Set up the db', at: 2, before: 'a' },
    { id: 'pp', text: 'Get the key', at: 3, before: 'p' },
    { id: 'b', text: 'Write docs', at: 4 },
  ]
  it('runs open prerequisites first, each once, in list order', () => {
    assert.deepEqual(runOrder(list, ['a']).map(t => t.id), ['pp', 'p', 'a'])
    assert.deepEqual(runOrder(list, ['b', 'a', 'p']).map(t => t.id), ['pp', 'p', 'a', 'b'])
    assert.deepEqual(runOrder([{ id: 'x', text: 'X', at: 1, before: 'y' }, { id: 'y', text: 'Y', at: 1, before: 'x' }], ['x']).map(t => t.id), ['y', 'x'])
  })
  it('says the items as a numbered list with the rules', () => {
    assert.equal(runMessage(runOrder(list, ['a'])), [
      'Switchboard to-do, in this order:',
      '1. Get the key (id pp, needed first for 2)',
      '2. Set up the db (id p, needed first for 3)',
      '3. Ship receipts (id a)',
      '',
      'Do prerequisites first. When you find something that must be done before an item, add it to the to-do with the switchboard todo_add tool (before_id: that item\'s id) as a prerequisite, do it, then continue. Mark each item done with todo_done (its id) when it is finished.',
    ].join('\n'))
  })
})

describe('todo tool', () => {
  const d = startTodo(addTodo(addTodo(emptyDoc(), 'Ship receipts', 1, 'a'), 'Write docs', 1, 'b'), 'a', 'c1', 2)
  it('adds a prerequisite before an item by id or text, in progress where that item is', () => {
    const r = toolStep(d, { op: 'add', text: 'Set up the db', before: 'receipts', session: 'c1' }, 5, 'p1')
    assert.deepEqual(r.doc.todo.at(-1), { id: 'p1', text: 'Set up the db', at: 5, before: 'a', chat: 'c1', host: hostId(), from: 'c1' })
    assert.match(r.said, /p1/)
    assert.equal(toolStep(d, { op: 'add', text: 'Later', session: 'c1' }, 5, 'f1').doc.todo.at(-1)?.chat, undefined)
    assert.throws(() => toolStep(d, { op: 'add', text: 'X', before: 'nothing like it' }), /no open to-do item/)
    assert.throws(() => toolStep(d, { op: 'add', text: ' ' }), /text/)
  })
  it('an add that an open item or suggestion already says is not added again', () => {
    const r = toolStep(d, { op: 'add', text: 'ship receipts', session: 'c1' }, 5, 'f1')
    assert.equal(r.doc, d)
    assert.equal(r.said, 'Already on the list as a: Ship receipts')
    const g = addTodo(d, 'Write the migration guide for v2', 1, 'g')
    assert.equal(toolStep(g, { op: 'add', text: 'Write a migration guide for v2' }, 5, 'f2').said, 'Already on the list as g: Write the migration guide for v2')
  })
  it('an add a shorter or longer item only partly says still goes on', () => {
    const base = ['CI', 'docs', 'Fix login'].reduce((o, t, i) => addTodo(o, t, 1, `k${i}`), emptyDoc())
    for (const text of ['Add CircleCI config', 'Update docstrings', 'Fix login redirect loop on Safari']) assert.match(toolStep(base, { op: 'add', text }, 5, 'n1').said, /^Added n1/)
    assert.match(toolStep(addTodo(emptyDoc(), 'Fix login redirect loop on Safari', 1, 'k'), { op: 'add', text: 'Fix login' }, 5, 'n1').said, /^Added n1/)
  })
  it('a suggestion in the tray never blocks an add, so dismissing it loses nothing', () => {
    const s = { ...emptyDoc(), suggested: [{ id: 's9', text: 'Write the migration guide for v2', at: 1 }] }
    assert.deepEqual(toolStep(s, { op: 'add', text: 'Write the migration guide for v2' }, 5, 'f2').doc.todo.map(t => t.id), ['f2'])
  })
  it('closes an item by id or text, with a tombstone', () => {
    assert.deepEqual(toolStep(d, { op: 'done', id: 'b' }, 6).doc.removed, { b: 6 })
    assert.deepEqual(toolStep(d, { op: 'done', text: 'ship receipts' }, 6).doc.todo.map(t => t.id), ['b'])
    assert.throws(() => toolStep(addTodo(d, 'Docs two', 1, 'c'), { op: 'done', text: 'doc' }), /2 items/)
  })
  it('the route needs the token and passes the call on', async () => {
    const hub = new HubService()
    const calls: unknown[] = []
    const fake = async (b: unknown) => { calls.push(b); return 'Added p1' }
    const body = JSON.stringify({ op: 'add', cwd: '/p', text: 'X' })
    assert.equal((await handleHub(hub, 'POST', '/hub/todo?token=nope', body, undefined, fake))?.status, 403)
    const ok = await handleHub(hub, 'POST', `/hub/todo?token=${hub.token}`, body, undefined, fake)
    assert.deepEqual([ok?.status, ok?.body], [200, 'Added p1'])
    assert.deepEqual(calls, [{ op: 'add', cwd: '/p', text: 'X' }])
    assert.equal((await handleHub(hub, 'POST', `/hub/todo?token=${hub.token}`, JSON.stringify({ op: 'zap', cwd: '/p' }), undefined, fake))?.status, 400)
    const bad = await handleHub(hub, 'POST', `/hub/todo?token=${hub.token}`, body, undefined, async () => { throw new Error('no open to-do item matches "x"') })
    assert.deepEqual([bad?.status, bad?.body], [400, 'no open to-do item matches "x"'])
  })
})

describe('holdReason', () => {
  const now = 10 * 60_000
  const item = (id: string, more: Partial<TodoDoc['todo'][number]> = {}) => ({ id, text: `do ${id}`, at: 0, ...more })
  const base = { on: true, folder: '/p', todo: [item('a'), item('b')], limited: false, tried: new Set<string>(), now }

  it('holds nothing while the next item starts', () => {
    assert.equal(holdReason(base), undefined)
  })

  it('holds nothing while auto-run is off or nothing is startable', () => {
    assert.equal(holdReason({ ...base, on: false }), undefined)
    assert.equal(holdReason({ ...base, todo: [item('a', { chat: 'c1', at: 0 })] }), undefined)
  })

  it('names what a live to-do chat waits on', () => {
    const hold = holdReason({ ...base, todo: [item('a', { chat: 'c1' }), item('b')], live: new Set(['c1']), links: [{ from: 'c1', to: ['c9'] }], label: () => 'Outfit picker copy' })
    assert.deepEqual(hold, { kind: 'waiting', text: 'Next to-do waits: do a is waiting on Outfit picker copy to finish' })
  })

  it('drops a wait target that finished and names the chat that took over', () => {
    const hold = holdReason({ ...base, todo: [item('a', { chat: 'c1' }), item('b')], live: new Set(['c1']), links: [{ from: 'c1', to: ['c2', 'c3'] }], open: id => (id === 'c2' ? undefined : 'c4'), label: id => `chat ${id}` })
    assert.deepEqual(hold, { kind: 'waiting', text: 'Next to-do waits: do a is waiting on chat c4 to finish' })
  })

  it('falls back to the running text when every wait target finished', () => {
    const hold = holdReason({ ...base, todo: [item('a', { chat: 'c1' }), item('b')], live: new Set(['c1']), links: [{ from: 'c1', to: ['c2'] }], open: () => undefined })
    assert.deepEqual(hold, { kind: 'running', text: 'Next to-do starts when do a finishes' })
  })

  it('a failed start is named before the grace of a just-claimed item', () => {
    assert.deepEqual(holdReason({ ...base, todo: [item('a', { chat: 'c1', at: now - 1000 }), item('b')], failedAt: now - 1000 }), { kind: 'sync', text: 'Next to-do waits: the last start failed, retrying' })
  })

  it('says the next item starts when a live to-do chat finishes, when it waits on nothing', () => {
    assert.deepEqual(holdReason({ ...base, todo: [item('a', { chat: 'c1' }), item('b')], live: new Set(['c1']) }), { kind: 'running', text: 'Next to-do starts when do a finishes' })
  })

  it('gives the time the usage limit resets', () => {
    const resetAt = new Date(2026, 10, 21, 15, 40).getTime()
    assert.deepEqual(holdReason({ ...base, limited: true, resetAt }), { kind: 'limit', text: 'Next to-do waits for the usage limit to reset at 3:40 PM' })
    assert.deepEqual(holdReason({ ...base, limited: true }), { kind: 'limit', text: 'Next to-do waits for the usage limit to reset' })
  })

  it('says the autopilot is paused', () => {
    assert.deepEqual(holdReason({ ...base, pilot: { paused: true, at: 0 } }), { kind: 'paused', text: 'Next to-do waits: autopilot is paused' })
  })

  it('says the last start failed while the retry waits', () => {
    assert.deepEqual(holdReason({ ...base, failedAt: now - 1000 }), { kind: 'sync', text: 'Next to-do waits: the last start failed, retrying' })
    assert.equal(holdReason({ ...base, failedAt: 0 }), undefined)
  })
})

describe('dropped', () => {
  it('sees a finished row an older device wrote without why or name', () => {
    const row = { id: 'a1', text: 'Reload the window', at: 5 }
    const mine: TodoDoc = { ...emptyDoc(), ticked: [{ ...row, why: 'you', name: 'Chat A' }] }
    assert.equal(dropped(mine, { ...emptyDoc(), ticked: [row] }), true)
    assert.equal(dropped(mine, mine), false)
  })
})

describe('autoStartPlan', () => {
  const now = 10 * 60_000
  const item = (id: string, more: Partial<TodoDoc['todo'][number]> = {}) => ({ id, text: `do ${id}`, at: 0, ...more })
  const base = { on: true, folder: '/p', todo: [item('a'), item('b')], busy: false, limited: false, tried: new Set<string>(), now }
  const ids = (p: ReturnType<typeof autoStartPlan>) => p?.items.map(t => t.id)

  it('an idle project starts its first ready item', () => {
    assert.deepEqual(autoStartPlan(base), { folder: '/p', items: [base.todo[0]] })
  })

  it('starts nothing while busy, limited, switched off, or in a window that does not own a project', () => {
    for (const s of [{ busy: true }, { limited: true }, { on: false }, { folder: undefined }]) assert.equal(autoStartPlan({ ...base, ...s }), undefined, JSON.stringify(s))
  })

  it('an open prerequisite runs first, with the item it unlocks', () => {
    assert.deepEqual(ids(autoStartPlan({ ...base, todo: [item('a'), item('p', { before: 'a' })] })), ['p', 'a'])
  })

  it('skips hand steps, items already tried, and items whose prerequisite is the user\'s', () => {
    assert.deepEqual(ids(autoStartPlan({ ...base, todo: [item('y', { why: 'you' }), item('a'), item('b')], tried: new Set(['a']) })), ['b'])
    assert.equal(autoStartPlan({ ...base, todo: [item('a'), item('y', { why: 'you', before: 'a' })] }), undefined)
  })

  it('a second evaluation right after the claim starts nothing', () => {
    const first = autoStartPlan(base)!
    const claimed = first.items.reduce((d, t) => startTodo(d, t.id, 'chat-1', now), { ...emptyDoc(), todo: base.todo })
    assert.equal(autoStartPlan({ ...base, todo: claimed.todo }), undefined)
    // Past the grace a claim whose chat never showed is cleared by clearGone; the next item waits for that.
    assert.deepEqual(ids(autoStartPlan({ ...base, todo: claimed.todo, now: now + 3 * 60_000 })), ['b'])
  })
})

describe('auto-start around a usage limit and claims', () => {
  const limit = { session_id: 'x1', cwd: '/p', hook_event_name: 'StopFailure', error: 'rate_limit', last_assistant_message: 'API Error: Rate limit reached' }

  it('a limited chat that ended keeps its item through the reset, and its project waits for the resume', () => {
    const h = new HubService()
    h.hook(limit, 0)
    h.hook({ session_id: 'x1', cwd: '/p', hook_event_name: 'SessionEnd', reason: 'other' }, 1000)
    const reset = 30 * 60_000
    let d: TodoDoc = { ...emptyDoc(), todo: [{ id: 'a', text: 'do a', at: 0, chat: 'x1', host: hostId() }, { id: 'b', text: 'do b', at: 0 }] }
    d = clearGone(d, new Set(h.retryIds()), reset)
    assert.equal(d.todo[0].chat, 'x1')
    const resumed = h.goneDue(() => false, reset)
    assert.deepEqual(resumed.map(r => r.sessionId), ['x1'])
    const s = { on: true, folder: '/p', busy: false, limited: h.retrying(), tried: new Set<string>(), resumed: reset }
    assert.equal(autoStartPlan({ ...s, todo: d.todo, now: reset }), undefined)
    // The next pass, before the resumed chat shows as live: still its item, still no second chat.
    d = clearGone(d, new Set(resumed.map(r => r.sessionId)), reset + 15_000)
    assert.equal(d.todo[0].chat, 'x1')
    assert.equal(autoStartPlan({ ...s, todo: d.todo, now: reset + 15_000 }), undefined)
    assert.deepEqual(autoStartPlan({ ...s, todo: d.todo, now: reset + 3 * 60_000 })?.items.map(t => t.id), ['b'])
  })

  it('claims only items still free: not running, not claimed in the last grace, not on another machine', () => {
    const d: TodoDoc = { ...emptyDoc(), todo: [
      { id: 'a', text: 'A', at: 0 },
      { id: 'dead', text: 'D', at: 0, chat: 'old', host: hostId() },
      { id: 'run', text: 'R', at: 0, chat: 'live', host: hostId() },
      { id: 'new', text: 'N', at: 9 * 60_000, chat: 'fresh', host: hostId() },
      { id: 'far', text: 'F', at: 0, chat: 'x', host: 'otherhost' },
    ] }
    const now = 10 * 60_000, live = new Set(['live'])
    const got = claimItems(d, ['a', 'dead'], 'c1', live, now)
    assert.deepEqual(got.todo.slice(0, 2).map(t => t.chat), ['c1', 'c1'])
    for (const id of ['run', 'new', 'far', 'gone']) assert.equal(claimItems(d, ['a', id], 'c1', live, now), d, id)
  })
})

describe('claimItems on another machine\'s claim', () => {
  const d: TodoDoc = { ...emptyDoc(), todo: [{ id: 'o', text: 'O', at: 0, chat: 'x', host: 'other' }] }
  const day = 24 * 60 * 60_000

  it('Run takes over one past the grace; auto-start never does; Run within the grace refuses', () => {
    assert.equal(claimItems(d, ['o'], 'c1', new Set(), 10 * day, true).todo[0].chat, 'c1')
    assert.equal(claimItems(d, ['o'], 'c1', new Set(), 10 * day), d)
    assert.equal(claimItems(d, ['o'], 'c1', new Set(), 60_000, true), d)
  })
})

describe('auto-start claims on a synced list wait for origin', () => {
  const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  let root = '', a = '', b = ''
  const claim = (chat: string) => (d: TodoDoc) => claimItems(d, ['x'], chat, new Set())
  const remoteChat = () => parseDoc(sh(path.join(root, 'remote.git'), 'cat-file', 'blob', `${TODO_REF}:todo.json`)).todo.find(t => t.id === 'x')?.chat
  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-claim-'))
    sh(root, 'init', '-q', '--bare', '-b', 'main', 'remote.git')
    for (const name of ['a', 'b']) sh(root, 'clone', '-q', 'remote.git', name)
    a = path.join(root, 'a'); b = path.join(root, 'b')
    await updateDoc({ root: a }, d => addTodo(d, 'X', 1, 'x'))
    await syncDoc({ root: a }); await syncDoc({ root: b })
  })
  after(() => fs.rmSync(root, { recursive: true, force: true }))

  it('two machines race: only the one whose push wins gets the claim; the loser fetches, sees it and skips', async () => {
    let won: TodoDoc | undefined
    // b claims and pushes after a has fetched but before a pushes, so a's push is rejected.
    const lost = await claimRemote(a, claim('a1'), { beforePush: async () => { won ??= await claimRemote(b, claim('b1')) } })
    assert.equal(lost, undefined)
    assert.equal(won?.todo.find(t => t.id === 'x')?.chat, 'b1')
    assert.equal(remoteChat(), 'b1')
    assert.equal((await readDoc({ root: b })).todo[0].chat, 'b1')
  })

  it('a Run claim that lands while auto-start fetches wins: auto-start re-checks and refuses', async () => {
    await updateDoc({ root: a }, d => addTodo(d, 'Y', 2, 'y'))
    await syncDoc({ root: a })
    const remote = () => parseDoc(sh(path.join(root, 'remote.git'), 'cat-file', 'blob', `${TODO_REF}:todo.json`)).todo.find(t => t.id === 'y')?.chat
    let run: TodoDoc | undefined
    const auto = await claimRemote(a, d => claimItems(d, ['y'], 'auto1', new Set()), { beforeClaim: async () => { run ??= await updateDoc({ root: a }, d => claimItems(d, ['y'], 'run1', new Set(), Date.now(), true)) } })
    assert.equal(auto, undefined)
    assert.equal(run?.todo.find(t => t.id === 'y')?.chat, 'run1')
    assert.equal((await readDoc({ root: a })).todo.find(t => t.id === 'y')?.chat, 'run1')
    assert.notEqual(remote(), 'auto1')
  })

  it('offline: auto-start skips the item; Run still claims it locally', async () => {
    const c = path.join(root, 'c')
    sh(root, 'clone', '-q', 'remote.git', 'c')
    await syncDoc({ root: c })
    await updateDoc({ root: c }, d => startTodo(d, 'x', undefined, 0))
    sh(c, 'remote', 'set-url', 'origin', path.join(root, 'gone.git'))
    // Opted in, as if private on GitHub; passed in, so the real ~/.claude opt-in file is never written.
    const optIn = { [fs.realpathSync(c)]: true as const }
    assert.equal(await claimRemote(c, claim('c1')), undefined)
    const tried = new Set<string>()
    assert.equal(await claimTodo(fs.realpathSync(c), ['x'], 'c1', new Set(), false, optIn, tried), false)
    assert.deepEqual([...tried], [], 'an unconfirmed claim leaves the item for a later pass')
    assert.equal((await readDoc({ root: c })).todo[0].chat, undefined)
    assert.equal(await claimTodo(fs.realpathSync(c), ['x'], 'c2', new Set(), true, optIn, tried), true)
    assert.deepEqual([...tried], ['x'], 'a claimed item is never auto-started again')
    assert.equal((await readDoc({ root: c })).todo[0].chat, 'c2')
  })
})

describe('autoStartPlan backs off after an unconfirmed claim', () => {
  const s = { on: true, folder: '/p', todo: [{ id: 'a', text: 'A', at: 0 }], busy: false, limited: false, tried: new Set<string>() }
  it('plans nothing for 5 minutes after a failed claim, then tries again; no failure, no wait', () => {
    assert.equal(autoStartPlan({ ...s, now: 60_000 + 4 * 60_000, failedAt: 60_000 }), undefined)
    assert.deepEqual(autoStartPlan({ ...s, now: 60_000 + 5 * 60_000, failedAt: 60_000 })?.items.map(t => t.id), ['a'])
    assert.deepEqual(autoStartPlan({ ...s, now: 61_000 })?.items.map(t => t.id), ['a'])
  })
})

describe('suggestion quality', () => {
  const day = 24 * 60 * 60_000
  const sug = (id: string, text: string, why: TodoDoc['todo'][0]['why'], from: string, at: number) => ({ id, text, at, from, why })
  // The id an old For you line got: those are the hand steps prune drops.
  const you = (text: string, from: string, at: number) => sug(crypto.createHash('sha1').update(`${from}\nyou\n${text}`).digest('hex').slice(0, 8), text, 'you', from, at)
  const doc = (over: Partial<TodoDoc>): TodoDoc => ({ ...emptyDoc(), ...over })

  it('drops pasted wrappers, harness prompts and follow-up nudges from missed requests; keeps real ones', () => {
    const asked = [
      '<pasted_content id="afb4"> Chat: Add these functions into switchboard Stuck: designer subagent',
      '<cross-session-message from="uds:/tmp/x.sock" from-name="Video"> Agreed, holding all edits',
      'Your claude.ai usage limit has reset. Continue the task you were working on when the limit was reached.',
      'Is there anything else?',
      'Do what is left',
      'Is everything done if not do them. Fix risks and add anything that will help',
      'Seems like engineer is stuck please fix',
      'After all subagents and tasks are done make full commit message including everything',
      'ok',
      'Add the Transcript tab for Codex chats',
      'add dark mode',
      '<pasted_content id="a1">log lines</pasted_content> Fix the crash in this log',
      'Show when the usage limit resets in the header',
      'Looks like the build gets stuck on Windows, look into it',
      'Add tests',
      'Fix the commit message prefill for the second repo',
      'Can you also add a logout button to settings?',
    ]
    const d = addMissed(emptyDoc(), chat({ asked, covered: asked.map(() => 0) }), 5)
    assert.deepEqual(d.suggested?.map(t => t.text), ['Add the Transcript tab for Codex chats', 'add dark mode', 'Fix the crash in this log', 'Show when the usage limit resets in the header',
      'Looks like the build gets stuck on Windows, look into it', 'Add tests', 'Fix the commit message prefill for the second repo', 'Can you also add a logout button to settings?'])
  })

  it('drops wrapper-only and nudge Left lines too; an unknown tag is plain text', () => {
    const d = afterFinish(emptyDoc(), chat({ report: { done: ['x'], left: ['<system-reminder>be terse</system-reminder>', '<command-name>/clear', 'Your claude.ai usage limit has reset.', 'Add rate limits', 'Wrap <todo-panel> in a dialog so it can close'] } }), [], 1)
    assert.deepEqual(d.suggested?.map(t => t.text), ['Add rate limits', 'Wrap <todo-panel> in a dialog so it can close'])
  })

  it('a line that only points at an open to-do item is dropped', () => {
    const d = doc({ todo: [{ id: 'd6bdfb41', text: 'Add MCP connectors', at: 1 }] })
    const out = afterFinish(d, chat({ report: { done: ['x'], left: [], you: ['To-do `d6bdfb41`: the connectors, which need your API keys.'] } }), [], 2)
    assert.equal(out.suggested, undefined)
  })

  it('a Left line saying what an open item or another chat\'s suggestion says is not added', () => {
    const d = doc({ todo: [{ id: 't1', text: 'Add the Transcript tab for Codex chats', at: 1 }], suggested: [sug('s9', 'Write the deploy docs for staging', 'later', 'c1', 1)] })
    const out = afterFinish(d, chat({ sessionId: 'c2', report: { done: ['x'], left: ['Add the Transcript tab for Codex chats', 'Write the deploy docs for staging'] } }), [], 2)
    assert.deepEqual(out.suggested?.map(t => t.id), ['s9'])
  })

  it('prune matches whole words: an open "CI" item never drops "Decide pricing tiers"', () => {
    const d = doc({ todo: [{ id: 't1', text: 'CI', at: 1 }], suggested: [sug('s1', 'Decide pricing tiers for teams', 'later', 'c1', 1)] })
    assert.equal(prune(d, 2), d)
  })

  it('prune drops old For you hand steps, open or in the tray, whatever their age; a Left line once guessed as you stays', () => {
    const mic = you('Tap the mic once', 'c1', 1), y1 = you('Reconnect Remote Control in this chat', 'c1', 0)
    const d = doc({ todo: [{ ...mic, id: `${mic.id}-ok` }, { id: 't1', text: 'Add the Codex tab', at: 1 }, { id: 'g1-ok', text: 'Add retries to your webhook handler', at: 1, from: 'c1', why: 'you' }],
      suggested: [y1, sug('g2', 'Decide the pricing tiers', 'you', 'c1', 0), sug('l1', 'Add rate limits to export', 'later', 'c1', 0)] })
    const out = prune(d, 1)
    assert.deepEqual(out.todo.map(t => t.id), ['t1', 'g1-ok'])
    assert.deepEqual(out.suggested?.map(t => t.id), ['g2', 'l1'])
    assert.equal(out.removed[y1.id], 1)
    assert.equal(out.removed[`${mic.id}-ok`], 1)
    assert.equal(out.cleared, 2)
    assert.equal(prune(out, 2), out)
  })

  it('prune counts what it cleared in one pass, open duplicates and suggestions together', () => {
    const d = doc({ todo: [{ id: 'a1', text: 'Add rate limits', at: 1 }, { id: 'a2', text: 'Add rate limits', at: 2, from: 'c1' }],
      suggested: [you('Reconnect Remote Control in this chat', 'c1', 0)], cleared: 7 })
    assert.equal(prune(d, 3 * day + 1).cleared, 2)
  })

  it('prune picks the same duplicate on every machine, whatever the list order', () => {
    const A = doc({ suggested: [sug('bb', 'Write the deploy docs for staging', 'later', 'c1', 5)], todo: [{ id: 'x2', text: 'Add rate limits to export', at: 3, from: 'c1' }] })
    const B = doc({ suggested: [sug('aa', 'Write the deploy docs for staging', 'later', 'c2', 5)], todo: [{ id: 'x1', text: 'Add rate limits to export', at: 3, from: 'c2' }] })
    const out = mergeDocs(prune(mergeDocs(A, B, 10), 10), prune(mergeDocs(B, A, 10), 10), 10)
    assert.deepEqual(out.suggested?.map(t => t.id), ['aa'])
    assert.deepEqual(out.todo.map(t => t.id), ['x1'])
  })

  it('prune never touches accepted or typed items; only a chat-made exact duplicate goes', () => {
    const now = 10 * day
    const d = doc({
      todo: [
        { id: '8133346b', text: 'Switchboard app keeper: add a way to turn the 3131 keep-alive off', at: 1, from: 'c1' },
        { id: '1ecbfca1-ok', text: "Turning the keep-alive off: there's no switch yet. That's on the to-do as 8133346b.", at: 2, from: 'c2', why: 'later' },
        { id: 'k1', text: 'Create mod instructions', at: 1 },
        { id: 'k2', text: 'Create mod instructions', at: 1 },
        { id: 'c9', text: 'Create mod instructions.', at: 2, from: 'c9' },
        { id: 'dfd937e0-ok', text: 'Clear shell and start running. After run is finished put full commit message in for me to push.', at: 3, from: 'c3', why: 'missed' },
        { id: 'a1-ok', text: 'Is there anything else?', at: 3, from: 'c3', why: 'missed' },
      ],
      suggested: [
        sug('w1', '<pasted_content id="afb4"> Chat: Add these functions', 'missed', 'c4', now),
        sug('h1', 'Is there anything else?', 'missed', 'c4', now),
        you('Reload VS Code so 0.20.1 is current.', 'c5', now - 2),
        you('Reload VS Code. That picks up the hook.', 'c6', now - 1),
        sug('p1', 'To-do 8133346b: turn it off.', 'you', 'c6', now - 1),
        sug('ok', 'Add the Transcript tab for Codex chats', 'later', 'c6', now - 1),
      ],
    })
    const out = prune(d, now)
    assert.deepEqual(out.todo.map(t => t.id), ['8133346b', '1ecbfca1-ok', 'k1', 'k2', 'dfd937e0-ok', 'a1-ok'])
    assert.deepEqual(out.suggested?.map(t => t.id), ['ok'])
    for (const id of ['c9', 'w1', 'h1', d.suggested![2].id, d.suggested![3].id, 'p1']) assert.equal(out.removed[id], now, id)
    assert.equal(prune(out, now), out)
  })

  it('reads the opt-in file under HOME at call time, and drops temp folders from it', () => {
    assert.ok(optInFile().startsWith(HOME), optInFile())
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-optin-')), 'todo-sync.json')
    fs.writeFileSync(file, JSON.stringify({ '/repo': true, [path.join(os.tmpdir(), 'sb-claim-x', 'c')]: true, [path.join(fs.realpathSync(os.tmpdir()), 'sb-claim-y', 'c')]: true }))
    assert.deepEqual(readOptIn(file), { '/repo': true })
    fs.rmSync(path.dirname(file), { recursive: true })
  })
})

describe('moveTodo', () => {
  const doc = (ids: string[]) => ({ ...emptyDoc(), todo: ids.map(id => ({ id, text: id, at: 1 })) })
  it('puts the listed ids first, the rest after in place', () => {
    assert.deepEqual(moveTodo(doc(['a', 'b', 'c', 'd']), ['c', 'a'], 5).todo.map(t => t.id), ['c', 'a', 'b', 'd'])
  })
  it('the newer order wins a merge on either side', () => {
    const a = moveTodo(doc(['a', 'b', 'c']), ['c', 'b', 'a'], 9), b = moveTodo(doc(['a', 'b', 'c']), ['b', 'a', 'c'], 5)
    assert.deepEqual(mergeDocs(a, b).todo.map(t => t.id), ['c', 'b', 'a'])
    assert.deepEqual(mergeDocs(b, a).todo.map(t => t.id), ['c', 'b', 'a'])
  })
  it('the order survives a write and read', () => {
    const d = moveTodo(doc(['a', 'b']), ['b', 'a'], 3)
    assert.deepEqual(parseDoc(JSON.stringify(d)).order, { ids: ['b', 'a'], at: 3 })
  })
})

describe('per-project autopilot and run numbers', () => {
  const now = 10 * 60_000
  const item = (id: string, more: Partial<TodoDoc['todo'][number]> = {}) => ({ id, text: `do ${id}`, at: 0, ...more })
  const base = { on: true, folder: '/p', todo: [item('a'), item('b')], busy: false, limited: false, tried: new Set<string>(), now }

  it('the project pilot overrides the global switch, and paused starts nothing', () => {
    assert.equal(autoStartPlan({ ...base, pilot: { on: false, at: 1 } }), undefined)
    assert.ok(autoStartPlan({ ...base, on: false, pilot: { on: true, at: 1 } }))
    assert.ok(autoStartPlan({ ...base, pilot: { at: 1 } }))
    assert.equal(autoStartPlan({ ...base, on: false, pilot: { at: 1 } }), undefined)
    assert.equal(autoStartPlan({ ...base, pilot: { on: true, paused: true, at: 1 } }), undefined)
  })

  it('only a live chat holding an item of the project keeps it busy', () => {
    assert.ok(autoStartPlan({ ...base, live: new Set(['other']) }))
    const todo = [item('a', { chat: 'c1' }), item('b')]
    assert.equal(autoStartPlan({ ...base, todo, live: new Set(['c1']) }), undefined)
    assert.deepEqual(autoStartPlan({ ...base, todo, live: new Set(['other']) })?.items.map(t => t.id), ['b'])
  })

  it('setPilot keeps the other field and stamps at; the newest pilot wins a merge and a read', () => {
    const d = setPilot(setPilot(emptyDoc(), { on: true }, 5), { paused: true }, 6)
    assert.deepEqual(d.pilot, { on: true, paused: true, at: 6 })
    assert.deepEqual(mergeDocs(d, setPilot(emptyDoc(), { on: false }, 9), 10).pilot, { on: false, at: 9 })
    assert.deepEqual(mergeDocs(setPilot(emptyDoc(), { on: false }, 3), d, 10).pilot, d.pilot)
    assert.deepEqual(parseDoc(JSON.stringify({ ...d, pilot: { on: 'x', paused: true, at: 6 } })).pilot, { paused: true, at: 6 })
    assert.equal(parseDoc(JSON.stringify({ ...d, pilot: { on: true } })).pilot, undefined)
  })

  it('claims number runs, mark auto ones, and a chain restarts once the queue went empty', () => {
    let d: TodoDoc = { ...emptyDoc(), todo: [item('a'), item('b'), item('y', { why: 'you' })] }
    d = claimItems(d, ['a'], 'c1', new Set(), now)
    assert.deepEqual([d.seq, d.streak, d.todo[0].run, d.todo[0].auto], [1, 1, 1, true])
    d = finishItem(d, 'a', 'c1', now)
    assert.deepEqual([d.ticked?.[0].run, d.ticked?.[0].auto], [1, true])
    d = claimItems(d, ['b'], 'c2', new Set(), now, true)
    assert.deepEqual([d.seq, d.streak, d.todo[0].run, d.todo[0].auto], [2, 1, 2, undefined])
    d = finishItem(d, 'b', 'c2', now)
    assert.equal(d.streak, undefined, 'only a hand step left: the chain ended')
    d = claimItems(addTodo(d, 'do c', now, 'c'), ['c'], 'c3', new Set(), now)
    assert.deepEqual([d.seq, d.streak, d.todo.find(t => t.id === 'c')?.run], [3, 3, 3])
  })

  it('run numbers survive a read, a merge with an older copy, and afterFinish', () => {
    const d = claimItems({ ...emptyDoc(), todo: [item('a'), item('b')] }, ['a', 'b'], 'c1', new Set(), now)
    const read = parseDoc(JSON.stringify(d))
    assert.deepEqual([read.seq, read.streak, read.todo[0].run, read.todo[0].auto], [1, 1, 1, true])
    const older: TodoDoc = { ...emptyDoc(), todo: [item('a', { at: now + 1 })] }
    assert.equal(mergeDocs(d, older, now).todo.find(t => t.id === 'a')?.run, 1)
    assert.equal(mergeDocs(d, { ...emptyDoc(), seq: 0 }, now).seq, 1)
    const p = { sessionId: 'c1', state: 'done', report: { done: ['did it'], left: [] } } as unknown as ChatProgress
    const done = afterFinish(d, p, ['a'], now)
    assert.equal(done.ticked?.[0].run, 1)
  })

  it('hub-todo-pilot passes the command check with optional booleans only', () => {
    assert.equal(commandProblem({ type: 'hub-todo-pilot', path: '/p', paused: true }), undefined)
    assert.equal(commandProblem({ type: 'hub-todo-pilot', path: '/p', on: false, paused: false }), undefined)
    assert.ok(commandProblem({ type: 'hub-todo-pilot', path: '/p', on: 'yes' }))
  })

  it('runLabel names the run for the terminal env', () => {
    const d = claimItems({ ...emptyDoc(), todo: [item('a', { name: 'Fix login' }), item('b')] }, ['a', 'b'], 'c1', new Set(), now)
    assert.deepEqual(runLabel(d.todo, '/Users/k/agent-flow'), { n: 1, auto: true, text: 'do a', from: 'Fix login', project: 'agent-flow', total: 2 })
    assert.deepEqual(runLabel([item('a', { run: 4 })], '/x/p'), { n: 4, auto: false, text: 'do a', from: 'you', project: 'p', total: 1 })
    assert.equal(runLabel([item('a')], '/x/p'), undefined)
  })

  it('todoEnv gives a resumed or handed-off chat the env its run had', () => {
    const d = claimItems({ ...emptyDoc(), todo: [item('a'), item('b'), item('z')] }, ['a', 'b'], 'old', new Set(), now)
    const want = { SWITCHBOARD_TODO: JSON.stringify(runLabel(d.todo.slice(0, 2), '/x/p')) }
    assert.deepEqual(todoEnv(heldLabel(d.todo, '/x/p', ['old'])), want)
    // Handoff: found by either id, before or after moveChat.
    assert.deepEqual(todoEnv(heldLabel(moveChat(d, 'old', 'new', now).todo, '/x/p', ['old', 'new'])), want)
    assert.deepEqual(todoEnv(heldLabel(d.todo, '/x/p', ['other'])), {})
    assert.deepEqual(todoEnv(heldLabel(undefined, '/x/p', ['old'])), {})
  })

  it('a chat that dies leaves its item stopped: held, skipped by auto-start without tried, kept on disk, cleared by Start again', () => {
    let d = claimItems({ ...emptyDoc(), seq: 4, todo: [item('S'), item('Z')] }, ['S'], 'dead', new Set(), now)
    d = clearGone(d, new Set(), now + START_GRACE_MS + 1)
    assert.equal(d.todo.find(t => t.id === 'S')?.stopped, true)
    assert.deepEqual(upcoming(d.todo, d.seq), { runs: [{ n: 6, ids: ['Z'] }], held: [{ id: 'S', why: 'stopped' }] })
    assert.deepEqual(autoStartPlan({ ...base, todo: d.todo, now: now + START_GRACE_MS * 3 })?.items.map(t => t.id), ['Z'])
    assert.equal(parseDoc(JSON.stringify(d)).todo.find(t => t.id === 'S')?.stopped, true)
    assert.equal(mergeDocs(d, { ...d, todo: d.todo.map(t => (t.id === 'S' ? { id: t.id, text: t.text, at: t.at + 1 } : t)) }).todo.find(t => t.id === 'S')?.stopped, true)
    const again = claimItems(d, ['S'], 'c2', new Set(), now + START_GRACE_MS * 3, true)
    assert.equal(again.todo.find(t => t.id === 'S')?.stopped, undefined)
  })

  it('heldLabel survives a prerequisite the chat adds, which takes the run of the item it is before', () => {
    const d = claimItems({ ...emptyDoc(), seq: 4, todo: [item('b')] }, ['b'], 'c1', new Set(), now)
    const { doc } = toolStep(d, { op: 'add', text: 'set up the key', before: 'b', session: 'c1' }, now, 'p1')
    assert.deepEqual(doc.todo.find(t => t.id === 'p1')?.run, 5)
    assert.deepEqual(heldLabel(doc.todo, '/x/p', ['c1']), { n: 5, auto: true, text: 'do b', from: 'you', project: 'p', total: 2 })
    // Another chat's add does not take the run.
    assert.equal(toolStep(d, { op: 'add', text: 'other', before: 'b', session: 'c2' }, now, 'p2').doc.todo.find(t => t.id === 'p2')?.run, undefined)
  })

  it('upcoming plans what auto-start runs: one number per run, prerequisites with their item, held ones with why', () => {
    // seq 4, [B, P before B, C]: [P, B] is 5, C is 6.
    assert.deepEqual(upcoming([item('B'), item('P', { before: 'B' }), item('C')], 4), { runs: [{ n: 5, ids: ['P', 'B'] }, { n: 6, ids: ['C'] }], held: [] })
    // x waits on a hand step: held as 'you'; w, its other prerequisite, still runs alone. A stopped chat's item is held; a live one is running.
    const todo = [item('k', { why: 'you', before: 'x' }), item('w', { before: 'x' }), item('x'), item('bl', { why: 'blocked' }), item('s', { chat: 'gone' }), item('r', { chat: 'live' }), item('f')]
    const p = upcoming(todo, 4, new Set(['live']))
    assert.deepEqual(p.runs, [{ n: 5, ids: ['w'] }, { n: 6, ids: ['f'] }])
    assert.deepEqual(p.held, [{ id: 'k', why: 'you' }, { id: 'x', why: 'you' }, { id: 'bl', why: 'blocked' }, { id: 's', why: 'stopped' }])
    // Waiting on a running chat's item is not held: that item leaves when its chat is done.
    assert.deepEqual(upcoming([item('q'), item('r', { chat: 'live', before: 'q' })], 2, new Set(['live'])), { runs: [{ n: 3, ids: ['q'] }], held: [] })
  })
})

describe('file list across processes', () => {
  it('two processes adding at once keep every item', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-race-'))
    const file = path.join(dir, 'list.json')
    const script = path.join(dir, 'add.ts')
    fs.writeFileSync(script, `import { updateDoc } from ${JSON.stringify(path.resolve(__dirname, '../src/hub/todo'))}
const tag = process.argv[2]
;(async () => { for (let i = 0; i < 25; i++) await updateDoc({ file: ${JSON.stringify(file)} }, d => ({ ...d, todo: [...d.todo, { id: tag + i, text: 'x', at: 1 }] })) })()
`)
    const tsx = path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs')
    const { execFile } = await import('child_process')
    const run = (tag: string) => new Promise<void>((ok, bad) => execFile(process.execPath, [tsx, script, tag], { env: { ...process.env, HOME } }, e => (e ? bad(e) : ok())))
    await Promise.all([run('a'), run('b')])
    const doc = await readDoc({ file })
    assert.equal(doc.todo.length, 50)
    assert.ok(!fs.existsSync(`${file}.lock`))
  })

  it('a stalled holder that lost its lock neither writes nor removes the new lock', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-stall-'))
    const file = path.join(dir, 'list.json')
    let aOwned: boolean | undefined, bInside = false
    const a = withLock(file, async owned => { await new Promise(r => setTimeout(r, 150)); aOwned = owned(); return 'a' }, 50)
    await new Promise(r => setTimeout(r, 20))
    const b = withLock(file, async owned => { bInside = owned(); await new Promise(r => setTimeout(r, 200)); return 'b' }, 50)
    await a
    assert.equal(aOwned, false)
    assert.equal(bInside, true)
    // A's release left B's lock in place.
    assert.ok(fs.existsSync(`${file}.lock`))
    await b
    assert.ok(!fs.existsSync(`${file}.lock`))
  })
})

describe('strict intake and shipped auto-tick', () => {
  const doc = (over: Partial<TodoDoc> = {}): TodoDoc => ({ ...emptyDoc(), ...over })
  const left = (texts: string[], d = emptyDoc()) => (afterEnd(d, chat({ sessionId: 'sX', state: 'stopped' as ChatProgress['state'] }), 1000, texts).suggested ?? []).map(x => x.text)

  it('keeps action lines, drops status remarks and fragments', () => {
    const got = left([
      'reviewing to-do b6447aa8.',
      "Pokemon Price Tracker hasn't made a real call yet, because that needs the pushed code.",
      '89 products have no PriceCharting price because the strict matcher found no confident page for them.',
      'Once, a direct load of a product page stuck on "Loading..." during qa\'s run. It didn\'t happen in three more tries, so I haven\'t traced it.',
      'Set retail prices by hand under Edit for the 23 products with no tier',
      'Re-run the model bench chain from Explore r1',
    ])
    assert.deepEqual(got, ['Set retail prices by hand under Edit for the 23 products with no tier', 'Re-run the model bench chain from Explore r1'])
  })

  it('typed questions and complaints never become missed', () => {
    const p = chat({ sessionId: 'sQ', asked: ['Sorry how come the cards are still in the new site...?', 'is it because I have not pushed the code yet?', 'Add the Transcript tab for Codex chats'], covered: [0, 0, 0] })
    assert.deepEqual((addMissed(emptyDoc(), p, 1000).suggested ?? []).map(x => x.text), ['Add the Transcript tab for Codex chats'])
  })

  it("can't and cannot do not mean blocked", () => {
    assert.equal(whyLeft("you can't edit a sale after it closes"), 'later')
    assert.equal(whyLeft('cannot reproduce the crash'), 'later')
    assert.equal(whyLeft('Blocked: needs the key'), 'blocked')
  })

  it('skips cache and tmp paths as to-do projects', () => {
    assert.equal(junkPath(path.join(os.tmpdir(), 'sb-audit-fresh-1')), true)
    assert.equal(junkPath(path.join(os.homedir(), '.cache', 'x')), true)
    assert.equal(junkPath('/Users/someone/code/app'), false)
  })

  const src = { commits: [{ sha: 'abc1234', subject: 'Fix the sync push retry on a dropped connection', at: 5000 }], changelog: ['Added dark mode toggle to the settings header'] }
  it('ticks an open item and a suggestion that a commit or CHANGELOG line shipped', () => {
    const d = doc({ todo: [{ id: 'a1', text: 'Fix sync push retry when the connection is dropped', at: 1000 }, { id: 'a2', text: 'Add a dark mode toggle in the settings header', at: 1000 }], suggested: [{ id: 'a3', text: 'Fix the sync push retry on dropped connection', at: 1000, from: 's9', why: 'later' }] })
    const out = tickShipped(d, src, 9000)
    assert.equal(out.todo.length, 0)
    assert.equal(out.suggested?.length ?? 0, 0)
    const by = Object.fromEntries((out.ticked ?? []).map(t => [t.id, t.shipped?.sha]))
    assert.deepEqual(by, { a1: 'abc1234', a2: 'CHANGELOG', a3: 'abc1234' })
  })

  it('keeps labelled and clause-led action lines, drops hand steps addressed to Kenneth', () => {
    const keep = ['Also wire the map page to the new counts', 'Zellizard Tracker: add eBay sold-listing prices to the card page', 'Next Switchboard release: add CHANGELOG line for the map', 'AAR fix plan (chat d354fc0f): done-check edits() should ignore reads', 'Proposed fix (qa round 2): guard the empty list', 'Chat view: add the Transcript tab for Codex chats',
      'Before turning on Firebase AI Logic for the Add page: enable App Check', 'After the next Switchboard build and a Reload Window, check both maps']
    assert.deepEqual(left(keep), keep)
    // A run prompt that reached a Left line keeps only the item it wraps.
    assert.deepEqual(left(['Switchboard to-do, in this order: 1. Map and flow view first (id 4d7d52a4-ok) Do prerequisites first.']), ['Map and flow view first'])
    const more = ['Re-run the chain', 'Debounce the save handler', 'Re-run the model bench chain from Explore r1', 'Backport the fix to 0.21', 'Hook the panel into the map']
    assert.deepEqual(left(more), more)
    const junk = ['Chat cards, the approve bar and the map views still say "Ready to approve"', 'AWS IAM users: kennykang and Royce-Li still have no MFA', 'Your plugin list is empty, so tool_on can turn on anything', 'reviewing to-do b6447aa8.', 'The saved list could mismatch when two windows write', 'JustTCG answers "too many requests" under load', 'one item page shows two different market numbers', 'Once, a direct load of a product page stuck on Loading', 'It is still slow on the map page', 'We should check the sync later']
    assert.deepEqual(left(junk), [])
    const drop = ['Give me a phone call if anything comes up', 'Approve or drop to-do 0dd5d1e1', 'Open a new chat in Switchboard.', "Log out of Instagram in Chrome if you don't want to stay signed in.", "Close VS Code and the chats in agent-flow when you're ready", 'Keep waiting for X to end']
    assert.deepEqual(left(drop), [])
  })

  it('Put back on a shipped item sticks', () => {
    const d = doc({ todo: [{ id: 'c1', text: 'Add a dark mode toggle in the settings header', at: 1000 }] })
    const t = tickShipped(d, src, 9000)
    assert.equal(t.ticked?.[0].shipped?.sha, 'CHANGELOG')
    const back = restoreTicked(t, 'c1', 10000, 'c2')
    assert.equal(back.todo.length, 1)
    assert.equal(tickShipped(back, src, 11000), back)
  })

  it('near misses and older commits stay open', () => {
    const d = doc({ todo: [
      { id: 'n1', text: 'Fix the sync pull retry on a dropped connection from the panel', at: 1000 },
      { id: 'n2', text: 'Fix sync push retry', at: 1000 },
      { id: 'n3', text: 'Fix the sync push retry on a dropped connection', at: 6000 },
    ] })
    assert.equal(tickShipped(d, src, 9000), d)
  })
})

describe('every repo project on the page', () => {
  it('lists repo projects with no chat, minus the window, chats and junk paths', () => {
    const was = hub.get().projects, wasChats = hub.get().chats
    try {
      hub.set({ chats: [], projects: [
        { name: 'ws', path: '/Users/x/code/ws', kind: 'repo', isOpen: true }, { name: 'zt', path: '/Users/x/code/zt', kind: 'repo', isOpen: false },
        { name: 'notes', path: '/Users/x/code/notes', kind: 'project', isOpen: false }, { name: 'tmp', path: path.join(os.tmpdir(), 'sb-audit-fresh'), kind: 'repo', isOpen: false }] })
      assert.deepEqual(extraTodoFolders('/Users/x/code/ws'), ['/Users/x/code/zt'])
    } finally { hub.set({ projects: was, chats: wasChats }) }
  })

  it('reads the local list only: no sync state, no shipped tick, nothing written', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-extra-'))
    try {
      execFileSync('git', ['init', '-q', repo])
      execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'Fix the sync push retry on a dropped connection'])
      const s = await storeFor(repo)
      await updateDoc(s, d => addTodo(d, 'Fix sync push retry when the connection is dropped', Date.now() - 100_000, 'e1'))
      const ref = () => execFileSync('git', ['-C', repo, 'rev-parse', TODO_REF]).toString()
      const before = ref()
      await loadLocalTodos([repo])
      const l = hub.get().todos?.[repo]
      assert.deepEqual(l?.todo.map(t => t.id), ['e1'])
      assert.equal(l?.sync, undefined)
      assert.equal(ref(), before)
    } finally { fs.rmSync(repo, { recursive: true, force: true }) }
  })

  it('writes a pruned doc back locally, with no push', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-extra-'))
    try {
      execFileSync('git', ['init', '-q', repo])
      const s = await storeFor(repo)
      await updateDoc(s, d => ({ ...d, suggested: [{ id: 'j1', text: 'reviewing to-do b6447aa8.', at: 1, from: 'sJ', why: 'later' }, { id: 'j2', text: 'Add retries to the export', at: 1, from: 'sJ', why: 'later' }] }))
      assert.equal((await readDoc(s)).suggested?.length, 2)
      await loadLocalTodos([repo])
      const after = await readDoc(s)
      assert.deepEqual(after.suggested?.map(x => x.id), ['j2'])
      assert.ok(after.removed.j1)
      assert.equal(hub.get().todos?.[repo]?.sync, undefined)
    } finally { fs.rmSync(repo, { recursive: true, force: true }) }
  })
})

describe('to-do run prompts, finished runs and repeats of done work', () => {
  const day = 24 * 60 * 60_000
  const doc = (over: Partial<TodoDoc>): TodoDoc => ({ ...emptyDoc(), ...over })
  const item = { id: '4d7d52a4-ok', text: 'Fix worktrees and merge if not merged so I can commit', at: 1, from: 's1' }
  // The prompt runMessage sends for one item, then the same text as the list stored it when the wrapper was nested.
  const runText = runMessage([item])
  const nested = (text: string) => runMessage([{ ...item, id: '0b1c2d3e', text: runMessage([{ ...item, text }]) }]).replace(/\s+/g, ' ')

  it('a suggestion holding a run prompt heals to its item, or goes when an open item says it', () => {
    const healed = prune(doc({ suggested: [{ id: '069c9329', text: nested('Write the release notes'), at: 1, from: 's1', why: 'later' }] }), 2)
    assert.deepEqual(healed.suggested?.map(t => [t.id, t.text]), [['069c9329', 'Write the release notes']])
    const dup = prune(doc({ todo: [{ id: 'f0e1d2c3', text: 'Fix worktrees and merge if not merged so I can commit', at: 1 }], suggested: [{ id: '069c9329', text: runText, at: 1, from: 's1', why: 'missed' }] }), 2)
    assert.equal(dup.suggested, undefined)
  })

  it('an accepted item or a ticked row holding a run prompt heals; an item that repeats an open one goes', () => {
    const d = doc({
      todo: [{ id: 'b65599b1-ok', text: nested('Write the release notes'), at: 1, from: 's1' }, { id: 'c1d2e3f4-ok', text: runText, at: 1, from: 's1' }, { id: 'a0a0a0a0', text: 'Write the release notes', at: 1 }],
      ticked: [{ id: 'd9d9d9d9-ok', text: nested('Tag the release'), at: 1 }],
    })
    const out = prune(d, 2)
    // The first repeats the open item and goes; the second heals to its own item.
    assert.deepEqual(out.todo.map(t => t.text), ['Fix worktrees and merge if not merged so I can commit', 'Write the release notes'])
    assert.deepEqual(out.ticked?.map(t => t.text), ['Tag the release'])
    assert.equal(prune(out, 3), out)
  })

  it('a run prompt that reaches the suggestions as missed is never suggested again', () => {
    assert.equal(addMissed(emptyDoc(), chat({ asked: [runText], covered: [0] }), 5).suggested, undefined)
    assert.equal(addMissed(emptyDoc(), chat({ asked: [nested('Write the release notes')], covered: [0] }), 5).suggested, undefined)
  })

  it('a healed row takes a title from its item, never from the run prompt it wrapped', () => {
    const long = 'Make the map courtyards show the waiting chats with their chips'
    const wrapped = runMessage([{ ...item, id: '4d7d52a4-ok', text: long }]).replace(/\s+/g, ' ')
    const d = addTodo(emptyDoc(), wrapped, 1, '4d7d52a4-ok')
    assert.equal(d.todo[0].short, 'Switchboard to-do, in this order:')
    const out = prune(d, 2)
    assert.equal(out.todo[0].text, long)
    assert.equal(out.todo[0].short, shortOf(long))
    const sug = prune(doc({ suggested: [{ id: '069c9329', text: wrapped, at: 1, from: 's1', why: 'later', short: 'Switchboard to-do, in this order:' }] }), 2)
    assert.equal(sug.suggested?.[0].short, shortOf(long))
    const tick = prune(doc({ ticked: [{ id: 'b65599b1-ok', text: wrapped, at: 1, short: 'Switchboard to-do, in this order:' }] }), 2)
    assert.equal(tick.ticked?.[0].short, shortOf(long))
    const titled = prune(doc({ suggested: [{ id: '069c9329', text: wrapped, at: 1, from: 's1', why: 'later', short: 'Make the map courtyards' }] }), 2)
    assert.equal(titled.suggested?.[0].short, shortOf(long))
  })

  it('a suggestion that repeats an item ticked in the last week is not added; an older tick does not block it', () => {
    const ticked = finishItem(addTodo(emptyDoc(), 'Add the CSV export', 1, 'c1'), 'c1', undefined, 2)
    const left = chat({ report: { done: [], left: ['Add the CSV export'] } })
    assert.equal(afterFinish(ticked, left, [], 3 * day).suggested, undefined)
    assert.deepEqual(afterFinish(ticked, left, [], 20 * day).suggested?.map(t => t.text), ['Add the CSV export'])
  })

  it('a run chat that reaches Done judges the items it held: covered ones are ticked, the rest are stopped', async () => {
    const s: TodoStore = { file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'run-done-')), 'todo.json') }
    const held = (id: string, text: string): TodoItem => ({ id, text, at: 1, chat: 'run1', host: hostId(), run: 1 })
    await updateDoc(s, d => ({ ...d, todo: [held('h1a2b3c4', 'Fix the parser crash'), held('h5d6e7f8', 'Add the CSV export')] }))
    const asked: string[] = []
    await todoFinished(s, chat({ sessionId: 'run1', report: { done: ['Fixed the parser crash in the lexer'], left: [] } }), async q => {
      asked.push(q)
      return q.includes('Which open items are now done') ? 'h1a2b3c4' : 'none'
    })
    const d = await readDoc(s)
    assert.deepEqual(d.ticked?.map(t => t.id), ['h1a2b3c4'])
    assert.deepEqual(d.todo.map(t => [t.id, t.chat, t.stopped]), [['h5d6e7f8', undefined, true]])
    assert.ok(asked.some(q => q.includes('h5d6e7f8: Add the CSV export') && q.includes('Fixed the parser crash in the lexer')))
  })
})
