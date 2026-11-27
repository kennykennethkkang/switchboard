/** API keys: the Keychain or file store, what the UI may see, the live test, and who may send key commands. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { keyEnv, keyProblem, keyStatus, keyStore, keyTest, redact, saveKey, removeKey, testKey, type Run } from '../src/hub/keys'
import { handleHub, commandProblem } from '../src/hub/routes'
import { HubService } from '../src/hub/hub-service'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-keys-'))
const SECRET = 'AIzaFAKEfakeFAKEfake0000wxyz'

/** A fake `security`: one keychain in a map, every call recorded. */
function fakeSecurity() {
  const items = new Map<string, string>()
  const calls: Array<{ args: string[]; input?: string }> = []
  const run: Run = (cmd, args, input) => {
    assert.equal(cmd, 'security')
    calls.push({ args, input })
    const a = args[args.indexOf('-a') + 1]
    if (args[0] === 'find-generic-password') return items.has(a) ? { code: 0, out: `${items.get(a)}\n` } : { code: 44, out: '' }
    if (args[0] === 'delete-generic-password') return { code: items.delete(a) ? 0 : 44, out: '' }
    if (args[0] === 'add-generic-password') {
      const [v, again] = (input ?? '').split('\n')
      if (!v || v !== again) return { code: 1, out: '' }
      items.set(a, v)
      return { code: 0, out: '' }
    }
    return { code: 2, out: '' }
  }
  return { items, calls, run }
}

describe('key store', () => {
  it('keeps keys in the Keychain on a Mac, the secret on stdin and never in the args', () => {
    const f = fakeSecurity()
    const s = keyStore({ platform: 'darwin', run: f.run })
    assert.equal(s.get('GEMINI_API_KEY'), undefined)
    s.set('GEMINI_API_KEY', SECRET)
    assert.equal(f.items.get('GEMINI_API_KEY'), SECRET)
    const add = f.calls.find(c => c.args[0] === 'add-generic-password')!
    assert.deepEqual(add.args, ['add-generic-password', '-U', '-s', 'switchboard', '-a', 'GEMINI_API_KEY', '-w'])
    assert.ok(!f.calls.some(c => c.args.join(' ').includes(SECRET)))
    assert.equal(s.get('GEMINI_API_KEY'), SECRET)
    s.remove('GEMINI_API_KEY')
    assert.equal(s.get('GEMINI_API_KEY'), undefined)
    s.remove('GEMINI_API_KEY')
  })

  it('says the Keychain refused without the secret in the message', () => {
    const s = keyStore({ platform: 'darwin', run: () => ({ code: 1, out: SECRET }) })
    assert.throws(() => s.set('GEMINI_API_KEY', SECRET), (e: Error) => !e.message.includes(SECRET) && /Keychain/.test(e.message))
  })

  it('falls back to 0600 files elsewhere', () => {
    const dir = path.join(tmp(), 'keys')
    const s = keyStore({ platform: 'linux', dir })
    s.set('OPENROUTER_API_KEY', 'sk-or-v1-fakefakefakefake')
    const file = path.join(dir, 'OPENROUTER_API_KEY')
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(file).mode & 0o777, 0o600)
      assert.equal(fs.statSync(dir).mode & 0o777, 0o700)
    }
    assert.equal(s.get('OPENROUTER_API_KEY'), 'sk-or-v1-fakefakefakefake')
    s.remove('OPENROUTER_API_KEY')
    assert.equal(s.get('OPENROUTER_API_KEY'), undefined)
  })
})

describe('key checks', () => {
  it('takes only the two names and key-shaped values', () => {
    assert.equal(keyProblem('GEMINI_API_KEY', SECRET), undefined)
    assert.match(keyProblem('PATH', SECRET) ?? '', /no such key/)
    assert.match(keyProblem('GEMINI_API_KEY', 'short') ?? '', /does not look like/)
    assert.match(keyProblem('GEMINI_API_KEY', 'AIza with space and "quotes" 1234') ?? '', /does not look like/)
    // security cuts stdin passwords at 128.
    assert.equal(keyProblem('GEMINI_API_KEY', 'A'.repeat(128)), undefined)
    assert.match(keyProblem('GEMINI_API_KEY', 'A'.repeat(129)) ?? '', /does not look like/)
  })

  it('redacts every saved key from a message', () => {
    assert.equal(redact(`bad key ${SECRET} and ${SECRET}`, [SECRET, undefined]), 'bad key *** and ***')
  })
})

describe('key status', () => {
  it('shows only the last four and the last test, never the key', () => {
    const f = fakeSecurity(), meta = path.join(tmp(), 'keys.json')
    const s = keyStore({ platform: 'darwin', run: f.run })
    assert.deepEqual(keyStatus(meta), [{ name: 'GEMINI_API_KEY', saved: false }, { name: 'OPENROUTER_API_KEY', saved: false }, { name: 'PERPLEXITY_API_KEY', saved: false }, { name: 'FIRECRAWL_API_KEY', saved: false }, { name: 'ZEP_API_KEY', saved: false }])
    saveKey(s, 'GEMINI_API_KEY', ` ${SECRET}\n`, meta)
    assert.equal(f.items.get('GEMINI_API_KEY'), SECRET)
    assert.ok(!fs.readFileSync(meta, 'utf8').includes(SECRET))
    assert.deepEqual(keyStatus(meta)[0], { name: 'GEMINI_API_KEY', saved: true, last4: 'wxyz' })
    keyTest('GEMINI_API_KEY', { ok: false, at: 5, reason: 'HTTP 400' }, meta)
    assert.deepEqual(keyStatus(meta)[0], { name: 'GEMINI_API_KEY', saved: true, last4: 'wxyz', checked: { ok: false, at: 5, reason: 'HTTP 400' } })
    // A new key drops the old test.
    saveKey(s, 'GEMINI_API_KEY', `${SECRET.slice(0, -4)}abcd`, meta)
    assert.deepEqual(keyStatus(meta)[0], { name: 'GEMINI_API_KEY', saved: true, last4: 'abcd' })
    removeKey(s, 'GEMINI_API_KEY', meta)
    assert.deepEqual(keyStatus(meta)[0], { name: 'GEMINI_API_KEY', saved: false })
    assert.equal(f.items.size, 0)
  })

  it('refuses a bad value before touching the store', () => {
    const f = fakeSecurity()
    assert.match(saveKey(keyStore({ platform: 'darwin', run: f.run }), 'GEMINI_API_KEY', 'nope', path.join(tmp(), 'k.json')) ?? '', /does not look like/)
    assert.equal(f.calls.length, 0)
  })

  it('gives a child env the saved keys only', () => {
    const f = fakeSecurity()
    const s = keyStore({ platform: 'darwin', run: f.run })
    s.set('OPENROUTER_API_KEY', 'sk-or-v1-fakefakefakefake')
    assert.deepEqual(keyEnv(s), { OPENROUTER_API_KEY: 'sk-or-v1-fakefakefakefake' })
  })
})

describe('key test', () => {
  it('asks Gemini for its models with the key in a header', async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined
    const r = await testKey('GEMINI_API_KEY', SECRET, async (url, init) => { seen = { url: String(url), headers: init?.headers as Record<string, string> }; return new Response('{}', { status: 200 }) }, 7)
    assert.deepEqual(r, { ok: true, at: 7 })
    assert.match(seen!.url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models/)
    assert.ok(!seen!.url.includes(SECRET))
    assert.equal(seen!.headers['x-goog-api-key'], SECRET)
  })

  it('asks Perplexity for its model list with a Bearer header', async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined
    const key = 'pplx-fakefakefakefakefake'
    const r = await testKey('PERPLEXITY_API_KEY', key, async (url, init) => { seen = { url: String(url), headers: init?.headers as Record<string, string> }; return new Response('{}', { status: 200 }) }, 3)
    assert.equal(seen!.url, 'https://api.perplexity.ai/v1/models')
    assert.equal(seen!.headers.Authorization, `Bearer ${key}`)
    assert.deepEqual(r, { ok: true, at: 3 })
  })

  it('asks OpenRouter for the key with a Bearer header, and redacts a failure', async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined
    const key = 'sk-or-v1-fakefakefakefake'
    const r = await testKey('OPENROUTER_API_KEY', key, async (url, init) => {
      seen = { url: String(url), headers: init?.headers as Record<string, string> }
      return new Response(JSON.stringify({ error: { message: `No auth credentials found for ${key}` } }), { status: 401 })
    }, 9)
    assert.equal(seen!.url, 'https://openrouter.ai/api/v1/key')
    assert.equal(seen!.headers.Authorization, `Bearer ${key}`)
    assert.equal(r.ok, false)
    assert.ok(!r.reason!.includes(key))
    assert.match(r.reason!, /^HTTP 401: No auth credentials/)
  })

  it('says a network failure without the key', async () => {
    const r = await testKey('GEMINI_API_KEY', SECRET, async () => { throw new Error(`fetch failed ${SECRET}`) }, 1)
    assert.deepEqual(r, { ok: false, at: 1, reason: 'fetch failed ***' })
  })
})

describe('key commands', () => {
  const save = JSON.stringify({ type: 'hub-key-save', name: 'GEMINI_API_KEY', value: SECRET })

  it('checks their shapes', () => {
    assert.equal(commandProblem({ type: 'hub-key-save', name: 'GEMINI_API_KEY', value: SECRET }), undefined)
    assert.equal(commandProblem({ type: 'hub-key-test', name: 'OPENROUTER_API_KEY' }), undefined)
    assert.equal(commandProblem({ type: 'hub-key-remove', name: 'GEMINI_API_KEY' }), undefined)
    assert.match(commandProblem({ type: 'hub-key-save', name: 'PATH', value: SECRET }) ?? '', /name/)
    assert.match(commandProblem({ type: 'hub-key-save', name: 'GEMINI_API_KEY', value: 'x'.repeat(1000) }) ?? '', /value/)
    // A refusal names the field, never echoes the value.
    assert.ok(!(commandProblem({ type: 'hub-key-save', name: 'PATH', value: SECRET }) ?? '').includes(SECRET))
  })

  it('reach the runner only with the hub token', async () => {
    const h = new HubService()
    const ran: unknown[] = []
    h.runner = c => { ran.push(c); return true }
    assert.equal((await handleHub(h, 'POST', '/hub/command', save))?.status, 403)
    assert.equal((await handleHub(h, 'POST', '/hub/command?token=nope', save))?.status, 403)
    assert.equal(ran.length, 0)
    assert.equal((await handleHub(h, 'POST', `/hub/command?token=${h.token}`, save))?.status, 204)
    assert.equal(ran.length, 1)
  })

  it('never puts a key in the state the hub serves', async () => {
    const h = new HubService()
    h.set({ signIns: { ...h.get().signIns, keys: [{ name: 'GEMINI_API_KEY', saved: true, last4: 'wxyz' }] } })
    const body = (await handleHub(h, 'GET', `/hub/state?token=${h.token}`, ''))!.body
    assert.ok(!body.includes(SECRET))
    assert.deepEqual(JSON.parse(body).signIns.keys, [{ name: 'GEMINI_API_KEY', saved: true, last4: 'wxyz' }])
  })
})
