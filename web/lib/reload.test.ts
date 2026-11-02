import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWatcher } from './reload'

/** Answers /index.js and /index.css with the current tags; null tags: the app is down mid restart. */
const server = (tags: { js: string; css: string } | null) => {
  const f = (async (url: string) => {
    if (!tags) throw new Error('down')
    return { headers: { get: (h: string) => (h === 'ETag' ? (url === '/index.js' ? tags.js : tags.css) : null) } }
  }) as unknown as typeof fetch
  return f
}

test('buildWatcher: reloads once the server serves files other than the ones this page loaded', async () => {
  let tags: { js: string; css: string } | null = { js: '"j1"', css: '"c1"' }
  let reloads = 0
  const tick = buildWatcher(() => reloads++, ((u: string, i?: RequestInit) => server(tags)(u, i)) as typeof fetch)
  await tick()
  await tick()
  assert.equal(reloads, 0)
  // Mid restart: no answer is not a new build.
  tags = null
  await tick()
  assert.equal(reloads, 0)
  tags = { js: '"j1"', css: '"c2"' }
  await tick()
  assert.equal(reloads, 1)
})

test('buildWatcher: a server down at load sets the baseline on its first answer', async () => {
  let tags: { js: string; css: string } | null = null
  let reloads = 0
  const tick = buildWatcher(() => reloads++, ((u: string, i?: RequestInit) => server(tags)(u, i)) as typeof fetch)
  await tick()
  tags = { js: '"j1"', css: '"c1"' }
  await tick()
  await tick()
  assert.equal(reloads, 0)
})
