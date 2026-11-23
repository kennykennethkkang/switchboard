import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deviceMailto, validEmail } from './device-mail'

const link = 'https://mac.tail1.ts.net/?k=' + 'a'.repeat(64)

test('validEmail checks the shape', () => {
  assert.ok(validEmail('me@example.com'))
  assert.ok(validEmail(' me@example.com '))
  for (const bad of ['', 'me', 'me@', 'me@x', 'a b@x.com', 'a@b.com,c@d.com']) assert.ok(!validEmail(bad), bad)
})

test('deviceMailto holds the encoded link and the steps', () => {
  const u = deviceMailto('me@example.com', link)!
  assert.ok(u.startsWith('mailto:me%40example.com?subject='))
  const body = new URLSearchParams(u.split('?')[1]).get('body')!
  assert.ok(body.includes(link))
  assert.match(body, /Tailscale/)
  assert.ok(!u.includes('&k='))
})

test('no link or a bad address gives no draft', () => {
  assert.equal(deviceMailto('me@example.com', undefined), undefined)
  assert.equal(deviceMailto('nope', link), undefined)
})
