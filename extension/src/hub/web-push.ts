/**
 * Web Push to the phone's home-screen Switchboard app: VAPID (RFC 8292) and aes128gcm (RFC 8291) on Node crypto.
 * The app stores subscriptions, any window sends. Best effort: nothing here throws at the caller.
 */
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { readJsonOr } from '../fs-utils'

export const PUSH_DIR = path.join(os.homedir(), '.claude', 'switchboard')

type Sub = { endpoint: string; keys: { p256dh: string; auth: string } }
type Vapid = { publicKey: string; privateKey: string }
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: Buffer }) => Promise<{ status: number }>

const b64 = (s: string) => Buffer.from(s, 'base64url')
const subs = (dir: string): Sub[] => { const v = readJsonOr(path.join(dir, 'push.json')); return Array.isArray(v) ? v : [] }
const saveSubs = (dir: string, list: Sub[]) => fs.writeFileSync(path.join(dir, 'push.json'), JSON.stringify(list, null, 2) + '\n', { mode: 0o600 })

/** P-256 keys made once; wx so two windows racing keep the first. */
export function vapidKeys(dir = PUSH_DIR): Vapid {
  const file = path.join(dir, 'vapid.json')
  const have = readJsonOr(file) as Vapid | undefined
  if (have?.publicKey && have.privateKey) return have
  const e = crypto.createECDH('prime256v1'); e.generateKeys()
  const keys = { publicKey: e.getPublicKey('base64url'), privateKey: e.getPrivateKey('base64url') }
  fs.mkdirSync(dir, { recursive: true })
  try { fs.writeFileSync(file, JSON.stringify(keys) + '\n', { mode: 0o600, flag: 'wx' }) } catch { return readJsonOr(file) as Vapid }
  return keys
}

// Browser push services only, so a signed-in client cannot point pushes at the tailnet.
const PUSH_HOST = /^(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[\w-]+\.notify\.windows\.com)$/

/** Keeps one entry per endpoint, newest keys win. false for anything that is not an https push subscription. */
export function addSubscription(v: unknown, dir = PUSH_DIR): boolean {
  const s = v as Sub
  if (typeof s?.endpoint !== 'string' || s.endpoint.length > 1024 || typeof s.keys?.p256dh !== 'string' || typeof s.keys.auth !== 'string') return false
  try { const u = new URL(s.endpoint); if (u.protocol !== 'https:' || !PUSH_HOST.test(u.hostname)) return false } catch { return false }
  const sub = { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }
  fs.mkdirSync(dir, { recursive: true })
  saveSubs(dir, [...subs(dir).filter(x => x.endpoint !== sub.endpoint), sub])
  return true
}

/** RFC 8291 body, one record. opts: fixed salt and sender key for the RFC test vector. */
export function encrypt(payload: Buffer, p256dh: string, auth: string, opts: { salt?: Buffer; asPrivate?: Buffer } = {}): Buffer {
  const salt = opts.salt ?? crypto.randomBytes(16)
  const as = crypto.createECDH('prime256v1')
  if (opts.asPrivate) as.setPrivateKey(opts.asPrivate); else as.generateKeys()
  const ua = b64(p256dh), asPub = as.getPublicKey()
  const ikm = Buffer.from(crypto.hkdfSync('sha256', as.computeSecret(ua), b64(auth), Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub]), 32))
  const key = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const c = crypto.createCipheriv('aes-128-gcm', key, nonce)
  const body = Buffer.concat([c.update(Buffer.concat([payload, Buffer.from([2])])), c.final(), c.getAuthTag()])
  const head = Buffer.alloc(21); salt.copy(head); head.writeUInt32BE(4096, 16); head[20] = asPub.length
  return Buffer.concat([head, asPub, body])
}

function vapidJwt(endpoint: string, v: Vapid): string {
  const pub = b64(v.publicKey)
  const key = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: v.privateKey, x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') } })
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  // Apple refuses a localhost sub; the repo URL is a real https contact.
  const data = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://github.com/kennykennethkkang/switchboard' })}`
  return `${data}.${crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
}

/** Every subscribed phone gets { title, body }; a 404 or 410 means the phone unsubscribed, so it is dropped. */
export async function sendPush(title: string, body: string, opts: { dir?: string; fetch?: Fetch } = {}): Promise<void> {
  try {
    const dir = opts.dir ?? PUSH_DIR
    const list = subs(dir)
    if (!list.length) return
    const v = vapidKeys(dir)
    const send = opts.fetch ?? (globalThis.fetch as unknown as Fetch)
    const payload = Buffer.from(JSON.stringify({ title, body }))
    const gone = new Set<string>()
    await Promise.all(list.map(async s => {
      try {
        const r = await send(s.endpoint, { method: 'POST', body: encrypt(payload, s.keys.p256dh, s.keys.auth), headers: {
          Authorization: `vapid t=${vapidJwt(s.endpoint, v)}, k=${v.publicKey}`,
          'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'high',
        } })
        if (r.status === 404 || r.status === 410) gone.add(s.endpoint)
      } catch { /* this phone missed it */ }
    }))
    // Reread: a phone may have subscribed while these were in flight.
    if (gone.size) saveSubs(dir, subs(dir).filter(s => !gone.has(s.endpoint)))
  } catch { /* no keys dir or a bad file: no push */ }
}
