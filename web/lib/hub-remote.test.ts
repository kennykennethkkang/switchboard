/** The standalone web app's calls to its own proxy. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { downReason, fetchHub, fetchHubWhy, fetchVoice, postCommand } from './hub-remote'
import type { HubCommand } from './vscode-bridge'

describe('hub-remote', () => {
  it('sends the Switchboard header and answers null when the proxy fails', async () => {
    const calls: Array<[string, RequestInit | undefined]> = []
    const ok = (async (url: string, init?: RequestInit) => { calls.push([url, init]); return new Response('{"chats":[]}', { status: 200 }) }) as typeof fetch
    assert.deepEqual(await fetchHub(ok), { chats: [] })
    assert.equal((calls[0][1]?.headers as Record<string, string>)['X-Switchboard'], '1')
    const down = (async () => new Response('', { status: 502 })) as typeof fetch
    assert.equal(await fetchHub(down), null)
    const thrown = (async () => { throw new Error('no server') }) as typeof fetch
    assert.equal(await fetchHub(thrown), null)
  })

  it('reads the mic through /hub/voice, null when it cannot', async () => {
    let url = ''
    const ok = (async (u: string) => { url = u; return new Response('{"voice":"listening","level":0.5,"heard":null}', { status: 200 }) }) as typeof fetch
    assert.deepEqual(await fetchVoice(ok), { voice: 'listening', level: 0.5, heard: null })
    assert.equal(url, '/hub/voice')
    assert.equal(await fetchVoice((async () => new Response('', { status: 502 })) as typeof fetch), null)
    assert.equal(await fetchVoice((async () => { throw new Error('x') }) as typeof fetch), null)
  })

  it('posts a command as JSON and answers no problem when it ran', async () => {
    let sent = ''
    const f = (async (_u: string, init?: RequestInit) => { sent = String(init?.body); return new Response(null, { status: 204 }) }) as typeof fetch
    assert.equal(await postCommand({ type: 'hub-aws-check' }, f), undefined)
    assert.equal(sent, '{"type":"hub-aws-check"}')
  })

  it('answers the reason a command failed', async () => {
    const bad = (async () => new Response('hub-send needs sessionId', { status: 400 })) as typeof fetch
    assert.equal(await postCommand({ type: 'hub-aws-check' }, bad), 'hub-send needs sessionId')
    const bare = (async () => new Response('', { status: 502 })) as typeof fetch
    assert.match((await postCommand({ type: 'hub-aws-check' }, bare)) ?? '', /502/)
    const thrown = (async () => { throw new Error('no server') }) as typeof fetch
    assert.match((await postCommand({ type: 'hub-aws-check' }, thrown)) ?? '', /reach/)
  })

  it('says why the hub is out of reach', async () => {
    assert.match(downReason(401), /signed out/)
    assert.match(downReason(403), /signed out/)
    assert.match(downReason(502), /No editor window/)
    assert.match(downReason(undefined), /Cannot reach the Mac/)
    const gone = (async () => new Response('', { status: 403 })) as typeof fetch
    const r = await fetchHubWhy(gone)
    assert.equal(r.hub, null)
    assert.match(r.why ?? '', /signed out/)
    const ok = (async () => new Response('{"chats":[]}', { status: 200 })) as typeof fetch
    assert.deepEqual(await fetchHubWhy(ok), { hub: { chats: [] } })
  })

  it('flags a 404 as no hub at all, not a window that is closed', async () => {
    const f = (s: number) => (async () => new Response('', { status: s })) as typeof fetch
    assert.equal((await fetchHubWhy(f(404))).noHub, true)
    assert.equal((await fetchHubWhy(f(502))).noHub, undefined)
  })

  it('does not ask a demo build for a hub, so the console stays clean', async () => {
    const was = process.env.NEXT_PUBLIC_DEMO
    process.env.NEXT_PUBLIC_DEMO = '1'
    try {
      const f = (async () => { throw new Error('asked') }) as typeof fetch
      const r = await fetchHubWhy(f)
      assert.equal(r.hub, null)
      assert.equal(r.noHub, true)
    } finally {
      if (was === undefined) delete process.env.NEXT_PUBLIC_DEMO; else process.env.NEXT_PUBLIC_DEMO = was
    }
  })

  it('sends back the last ETag and keeps the state it had on a 304', async () => {
    const sent: Array<string | undefined> = []
    let reply = () => new Response('{"chats":[],"n":1}', { status: 200, headers: { ETag: '"a"' } })
    const f = (async (_u: string, init?: RequestInit) => { sent.push((init?.headers as Record<string, string>)['If-None-Match']); return reply() }) as typeof fetch
    assert.deepEqual(await fetchHubWhy(f), { hub: { chats: [], n: 1 } })
    reply = () => new Response(null, { status: 304, headers: { ETag: '"a"' } })
    assert.deepEqual(await fetchHubWhy(f), { hub: { chats: [], n: 1 } })
    assert.deepEqual(sent.slice(-2), [sent[sent.length - 2], '"a"'])
  })

  it('merges a delta onto the state it holds and names that state as its base', async () => {
    const bases: Array<string | undefined> = []
    let reply = () => new Response('{"chats":[],"big":[1,2],"n":1}', { status: 200, headers: { ETag: '"b"' } })
    const f = (async (_u: string, init?: RequestInit) => { bases.push((init?.headers as Record<string, string>)['X-Base']); return reply() }) as typeof fetch
    const first = (await fetchHubWhy(f)).hub as unknown as Record<string, unknown>
    reply = () => new Response('{"set":{"n":2},"del":["chats"]}', { status: 200, headers: { ETag: '"c"', 'X-Delta': '1' } })
    const next = (await fetchHubWhy(f)).hub as unknown as Record<string, unknown>
    assert.deepEqual(next, { big: [1, 2], n: 2 })
    assert.equal(next.big, first.big)
    assert.equal(bases[bases.length - 1], '"b"')
    reply = () => new Response(null, { status: 304, headers: { ETag: '"c"' } })
    assert.deepEqual((await fetchHubWhy(f)).hub, { big: [1, 2], n: 2 })
    assert.equal(bases[bases.length - 1], '"c"')
  })

  it('drops a delta whose base another reply replaced, and asks for the whole state', async () => {
    let n = 0
    const full = () => new Response('{"a":0,"b":0}', { status: 200, headers: { ETag: '"e0"' } })
    await fetchHubWhy((async () => full()) as typeof fetch)
    // Two overlapping fetches name e0; B answers first, then A's delta against e0 lands on B's state.
    let releaseA!: () => void
    const gate = new Promise<void>(r => { releaseA = r })
    const fa = (async (_u: string, init?: RequestInit) => {
      const h = init?.headers as Record<string, string>
      if (!h['X-Base']) return new Response('{"a":1,"b":0}', { status: 200, headers: { ETag: '"e1"' } })
      await gate
      return new Response('{"set":{"a":1},"del":[]}', { status: 200, headers: { ETag: '"e1"', 'X-Delta': '1' } })
    }) as typeof fetch
    const fb = (async () => { n++; return new Response('{"set":{"a":5,"b":2},"del":[]}', { status: 200, headers: { ETag: '"e2"', 'X-Delta': '1' } }) }) as typeof fetch
    const a = fetchHubWhy(fa)
    assert.deepEqual((await fetchHubWhy(fb)).hub, { a: 5, b: 2 })
    releaseA()
    assert.deepEqual((await a).hub, { a: 1, b: 0 })
    assert.equal(n, 1)
  })

  it('keeps the to-do lists, ticked and sync, from the proxy state', async () => {
    const todos = { '/p': { todo: [{ id: 'a', text: 'later', at: 1 }], ticked: [{ id: 'b', text: 'did', at: 2, by: 's1' }], sync: { state: 'synced' } } }
    const f = (async () => new Response(JSON.stringify({ chats: [], todos }), { status: 200 })) as typeof fetch
    assert.deepEqual((await fetchHubWhy(f)).hub?.todos, todos)
  })

  it('posts every to-do command to the proxy as it is, Run included, never as a new or remote chat', async () => {
    const cmds: HubCommand[] = [
      { type: 'hub-todo-add', path: '/p', text: 'x' },
      { type: 'hub-todo-edit', path: '/p', id: 'a', text: 'y' },
      { type: 'hub-todo-remove', path: '/p', id: 'a' },
      { type: 'hub-todo-restore', path: '/p', id: 'b' },
      { type: 'hub-todo-run', path: '/p', ids: ['a'] },
      { type: 'hub-todo-run', path: '/p', ids: ['a'], to: 's1' },
      { type: 'hub-todo-sync', path: '/p', on: true },
    ]
    for (const c of cmds) {
      const calls: Array<[string, RequestInit | undefined]> = []
      const f = (async (url: string, init?: RequestInit) => { calls.push([url, init]); return new Response(null, { status: 204 }) }) as typeof fetch
      assert.equal(await postCommand(c, f), undefined, c.type)
      assert.equal(calls.length, 1)
      assert.equal(calls[0][0], '/hub/command')
      assert.equal(calls[0][1]?.method, 'POST')
      assert.equal((calls[0][1]?.headers as Record<string, string>)['X-Switchboard'], '1')
      assert.deepEqual(JSON.parse(String(calls[0][1]?.body)), c)
    }
  })
})
