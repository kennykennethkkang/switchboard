/**
 * The standalone app's hub proxy: which window it talks to, and which browser
 * requests it lets through.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { allowed, codeLogin, macOnly, hostOk, lanNames, macNames, macNamesRead, commandSession, deniedAs, deviceAsks, forwardedIp, lanCookie, lanFor, lanGate, lanSetCookie, commandFolder, liveToken, phoneCode, phoneSecret, pickWindow, proxyHub, signInPage, tailscaleName, tailscaleProblem, uaSummary, waitPage } from './hub-proxy'
import { MAC_ONLY_GIT } from '../../web/lib/hub-types'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as http from 'http'
import type { AddressInfo } from 'net'
import * as os from 'os'
import * as path from 'path'
import * as zlib from 'zlib'
import { macNamesOf, phoneServeArgs } from '../../extension/src/hub/lan'

const w = (workspace: string, mtimeMs: number, port = 1) => ({ port, hubToken: 't', workspace, mtimeMs })

describe('pickWindow', () => {
  it('takes the window open on the workspace, else the newest', () => {
    const files = [w('/u/a', 5, 1), w('/u/Armasu', 1, 2), w('/u/b', 9, 3)]
    assert.equal(pickWindow(files, '/u/Armasu')?.port, 2)
    assert.equal(pickWindow(files, '/elsewhere')?.port, 3)
    assert.equal(pickWindow([], '/u')?.port, undefined)
  })
  it('skips a window whose process is gone', () => {
    const files = [{ ...w('/u/Armasu', 9, 1), pid: 11 }, { ...w('/u/Armasu', 1, 2), pid: 22 }]
    assert.equal(pickWindow(files, '/u/Armasu', pid => pid === 22)?.port, 2)
    assert.equal(pickWindow(files, '/u/Armasu', () => false)?.port, undefined)
  })
  it('takes the window whose workspace holds the app folder', () => {
    const files = [w('/u/b', 9, 1), w('/u/Armasu', 1, 2), w('/u/Arm', 5, 3)]
    assert.equal(pickWindow(files, '/u/Armasu/web')?.port, 2)
  })
  it('takes the window holding the command folder first, the deepest one, else the usual pick', () => {
    const files = [w('/u/switchboard', 9, 1), w('/u/Armasu', 1, 2), w('/u', 5, 3)]
    assert.equal(pickWindow(files, '/u/switchboard', undefined, '/u/Armasu')?.port, 2)
    assert.equal(pickWindow(files, '/u/switchboard', undefined, '/u/Armasu/web')?.port, 2)
    assert.equal(pickWindow(files, '/u/switchboard', undefined, '/u/other')?.port, 3)
    assert.equal(pickWindow(files, '/u/switchboard', undefined, '/elsewhere')?.port, 1)
    assert.equal(pickWindow(files, '/u/switchboard')?.port, 1)
  })
  it('routes to-do and new-chat commands by their path, nothing else', () => {
    assert.equal(commandFolder('{"type":"hub-todo-run","path":"/u/Armasu","ids":["a"]}'), '/u/Armasu')
    assert.equal(commandFolder('{"type":"hub-todo-add","path":"/u/Armasu","text":"x"}'), '/u/Armasu')
    assert.equal(commandFolder('{"type":"hub-new-chat","path":"/u/b","remote":false}'), '/u/b')
    // Their answers stay in the window that ran them, which the page reads.
    assert.equal(commandFolder('{"type":"hub-pick-tools","text":"x","path":"/u/b"}'), undefined)
    assert.equal(commandFolder('{"type":"hub-dev-start","folder":"/u/b"}'), undefined)
    assert.equal(commandFolder('{"type":"hub-send","sessionId":"s"}'), undefined)
    assert.equal(commandFolder('{"type":"hub-todo-run","path":5}'), undefined)
    assert.equal(commandFolder('not json'), undefined)
  })
  it('skips files without a port or token', () => {
    assert.equal(pickWindow([{ workspace: '/u', mtimeMs: 9 } as never, w('/u', 1, 4)], '/x')?.port, 4)
  })
})

describe('macOnly', () => {
  it('refuses the same git ops the phone hides', () => {
    for (const op of ['sync', 'commit', 'commit-push', 'switch', 'create', 'undo', 'discard', 'pr', 'stash', 'pop', 'delete-branch', 'rerun', 'ship', 'push'])
      assert.equal(macOnly(JSON.stringify({ type: 'hub-git', op })), MAC_ONLY_GIT.has(op as never), op)
    assert.equal(MAC_ONLY_GIT.has('commit'), false)
    assert.equal(macOnly('{"type":"hub-harden","sessionId":"s"}'), true)
  })
  it('keeps the Mac mic off for a phone and lets other commands by', () => {
    assert.equal(macOnly('{"type":"hub-voice","on":true}'), true)
    // A spoken reply plays out of the Mac's speakers; the phone asks in text only.
    assert.equal(macOnly('{"type":"hub-jarvis","q":"hi","voice":true}'), true)
    assert.equal(macOnly('{"type":"hub-jarvis","q":"hi"}'), false)
    assert.equal(macOnly('{"type":"hub-jarvis","q":"x"}'), false)
    assert.equal(macOnly('not json'), false)
  })
  it('keeps keys, sign-ins, AWS, setup, links, dev servers and pushes on the Mac', () => {
    for (const type of ['hub-key-save', 'hub-key-remove', 'hub-key-test', 'hub-login-add', 'hub-login-open', 'hub-login-delete', 'hub-aws-add', 'hub-aws-login', 'hub-aws-delete',
      'hub-open-url', 'hub-dev-start', 'hub-setup', 'hub-rules-sync', 'hub-kit-export', 'hub-toggle', 'hub-switchboard', 'hub-browser']) assert.equal(macOnly(JSON.stringify({ type })), true, type)
    for (const op of ['sync', 'commit-push', 'pr', 'ship', 'discard', 'delete-branch']) assert.equal(macOnly(JSON.stringify({ type: 'hub-git', sessionId: 's', op })), true, op)
  })
  it('lets the phone chat, answer, read, upload and keep to-dos', () => {
    for (const type of ['hub-send', 'hub-answer', 'hub-new-chat', 'hub-focus-chat', 'hub-changes', 'hub-todo-add', 'hub-todo-run', 'hub-star', 'hub-search', 'hub-dev-stop', 'hub-setting'])
      assert.equal(macOnly(JSON.stringify({ type })), false, type)
    for (const op of ['commit', 'push', 'stash', 'pop', 'switch', 'create', 'undo', 'rerun']) assert.equal(macOnly(JSON.stringify({ type: 'hub-git', sessionId: 's', op })), false, op)
  })
})

describe('lanCookie', () => {
  it('sets a Secure cookie for 30 days, since the phone only comes in over https', () => {
    assert.equal(lanSetCookie(3131, 'abc'), 'sb3131=abc; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000')
  })
  it('drops Secure over plain http, or the phone never keeps it', () => {
    assert.equal(lanSetCookie(3131, 'abc', false), 'sb3131=abc; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000')
  })
})

describe('commandSession', () => {
  it('reads the chat a command names, nothing else', () => {
    assert.equal(commandSession('{"type":"hub-send","sessionId":"ab-12","text":"x"}'), 'ab-12')
    assert.equal(commandSession('{"type":"hub-focus-chat","sessionId":"ab-12"}'), 'ab-12')
    assert.equal(commandSession('{"type":"hub-todo-add","path":"/p","text":"x"}'), undefined)
    assert.equal(commandSession('{"type":"hub-send","sessionId":"../x?y"}'), undefined)
    assert.equal(commandSession('not json'), undefined)
  })
})

describe('allowed', () => {
  const ok = { host: '127.0.0.1:3010', 'x-switchboard': '1' }
  it('lets the app own page through', () => {
    assert.equal(allowed(ok, 3010), true)
    assert.equal(allowed({ ...ok, host: 'localhost:3010', origin: 'http://localhost:3010' }, 3010), true)
  })
  it('refuses another site, a rebound name and a request without the header', () => {
    assert.equal(allowed({ ...ok, origin: 'http://evil.test' }, 3010), false)
    assert.equal(allowed({ ...ok, host: 'evil.test:3010' }, 3010), false)
    assert.equal(allowed({ host: '127.0.0.1:3010' }, 3010), false)
  })
})

describe('hostOk', () => {
  it('takes only the loopback names on loopback, so a rebound name never reads /events', () => {
    for (const host of ['127.0.0.1:3131', 'localhost:3131', '[::1]:3131', 'LOCALHOST:3131']) assert.equal(hostOk({ host }, 3131), true, host)
    for (const host of ['attacker.example:3131', '127.0.0.1:3132', '127.0.0.1', undefined]) assert.equal(hostOk({ host }, 3131), false, String(host))
  })
  it('takes only the MagicDNS name through tailscale serve', () => {
    const lan = { secret: 's', names: ['mac.tail1.ts.net'] }
    assert.equal(hostOk({ host: 'mac.tail1.ts.net' }, 3131, lan), true)
    assert.equal(hostOk({ host: 'Mac.Tail1.ts.net:443' }, 3131, lan), true)
    for (const host of ['127.0.0.1:3131', 'mac.tail1.ts.net:3131', 'mac.tail1.ts.net.evil.test', '192.168.1.5:3131']) assert.equal(hostOk({ host }, 3131, lan), false, host)
  })
  it('takes the name on port 80 when served over plain http', () => {
    const lan = { secret: 's', names: ['mac.tail1.ts.net'], plain: true }
    assert.equal(hostOk({ host: 'mac.tail1.ts.net' }, 3131, lan), true)
    assert.equal(hostOk({ host: 'mac.tail1.ts.net:80' }, 3131, lan), true)
    assert.equal(hostOk({ host: 'mac.tail1.ts.net:3131' }, 3131, lan), false)
    assert.equal(allowed({ host: 'mac.tail1.ts.net', 'x-switchboard': '1', origin: 'http://mac.tail1.ts.net' }, 3131, lan), true)
    assert.equal(allowed({ host: 'mac.tail1.ts.net', 'x-switchboard': '1', origin: 'https://mac.tail1.ts.net' }, 3131, lan), false)
  })
  it('takes the short MagicDNS name too, from the same read', () => {
    assert.deepEqual(lanNames({ tailscale: 'mac.tail1.ts.net', https: false }), { names: ['mac.tail1.ts.net', 'mac'], plain: true })
    assert.deepEqual(lanNames({ tailscale: 'mac.tail1.ts.net', https: true }), { names: ['mac.tail1.ts.net', 'mac'], plain: false })
    assert.deepEqual(lanNames({}).names, [])
    // What serve really runs wins: certs on but the switch to https failed stays plain.
    assert.equal(lanNames({ tailscale: 'mac.tail1.ts.net', https: true }, 'http').plain, true)
    assert.equal(lanNames({ tailscale: 'mac.tail1.ts.net', https: false }, 'https').plain, false)
    const { names, plain } = lanNames({ tailscale: 'mac.tail1.ts.net', https: false })
    const secret = 'a'.repeat(64)
    const h = { host: 'mac', 'x-forwarded-for': '100.1.2.3' }
    const lan = lanFor(h, 3131, secret, names, plain)!
    assert.equal(lanGate(h, '/?k=' + secret, 3131, lan), 'login')
    assert.equal(lanGate({ ...h, cookie: 'sb3131=' + secret }, '/hub/command', 3131, lan), 'ok')
    assert.equal(allowed({ ...h, 'x-switchboard': '1', origin: 'http://mac' }, 3131, lan), true)
    assert.equal(allowed({ ...h, host: 'mac:80', 'x-switchboard': '1', origin: 'http://mac' }, 3131, lan), true)
    assert.equal(allowed({ ...h, 'x-switchboard': '1', origin: 'http://evil.test' }, 3131, lan), false)
    assert.equal(lanGate({ ...h, host: 'mac.evil.test', cookie: 'sb3131=' + secret }, '/', 3131, lan), 'deny')
  })
})

describe('macNamesRead', () => {
  it('waits for the first tailscale read, so startup does not refuse the phone', async () => {
    macNames()
    const n = await macNamesRead()
    assert.deepEqual(macNames(), n)
  })
})

describe('lanGate', () => {
  const lan = { secret: 'a'.repeat(64), names: ['mac.tail1.ts.net'] }
  const h = { host: 'mac.tail1.ts.net' }
  it('passes loopback requests as before', () => {
    assert.equal(lanGate({ host: '127.0.0.1:3131' }, '/', 3131, undefined), 'ok')
    assert.equal(allowed({ host: '127.0.0.1:3131', 'x-switchboard': '1' }, 3131), true)
    assert.equal(allowed({ host: 'mac.tail1.ts.net', 'x-switchboard': '1' }, 3131), false)
  })
  it('refuses a phone request without the secret or with a wrong one', () => {
    assert.equal(lanGate(h, '/', 3131, lan), 'deny')
    assert.equal(lanGate(h, '/hub/state', 3131, lan), 'deny')
    assert.equal(lanGate(h, '/?k=' + 'b'.repeat(64), 3131, lan), 'deny')
    assert.equal(lanGate(h, '/?k=short', 3131, lan), 'deny')
    assert.equal(lanGate({ ...h, cookie: 'sb3131=' + 'b'.repeat(64) }, '/', 3131, lan), 'deny')
  })
  it('logs in with the QR secret once, then lets the cookie through', () => {
    assert.equal(lanGate(h, '/?k=' + lan.secret, 3131, lan), 'login')
    assert.equal(lanGate({ ...h, cookie: 'x=1; sb3131=' + lan.secret }, '/hub/state', 3131, lan), 'ok')
    assert.equal(allowed({ ...h, 'x-switchboard': '1', origin: 'https://mac.tail1.ts.net' }, 3131, lan), true)
    assert.equal(allowed({ ...h, 'x-switchboard': '1', origin: 'http://mac.tail1.ts.net' }, 3131, lan), false)
    assert.equal(allowed({ ...h }, 3131, lan), false)
  })
  it('refuses a path it cannot parse instead of throwing', () => {
    assert.equal(lanGate(h, '//', 3131, lan), 'deny')
    assert.equal(lanGate({ ...h, cookie: 'sb3131=' + lan.secret }, '//', 3131, lan), 'deny')
  })
  it('names the cookie per port, so two apps keep apart', () => {
    assert.equal(lanCookie(3131), 'sb3131')
    assert.equal(lanGate({ ...h, cookie: 'sb=' + lan.secret }, '/', 3131, lan), 'deny')
    assert.equal(lanGate({ ...h, cookie: 'sb3001=' + lan.secret }, '/', 3131, lan), 'deny')
  })
  it('refuses another Host even with the right secret', () => {
    assert.equal(lanGate({ host: 'evil.test', cookie: 'sb3131=' + lan.secret }, '/', 3131, lan), 'deny')
    assert.equal(lanGate({ host: 'evil.test' }, '/?k=' + lan.secret, 3131, lan), 'deny')
    // tailscale serve is on loopback, so a loopback Host with its headers is still the phone.
    assert.equal(lanGate({ host: '127.0.0.1:3131', 'x-forwarded-for': '100.1.2.3', cookie: 'sb3131=' + lan.secret }, '/', 3131, lanFor({ host: '127.0.0.1:3131', 'x-forwarded-for': '100.1.2.3' }, 3131, lan.secret, lan.names)), 'deny')
  })
})

describe('lanFor', () => {
  const secret = 'a'.repeat(64), names = ['mac.tail1.ts.net']
  it('is the Mac itself only for a loopback Host with no proxy headers', () => {
    assert.equal(lanFor({ host: '127.0.0.1:3131' }, 3131, secret, names), undefined)
    assert.equal(lanFor({ host: 'localhost:3131' }, 3131, secret, names), undefined)
  })
  it('is the phone for the ts.net Host or any tailscale serve header', () => {
    for (const h of [{ host: 'mac.tail1.ts.net' }, { host: '127.0.0.1:3131', 'x-forwarded-for': '100.1.2.3' }, { host: '127.0.0.1:3131', 'x-forwarded-proto': 'https' },
      { host: '127.0.0.1:3131', 'tailscale-user-login': 'a@b.c' }, { host: 'evil.test:3131' }, {}]) assert.deepEqual(lanFor(h, 3131, secret, names), { secret, names }, JSON.stringify(h))
  })
  it('marks a plain http phone', () => {
    assert.deepEqual(lanFor({ host: 'mac.tail1.ts.net' }, 3131, secret, names, true), { secret, names, plain: true })
    assert.equal(lanFor({ host: '127.0.0.1:3131' }, 3131, secret, names, true), undefined)
  })
  it('reads the phone address from x-forwarded-for', () => {
    assert.equal(forwardedIp({ 'x-forwarded-for': '100.101.2.3, 127.0.0.1' }), '100.101.2.3')
    assert.equal(forwardedIp({}), '')
  })
})

describe('phoneSecret', () => {
  it('keeps one secret across restarts, readable only by the owner, and replaces a bad file', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-secret-')), 'sub', 'phone.secret')
    const first = phoneSecret(file)
    assert.match(first, /^[0-9a-f]{64}$/)
    assert.equal(phoneSecret(file), first)
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    fs.writeFileSync(file, 'short')
    assert.notEqual(phoneSecret(file), 'short')
  })
})

describe('phoneCode', () => {
  it('is six digits, the same every time for one secret', () => {
    const a = phoneCode('a'.repeat(64))
    assert.match(a, /^\d{6}$/)
    assert.equal(phoneCode('a'.repeat(64)), a)
    assert.notEqual(phoneCode('b'.repeat(64)), a)
    // HMAC-SHA256(secret, 'switchboard-code'), first 4 bytes mod 1e6
    assert.equal(phoneCode('k'), String(crypto.createHmac('sha256', 'k').update('switchboard-code').digest().readUInt32BE(0) % 1e6).padStart(6, '0'))
  })
})

describe('deniedAs', () => {
  const lan = { secret: 'a'.repeat(64), names: ['mac.tail1.ts.net'] }
  const h = { host: 'mac.tail1.ts.net' }
  it('gives a typed page address the sign-in page', () => {
    assert.equal(deniedAs('GET', h, '/', 3131, lan), 'page')
    assert.equal(deniedAs('GET', { ...h, accept: 'text/html,*/*' }, '/chat/1', 3131, lan), 'page')
    assert.equal(deniedAs('GET', h, '/?k=wrong', 3131, lan), 'page')
  })
  it('takes the code on POST /login only', () => {
    assert.equal(deniedAs('POST', h, '/login', 3131, lan), 'login')
    assert.equal(deniedAs('POST', h, '/', 3131, lan), 'forbid')
  })
  it('keeps refusing everything that is not a page', () => {
    assert.equal(deniedAs('GET', h, '/events', 3131, lan), 'forbid')
    assert.equal(deniedAs('GET', h, '/hub/state', 3131, lan), 'forbid')
    assert.equal(deniedAs('GET', { ...h, accept: '*/*' }, '/_next/app.js', 3131, lan), 'forbid')
    assert.equal(deniedAs('GET', h, '//', 3131, lan), 'forbid')
  })
  it('pins the Host, so a rebound name gets neither page nor login', () => {
    assert.equal(deniedAs('GET', { host: 'evil.test' }, '/', 3131, lan), 'forbid')
    assert.equal(deniedAs('POST', { host: 'evil.test' }, '/login', 3131, lan), 'forbid')
    assert.equal(deniedAs('GET', { host: 'mac.tail1.ts.net:3001' }, '/', 3131, lan), 'forbid')
  })
})

describe('codeLogin', () => {
  const secret = 'a'.repeat(64), code = phoneCode(secret)
  const wrong = code === '000000' ? '000001' : '000000'
  it('takes the right code and refuses a wrong one', () => {
    const check = codeLogin()
    assert.equal(check(code, secret), 'ok')
    assert.equal(check(wrong, secret), 'wrong')
    assert.equal(check('', secret), 'wrong')
    assert.equal(check(code + '0', secret), 'wrong')
  })
  it('locks after 5 wrong codes in 10 minutes, even for the right one, then lets go', () => {
    let t = 0
    const check = codeLogin(() => t)
    for (let i = 0; i < 5; i++) assert.equal(check(wrong, secret), 'wrong')
    assert.equal(check(wrong, secret), 'locked')
    assert.equal(check(code, secret), 'locked')
    t = 10 * 60_000
    assert.equal(check(code, secret), 'ok')
  })
})

describe('signInPage', () => {
  it('is one numeric field posting to /login, with no outside loads', () => {
    const page = signInPage()
    assert.match(page, /action="\/login" method="post"/)
    assert.match(page, /inputmode="numeric"/)
    assert.match(page, /autocomplete="one-time-code"/)
    assert.match(page, /prefers-color-scheme: dark/)
    assert.doesNotMatch(page, /https?:\/\/|<script|\u2014/)
    assert.match(signInPage('Wrong code'), /Wrong code/)
  })
})

describe('sign-in hardening', () => {
  const lan = { secret: 'a'.repeat(64), names: ['mac.tail1.ts.net'] }
  const h = { host: 'mac.tail1.ts.net' }
  it('takes /login only from the page itself or with no Origin', () => {
    assert.equal(deniedAs('POST', h, '/login', 3131, lan), 'login')
    assert.equal(deniedAs('POST', { ...h, origin: 'https://mac.tail1.ts.net' }, '/login', 3131, lan), 'login')
    assert.equal(deniedAs('POST', { ...h, origin: 'http://evil.example' }, '/login', 3131, lan), 'forbid')
    assert.equal(deniedAs('POST', { ...h, origin: 'null' }, '/login', 3131, lan), 'forbid')
  })
  it('a right code clears the wrong ones', () => {
    const check = codeLogin()
    for (let i = 0; i < 4; i++) assert.equal(check('000000', lan.secret), 'wrong')
    assert.equal(check(phoneCode(lan.secret), lan.secret), 'ok')
    for (let i = 0; i < 4; i++) assert.equal(check('000000', lan.secret), 'wrong')
    assert.equal(check(phoneCode(lan.secret), lan.secret), 'ok')
  })
})

describe('Mac names', () => {
  const ts = (o: object) => JSON.stringify({ BackendState: 'Running', CertDomains: ['kennys-mbp.tail1234.ts.net'], Self: { DNSName: 'Kennys-MBP.tail1234.ts.net.' }, ...o })
  it('reads the MagicDNS name from tailscale, lowercased, without the trailing dot', () => {
    assert.equal(tailscaleName(ts({})), 'kennys-mbp.tail1234.ts.net')
    assert.equal(tailscaleName(ts({ Self: { DNSName: 'a b.ts.net.' } })), undefined)
    assert.equal(tailscaleName('not json'), undefined)
  })
  it('has no name, and says why, without tailscale or signed out', () => {
    assert.match(tailscaleProblem(undefined)!, /install/i)
    assert.match(tailscaleProblem(ts({ BackendState: 'Stopped' }))!, /sign in/i)
    assert.match(tailscaleProblem('not json')!, /sign in/i)
    assert.equal(tailscaleName(ts({ BackendState: 'Stopped' })), undefined)
    assert.equal(tailscaleProblem(ts({})), undefined)
  })
  it('still has a name without HTTPS certs, flagged for the plain http fallback', () => {
    assert.equal(tailscaleProblem(ts({ CertDomains: null })), undefined)
    assert.deepEqual(macNamesOf(ts({})), { tailscale: 'kennys-mbp.tail1234.ts.net', https: true })
    assert.deepEqual(macNamesOf(ts({ CertDomains: [] })), { tailscale: 'kennys-mbp.tail1234.ts.net', https: false })
    assert.deepEqual(macNamesOf(ts({ CertDomains: null })), { tailscale: 'kennys-mbp.tail1234.ts.net', https: false })
    assert.match(macNamesOf(undefined).problem!, /install/i)
  })
  it('serves https on 443, else plain http on 80', () => {
    assert.deepEqual(phoneServeArgs(3131, true, true), ['serve', '--bg', '--https=443', 'http://127.0.0.1:3131'])
    assert.deepEqual(phoneServeArgs(3131, false, true), ['serve', '--https=443', 'off'])
    assert.deepEqual(phoneServeArgs(3131, true, false), ['serve', '--bg', '--http=80', 'http://127.0.0.1:3131'])
    assert.deepEqual(phoneServeArgs(3131, false, false), ['serve', '--http=80', 'off'])
  })
})

describe('device approval', () => {
  const lan = { secret: 'a'.repeat(64), names: ['mac.tail1.ts.net'] }
  const h = { host: 'mac.tail1.ts.net' }
  const d = { ip: '100.101.2.3', ua: 'iPhone Safari', host: 'mac.tail1.ts.net', network: 'Tailscale' as const }
  it('routes Ask and the wait page past the gate, with the /login Origin rule', () => {
    assert.equal(deniedAs('POST', h, '/device', 3131, lan), 'device')
    assert.equal(deniedAs('POST', { ...h, origin: 'https://mac.tail1.ts.net' }, '/device', 3131, lan), 'device')
    assert.equal(deniedAs('POST', { ...h, origin: 'http://evil.test' }, '/device', 3131, lan), 'forbid')
    assert.equal(deniedAs('GET', h, '/device/wait?id=x', 3131, lan), 'wait')
    assert.equal(deniedAs('GET', { host: 'evil.test' }, '/device/wait?id=x', 3131, lan), 'forbid')
    assert.equal(deniedAs('POST', h, '/device/answer', 3131, lan), 'forbid')
  })
  it('creates a pending ask with a 128-bit id, at most 3 at once', () => {
    const asks = deviceAsks(() => 0)
    const a = asks.ask(d)!
    assert.match(a.id, /^[0-9a-f]{32}$/)
    assert.equal(asks.state(a.id), 'pending')
    asks.ask(d); asks.ask(d)
    assert.equal(asks.ask(d), undefined)
    assert.equal(asks.state('nope'), 'gone')
  })
  it('expires an unanswered ask after 2 minutes, which frees its place', () => {
    let t = 0
    const asks = deviceAsks(() => t)
    const a = asks.ask(d)!
    asks.ask(d); asks.ask(d)
    t = 2 * 60_000
    assert.equal(asks.state(a.id), 'gone')
    assert.equal(asks.answer(a.id, true), false)
    assert.ok(asks.ask(d))
  })
  it('allow and deny are answered once and read once', () => {
    const asks = deviceAsks(() => 0)
    const a = asks.ask(d)!, b = asks.ask(d)!
    assert.equal(asks.answer(a.id, true), true)
    assert.equal(asks.answer(a.id, true), false)
    assert.equal(asks.answer(b.id, false), true)
    assert.equal(asks.state(a.id), 'allowed')
    assert.equal(asks.state(a.id), 'gone')
    assert.equal(asks.state(b.id), 'denied')
    assert.equal(asks.state(b.id), 'gone')
  })
  it('an answered ask no longer counts toward the cap', () => {
    const asks = deviceAsks(() => 0)
    const a = asks.ask(d)!
    asks.ask(d); asks.ask(d)
    asks.answer(a.id, true)
    assert.ok(asks.ask(d))
  })
  it('sums up a User-Agent in a few words', () => {
    assert.equal(uaSummary('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'), 'iPhone Safari')
    assert.equal(uaSummary('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1'), 'iPhone Chrome')
    assert.equal(uaSummary('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'), 'Android Chrome')
    assert.equal(uaSummary('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0'), 'Windows Edge')
    assert.equal(uaSummary('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0'), 'Mac Firefox')
    assert.equal(uaSummary('curl/8.7.1'), 'Unknown browser')
    assert.equal(uaSummary(undefined), 'Unknown browser')
  })
  it('takes an answer only with the token of a live window', () => {
    const files = [{ port: 1, hubToken: 'live', workspace: '/u', mtimeMs: 1, pid: 11 }, { port: 2, hubToken: 'dead', workspace: '/u', mtimeMs: 1, pid: 22 }, { workspace: '/u', mtimeMs: 1 }]
    const alive = (pid: number) => pid === 11
    assert.equal(liveToken(files, 'live', alive), true)
    assert.equal(liveToken(files, 'dead', alive), false)
    assert.equal(liveToken(files, 'nope', alive), false)
    assert.equal(liveToken(files, '', alive), false)
    assert.equal(liveToken(files, undefined, alive), false)
  })
  it('the sign-in page puts the code first, asking the Mac below for when someone is at it, no scripts', () => {
    const page = signInPage()
    assert.match(page, /action="\/device" method="post"/)
    assert.match(page, /Ask the Mac to let me in/)
    assert.match(page, /at the Mac/)
    assert.ok(page.indexOf('action="/login"') < page.indexOf('action="/device"'))
    assert.doesNotMatch(page, /<script|\u2014/)
  })
  it('the wait page refreshes itself to its own id, no scripts', () => {
    const id = 'ab'.repeat(16)
    const page = waitPage(id)
    assert.match(page, new RegExp(`<meta http-equiv="refresh" content="2;url=/device/wait\\?id=${id}">`))
    assert.doesNotMatch(page, /<script|https?:\/\/|\u2014/)
    assert.doesNotMatch(waitPage('"><x'), /"><x/)
  })
})

// A fake window's hook server behind a real proxy, on loopback, Wi-Fi and Tailscale Hosts alike.
describe('proxyHub to-do', () => {
  const todos = { '/p': { todo: [{ id: 'a', text: 'later', at: 1 }], ticked: [{ id: 'b', text: 'did', at: 2, by: 's1' }], sync: { state: 'synced', canSync: true } } }
  const hops: Array<{ method?: string; url?: string; body: string }> = []
  const tokens: string[] = []
  let stamp = 0
  const up = http.createServer(async (req, res) => {
    let body = ''
    for await (const c of req) body += c
    hops.push({ method: req.method, url: req.url, body })
    tokens.push(String(req.headers['x-switchboard-token']))
    if (req.url?.startsWith('/hub/holds')) res.writeHead(404).end()
    else if (req.url?.startsWith('/hub/state')) res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ chats: [], todos, ...(stamp ? { stamp } : {}) }))
    else res.writeHead(204).end()
  })
  let port = 0
  // A second window on another project, opened later, so it is the newest.
  const other: string[] = []
  const up2 = http.createServer(async (req, res) => {
    let body = ''
    for await (const c of req) body += c
    if (req.url?.startsWith('/hub/holds')) { res.writeHead(req.url === '/hub/holds?session=s2' && req.headers['x-switchboard-token'] === 'tok2' ? 204 : 404).end(); return }
    other.push(`${req.url} ${req.headers['x-switchboard-token']} ${body}`)
    res.writeHead(204).end()
  })
  const app = http.createServer((req, res) => {
    void proxyHub(req, res, port, '/p', lanFor(req.headers, port, 's', ['mac.tail1.ts.net']), async () => [
      { port: (up.address() as AddressInfo).port, hubToken: 'tok', workspace: '/p', mtimeMs: 1, pid: process.pid },
      { port: (up2.address() as AddressInfo).port, hubToken: 'tok2', workspace: '/q', mtimeMs: 2, pid: process.pid },
    ])
  })
  const call = (host: string, method: string, path: string, body?: string) => new Promise<{ status: number; body: string }>((ok, fail) => {
    const r = http.request({ host: '127.0.0.1', port, method, path, headers: { Host: host, 'X-Switchboard': '1', Origin: host.endsWith('.ts.net') ? `https://${host}` : `http://${host}`, 'Content-Type': 'application/json' } }, x => {
      let b = ''
      x.on('data', c => { b += c })
      x.on('end', () => ok({ status: x.statusCode ?? 0, body: b }))
    })
    r.on('error', fail)
    r.end(body)
  })
  const start = (s: http.Server) => new Promise<void>(ok => s.listen(0, '127.0.0.1', () => ok()))
  const hosts = () => [`127.0.0.1:${port}`, 'mac.tail1.ts.net']

  it('starts', async () => { await start(up); await start(up2); await start(app); port = (app.address() as AddressInfo).port })

  it('takes a signed-in phone Send and upload over plain http, on the full and short name', async () => {
    const secret = 'a'.repeat(64)
    const { names, plain } = lanNames({ tailscale: 'mac.tail1.ts.net', https: false })
    // As server.ts: gate, then the proxy; tailscale serve adds x-forwarded-for.
    const phone = http.createServer((req, res) => {
      const lan = lanFor(req.headers, port, secret, names, plain)
      if (lanGate(req.headers, req.url ?? '/', port, lan) !== 'ok') { res.writeHead(401).end(); return }
      void proxyHub(req, res, port, '/p', lan, async () => [{ port: (up.address() as AddressInfo).port, hubToken: 'tok', workspace: '/p', mtimeMs: 1, pid: process.pid }])
    })
    await start(phone)
    const post = (host: string, path: string, body: string, cookie = true) => new Promise<number>((ok, fail) => {
      const r = http.request({ host: '127.0.0.1', port: (phone.address() as AddressInfo).port, method: 'POST', path, headers: { Host: host, 'X-Switchboard': '1', Origin: `http://${host}`, 'X-Forwarded-For': '100.1.2.3', 'Content-Type': 'application/json', ...(cookie ? { Cookie: `sb${port}=${secret}` } : {}) } }, x => { x.resume(); ok(x.statusCode ?? 0) })
      r.on('error', fail)
      r.end(body)
    })
    try {
      for (const host of ['mac.tail1.ts.net', 'mac']) {
        hops.length = 0
        assert.equal(await post(host, '/hub/command', JSON.stringify({ type: 'hub-send', sessionId: 's1', text: 'hi' })), 204, host)
        assert.equal(hops.at(-1)?.url, '/hub/command', host)
        assert.equal(await post(host, '/hub/upload?cwd=/p&name=a.txt', 'file body'), 204, host)
        assert.equal(await post(host, '/hub/command', '{"type":"hub-send"}', false), 401, host)
      }
    } finally { phone.close() }
  })

  it('hands the to-do lists, ticked and sync included, to every path', async () => {
    for (const host of hosts()) {
      const r = await call(host, 'GET', '/hub/state')
      assert.equal(r.status, 200, host)
      assert.deepEqual(JSON.parse(r.body).todos, todos, host)
    }
  })

  it('refuses a spoken Jarvis question from the phone, and takes it from the Mac', async () => {
    const body = JSON.stringify({ type: 'hub-jarvis', q: 'hi', voice: true })
    assert.equal((await call('mac.tail1.ts.net', 'POST', '/hub/command', body)).status, 403)
    assert.equal((await call('mac.tail1.ts.net', 'POST', '/hub/command', JSON.stringify({ type: 'hub-jarvis', q: 'hi' }))).status, 204)
    assert.equal((await call(`127.0.0.1:${port}`, 'POST', '/hub/command', body)).status, 204)
  })

  it('passes the mic read on with the window token, and only to the page itself', async () => {
    hops.length = 0; tokens.length = 0
    assert.equal((await call(`127.0.0.1:${port}`, 'GET', '/hub/voice?token=evil')).status, 204)
    assert.deepEqual([hops.map(h => h.url), tokens], [['/hub/voice'], ['tok']])
    const bare = await new Promise<number>(ok => http.request({ host: '127.0.0.1', port, path: '/hub/voice', headers: { Host: `127.0.0.1:${port}` } }, x => { x.resume(); ok(x.statusCode ?? 0) }).end())
    assert.equal(bare, 403)
  })

  it('passes the memory graph on with the window token in a header, and only to the page itself', async () => {
    hops.length = 0; tokens.length = 0
    assert.equal((await call(`127.0.0.1:${port}`, 'GET', '/hub/graph')).status, 204)
    assert.deepEqual([hops.map(h => h.url), tokens], [['/hub/graph'], ['tok']])
    const bare = await new Promise<number>(ok => http.request({ host: '127.0.0.1', port, path: '/hub/graph', headers: { Host: `127.0.0.1:${port}` } }, x => { x.resume(); ok(x.statusCode ?? 0) }).end())
    assert.equal(bare, 403)
  })

  it("passes a role's runs on with only the chat and role, and the window token", async () => {
    hops.length = 0
    assert.equal((await call(`127.0.0.1:${port}`, 'GET', '/hub/runs?session=s-1&role=qa&token=evil&x=1')).status, 204)
    assert.deepEqual(hops.map(h => h.url), ['/hub/runs?session=s-1&role=qa'])
    const bare = await new Promise<number>(ok => http.request({ host: '127.0.0.1', port, path: '/hub/runs?session=s&role=qa', headers: { Host: `127.0.0.1:${port}` } }, x => { x.resume(); ok(x.statusCode ?? 0) }).end())
    assert.equal(bare, 403)
  })

  it('passes the chat view reads on with only their own fields, GET only', async () => {
    hops.length = 0
    for (const q of ['/hub/chat/outputs?session=s-1&token=evil', '/hub/chat/transcript?session=s-1&before=99&x=1', '/hub/chat/shot?session=s-1&path=%2Fa%2Fb.png']) {
      assert.equal((await call(`127.0.0.1:${port}`, 'GET', q)).status, 204, q)
    }
    assert.deepEqual(hops.map(h => h.url), ['/hub/chat/outputs?session=s-1', '/hub/chat/transcript?session=s-1&before=99', '/hub/chat/shot?session=s-1&path=%2Fa%2Fb.png'])
    assert.equal((await call(`127.0.0.1:${port}`, 'POST', '/hub/chat/outputs?session=s-1', '{}')).status, 404)
    assert.equal((await call(`127.0.0.1:${port}`, 'GET', '/hub/chat/other?session=s-1')).status, 404)
  })

  it('passes every to-do command the panel sends, unchanged, with the window token added', async () => {
    const cmds = [
      { type: 'hub-todo-add', path: '/p', text: 'x' },
      { type: 'hub-todo-edit', path: '/p', id: 'a', text: 'y' },
      { type: 'hub-todo-remove', path: '/p', id: 'a' },
      { type: 'hub-todo-restore', path: '/p', id: 'b' },
      { type: 'hub-todo-run', path: '/p', ids: ['a'] },
      { type: 'hub-todo-run', path: '/p', ids: ['a'], to: 's1' },
      { type: 'hub-todo-sync', path: '/p', on: true },
    ]
    for (const host of hosts()) for (const c of cmds) {
      hops.length = 0; tokens.length = 0
      const r = await call(host, 'POST', '/hub/command', JSON.stringify(c))
      assert.equal(r.status, 204, `${host} ${c.type}`)
      assert.deepEqual([hops, tokens], [[{ method: 'POST', url: '/hub/command', body: JSON.stringify(c) }], ['tok']], `${host} ${c.type}`)
    }
  })

  it('still refuses a to-do command from another site or without the header', async () => {
    hops.length = 0
    const evil = await new Promise<number>(ok => http.request({ host: '127.0.0.1', port, method: 'POST', path: '/hub/command', headers: { Host: `127.0.0.1:${port}`, 'X-Switchboard': '1', Origin: 'http://evil.test' } }, x => { x.resume(); ok(x.statusCode ?? 0) }).end('{"type":"hub-todo-run","path":"/p","ids":["a"]}'))
    const bare = await new Promise<number>(ok => http.request({ host: '127.0.0.1', port, method: 'POST', path: '/hub/command', headers: { Host: `127.0.0.1:${port}` } }, x => { x.resume(); ok(x.statusCode ?? 0) }).end('{"type":"hub-todo-run","path":"/p","ids":["a"]}'))
    assert.deepEqual([evil, bare, hops.length], [403, 403, 0])
  })

  it('refuses Mac-only commands from the phone with a short reason, and runs them from the Mac', async () => {
    const save = JSON.stringify({ type: 'hub-key-save', name: 'OPENAI_API_KEY', value: 'x' })
    const ship = JSON.stringify({ type: 'hub-git', sessionId: 'nobody', op: 'ship' })
    for (const c of [save, ship]) {
      hops.length = 0
      const r = await call('mac.tail1.ts.net', 'POST', '/hub/command', c)
      assert.deepEqual([r.status, hops.filter(h => h.url === '/hub/command').length], [403, 0], c)
      assert.match(r.body, /Mac/)
      // tailscale serve comes in on loopback: its headers alone mark the phone.
      const r2 = await new Promise<number>(ok => http.request({ host: '127.0.0.1', port, method: 'POST', path: '/hub/command', headers: { Host: `127.0.0.1:${port}`, 'X-Switchboard': '1', 'X-Forwarded-For': '100.1.2.3' } }, x => { x.resume(); ok(x.statusCode ?? 0) }).end(c))
      assert.equal(r2, 403, c)
      assert.equal((await call(`127.0.0.1:${port}`, 'POST', '/hub/command', c)).status, 204, c)
    }
  })

  it('sends a command to the window holding its folder, on every path', async () => {
    const run = JSON.stringify({ type: 'hub-todo-run', path: '/q/web', ids: ['a'] })
    for (const host of hosts()) {
      hops.length = 0; other.length = 0
      assert.equal((await call(host, 'POST', '/hub/command', run)).status, 204, host)
      assert.deepEqual([hops.length, other], [0, [`/hub/command tok2 ${run}`]], host)
    }
  })

  it('sends a chat command to the window holding that chat, else the usual window', async () => {
    const send = (id: string) => JSON.stringify({ type: 'hub-send', sessionId: id, text: 'hi' })
    for (const host of hosts()) {
      hops.length = 0; other.length = 0
      assert.equal((await call(host, 'POST', '/hub/command', send('s2'))).status, 204, host)
      assert.deepEqual([hops.filter(h => h.url?.startsWith('/hub/command')).length, other], [0, [`/hub/command tok2 ${send('s2')}`]], host)
      hops.length = 0; other.length = 0
      assert.equal((await call(host, 'POST', '/hub/command', send('s9'))).status, 204, host)
      assert.deepEqual([hops.filter(h => h.url?.startsWith('/hub/command')).map(h => h.body), other], [[send('s9')], []], host)
    }
  })

  const getState = (headers: Record<string, string>) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((ok, fail) => {
    const r = http.request({ host: '127.0.0.1', port, method: 'GET', path: '/hub/state', headers: { Host: `127.0.0.1:${port}`, 'X-Switchboard': '1', ...headers } }, x => {
      const parts: Buffer[] = []
      x.on('data', c => parts.push(c))
      x.on('end', () => ok({ status: x.statusCode ?? 0, headers: x.headers, body: Buffer.concat(parts) }))
    })
    r.on('error', fail)
    r.end()
  })

  it('gzips the state when the browser takes it, and sends it plain when not', async () => {
    const z = await getState({ 'Accept-Encoding': 'gzip, deflate, br' })
    assert.equal(z.headers['content-encoding'], 'gzip')
    assert.deepEqual(JSON.parse(zlib.gunzipSync(z.body).toString()).todos, todos)
    const plain = await getState({})
    assert.equal(plain.headers['content-encoding'], undefined)
    assert.deepEqual(JSON.parse(plain.body.toString()).todos, todos)
    assert.equal(z.headers.etag, plain.headers.etag)
  })

  it('answers 304 with no body on a matching ETag, and a new ETag once the state changes', async () => {
    const first = await getState({ 'Accept-Encoding': 'gzip' })
    const tag = String(first.headers.etag)
    assert.match(tag, /^"[0-9a-f]+"$/)
    const same = await getState({ 'Accept-Encoding': 'gzip', 'If-None-Match': tag })
    assert.deepEqual([same.status, same.body.length, same.headers.etag], [304, 0, tag])
    stamp = 1
    const changed = await getState({ 'If-None-Match': tag })
    assert.equal(changed.status, 200)
    assert.notEqual(changed.headers.etag, tag)
    assert.equal(JSON.parse(changed.body.toString()).stamp, 1)
    stamp = 0
  })

  it('stops', () => { app.close(); up.close(); up2.close() })
})

describe('proxyHub upstream dying', () => {
  it('ends the client instead of leaving it hanging when the window dies mid-body', async () => {
    const up = http.createServer((req, res) => { req.resume(); res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"part'); setTimeout(() => res.socket?.destroy(), 50) })
    await new Promise<void>(ok => up.listen(0, '127.0.0.1', ok))
    const upPort = (up.address() as AddressInfo).port
    const app = http.createServer((req, res) => {
      void proxyHub(req, res, (app.address() as AddressInfo).port, '/tmp', undefined, async () => [{ port: upPort, hubToken: 't', workspace: '/tmp', mtimeMs: 1 }])
    })
    await new Promise<void>(ok => app.listen(0, '127.0.0.1', ok))
    const port = (app.address() as AddressInfo).port
    const done = await new Promise<string>(ok => {
      const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/hub/command', headers: { 'X-Switchboard': '1', Host: `127.0.0.1:${port}` } }, x => {
        x.resume()
        x.on('end', () => ok('end'))
        x.on('error', () => ok('error'))
        x.on('aborted', () => ok('aborted'))
      })
      r.on('error', () => ok('error'))
      r.end('{"type":"x"}')
      setTimeout(() => ok('hang'), 2000)
    })
    // Drop any held socket, so a regression fails the test instead of hanging the run.
    app.closeAllConnections(); up.closeAllConnections(); app.close(); up.close()
    assert.notEqual(done, 'hang')
  })
})

describe('proxyHub upload', () => {
  const got: Array<{ url?: string; body: Buffer; token?: string | string[] }> = []
  let aborted = 0
  const up = http.createServer(async (req, res) => {
    const parts: Buffer[] = []
    try { for await (const c of req) parts.push(c as Buffer) } catch { aborted++; return }
    got.push({ url: req.url, body: Buffer.concat(parts), token: req.headers['x-switchboard-token'] })
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"path":"/u/x.bin"}')
  })
  up.on('clientError', () => { aborted++ })
  let port = 0
  const app = http.createServer((req, res) => {
    void proxyHub(req, res, port, '/p', undefined, async () => [{ port: (up.address() as AddressInfo).port, hubToken: 'tok', workspace: '/p', mtimeMs: 1, pid: process.pid }])
  })
  const send = (headers: Record<string, string | number>, write: (r: http.ClientRequest) => void, path = '/hub/upload?cwd=%2Fp%2Fweb&name=x.bin&session=s1&token=evil') => new Promise<{ status: number; body: string }>(ok => {
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path, headers: { Host: `127.0.0.1:${port}`, ...headers } }, x => {
      let b = ''
      x.on('data', c => { b += c })
      x.on('end', () => ok({ status: x.statusCode ?? 0, body: b }))
    })
    r.on('error', () => ok({ status: 0, body: '' }))
    write(r)
  })
  it('starts', async () => {
    await new Promise<void>(ok => up.listen(0, '127.0.0.1', ok))
    await new Promise<void>(ok => app.listen(0, '127.0.0.1', ok))
    port = (app.address() as AddressInfo).port
  })
  it('streams the bytes through unchanged, with the window token in place of any the page sent', async () => {
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i))
    got.length = 0
    const r = await send({ 'X-Switchboard': '1' }, x => x.end(bytes))
    assert.deepEqual([r.status, r.body], [200, '{"path":"/u/x.bin"}'])
    assert.equal(got.length, 1)
    assert.ok(got[0].body.equals(bytes))
    const q = new URL(got[0].url!, 'http://x').searchParams
    assert.deepEqual([q.get('cwd'), q.get('name'), q.get('session'), q.getAll('token'), got[0].token], ['/p/web', 'x.bin', 's1', [], 'tok'])
  })
  it('refuses an upload without the header or from another site', async () => {
    got.length = 0
    assert.equal((await send({}, x => x.end('x'))).status, 403)
    assert.equal((await send({ 'X-Switchboard': '1', Origin: 'http://evil.test' }, x => x.end('x'))).status, 403)
    assert.equal(got.length, 0)
  })
  it('answers 413 for a declared size over 100 MB without passing it on', async () => {
    got.length = 0
    const r = await send({ 'X-Switchboard': '1', 'Content-Length': 100 * 1024 * 1024 + 1 }, x => x.write('x'))
    assert.equal(r.status, 413)
    assert.equal(got.length, 0)
  })
  it('cuts a chunked upload off at 100 MB and the window never finishes it', async () => {
    got.length = 0
    const mb = Buffer.alloc(1024 * 1024)
    const r = await send({ 'X-Switchboard': '1' }, x => {
      let n = 0
      const more = () => { while (n < 102) { n++; if (!x.write(mb)) { x.once('drain', more); return } } x.end() }
      x.on('error', () => {})
      more()
    })
    assert.equal(r.status, 413)
    await new Promise(ok => setTimeout(ok, 100))
    assert.equal(got.length, 0)
  })
  it('stops', () => { app.closeAllConnections(); up.closeAllConnections(); app.close(); up.close() })
})

describe('proxyHub voice clip', () => {
  const got: Array<{ url?: string; body: Buffer; type?: string; token?: string | string[] }> = []
  const up = http.createServer(async (req, res) => {
    const parts: Buffer[] = []
    for await (const c of req) parts[parts.length] = c as Buffer
    got[got.length] = { url: req.url, body: Buffer.concat(parts), type: req.headers['content-type'], token: req.headers['x-switchboard-token'] }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"text":"hi"}')
  })
  let port = 0
  const app = http.createServer((req, res) => {
    void proxyHub(req, res, port, '/p', undefined, async () => [{ port: (up.address() as AddressInfo).port, hubToken: 'tok', workspace: '/p', mtimeMs: 1, pid: process.pid }])
  })
  const send = (headers: Record<string, string>, body: Buffer) => new Promise<{ status: number; body: string }>(ok => {
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/hub/voice?token=evil', headers: { Host: `127.0.0.1:${port}`, ...headers } }, x => {
      let b = ''
      x.on('data', c => { b += c })
      x.on('end', () => ok({ status: x.statusCode ?? 0, body: b }))
    })
    r.on('error', () => ok({ status: 0, body: '' }))
    r.end(body)
  })
  it('starts', async () => {
    await new Promise<void>(ok => up.listen(0, '127.0.0.1', ok))
    await new Promise<void>(ok => app.listen(0, '127.0.0.1', ok))
    port = (app.address() as AddressInfo).port
  })
  it('passes the clip bytes and type through with the window token', async () => {
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i))
    got.length = 0
    const r = await send({ 'X-Switchboard': '1', 'Content-Type': 'audio/webm' }, bytes)
    assert.deepEqual([r.status, r.body], [200, '{"text":"hi"}'])
    assert.ok(got[0].body.equals(bytes))
    assert.deepEqual([got[0].url, got[0].type, got[0].token], ['/hub/voice', 'audio/webm', 'tok'])
  })
  it('refuses without the header, and a clip over 5 MB', async () => {
    got.length = 0
    assert.equal((await send({ 'Content-Type': 'audio/webm' }, Buffer.from('x'))).status, 403)
    assert.equal((await send({ 'X-Switchboard': '1', 'Content-Type': 'audio/webm' }, Buffer.alloc(5 * 1024 * 1024 + 1))).status, 413)
    assert.equal(got.length, 0)
  })
  it('stops', () => { app.closeAllConnections(); up.closeAllConnections(); app.close(); up.close() })
})
