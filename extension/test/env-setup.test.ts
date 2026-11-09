/** Project .env setup: recipe and template fill from saved keys, never overwrite, mode 600, no secrets out. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { envSetup, fillRecipes } from '../src/hub/env-setup'
import { keyProblem, keyStore, testKey, type KeyStore, type Run } from '../src/hub/keys'
import type { ApiKeyName } from '../src/hub/types'

const OR = 'sk-or-v1-FAKEfakeFAKEfake0000'
const ZEP = 'z_' + 'FAKEfake'.repeat(20) + '.sig_part-0000'
const project = (name: string) => { const d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-env-')), name); fs.mkdirSync(d); return d }
const store = (v: Partial<Record<ApiKeyName, string>>): KeyStore => ({ get: n => v[n], set: () => {}, remove: () => {} })
const env = (dir: string) => fs.readFileSync(path.join(dir, '.env'), 'utf8')

describe('env setup', () => {
  it('an unreadable template is a refusal, not a throw', () => {
    const dir = project('plain')
    const t = path.join(dir, '.env.example')
    fs.writeFileSync(t, 'X=1\n')
    fs.chmodSync(t, 0o000)
    try {
      const r = envSetup(dir, store({}))
      assert.ok('error' in r && /could not read the template/.test(r.error))
    } finally { fs.chmodSync(t, 0o600) }
  })
  it('an unreadable .env is a refusal, never overwritten', () => {
    const dir = project('MiroFish')
    const f = path.join(dir, '.env')
    fs.writeFileSync(f, 'LLM_API_KEY=keepme\nOTHER=x\n')
    fs.chmodSync(f, 0o000)
    try {
      const r = envSetup(dir, store({ OPENROUTER_API_KEY: OR }))
      assert.ok('error' in r && /could not read the \.env/.test(r.error))
    } finally { fs.chmodSync(f, 0o600) }
    assert.equal(env(dir), 'LLM_API_KEY=keepme\nOTHER=x\n')
  })
  it('fills the MiroFish recipe from saved keys and writes mode 600', () => {
    const dir = project('MiroFish')
    fs.writeFileSync(path.join(dir, '.env.example'), 'LLM_API_KEY=your_api_key_here\nLLM_BOOST_API_KEY=your_api_key_here\n')
    const r = envSetup(dir, store({ OPENROUTER_API_KEY: OR, ZEP_API_KEY: ZEP }))
    assert.ok(!('error' in r))
    const text = env(dir)
    assert.match(text, new RegExp(`^LLM_API_KEY=${OR}$`, 'm'))
    assert.match(text, /^LLM_BASE_URL=https:\/\/openrouter\.ai\/api\/v1$/m)
    assert.match(text, /^LLM_MODEL_NAME=qwen\/qwen-plus$/m)
    assert.match(text, /^OASIS_DEFAULT_MAX_ROUNDS=10$/m)
    assert.ok(text.includes(`ZEP_API_KEY=${ZEP}`))
    assert.ok(!text.includes('LLM_BOOST'), 'the recipe leaves optional boost keys out')
    assert.equal(fs.statSync(path.join(dir, '.env')).mode & 0o777, 0o600)
    assert.deepEqual(r.missing, [])
    assert.deepEqual(r.filled.sort(), ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL_NAME', 'OASIS_DEFAULT_MAX_ROUNDS', 'ZEP_API_KEY'])
  })

  it('never overwrites a set value, fills empty and placeholder ones, keeps other lines', () => {
    const dir = project('mirofish')
    fs.writeFileSync(path.join(dir, '.env'), '# mine\nLLM_API_KEY=my-own-key\nZEP_API_KEY=\nLLM_MODEL_NAME=your_model_name_here\nEXTRA=1\n', { mode: 0o644 })
    const r = envSetup(dir, store({ OPENROUTER_API_KEY: OR }))
    assert.ok(!('error' in r))
    const text = env(dir)
    assert.match(text, /^# mine$/m)
    assert.match(text, /^LLM_API_KEY=my-own-key$/m)
    assert.match(text, /^EXTRA=1$/m)
    assert.match(text, /^LLM_MODEL_NAME=qwen\/qwen-plus$/m)
    assert.match(text, /^ZEP_API_KEY=$/m)
    assert.ok(!text.includes(OR))
    assert.deepEqual(r.kept, ['LLM_API_KEY'])
    assert.deepEqual(r.missing, [{ name: 'ZEP_API_KEY', key: 'ZEP_API_KEY' }])
    assert.equal(fs.statSync(path.join(dir, '.env')).mode & 0o777, 0o600)
    assert.equal(fs.readdirSync(dir).filter(f => f.includes('.tmp')).length, 0)
  })

  it('reads .env.sample when there is no recipe: saved keys by name, defaults kept, placeholders missing', () => {
    const dir = project('other-app')
    fs.writeFileSync(path.join(dir, '.env.sample'), 'GEMINI_API_KEY=\nPORT=8080\nSTRIPE_KEY=changeme\n')
    const r = envSetup(dir, store({ GEMINI_API_KEY: 'AIzaFAKEfakeFAKEfake0000' }))
    assert.ok(!('error' in r))
    assert.match(env(dir), /^GEMINI_API_KEY=AIzaFAKEfakeFAKEfake0000$/m)
    assert.match(env(dir), /^PORT=8080$/m)
    assert.deepEqual(r.missing, [{ name: 'STRIPE_KEY' }])
  })

  it('says so when there is nothing to go on, and writes nothing', () => {
    const dir = project('bare')
    const r = envSetup(dir, store({}))
    assert.ok('error' in r)
    assert.ok(!fs.existsSync(path.join(dir, '.env')))
  })

  it('the result holds names only, never a secret', () => {
    const dir = project('MiroFish')
    const r = envSetup(dir, store({ OPENROUTER_API_KEY: OR, ZEP_API_KEY: ZEP }))
    const out = JSON.stringify(r)
    assert.ok(!out.includes(OR) && !out.includes(ZEP))
  })

  it('a write error comes back redacted', () => {
    const dir = project('MiroFish')
    const r = envSetup(dir, store({ OPENROUTER_API_KEY: OR }), { write: () => { throw new Error(`boom ${OR}`) } })
    assert.ok('error' in r)
    assert.ok(!r.error.includes(OR))
  })
})

describe('ZEP_API_KEY', () => {
  it('takes a long Zep key and stores it past security stdin cut', () => {
    assert.equal(keyProblem('ZEP_API_KEY', ZEP), undefined)
    assert.ok(ZEP.length > 128)
    assert.ok(keyProblem('GEMINI_API_KEY', ZEP), 'other keys keep the 128 cap')
    const calls: Array<{ args: string[]; input?: string }> = []
    const run: Run = (_c, args, input) => { calls.push({ args, input }); return { code: 0, out: '' } }
    keyStore({ platform: 'darwin', run }).set('ZEP_API_KEY', ZEP)
    assert.deepEqual(calls[0].args, ['-i'])
    assert.ok(calls[0].input?.includes(ZEP))
  })

  it('tests against Zep with an Api-Key header', async () => {
    let seen: { url: string; auth?: string } | undefined
    const get = (async (url: string, init: RequestInit) => { seen = { url, auth: (init.headers as Record<string, string>).Authorization }; return new Response('{}', { status: 200 }) }) as unknown as typeof fetch
    const r = await testKey('ZEP_API_KEY', ZEP, get, 1)
    assert.deepEqual(r, { ok: true, at: 1 })
    assert.ok(seen?.url.startsWith('https://api.getzep.com/'))
    assert.equal(seen?.auth, `Api-Key ${ZEP}`)
  })
  it('a saved OpenRouter or Zep key fills listed recipe projects only, keeping set values', () => {
    const miro = project('MiroFish'), other = project('other')
    fs.writeFileSync(path.join(other, '.env.example'), 'OPENROUTER_API_KEY=\n')
    fs.writeFileSync(path.join(miro, '.env'), 'ZEP_API_KEY=mine\n')
    const r = fillRecipes([miro, other, miro], 'OPENROUTER_API_KEY', store({ OPENROUTER_API_KEY: OR, ZEP_API_KEY: ZEP }))
    assert.equal(r.length, 1)
    assert.ok(!('error' in r[0]) && r[0].folder === miro && r[0].kept.includes('ZEP_API_KEY'))
    assert.match(env(miro), new RegExp(`^LLM_API_KEY=${OR}$`, 'm'))
    assert.match(env(miro), /^ZEP_API_KEY=mine$/m)
    assert.ok(!fs.existsSync(path.join(other, '.env')), 'a template project is left for the button')
    assert.deepEqual(fillRecipes([miro], 'GEMINI_API_KEY', store({})), [])
  })
})
