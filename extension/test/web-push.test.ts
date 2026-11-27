import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { addSubscription, encrypt, sendPush, vapidKeys } from '../src/hub/web-push'

const b64 = (s: string) => Buffer.from(s, 'base64url')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'push-'))

// RFC 8291 Appendix A
const RFC = {
  plain: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

describe('web push encrypt', () => {
  it('matches the RFC 8291 test vector', () => {
    const out = encrypt(Buffer.from(RFC.plain), RFC.uaPublic, RFC.auth, { salt: b64(RFC.salt), asPrivate: b64(RFC.asPrivate) })
    assert.equal(out.toString('base64url'), RFC.body)
  })
  it('decrypts back with the phone key', () => {
    const ua = crypto.createECDH('prime256v1'); ua.generateKeys()
    const auth = crypto.randomBytes(16)
    const out = encrypt(Buffer.from('hi'), ua.getPublicKey('base64url'), auth.toString('base64url'))
    const salt = out.subarray(0, 16), as = out.subarray(21, 86)
    const ikm = Buffer.from(crypto.hkdfSync('sha256', ua.computeSecret(as), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), as]), 32))
    const key = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
    const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
    const d = crypto.createDecipheriv('aes-128-gcm', key, nonce)
    d.setAuthTag(out.subarray(-16))
    assert.equal(Buffer.concat([d.update(out.subarray(86, -16)), d.final()]).toString(), 'hi\u0002')
  })
})

describe('web push store', () => {
  it('makes VAPID keys once, mode 600', () => {
    const dir = tmp()
    const a = vapidKeys(dir), b = vapidKeys(dir)
    assert.equal(a.publicKey, b.publicKey)
    assert.equal(b64(a.publicKey).length, 65)
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'vapid.json')).mode & 0o777, 0o600)
  })
  it('dedupes by endpoint and refuses junk', () => {
    const dir = tmp()
    const sub = { endpoint: 'https://web.push.apple.com/1', keys: { p256dh: 'p', auth: 'a' } }
    assert.equal(addSubscription(sub, dir), true)
    assert.equal(addSubscription({ ...sub, keys: { p256dh: 'p2', auth: 'a2' } }, dir), true)
    assert.equal(addSubscription({ endpoint: 'http://web.push.apple.com/2', keys: { p256dh: 'p', auth: 'a' } }, dir), false)
    assert.equal(addSubscription({ endpoint: 'https://x' }, dir), false)
    assert.equal(addSubscription({ endpoint: 'https://localhost/x', keys: { p256dh: 'p', auth: 'a' } }, dir), false)
    assert.equal(addSubscription('nope', dir), false)
    const list = JSON.parse(fs.readFileSync(path.join(dir, 'push.json'), 'utf8'))
    assert.deepEqual(list, [{ endpoint: 'https://web.push.apple.com/1', keys: { p256dh: 'p2', auth: 'a2' } }])
  })
})

describe('sendPush', () => {
  it('posts to each phone and drops the ones that are gone', async () => {
    const dir = tmp()
    const ua = crypto.createECDH('prime256v1'); ua.generateKeys()
    const keys = { p256dh: ua.getPublicKey('base64url'), auth: crypto.randomBytes(16).toString('base64url') }
    addSubscription({ endpoint: 'https://web.push.apple.com/live', keys }, dir)
    addSubscription({ endpoint: 'https://web.push.apple.com/gone', keys }, dir)
    const seen: { url: string; headers: Record<string, string> }[] = []
    const fake = async (url: string, init: { headers: Record<string, string> }) => {
      seen.push({ url, headers: init.headers })
      return { status: url.endsWith('gone') ? 410 : 201 }
    }
    await sendPush('AWS', 'ends soon', { dir, fetch: fake })
    assert.equal(seen.length, 2)
    assert.match(seen[0].headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/)
    assert.equal(seen[0].headers['Content-Encoding'], 'aes128gcm')
    const left = JSON.parse(fs.readFileSync(path.join(dir, 'push.json'), 'utf8'))
    assert.deepEqual(left.map((s: { endpoint: string }) => s.endpoint), ['https://web.push.apple.com/live'])
  })
  it('never throws', async () => {
    const dir = tmp()
    addSubscription({ endpoint: 'https://web.push.apple.com/1', keys: { p256dh: 'bad', auth: 'bad' } }, dir)
    await sendPush('AWS', 'x', { dir, fetch: async () => { throw new Error('down') } })
    await sendPush('AWS', 'x', { dir: path.join(dir, 'missing') })
  })
})
