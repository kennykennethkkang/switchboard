/**
 * Per-project to-do lists: merging, the finish rules, and the hidden ref against temp repos
 * with a temp bare remote. Never touches a real repo.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { addTodo, afterEnd, afterFinish, backInChat, laterOnly, parseKept, clearGone, editTodo, emptyDoc, finishPrompt, hostId, mergeDocs, moveChat, ownerRepo, parseDoneIds, readDoc, readOptIn, removeItem, setOptIn, startTodo, storeFor, syncDoc, syncMode, todoFinished, updateDoc, TODO_REF, remoteSeen, replaceRemote, runOrder, runMessage, toolStep, mentions, restoreTicked, projectOf, finishItem, parseDoc, whyLeft, acceptSuggestion, dismissSuggestion, addMissed, dropped, autoStartPlan, claimItems, claimRemote, claimTodo, prune, optInFile, moveTodo } from '../src/hub/todo'
import { commandProblem, handleHub } from '../src/hub/routes'
import { git } from '../src/hub/git'
import { HubService, hub } from '../src/hub/hub-service'
import type { ChatProgress, TodoDoc } from '../src/hub/types'

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

  it('Done on a suggestion (a Finish up row) ticks it, tombstoned', () => {
    const d = afterEnd(emptyDoc(), chat({ state: 'idle', report: { done: [], left: ['Reload the window, Kenneth'] } }), 1)
    const id = d.suggested![0].id
    const out = finishItem(d, id, undefined, 2)
    assert.equal(out.suggested, undefined)
    assert.ok(out.removed[id])
    assert.deepEqual(out.ticked, [{ id, text: 'Reload the window, Kenneth', at: 2, from: 's1', why: 'you' }])
    // Put back, it is a hand step again, also after a round trip through the file.
    const named = { ...out, ticked: [{ ...out.ticked![0], name: 'Fix login' }] }
    assert.deepEqual(parseDoc(JSON.stringify(named)).ticked, named.ticked)
    const back = restoreTicked(parseDoc(JSON.stringify(named)), id, 3, 'r1').todo[0]
    assert.equal(back.why, 'you')
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

  it('For you lines are hand steps as written, replaced by the chat\'s next Done like its Left', () => {
    const p = chat({ report: { done: ['x'], left: ['Deploy'], you: ['Untested by eye: the panel itself.', 'Commit the repo'] } })
    const d = afterFinish(emptyDoc(), p, [], 1, [])
    assert.deepEqual(d.suggested?.map(l => [l.text, l.why]), [['Untested by eye: the panel itself.', 'you'], ['Commit the repo', 'you']])
    // Not the Left line's id: the same text as a Left line stays apart.
    assert.equal(afterFinish(emptyDoc(), chat({ report: { done: [], left: ['Commit the repo'] } }), [], 1).suggested![0].id === d.suggested![1].id, false)
    const again = afterFinish(d, chat({ report: { done: [], left: [], you: ['Commit the repo'] } }), [], 2)
    assert.deepEqual(again.suggested?.map(l => l.text), ['Commit the repo'])
    assert.ok(again.removed[d.suggested![0].id])
    assert.deepEqual(afterEnd(emptyDoc(), chat({ state: 'idle', report: { done: [], left: [], you: ['Sign in'] } }), 1, []).suggested?.map(l => [l.text, l.why]), [['Sign in', 'you']])
    // An explicit For you line wins over a Left line that holds it.
    const both = afterFinish(emptyDoc(), chat({ report: { done: [], left: ['Reload the window and check the panel'], you: ['Reload the window'] } }), [], 1)
    assert.deepEqual(both.suggested?.map(l => [l.text, l.why]), [['Reload the window', 'you']])
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
    const p = chat({ report: { done: ['x'], left: ['Live test in two windows', 'Deploy'] } })
    // Before the Suggested tray, Left lines went straight into todo.
    const auto = afterFinish(emptyDoc(), p, [], 1)
    const d = addTodo({ ...auto, todo: auto.suggested!, suggested: undefined }, 'Kenneth item', 1, 'k1')
    const back = backInChat(d, 's1', 2)
    assert.deepEqual(back.todo.map(l => [l.text, l.chat]), [['Live test in two windows', 's1'], ['Deploy', 's1'], ['Kenneth item', undefined]])
    // It did the test; only Deploy is still left.
    const next = afterFinish(back, chat({ report: { done: ['tested'], left: ['Deploy'] } }), [], 3)
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
    const z = afterFinish(emptyDoc(), chat({ report: { done: [], left: ['Z'] } }), [], 1)
    const dismissed = dismissSuggestion(z, z.suggested![0].id, 2)
    assert.equal(afterFinish(dismissed, chat({ report: { done: [], left: ['Z'] } }), [], 3).suggested, undefined)
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
    assert.deepEqual(afterFinish(d, chat({ report: { done: ['Receipts'], left: [] } }), [], 3).todo, [])
    assert.equal(afterFinish(d, chat({ report: { done: ['Receipts'], left: [] } }), [], 3).removed.t1, 3)
    // Left with other lines only: done, and the lines join the to-do.
    const other = afterFinish(d, chat({ report: { done: [], left: ['Deploy to staging'] } }), [], 3)
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
    assert.equal(whyLeft('Kenneth to decide the pricing tiers'), 'you')
    assert.equal(whyLeft('Needs your sign in to the AWS console'), 'you')
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
    const d = afterEnd(emptyDoc(), chat({ state: 'idle', report: { done: [], left: ['Deploy', 'Docs'] } }), 1)
    const [dep, docs] = d.suggested!
    const ok = acceptSuggestion(d, dep.id, 2, 'new11111')
    assert.deepEqual(ok.todo, [{ id: 'new11111', text: 'Deploy', at: 2, from: 's1', why: 'later' }])
    assert.deepEqual(ok.suggested?.map(t => t.id), [docs.id])
    assert.equal(ok.removed[dep.id], 2)
    const gone = dismissSuggestion(ok, docs.id, 3)
    assert.equal(gone.suggested, undefined)
    assert.equal(gone.removed[docs.id], 3)
    // Neither comes back when the chat ends again with the same Left.
    assert.deepEqual(afterEnd(gone, chat({ state: 'idle', report: { done: [], left: ['Deploy', 'Docs'] } }), 4), gone)
    assert.equal(acceptSuggestion(gone, 'nope', 5), gone)
  })

  it('suggests the requests Jev found not covered, once', () => {
    const p = chat({ asked: ['fix the login', 'add dark mode'], covered: [0.9, 0.1] })
    const d = addMissed(emptyDoc(), p, 5)
    assert.deepEqual(d.suggested?.map(t => [t.text, t.why, t.from]), [['add dark mode', 'missed', 's1']])
    assert.deepEqual(addMissed(d, p, 6), d)
    assert.equal(addMissed(emptyDoc(), chat({ asked: ['x'] }), 5).suggested, undefined)
  })

  it('leaves conversational asks out of the missed suggestions', () => {
    const asked = ['Give me a phone call if anything comes up', 'Call me when it is done', 'Continue from /Users/k/handoff.md', "What's the status?", 'how is it going', 'Are you done yet?', 'add dark mode']
    const d = addMissed(emptyDoc(), chat({ asked, covered: asked.map(() => 0) }), 5)
    assert.deepEqual(d.suggested?.map(t => t.text), ['add dark mode'])
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
  const tasks = [{ id: '1', subject: 'Open task', status: 'pending' as const }, { id: '2', subject: 'Closed', status: 'completed' as const }, { id: '3', subject: 'Already listed', status: 'in_progress' as const }]

  it('adds the standup Left items of a chat that ends unfinished, once, deduped by text, never its open tasks', () => {
    const d: TodoDoc = { ...emptyDoc(), todo: [{ id: 'x', text: 'already listed', at: 1, from: 'other' }] }
    const p = chat({ state: 'idle', tasks, report: { done: [], left: ['Docs', 'Already listed'] } })
    const after = afterEnd(d, p, 5)
    assert.deepEqual(after.todo.map(l => l.text), ['already listed'])
    assert.deepEqual(after.suggested?.map(l => l.text), ['Docs'])
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
    assert.equal(s.root, fs.realpathSync(a))
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
    const slow = todoFinished(s, chat({ sessionId: 'r1', report: { done: ['a'], left: ['Old A'] } }), () => new Promise(r => setTimeout(() => r('1'), 100)))
    await todoFinished(s, chat({ sessionId: 'r1', report: { done: ['b'], left: ['New B'] } }), async () => '1')
    await slow
    const d = await readDoc(s)
    assert.deepEqual(d.suggested?.map(l => l.text), ['New B'])
    assert.deepEqual(d.removed, {})
  })

  it('a finished chat adds its Left items and the model ticks older ones', async () => {
    const s = await storeFor(plain, files)
    // The Left filter keeps every line here; its own tests are above.
    const keep = (f: (q: string) => Promise<string>) => async (q: string) => q.startsWith("A coding chat's standup") ? '1, 2, 3, 4, 5' : f(q)
    await todoFinished(s, chat({ sessionId: 'c1', report: { done: [], left: ['Old thing'] } }), keep(async () => 'none'))
    const sug = (await readDoc(s)).suggested!.find(t => t.text === 'Old thing')!
    await updateDoc(s, d => acceptSuggestion(d, sug.id, 2, 'acc11111'))
    const id = 'acc11111'
    let asked = ''
    await todoFinished(s, chat({ sessionId: 'c2', report: { done: ['Old thing done'], left: ['New thing'] } }), keep(async q => { asked = q; return id }))
    assert.match(asked, /Old thing/)
    assert.deepEqual((await readDoc(s)).todo.map(l => l.text), ['Plain'])
    const next = (await readDoc(s)).suggested!.find(t => t.text === 'New thing')!
    await updateDoc(s, d => acceptSuggestion(d, next.id, 3, 'new11111'))
    assert.deepEqual((await readDoc(s)).todo.map(l => l.text), ['Plain', 'New thing'])
    // A failed model call removes nothing.
    await todoFinished(s, chat({ sessionId: 'c3', report: { done: ['x'], left: [] } }), keep(async () => { throw new Error('offline') }))
    assert.deepEqual((await readDoc(s)).todo.map(l => l.text), ['Plain', 'New thing'])
    // An item typed in by hand, or one this chat added itself, is ticked too; one in progress on a chat is not asked about.
    await updateDoc(s, d => startTodo(addTodo(addTodo(d, 'Mine', 2, 'm1', { from: 'c4' }), 'Busy', 2, 'b1'), 'b1', 'other', 3))
    await todoFinished(s, chat({ sessionId: 'c4', report: { done: ['did it'], left: [] } }), keep(async q => { asked = q; return 'p, m1, b1' }))
    assert.doesNotMatch(asked, /Busy/)
    assert.deepEqual((await readDoc(s)).todo.map(l => l.text), ['New thing', 'Busy'])
    // Finishing again with the same Left line keeps it, whatever the model says.
    asked = ''
    await todoFinished(s, chat({ sessionId: 'c2', report: { done: ['part of it'], left: ['New thing'] } }), keep(async q => { asked = q; return (await readDoc(s)).todo.map(l => l.id).join(',') }))
    assert.doesNotMatch(asked, /New thing/)
    assert.deepEqual((await readDoc(s)).todo.map(l => l.text), ['New thing', 'Busy'])
  })

  it('any finished chat can tick a Finish up step another chat left; its own listed Left line is never asked about', async () => {
    const s = await storeFor(fs.mkdtempSync(path.join(os.tmpdir(), 'you-')), fs.mkdtempSync(path.join(os.tmpdir(), 'you-files-')))
    const keep = (f: (q: string) => Promise<string>) => async (q: string) => q.startsWith("A coding chat's standup") ? '1, 2' : f(q)
    await updateDoc(s, d => afterEnd(d, chat({ sessionId: 'y1', state: 'idle', report: { done: [], left: ['Reload the window, Kenneth', 'Add rate limits later'] } }), 1))
    const sug = (await readDoc(s)).suggested!
    const you = sug.find(x => x.why === 'you')!, later = sug.find(x => x.why === 'later')!
    let asked = ''
    await todoFinished(s, chat({ sessionId: 'y2', report: { done: ['Kenneth reloaded the window'], left: ['Sign in to Vercel yourself'] } }), keep(async q => { asked = q; return `${you.id}, ${later.id}` }))
    assert.match(asked, /Reload the window/)
    assert.doesNotMatch(asked, /rate limits/)
    const d = await readDoc(s)
    assert.deepEqual(d.ticked?.map(t => [t.id, t.by]), [[you.id, 'y2']])
    assert.deepEqual(d.suggested?.map(x => x.text).sort(), ['Add rate limits later', 'Sign in to Vercel yourself'])
    // y2's own Left line, still listed, is not offered to the model.
    await todoFinished(s, chat({ sessionId: 'y2', report: { done: ['more'], left: ['Sign in to Vercel yourself'] } }), keep(async q => { asked = q; return 'none' }))
    assert.doesNotMatch(asked, /Vercel/)
    // Nor its own For you lines; the Left filter never sees them.
    await todoFinished(s, chat({ sessionId: 'y3', report: { done: ['x'], left: [], you: ['Tap the mic on the phone'] } }), keep(async () => 'none'))
    asked = ''
    await todoFinished(s, chat({ sessionId: 'y3', report: { done: ['more'], left: [], you: ['Tap the mic on the phone'] } }), async q => { asked = q; return 'none' })
    assert.match(asked, /Vercel/)
    assert.doesNotMatch(asked, /mic/)
    assert.ok((await readDoc(s)).suggested?.some(x => x.text === 'Tap the mic on the phone' && x.why === 'you'))
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
    { id: 'b', text: 'Docs', at: 4 },
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
  const d = startTodo(addTodo(addTodo(emptyDoc(), 'Ship receipts', 1, 'a'), 'Docs', 1, 'b'), 'a', 'c1', 2)
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

  it('dedupes hand steps across chats by verb and object: one Reload VS Code, but each repo\'s commit', () => {
    const d = doc({ suggested: [sug('a1', 'Reload VS Code so 0.20.1 keeps the note current.', 'you', 'c1', 1), sug('m1', 'Commit claude-mods', 'you', 'c1', 1)] })
    const out = afterFinish(d, chat({ sessionId: 'c2', report: { done: ['x'], left: [], you: ['Reload VS Code. That picks up the new hook.', 'Commit switchboard'] } }), [], 2)
    assert.deepEqual(out.suggested?.map(t => `${t.from} ${t.text}`).sort(), ['c1 Commit claude-mods', 'c2 Commit switchboard', 'c2 Reload VS Code. That picks up the new hook.'])
    assert.ok(out.removed.a1)
    // Words after in/to/for are the object: each repo keeps its own step.
    const repos = afterFinish(doc({ suggested: [sug('i1', 'Commit in claude-mods', 'you', 'c1', 1), sug('t1', 'Push to origin', 'you', 'c1', 1)] }),
      chat({ sessionId: 'c2', report: { done: ['x'], left: [], you: ['Commit in switchboard', 'Push to the fork'] } }), [], 2)
    assert.equal(repos.suggested?.length, 4)
    // A leading "Optional:" or "First," is not the whole step.
    const pre = afterFinish(doc({ suggested: [sug('o1', 'Optional: reload VS Code', 'you', 'c1', 1)] }),
      chat({ sessionId: 'c2', report: { done: ['x'], left: [], you: ['First, commit in claude-mods'] } }), [], 2)
    assert.equal(pre.suggested?.length, 2)
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

  it('prune: For you steps expire after 3 days; others stay', () => {
    const d = doc({ suggested: [sug('y1', 'Reconnect Remote Control in this chat', 'you', 'c1', 0), sug('l1', 'Add rate limits to export', 'later', 'c1', 0)] })
    assert.equal(prune(d, 2 * day), d)
    const out = prune(d, 3 * day + 1)
    assert.deepEqual(out.suggested?.map(t => t.id), ['l1'])
    assert.equal(out.removed.y1, 3 * day + 1)
    assert.equal(out.cleared, 1)
    assert.equal(prune(d, 2 * day).cleared, undefined)
  })

  it('prune counts what it cleared in one pass, open duplicates and suggestions together', () => {
    const d = doc({ todo: [{ id: 'a1', text: 'Add rate limits', at: 1 }, { id: 'a2', text: 'Add rate limits', at: 2, from: 'c1' }],
      suggested: [sug('y1', 'Reconnect Remote Control in this chat', 'you', 'c1', 0)], cleared: 7 })
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
        sug('r1', 'Reload VS Code so 0.20.1 is current.', 'you', 'c5', now - 2),
        sug('r2', 'Reload VS Code. That picks up the hook.', 'you', 'c6', now - 1),
        sug('p1', 'To-do 8133346b: turn it off.', 'you', 'c6', now - 1),
        sug('ok', 'Add the Transcript tab for Codex chats', 'later', 'c6', now - 1),
      ],
    })
    const out = prune(d, now)
    assert.deepEqual(out.todo.map(t => t.id), ['8133346b', '1ecbfca1-ok', 'k1', 'k2', 'dfd937e0-ok', 'a1-ok'])
    assert.deepEqual(out.suggested?.map(t => t.id), ['r2', 'ok'])
    for (const id of ['c9', 'w1', 'h1', 'r1', 'p1']) assert.equal(out.removed[id], now, id)
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
