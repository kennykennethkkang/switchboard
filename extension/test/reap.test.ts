import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { HubService } from '../src/hub/hub-service'
import { parsePs, reapChat, remember, targets, type Proc, type Ran } from '../src/hub/reap'
import type { Server } from '../src/hub/types'

// launchd 1, VS Code 10, chat A's claude 100, chat B's claude 200
const live: Proc[] = [
  { pid: 1, ppid: 0, command: 'launchd' },
  { pid: 10, ppid: 1, command: 'Code Helper' },
  { pid: 100, ppid: 10, command: 'claude' },
  { pid: 110, ppid: 100, command: '/bin/zsh -c pnpm run dev' },
  { pid: 111, ppid: 110, command: 'node vite' },
  { pid: 112, ppid: 110, command: 'node next dev -p 3000' },
  { pid: 120, ppid: 100, command: '/Users/k/Library/Caches/ms-playwright/chromium-1140/chrome-mac/Chromium.app/Contents/MacOS/Chromium --headless' },
  { pid: 121, ppid: 120, command: '/Users/k/Library/Caches/ms-playwright/chromium-1140/chrome-mac/Chromium.app/Contents/MacOS/Chromium Helper --type=renderer' },
  { pid: 130, ppid: 100, command: 'node app/server.js --port 3131' },
  { pid: 140, ppid: 100, command: 'node keeper/app-keeper.mjs' },
  { pid: 150, ppid: 100, command: 'node shared.js' },
  { pid: 200, ppid: 10, command: 'claude' },
  { pid: 300, ppid: 1, command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
  { pid: 400, ppid: 1, command: 'node mine.js' },
]
const srv = (pid: number, port: number): Server => ({ pid, port, command: 'node', folder: 'x/y' })
const servers = [srv(111, 5173), srv(112, 3000), srv(130, 3131), srv(150, 8080), srv(400, 4000)]
const chats = [{ sessionId: 'A', pid: 100, live: true }, { sessionId: 'B', pid: 200, live: true }]
// After A's claude exits its children go to launchd.
const ended = live.filter(p => p.pid !== 100).map(p => p.ppid === 100 ? { ...p, ppid: 1 } : p)
const endedChats = [{ sessionId: 'A', pid: 100, live: false }, { sessionId: 'B', pid: 200, live: true }]

const recorded = (): Ran => { const ran: Ran = new Map(); remember(ran, chats, live); return ran }

describe('reap', () => {
  it('reads ps -axo pid=,ppid=,command=', () => {
    assert.deepEqual(parsePs('  100    10 claude --resume\n  111   110 node vite\n\nbad'), [
      { pid: 100, ppid: 10, command: 'claude --resume' }, { pid: 111, ppid: 110, command: 'node vite' },
    ])
  })

  it('reads ps -axo pid=,ppid=,lstart=,command=', () => {
    assert.deepEqual(parsePs('  111   110 Sun Nov  8 03:02:11 2026     node vite --port 5173'), [
      { pid: 111, ppid: 110, start: 'Sun Nov  8 03:02:11 2026', command: 'node vite --port 5173' },
    ])
  })

  it('never stops a reused pid running the same command', () => {
    const at = (t: string) => live.map(p => ({ ...p, start: t }))
    const ran: Ran = new Map(); remember(ran, chats, at('Sun Nov  8 03:00:00 2026'))
    const reused = ended.map(p => ({ ...p, start: p.pid === 111 ? 'Sun Nov  8 04:00:00 2026' : 'Sun Nov  8 03:00:00 2026' }))
    const pids = targets('A', ran, endedChats, reused, servers).map(t => t.pid)
    assert.equal(pids.includes(111), false)
    assert.equal(pids.includes(120), true)
  })

  it('stops only what the chat started, after it was reparented', () => {
    const got = targets('A', recorded(), endedChats, ended, servers).map(t => t.pid).sort()
    // vite and the main test browser; never its renderer, the user's Chrome or a server it did not start
    assert.deepEqual(got, [111, 120, 150])
  })

  it('never port 3000, 3131 or the keeper', () => {
    const got = targets('A', recorded(), endedChats, ended, servers).map(t => t.pid)
    for (const pid of [112, 130, 140]) assert.ok(!got.includes(pid), `stopped ${pid}`)
  })

  it('skips a process another live chat also descends from', () => {
    const ran = recorded()
    // B picked up 150 since (pid 150 now under B)
    const moved = ended.map(p => p.pid === 150 ? { ...p, ppid: 200 } : p)
    assert.ok(!targets('A', ran, endedChats, moved, servers).some(t => t.pid === 150))
    // or B recorded it earlier
    ran.set('B', new Map([[150, 'node shared.js']]))
    assert.ok(!targets('A', ran, endedChats, ended, servers).some(t => t.pid === 150))
  })

  it('skips a reused pid running something else', () => {
    const reused = ended.map(p => p.pid === 111 ? { ...p, command: 'node other' } : p)
    assert.ok(!targets('A', recorded(), endedChats, reused, servers).some(t => t.pid === 111))
  })

  it('terms, then kills only what is still alive; skips a retry, a limited chat or the switch off', async () => {
    const sent: string[] = []
    const up = new Set([111, 120, 150])
    const deps = (over = {}) => ({
      on: true, retrying: [] as string[], chats: endedChats, procs: ended, servers, ran: recorded(), graceMs: 0,
      kill: (pid: number, sig: string) => { sent.push(`${sig} ${pid}`); if (sig === 'SIGTERM' && pid !== 120) up.delete(pid) },
      alive: (pid: number) => up.has(pid), ...over,
    })
    const done = await reapChat({ sessionId: 'A' }, deps())
    assert.deepEqual(done.map(t => t.pid).sort(), [111, 120, 150])
    assert.deepEqual(sent.filter(s => s.startsWith('SIGKILL')), ['SIGKILL 120'])
    sent.length = 0
    assert.deepEqual(await reapChat({ sessionId: 'A' }, deps({ retrying: ['A'] })), [])
    assert.deepEqual(await reapChat({ sessionId: 'A', limited: { error: 'rate_limit' } }, deps()), [])
    assert.deepEqual(await reapChat({ sessionId: 'A' }, deps({ on: false })), [])
    assert.deepEqual(sent, [])
  })

  it('a handoff end never reaches onEnded, so the successor keeps the server', () => {
    const hub = new HubService()
    const ended: string[] = []
    hub.onEnded(p => ended.push(p.sessionId))
    hub.hook({ session_id: 'H', cwd: '/p', hook_event_name: 'UserPromptSubmit', prompt: 'go' })
    hub.closeAfterFresh('H', '/p')
    hub.hook({ session_id: 'H', cwd: '/p', hook_event_name: 'SessionEnd', reason: 'other' })
    assert.deepEqual(ended, [])
    hub.hook({ session_id: 'E', cwd: '/p', hook_event_name: 'UserPromptSubmit', prompt: 'go' })
    hub.hook({ session_id: 'E', cwd: '/p', hook_event_name: 'SessionEnd', reason: 'other' })
    assert.deepEqual(ended, ['E'])
  })
})
