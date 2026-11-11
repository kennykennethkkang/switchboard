/** Web apps with a CLI sign-in (Auth0): the CLI table, tenant JSON, device URLs and merging into saved logins. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CLI_APPS, checkStatus, cliBusy, deviceUrl, endCli, mergeTenants, readTenants, startCli, tenantsOf } from '../src/hub/cli-logins'
import type { WebApp } from '../src/hub/types'

const APP: WebApp = { id: 'auth0', name: 'Auth0', url: 'https://manage.auth0.com/', logins: [] }

describe('cli table', () => {
  it('has auth0 with login, list, check and tenant flag; other apps are not in it', () => {
    const a = CLI_APPS.auth0
    assert.deepEqual(a.login, ['login', '--agent-mode'])
    assert.deepEqual(a.list, ['tenants', 'list', '--json', '--agent-mode'])
    assert.equal(a.tenantFlag, '--tenant')
    assert.deepEqual(a.check('dev.us.auth0.com'), ['apps', 'list', '--json', '--agent-mode', '--no-input', '--number', '1', '--tenant', 'dev.us.auth0.com'])
    assert.equal(CLI_APPS.vercel, undefined)
  })
})

describe('tenants list output', () => {
  it('reads domains from strings or objects, skipping junk', () => {
    assert.deepEqual(tenantsOf('["a.us.auth0.com","b.eu.auth0.com"]'), ['a.us.auth0.com', 'b.eu.auth0.com'])
    assert.deepEqual(tenantsOf('[{"active":true,"name":"a.us.auth0.com"},{"Domain":"b.auth0.com"},{"x":1},"not a domain!"]'), ['a.us.auth0.com', 'b.auth0.com'])
    assert.deepEqual(tenantsOf('{"tenants":[{"domain":"c.auth0.com"}]}'), ['c.auth0.com'])
  })

  it('reads no config or not logged in as no tenants, anything else as unknown', () => {
    assert.deepEqual(tenantsOf('{"error":{"code":"auth","reason":"no_config","message":"failed to load tenants: config.json file is missing"}}'), [])
    assert.deepEqual(tenantsOf('{"error":{"code":"auth","reason":"not_logged_in"}}'), [])
    assert.equal(tenantsOf('{"error":{"code":"api","reason":"timeout"}}'), undefined)
    assert.equal(tenantsOf(''), undefined)
    assert.equal(tenantsOf('garbage'), undefined)
  })
})

describe('device login output', () => {
  it('finds the verification URL, the complete one first', () => {
    assert.equal(deviceUrl('{"verification_uri":"https://x.auth0.com/activate","verification_uri_complete":"https://x.auth0.com/activate?user_code=AB-CD","user_code":"AB-CD"}\n'), 'https://x.auth0.com/activate?user_code=AB-CD')
    assert.equal(deviceUrl('noise\n{"verification_url":"https://auth0.auth0.com/activate"}'), 'https://auth0.auth0.com/activate')
    assert.equal(deviceUrl('{"error":{"code":"auth"}}'), undefined)
    assert.equal(deviceUrl('{"verification_uri":"javascript:alert(1)"}'), undefined)
  })
})

describe('tenant check', () => {
  it('signed in on success, expired on an auth error, never for an unknown tenant, unsure otherwise', () => {
    assert.equal(checkStatus(true, '[]'), 'signed-in')
    assert.equal(checkStatus(false, '{"error":{"code":"auth","reason":"token_expired","message":"auth token expired and --no-input is set"}}'), 'expired')
    assert.equal(checkStatus(false, 'failed to find tenant: x.auth0.com'), 'never')
    assert.equal(checkStatus(false, '{"error":{"code":"api","reason":"rate_limit"}}'), undefined)
    assert.equal(checkStatus(false, ''), undefined)
  })
})

describe('merging tenants into saved logins', () => {
  const hand = { id: 'h1', label: 'Hand added', url: 'https://manage.auth0.com/dashboard/us/x/', email: 'k@x.com' }
  const known = { id: 'old.us.auth0.com', label: 'Old', url: 'https://manage.auth0.com/dashboard/', domain: 'old.us.auth0.com', email: 'me@x.com', chrome: 'Profile 2', status: 'signed-in' as const }

  it('adds new tenants, keeps hand-added logins and the label, email and Chrome of known ones', () => {
    const app = { ...APP, logins: [hand, known] }
    const out = mergeTenants(app, ['old.us.auth0.com', 'dev-abc.us.auth0.com'], { 'old.us.auth0.com': 'expired', 'dev-abc.us.auth0.com': 'signed-in' })
    assert.deepEqual(out.logins, [
      hand,
      { ...known, status: 'expired' },
      { id: 'dev-abc.us.auth0.com', label: 'dev-abc', url: 'https://manage.auth0.com/dashboard/', domain: 'dev-abc.us.auth0.com', status: 'signed-in' },
    ])
  })

  it('adopts a hand-added login whose dashboard url names the tenant, and drops an auto-added twin', () => {
    const mine = { id: 'f6', label: 'Armasu', url: 'https://manage.auth0.com/dashboard/us/dev-m1q/', chrome: 'Profile 12', email: 'a@x.com' }
    const out = mergeTenants({ ...APP, logins: [mine] }, ['dev-m1q.us.auth0.com'], { 'dev-m1q.us.auth0.com': 'signed-in' })
    assert.deepEqual(out.logins, [{ ...mine, domain: 'dev-m1q.us.auth0.com', status: 'signed-in' }])
    // A twin already added by an earlier sign-in folds into the hand-added one, which keeps its id for project picks.
    const twin = { id: 'dev-m1q.us.auth0.com', label: 'dev-m1q', url: 'https://manage.auth0.com/dashboard/', domain: 'dev-m1q.us.auth0.com', status: 'signed-in' as const }
    const again = mergeTenants({ ...APP, logins: [mine, twin] }, ['dev-m1q.us.auth0.com'], {})
    assert.deepEqual(again.logins, [{ ...mine, domain: 'dev-m1q.us.auth0.com', status: 'signed-in' }])
    // Another tenant's url is not adopted.
    assert.equal(mergeTenants({ ...APP, logins: [mine] }, ['dev-other.us.auth0.com'], {}).logins.length, 2)
  })

  it('marks tenants the CLI no longer lists as not signed in, never deleting them', () => {
    const out = mergeTenants({ ...APP, logins: [hand, known] }, [], {})
    assert.deepEqual(out.logins, [hand, { ...known, status: 'never' }])
  })

  it('keeps the last status when a check could not tell, and never invents signed in', () => {
    const out = mergeTenants({ ...APP, logins: [known, { ...known, id: 'u', domain: 'u.auth0.com', status: undefined }] }, ['old.us.auth0.com', 'u.auth0.com'], {})
    assert.equal(out.logins[0].status, 'signed-in')
    assert.equal(out.logins[1].status, undefined)
    assert.ok(!('status' in out.logins[1]))
    const fresh = mergeTenants(APP, ['n.auth0.com'], {})
    assert.ok(!('status' in fresh.logins[0]))
  })
})

describe('reading tenants through the CLI', () => {
  it('lists, then checks each tenant; no answer from the list changes nothing', async () => {
    const calls: string[][] = []
    const run = async (_bin: string, args: string[]) => {
      calls.push(args)
      if (args[0] === 'tenants') return { ok: true, out: '[{"name":"a.auth0.com"},{"name":"b.auth0.com"}]' }
      return args.includes('a.auth0.com') ? { ok: true, out: '[]' } : { ok: false, out: '{"error":{"code":"auth","reason":"token_expired"}}' }
    }
    assert.deepEqual(await readTenants('auth0', run), { domains: ['a.auth0.com', 'b.auth0.com'], status: { 'a.auth0.com': 'signed-in', 'b.auth0.com': 'expired' } })
    assert.equal(calls.length, 3)
    assert.equal(await readTenants('auth0', async () => ({ ok: false, out: '' })), undefined)
    assert.equal(await readTenants('vercel', run), undefined)
  })
})

describe('one CLI login per app at a time', () => {
  it('refuses a second start until the first ends', () => {
    assert.equal(startCli('auth0'), true)
    assert.equal(startCli('auth0'), false)
    assert.deepEqual(cliBusy(), ['auth0'])
    endCli('auth0')
    assert.deepEqual(cliBusy(), [])
    assert.equal(startCli('auth0'), true)
    endCli('auth0')
  })
})
