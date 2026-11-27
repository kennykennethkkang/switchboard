import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// A To-do run's picks (hub-todo-run model, effort, ultracode, auto, research) have to reach newChat's run argument.
describe('codexPanel runInNewChat', () => {
  const Module = require('module') as { _load: (...args: any[]) => any }
  const item = { id: 'a1', text: 'do it' }

  const load = (calls: unknown[][], switchboard: Record<string, unknown> = {}) => {
    const original = Module._load
    const noop: any = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => '' : noop), apply: () => noop })
    Module._load = function (request: string, ...args: any[]) {
      if (request === 'vscode') return noop
      if (request === './actions') return { newChat: async (...a: unknown[]) => { calls.push(a); return undefined } }
      if (request === './hub-service') return { hub: { get: () => ({ chats: [], todos: {}, controls: { switchboard } }) } }
      if (request === './todo') return { claimTodo: async () => true, runLabel: () => undefined, runMessage: () => 'msg', changeTodo: async () => {}, startTodo: (d: unknown) => d }
      return original.call(this, request, ...args)
    }
    const drop = () => { delete require.cache[require.resolve('../src/hub/hub-panel-codex')] }
    drop()
    return { restore: () => { Module._load = original; drop() }, mod: require('../src/hub/hub-panel-codex') as typeof import('../src/hub/hub-panel-codex') }
  }

  const panel = (mod: typeof import('../src/hub/hub-panel-codex')) => mod.codexPanel({
    state: () => ({}) as any, store: () => undefined, workspace: () => undefined, pendingWaits: new Map(), refuse: p => p,
    sendToChat: () => true, startWaits() {}, refreshStages() {}, controlsKey: 'c', handedKey: 'h',
  })

  it('hands the run picks to newChat as its run argument', async () => {
    const calls: unknown[][] = []
    const { restore, mod } = load(calls)
    try {
      const run = { model: 'opus[1m]', effort: 'xhigh' as const, ultracode: true, auto: false, research: true }
      assert.equal(await panel(mod).runInNewChat('/a', [item as any], true, run), true)
      assert.deepEqual(calls[0][12], run)
    } finally { restore() }
  })

  it('an auto start passes no picks, so the auto pick fills them', async () => {
    const calls: unknown[][] = []
    const { restore, mod } = load(calls)
    try {
      assert.equal(await panel(mod).runInNewChat('/a', [item as any]), true)
      assert.equal(calls[0][12], undefined)
    } finally { restore() }
  })

  it('a code item starts in its own worktree unless codeWorktrees is off', async () => {
    const fix = { id: 'b2', text: 'fix the crash on save' }
    for (const [switchboard, want] of [[{}, true], [{ codeWorktrees: false }, false]] as const) {
      const calls: unknown[][] = []
      const { restore, mod } = load(calls, switchboard)
      try {
        assert.equal(await panel(mod).runInNewChat('/a', [fix as any]), true)
        assert.equal(calls[0][11], want)
      } finally { restore() }
    }
    const calls: unknown[][] = []
    const { restore, mod } = load(calls)
    try { await panel(mod).runInNewChat('/a', [item as any]); assert.equal(calls[0][11], false) } finally { restore() }
  })
})
