import { test } from 'node:test'
import assert from 'node:assert/strict'
import { armoryList, gardenList, keepGraph, keyList, memoryTally, studyList, todoList, towerList, uploadList, uploadSummary, withDemoLearn } from './court-places'
import { demoGraph } from './memory-graph'
import { emptyHub } from './hub-demo'
import type { HubState } from './hub-types'

const hub = (over: Partial<HubState>): HubState => ({ ...emptyHub(), ...over })

test('memory tally counts by kind, issues and the newest notes', () => {
  const t = memoryTally(demoGraph())
  assert.deepEqual(t.counts, { memory: 8, wiki: 1, raw: 1, rule: 1 })
  assert.deepEqual(t.issues, { contradictions: 1, stale: 0, dangling: 1 })
  assert.equal(t.recent[0].label, 'hub-recall')
  assert.ok(t.recent.every(n => n.kind === 'memory' || n.kind === 'wiki'))
  assert.ok(!t.recent.some(n => n.superseded))
})

test('armory names enabled tools and MCPs, skips roles and disabled ones', () => {
  const l = armoryList(hub({
    installed: [{ kind: 'skill', name: 'aar', enabled: true }, { kind: 'plugin', name: 'ponytail', enabled: true }, { kind: 'mod', name: 'usage-meter', enabled: true },
      { kind: 'skill', name: 'off', enabled: false }, { kind: 'role', name: 'qa', enabled: true }],
    connections: [{ kind: 'mcp', name: 'playwright', status: 'on' }, { kind: 'mcp', name: 'github', status: 'error', detail: 'bad auth' }, { kind: 'app', name: 'x', status: 'on' }],
  }))
  assert.deepEqual(l.map(i => i.name), ['usage-meter', 'ponytail', 'aar', 'playwright', 'github'])
  assert.deepEqual(l.map(i => i.note), ['mod', 'plugin', 'skill', 'mcp', 'mcp, bad auth'])
  assert.equal(l.find(i => i.name === 'github')!.ok, false)
})

test('garden lists enabled roles not working right now', () => {
  const h = hub({ installed: [{ kind: 'role', name: 'qa', enabled: true }, { kind: 'role', name: 'engineer', enabled: true }, { kind: 'role', name: 'ops', enabled: false }] })
  assert.deepEqual(gardenList(h, new Set(['engineer'])).map(i => i.name), ['qa'])
})

test('to-do list: open items across projects with the project name', () => {
  const l = todoList(hub({ todos: { '/w/a': { todo: [{ id: '1', text: 'Ship logo', at: 2 }] }, '/w/b': { todo: [{ id: '2', text: 'Fix meter', at: 1, why: 'you' }] } } }))
  assert.deepEqual(l.map(i => [i.name, i.note]), [['Ship logo', 'a'], ['Fix meter', 'b, needs you']])
  assert.deepEqual(l.map(i => i.id), ['/w/a\n1', '/w/b\n2'])
})

test('tower: remote control, rc servers, phone and tailscale, never a link', () => {
  const l = towerList(hub({ rc: { atStartup: true }, rcServers: [{ folder: '/w', name: 'w', on: false }], tailscale: true, webUrl: 'http://secret' }))
  assert.deepEqual(l.map(i => [i.name, i.ok]), [['Remote Control at startup', true], ['Remote Control: w', false], ['Phone app', true], ['Tailscale', true]])
  assert.ok(!JSON.stringify(l).includes('secret'))
})

test('study: last learn run and proposals waiting', () => {
  const l = studyList(hub({ learn: { at: 5, kind: 'aar', what: 'aar on chat 1' }, learnReady: [{ id: 'p1', target: 'kit/rules.md', before: 0.5, after: 0.75, diff: '' }] }))
  assert.deepEqual(l.map(i => i.name), ['kit/rules.md', 'aar on chat 1'])
  assert.equal(l[0].note, '50% to 75%, waiting'); assert.equal(l[0].id, 'p1')
})

test('keys: names and ok or missing only, never a value', () => {
  const l = keyList(hub({
    signIns: { chrome: [], projects: {}, keys: [{ name: 'GEMINI_API_KEY', saved: true, last4: 'abcd', checked: { ok: false, at: 1 } }, { name: 'ZEP_API_KEY', saved: false }] },
    aws: [{ name: 'dev', isDefault: true, status: 'expired', checkedAt: 1 }, { name: 'prod', label: 'Work', isDefault: false, status: 'signed-in', checkedAt: 1 }],
  }))
  assert.deepEqual(l.map(i => [i.name, i.note, i.ok]), [['GEMINI_API_KEY', 'failed test', false], ['ZEP_API_KEY', 'missing', false], ['AWS dev', 'expired', false], ['AWS Work (prod)', 'signed-in', true]])
  assert.ok(!JSON.stringify(l).includes('abcd'))
})

test('a failed refresh keeps the last good graph and marks it stale', () => {
  const g = demoGraph()
  assert.deepEqual(keepGraph(undefined, 'down'), { graph: undefined, error: 'down' })
  assert.deepEqual(keepGraph({ graph: undefined, error: 'down' }, g), { graph: g })
  assert.deepEqual(keepGraph({ graph: g }, 'down'), { graph: g, error: 'down' })
})

test('demo learn: a run and a proposal until it is decided, never over real data', () => {
  const h = hub({})
  assert.deepEqual(studyList(withDemoLearn(h, [], 0)).map(i => i.id), ['demo-learn', undefined])
  assert.deepEqual(studyList(withDemoLearn(h, ['demo-learn'], 0)).map(i => i.id), [undefined])
  const real = hub({ learnReady: [{ id: 'r', target: 't', before: 0, after: 1, diff: '' }] })
  assert.equal(withDemoLearn(real, []), real)
})

test('uploads: newest first across projects, file name and chat only, a count summary', () => {
  const now = Date.parse('2026-11-08T12:00:00Z'), hr = 3_600_000
  const h = hub({ uploads: {
    app: { count: 7, last: [{ name: 'shot.png', at: now - 2 * hr, size: '1.2 KB', chat: 'Fix login (abc12345)' }] },
    web: { count: 1, last: [{ name: '/Users/me/secret/plan.pdf', at: now - 5 * 60e3, size: '3 MB', chat: 'new chat' }] },
  } })
  const l = uploadList(h, now)
  assert.deepEqual(l, [{ name: 'plan.pdf', note: 'new chat · 5 min ago', ok: true }, { name: 'shot.png', note: 'Fix login · 2 h ago', ok: true }])
  assert.ok(!JSON.stringify(l).includes('/Users'))
  assert.equal(uploadSummary(h), '8 uploads')
  assert.equal(uploadSummary(hub({ uploads: { a: { count: 1, last: [] } } })), '1 upload')
})

test('uploads: none, or an older extension with no field, gives nothing', () => {
  assert.deepEqual(uploadList(hub({})), [])
  assert.deepEqual(uploadList(hub({ uploads: {} })), [])
  assert.equal(uploadSummary(hub({})), undefined)
})
