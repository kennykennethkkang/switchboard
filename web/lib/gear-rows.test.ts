import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chatGroups, benchPrompt, blockHits, pauseValue, gearRows, keywordHit, roleModels, sweepBadge, sweepTip, sweptNow } from './gear-rows'
import type { Connection, Installed, SweepRecord } from './hub-types'
import { demoHub } from './hub-demo'

const installed: Installed[] = [
  { kind: 'plugin', name: 'superpowers@superpowers-dev', enabled: true, skills: ['brainstorming', 'writing-plans'] },
  // code-review and codex ship commands only (commands/*.md); installed() lists them with the skills.
  { kind: 'plugin', name: 'code-review@claude-plugins-official', enabled: true, skills: ['code-review'] },
  { kind: 'plugin', name: 'codex@openai-codex', enabled: true, skills: ['rescue', 'setup'] },
  { kind: 'plugin', name: 'github@claude-plugins-official', enabled: false },
  { kind: 'mod', name: 'usage-meter@kenneth-mods', enabled: true },
  { kind: 'skill', name: 'phone', enabled: true }, { kind: 'skill', name: 'skill-inspector', enabled: true },
  { kind: 'skill', name: 'drei', enabled: false },
  { kind: 'role', name: 'qa', enabled: true }, { kind: 'role', name: 'engineer', enabled: true },
  { kind: 'preset', name: 'armasu-copy-check', enabled: true },
]
const connections: Connection[] = [{ kind: 'mcp', name: 'openrouter', status: 'on' }, { kind: 'mcp', name: 'openrouter', status: 'on', detail: 'x' }, { kind: 'repo', name: 'r', status: 'on' }]
const rows = (q: string) => Object.fromEntries(gearRows({ installed, connections }, q).filter(r => r.match).map(r => [r.label, r.names]))

test('with no query every row lists all its names with a count', () => {
  const all = gearRows({ installed, connections }, '')
  assert.deepEqual(all.map(r => [r.label, r.hint]), [
    ['Roles', '2 roles'], ['Skills', '2 skills'], ['Archived skills', '1 skill'], ['Plugins', '4 plugins'], ['Mods', '1 mod'], ['MCP servers', '1 server'], ['Jev presets', '1 preset'],
  ])
  assert.deepEqual(rows('').Plugins, ['superpowers (2)', 'code-review (1)', 'codex (2)', 'github (off)'])
  assert.deepEqual(rows('')['MCP servers'], ['openrouter'])
})

test('a query shows only the rows and names that match', () => {
  assert.deepEqual(rows('inspector'), { Skills: ['skill-inspector'] })
  assert.deepEqual(rows('qa'), { Roles: ['qa'] })
  assert.deepEqual(rows('copy'), { 'Jev presets': ['armasu-copy-check'] })
  assert.deepEqual(rows('router'), { 'MCP servers': ['openrouter'] })
})

test('plugin skills match by name and in the plugin:skill form', () => {
  assert.deepEqual(rows('brainstorming'), { Plugins: ['superpowers (2): brainstorming'] })
  assert.deepEqual(rows('superpowers:brainstorming'), { Plugins: ['superpowers (2): brainstorming'] })
  assert.deepEqual(rows('code-review:code-review'), { Plugins: ['code-review (1): code-review'] })
  assert.deepEqual(rows('codex:rescue'), { Plugins: ['codex (2): rescue'] })
  assert.deepEqual(rows('superpowers'), { Plugins: ['superpowers (2)'] })
})

test('a query that names the row itself keeps the whole list', () => {
  assert.deepEqual(rows('roles').Roles, ['qa', 'engineer'])
})

test('role models: the frontmatter model, or the lead model for inherit and no line', () => {
  const roles: Installed[] = [
    { kind: 'role', name: 'qa', enabled: true, model: 'opus' }, { kind: 'role', name: 'ops', enabled: true, model: 'inherit' },
    { kind: 'role', name: 'growth', enabled: true }, { kind: 'skill', name: 'phone', enabled: true, model: 'haiku' },
  ]
  assert.deepEqual(roleModels(roles, 'sonnet'), { qa: 'opus', ops: 'sonnet', growth: 'sonnet' })
  assert.deepEqual(roleModels(roles), { qa: 'opus', ops: 'inherit', growth: 'inherit' })
})

test('a codex role shows its Codex model, else default', () => {
  const roles: Installed[] = [
    { kind: 'role', name: 'qa-codex', enabled: true, model: 'sonnet', codex: true, codexModel: 'gpt-6-luna', codexEffort: 'high' },
    { kind: 'role', name: 'engineer-codex', enabled: true, model: 'sonnet', codex: true, codexEffort: 'low' },
  ]
  assert.deepEqual(roleModels(roles, 'opus'), { 'qa-codex': 'gpt-6-luna', 'engineer-codex': 'codex default' })
})

test('the demo roles carry models', () => {
  const h = demoHub(0)
  const m = roleModels(h.installed, h.controls.claude.model)
  assert.equal(m.engineer, 'opus')
  assert.ok(Object.keys(m).length >= 5)
})

test('keywordHit matches a word start, not any letter inside', () => {
  const words = 'accounts sign-ins logins aws'
  assert.equal(keywordHit(words, 'acc'), true)
  assert.equal(keywordHit(words, 'aws'), true)
  assert.equal(keywordHit(words, 'sign'), true)
  assert.equal(keywordHit(words, 'o'), false)
  assert.equal(keywordHit(words, 'ins'), false)
  assert.equal(keywordHit(words, ''), false)
})

test('a swept plugin or skill shows its sweep badge; one with no result shows none', () => {
  const rec = (state: 'clean' | 'review', approvedAt?: number) => ({ kind: 'plugin' as const, path: '/p', digest: 'd', scannedAt: 1, state, ...(approvedAt ? { approvedAt, approvedDigest: 'd' } : {}) })
  const sweep = { busy: false, tools: { 'superpowers@superpowers-dev': rec('review'), 'codex@openai-codex': rec('review', 2), phone: { ...rec('clean'), kind: 'skill' as const } } }
  const r = Object.fromEntries(gearRows({ installed, connections, sweep }, '').map(x => [x.label, x.names]))
  assert.deepEqual(r.Plugins, ['superpowers (2, review)', 'code-review (1)', 'codex (2, approved)', 'github (off)'])
  assert.deepEqual(r.Skills, ['phone (clean)', 'skill-inspector'])
  assert.deepEqual(r.Mods, ['usage-meter'])
})

test('a human review quiets the sweep badge until the files change', () => {
  const rec: SweepRecord = { kind: 'plugin', path: '/p', digest: 'd1', scannedAt: 1, state: 'review', severity: 'CRITICAL', reviewed: { verdict: 'CAUTION', why: 'shells out to git', at: 2, digest: 'd1' } }
  assert.equal(sweepBadge(rec), 'Reviewed')
  assert.equal(sweepTip(rec), 'CAUTION: shells out to git')
  assert.equal(sweepBadge({ ...rec, digest: 'd2' }), 'Review')
  assert.equal(sweepTip({ ...rec, digest: 'd2' }), undefined)
  // A hold still needs Approve, so it keeps the Review badge and its button.
  assert.equal(sweepBadge({ ...rec, hold: true }), 'Review')
  assert.equal(sweepBadge({ ...rec, hold: true, approvedAt: 3, approvedDigest: 'd1' }), 'Approved')
  // An approval for older files does not count: Review and its Approve button come back.
  assert.equal(sweepBadge({ ...rec, digest: 'd2', reviewed: { ...rec.reviewed!, digest: 'd2' }, hold: true, approvedAt: 3, approvedDigest: 'd1' }), 'Review')
  const rows = gearRows({ installed: [{ kind: 'plugin', name: 'x@m', enabled: true, description: 'X tool' } as Installed], connections: [], sweep: { busy: false, tools: { 'x@m': rec } } }, '')
  const plugins = rows.find(r => r.label === 'Plugins')!
  assert.match(plugins.names[0], /\(reviewed\)/)
  assert.equal(plugins.tips[0], 'X tool. CAUTION: shells out to git')
})

test('Test models starts a chat that runs the model-bench skill', () => {
  assert.match(benchPrompt, /model-bench skill/)
  assert.match(benchPrompt, /recommended model per role/)
})

test('sweptNow: drops records for uninstalled tools and older plugin versions', () => {
  const rec = (path: string) => ({ kind: 'plugin', path, digest: 'd', scannedAt: 1, state: 'review' }) as SweepRecord
  const installed: Installed[] = [
    { kind: 'plugin', name: 'sg@m', enabled: true, path: '/c/sg/2.0.19' },
    { kind: 'plugin', name: 'ok@m', enabled: true, path: '/c/ok/1.0.0' },
    { kind: 'skill', name: 'gemini', enabled: true },
  ]
  const tools = { 'sg@m': rec('/c/sg/2.0.18'), 'ok@m': rec('/c/ok/1.0.0'), gemini: { ...rec('/s/gemini'), kind: 'skill' } as SweepRecord, 'gone@m': rec('/c/gone/1') }
  assert.deepEqual(sweptNow({ installed, sweep: { busy: false, tools } }).map(([n]) => n), ['ok@m', 'gemini'])
})

test('keywordHit matches a phrase by word starts', () => {
  assert.equal(keywordHit('sign-ins sign in logins', 'sign in'), true)
  assert.equal(keywordHit('sign-ins sign in logins', 'gn in'), false)
})

test('settings blocks that are not rows are found by their words', () => {
  const labels = (q: string) => blockHits(q).map(b => b.label)
  assert.deepEqual(labels('sweep'), ['Sweep'])
  assert.ok(labels('export').includes('Export kit'))
  assert.ok(labels('set up').includes('Set up'))
  assert.ok(labels('sign in').includes('Accounts'))
  assert.ok(labels('api key').includes('API keys'))
  assert.ok(labels('credits').includes('About and credits'))
  assert.deepEqual(blockHits('zzz'), [])
  assert.deepEqual(blockHits(''), [])
})

test('pauseValue: on brings back the last value, else 99; off is null', () => {
  assert.equal(pauseValue(true, 90), 90)
  assert.equal(pauseValue(true, undefined), 99)
  assert.equal(pauseValue(true, 40), 99)
  assert.equal(pauseValue(false, 90), null)
})

test('chatGroups: five headings, every label once, strays join Advanced', () => {
  const labels = ['Continue at usage limit', 'Chat notices', 'Phone mode', 'Show agent browsers', 'Fix stuck items', 'Advanced mode in X', 'Your name']
  const g = chatGroups(labels.map(label => ({ label })))
  assert.deepEqual(g.map(([h]) => h), ['Chats', 'Notices', 'Windows and phone', 'Advanced'])
  assert.deepEqual(g.flatMap(([, r]) => r.map(x => x.label)).sort(), [...labels].sort())
  assert.ok(g.find(([h]) => h === 'Advanced')![1].some(r => r.label === 'Advanced mode in X'))
})
