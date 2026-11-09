/** One window: the native tabs switch, the command allowlist, and which windows a tab op reaches. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { isTabCommand, loadKept, saveKept, setOneWindow, tabTargets, TAB_COMMANDS, type TabConfig } from '../src/hub/window-tabs'
import { handleHub, commandProblem } from '../src/hub/routes'
import { HubService } from '../src/hub/hub-service'
import type { Win } from '../src/hub/dev'

/** A stand-in for VS Code's "window" config: user values in a map, every write recorded. */
function fakeConfig(user: Record<string, unknown> = {}) {
  const writes: Array<[string, unknown]> = []
  const cfg: TabConfig = {
    inspect: key => ({ globalValue: user[key] }),
    update: async (key, value, global) => {
      assert.equal(global, true)
      writes.push([key, value])
      if (value === undefined) delete user[key]
      else user[key] = value
    },
  }
  return { cfg, user, writes }
}

const win = (pid: number, workspace: string): Win => ({ pid, port: 4000 + pid, hubToken: `t${pid}`, workspace })

describe('one window switch', () => {
  it('turns native tabs on and keeps what was there', async () => {
    const f = fakeConfig({ nativeTabs: false })
    const kept = await setOneWindow(f.cfg, true, undefined)
    assert.deepEqual(kept, { nativeTabs: false })
    assert.equal(f.user.nativeTabs, true)
  })

  it('a second on does not lose the first value', async () => {
    const f = fakeConfig({ nativeTabs: true })
    assert.deepEqual(await setOneWindow(f.cfg, true, { nativeTabs: undefined }), { nativeTabs: undefined })
  })

  it('off puts the old value back, or removes the key when there was none', async () => {
    const f = fakeConfig({ nativeTabs: true })
    assert.equal(await setOneWindow(f.cfg, false, { nativeTabs: false }), undefined)
    assert.equal(f.user.nativeTabs, false)
    const g = fakeConfig({ nativeTabs: true })
    await setOneWindow(g.cfg, false, { nativeTabs: undefined })
    assert.ok(!('nativeTabs' in g.user))
  })

  it('off with nothing kept leaves the user setting alone', async () => {
    const f = fakeConfig({ nativeTabs: true })
    await setOneWindow(f.cfg, false, undefined)
    assert.equal(f.user.nativeTabs, true)
    assert.deepEqual(f.writes, [])
  })

  it('a second off from another window keeps the restored value', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'one-window-')), 'one-window.json')
    const f = fakeConfig({ nativeTabs: false })
    saveKept(await setOneWindow(f.cfg, true, loadKept(file)), file)
    assert.deepEqual(loadKept(file), { nativeTabs: false })
    saveKept(await setOneWindow(f.cfg, false, loadKept(file)), file)
    assert.equal(f.user.nativeTabs, false)
    saveKept(await setOneWindow(f.cfg, false, loadKept(file)), file)
    assert.equal(f.user.nativeTabs, false)
    assert.equal(loadKept(file), undefined)
    fs.rmSync(path.dirname(file), { recursive: true, force: true })
  })
})

describe('tab commands', () => {
  it('allows only the window tab commands', () => {
    for (const c of Object.values(TAB_COMMANDS)) assert.ok(isTabCommand(c))
    for (const c of ['workbench.action.quit', 'workbench.action.terminal.sendSequence', '', undefined, 3]) assert.equal(isTabCommand(c), false)
  })

  it('the cross-window post refuses any other command before it is taken', async () => {
    const h = new HubService()
    const seen: string[] = []
    h.onTab(c => seen.push(c))
    const post = (command: unknown) => handleHub(h, 'POST', '/hub', JSON.stringify({ token: h.token, kind: 'window-tab', command }))
    assert.equal((await post('workbench.action.quit'))?.status, 400)
    assert.equal((await post({ id: 'x' }))?.status, 400)
    assert.equal((await post(TAB_COMMANDS.split))?.status, 204)
    assert.deepEqual(seen, [TAB_COMMANDS.split])
    const bad = await handleHub(h, 'POST', '/hub', JSON.stringify({ token: 'nope', kind: 'window-tab', command: TAB_COMMANDS.split }))
    assert.equal(bad?.status, 403)
    assert.equal(seen.length, 1)
  })

  it('the panel command takes only known ops', () => {
    assert.equal(commandProblem({ type: 'hub-window-tab', op: 'merge' }), undefined)
    assert.equal(commandProblem({ type: 'hub-window-tab', op: 'show', workspace: '/a' }), undefined)
    assert.match(commandProblem({ type: 'hub-window-tab', op: 'workbench.action.quit' }) ?? '', /op/)
  })
})

describe('tab targets', () => {
  const wins = [win(1, '/a'), win(2, '/b'), win(3, '/c')]

  it('merge runs here only', () => {
    assert.deepEqual(tabTargets(wins, 1, 'merge'), { here: true, send: [] })
  })

  it('split runs here and in every other window', () => {
    const t = tabTargets(wins, 1, 'split')
    assert.equal(t.here, true)
    assert.deepEqual(t.send.map(w => w.pid), [2, 3])
  })

  it('pop out and show reach only the named window', () => {
    assert.deepEqual(tabTargets(wins, 1, 'popout', '/b').send.map(w => w.pid), [2])
    assert.equal(tabTargets(wins, 1, 'popout', '/b').here, false)
    assert.deepEqual(tabTargets(wins, 1, 'show', '/a'), { here: true, send: [] })
    assert.deepEqual(tabTargets(wins, 1, 'show', '/nowhere'), { here: false, send: [] })
    assert.deepEqual(tabTargets(wins, 1, 'show'), { here: false, send: [] })
  })
})
