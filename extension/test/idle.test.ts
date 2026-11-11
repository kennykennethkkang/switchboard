import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hold, idle, IDLE_MS, touch, watchActivity } from '../src/hub/idle'
import { answerQuestion, openQuestion } from '../src/hub/questions'

test('idle: a window nobody typed in is idle, typing holds it for two minutes', () => {
  const t = Date.now()
  assert.equal(idle(t), true, 'fresh window: reload at once')
  touch(t)
  assert.equal(idle(t + IDLE_MS - 1), false)
  assert.equal(idle(t + IDLE_MS), true)
})

test('watchActivity: typing in the focused editor and terminal use count, an agent writing a file does not', () => {
  type Fn = (e: unknown) => void
  const subs: Record<string, Fn> = {}
  const ev = (name: string) => (f: Fn) => { subs[name] = f; return { dispose() {} } }
  const doc = { uri: { scheme: 'file' } }
  const win = { state: { focused: false }, activeTextEditor: { document: doc } as unknown,
    onDidChangeTextEditorSelection: ev('sel'), onDidChangeWindowState: ev('win'), onDidChangeActiveTerminal: ev('term'), onDidChangeTerminalState: ev('termState') }
  const vs = { workspace: { onDidChangeTextDocument: ev('doc') }, window: win }
  const ds = watchActivity(vs as never)
  assert.ok(ds.length >= 5)
  const base = Date.now() + 40 * IDLE_MS
  const busyAfter = (f: () => void) => { touch(0); f(); return !idle(Date.now() + 1000) && idle(base) }
  assert.equal(busyAfter(() => subs.doc({ document: doc, contentChanges: [{}] })), false, 'window not focused: an agent edit')
  win.state.focused = true
  assert.equal(busyAfter(() => subs.doc({ document: { uri: { scheme: 'output' } }, contentChanges: [{}] })), false, 'log output')
  assert.equal(busyAfter(() => subs.doc({ document: doc, contentChanges: [{}] })), true, 'typing')
  assert.equal(busyAfter(() => subs.sel({ kind: undefined })), false, 'a selection moved by code')
  assert.equal(busyAfter(() => subs.sel({ kind: 1 })), true, 'a click or key')
  assert.equal(busyAfter(() => subs.termState({})), true)
  assert.equal(busyAfter(() => subs.win({ focused: true })), true)
})

test('idle: a hold (Commit, Push) keeps it busy', () => {
  const t = Date.now() + 10 * IDLE_MS
  const a = hold(), b = hold()
  assert.equal(idle(t), false)
  a(); a()
  assert.equal(idle(t), false, 'a release twice does not free the other hold')
  b()
  assert.equal(idle(t), true)
})

test('idle: an open ask question keeps it busy until answered', () => {
  const t = Date.now() + 20 * IDLE_MS
  const id = 'a'.repeat(32)
  openQuestion(id, 's1', { id, kind: 'question', tool: 'ask', options: [] }, t)
  assert.equal(idle(t + 1000), false)
  answerQuestion(id, [0])
  assert.equal(idle(t + 1000), true)
})
