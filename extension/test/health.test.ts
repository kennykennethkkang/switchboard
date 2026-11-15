import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkHealth, fixHealth, type HealthDeps } from '../src/hub/health'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'health-'))
const kit = path.join(home, 'kit')
const put = (f: string, body: string) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body) }
put(path.join(kit, 'mods', 'tab-close', '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '0.1.4' }))
put(path.join(kit, 'mods', 'chat-wait', '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '0.2.0' }))
put(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'tab-close@kenneth-mods': [{ version: '0.1.3' }] } }))
put(path.join(home, '.claude.json'), '{"mcpServers":{}}')

const ran: string[][] = []
let synced = false
const deps = (o: Partial<HealthDeps> = {}): HealthDeps => ({
  home, kit, mods: ['tab-close', 'chat-wait'],
  ports: () => [4000], reach: async p => p === 4000,
  onPath: c => c === 'claude',
  sync: write => { if (write) synced = true; return synced ? [] : ['CLAUDE.md (older)'] },
  run: async (...a) => { ran.push(a); return true },
  ...o,
})
const by = (r: Awaited<ReturnType<typeof checkHealth>>) => Object.fromEntries(r.map(x => [x.id, x]))

test('each check reports its status and fixable flag', async () => {
  const r = by(await checkHealth(deps()))
  assert.equal(r.hook.status, 'ok')
  assert.equal(r.hub.status, 'ok')
  assert.equal(r.kit.status, 'warn')
  assert.equal(r.kit.fixable, true)
  assert.equal(r['mod:tab-close'].status, 'warn')
  assert.equal(r['mod:tab-close'].fixable, true)
  assert.equal(r['mod:chat-wait'].status, 'warn')
  assert.equal(r.claude.status, 'ok')
  assert.equal(r.codex.status, 'warn')
  assert.equal(r.codex.fixable, false)
  assert.equal(r.mcp.status, 'ok')
})

test('unreachable port fails, broken mcp json fails, no claude fails', async () => {
  put(path.join(home, '.claude.json'), '{bad')
  const r = by(await checkHealth(deps({ reach: async () => false, onPath: () => false })))
  assert.equal(r.hook.status, 'fail')
  assert.equal(r.hub.status, 'fail')
  assert.equal(r.mcp.status, 'fail')
  assert.equal(r.claude.status, 'fail')
  assert.equal(r.hook.fixable, false)
  put(path.join(home, '.claude.json'), '{}')
})

test('fix reruns only fixable ones and returns a fresh check', async () => {
  const out = await fixHealth(['kit', 'mod:tab-close', 'codex', 'hook'], deps())
  assert.equal(synced, true)
  const cmds = ran.map(a => a.join(' '))
  assert.ok(cmds.some(c => /plugin update tab-close@kenneth-mods/.test(c)))
  assert.ok(!cmds.some(c => /chat-wait/.test(c)))
  assert.equal(by(out).kit.status, 'ok')
})

test('empty ids fix every fixable result', async () => {
  ran.length = 0
  await fixHealth([], deps())
  const cmds = ran.map(a => a.join(' '))
  assert.ok(cmds.some(c => /chat-wait@kenneth-mods/.test(c)))
})
