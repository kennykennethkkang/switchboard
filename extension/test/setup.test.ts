/**
 * Set up: the steps a new machine runs, each skipped when that piece is already there, and the node runner that runs them.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { claudeBinary, claudeCall, codexState, setupState, setupSteps, type SetupKit } from '../src/hub/setup'
// @ts-expect-error plain .mjs, no types
import { commandFor, expand, installOwnSkills, installSkills, keyFor, mcpConfig, mirrorAllSkills, mirrorSkill, readKey, storeKey } from '../kit/setup-run.mjs'

const KIT: SetupKit = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'kit', 'setup.json'), 'utf8'))
const fresh = { plugins: [], marketplaces: [], mcps: [], plain: [] as string[], skills: [] as string[], agentsSkills: [] as string[], codex: { plugins: [] as string[], marketplaces: [] as string[], mcps: [] as string[] }, key21st: false, modsDir: '/ext/kit/mods', skillsDir: '/ext/kit/skills' }
const steps = (o = {}) => setupSteps(KIT, { ...fresh, ...o })
const runs = (o = {}) => steps(o).flatMap(s => (s.run ? [s.run.join(' ')] : []))
const text = (o = {}) => JSON.stringify(steps(o))
const MODS = '~/.claude/switchboard/mods'
// A clean sweep, so these tests never run skillspector.
const passed = async () => ({ state: 'clean' })
const ASK = '~/.claude/switchboard/ask/ask-server.mjs'

describe('setup steps', () => {
  it('bundles every mod setup.json installs, listed in the bundled marketplace', () => {
    const dir = path.join(__dirname, '..', 'kit', 'mods')
    const market = JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'marketplace.json'), 'utf8'))
    for (const m of KIT.mods) {
      assert.ok(fs.existsSync(path.join(dir, m, '.claude-plugin', 'plugin.json')), m)
      assert.ok(market.plugins.some((p: { name: string }) => p.name === m), m)
    }
  })

  it('ships done-check and bash-approve, which the generic rules promise', () => {
    for (const m of ['done-check', 'bash-approve']) assert.ok(KIT.mods.includes(m), m)
  })

  it('ships the reel picks: pixelfx, humanizer, last30days and find-skills', () => {
    for (const id of ['pixelfx@pixelfx', 'humanizer@humanizer', 'last30days@last30days-skill']) assert.ok(KIT.plugins.includes(id), id)
    assert.ok(KIT.skills?.some(k => k.repo === 'vercel-labs/skills' && k.names.includes('find-skills')))
  })

  it('adds every marketplace, plugin, mod and mcp on a fresh machine', () => {
    const r = runs({ key21st: true })
    for (const [name, repo] of Object.entries(KIT.marketplaces)) assert.ok(r.includes(`claude plugin marketplace add ${repo}`), name)
    for (const id of KIT.plugins) assert.ok(r.includes(`claude plugin install ${id}`), id)
    for (const m of KIT.mods) assert.ok(r.includes(`claude plugin install ${m}@kenneth-mods`), m)
    for (const m of KIT.mcps.filter(x => x.url && !x.keyHeader)) assert.ok(r.some(l => l.startsWith(`claude mcp add --scope user --transport http ${m.name} ${m.url}`)), m.name)
    assert.ok(steps({ key21st: true }).some(x => x.key?.name === '21st'))
    const mods = steps().find(s => s.copy)
    assert.deepEqual(mods?.copy, { from: '/ext/kit/mods', to: MODS })
    assert.deepEqual(mods?.run, ['claude', 'plugin', 'marketplace', 'add', MODS])
    assert.equal(mods?.ifExists, undefined)
    const ask = steps().find(s => s.run?.includes('switchboard'))
    assert.deepEqual(ask, { label: 'Ask tool', ifExists: ASK, run: ['claude', 'mcp', 'add', '--scope', 'user', 'switchboard', '--', 'node', ASK] })
  })

  it('skips what is already there', () => {
    const r = runs({
      plugins: [...KIT.plugins, ...KIT.mods.map(m => `${m}@kenneth-mods`)],
      marketplaces: [...Object.keys(KIT.marketplaces), 'kenneth-mods'],
      mcps: [...KIT.mcps.map(m => m.name), 'switchboard', 'scrapling'],
      key21st: true,
    }).join('\n')
    assert.doesNotMatch(r, /claude plugin (install|marketplace add)|claude mcp add/)
    assert.match(text(), /\/mcp/)
  })

  it('refreshes only its own copy of the mods', () => {
    const s = steps({ marketplaces: [...Object.keys(KIT.marketplaces), 'kenneth-mods'] }).find(x => x.copy)
    assert.deepEqual(s, { label: 'Refresh mods', ifExists: MODS, copy: { from: '/ext/kit/mods', to: MODS }, run: ['claude', 'plugin', 'marketplace', 'update', 'kenneth-mods'] })
  })

  it('adds each mcp once', () => {
    const r = runs({ key21st: true })
    for (const m of ['slack', 'switchboard']) assert.equal(r.filter(l => l.startsWith('claude mcp add') && l.split(' ').includes(m)).length, 1, m)
    assert.equal(steps({ key21st: true }).filter(x => x.key).length, 1)
  })

  it('leaves the 21st key to the runner, never in a command, and skips 21st without one', () => {
    const s = steps({ key21st: true }).find(x => x.key)
    assert.deepEqual(s, { label: '21st', key: { name: '21st', url: 'https://21st.dev/api/mcp', header: 'x-api-key' } })
    assert.ok(!runs({ key21st: true }).some(l => l.includes('21st')))
    assert.ok(!steps().some(x => x.key))
    assert.match(text(), /21st: no key/)
  })

  it('stores a new key even when 21st is there, and moves a plain-text key without asking', () => {
    const k = (o = {}) => steps({ mcps: ['21st'], ...o }).filter(x => x.key).length
    assert.equal(k({ key21st: true }), 1)
    assert.equal(k(), 0)
    assert.doesNotMatch(text({ mcps: ['21st'] }), /21st: no key/)
    assert.equal(k({ mcps: [], plain: ['21st'] }), 1)
    // Linux has no store, so moving it would only lose the key.
    assert.equal(k({ mcps: [], plain: ['21st'], platform: 'linux' }), 0)
    assert.equal(k({ key21st: true, platform: 'linux' }), 1)
  })

  it('fetches each skill repo with only the skills not already there', () => {
    const sk = KIT.skills ?? []
    const kit = (o = {}) => steps(o).filter(s => s.skills && sk.some(k => k.repo === s.skills!.repo))
    assert.deepEqual(kit().map(s => s.skills), sk)
    const [first, ...rest] = sk
    const some = kit({ skills: [first.names[0]], agentsSkills: [first.names[0]] })
    assert.deepEqual(some[0], { label: first.repo, skills: { repo: first.repo, names: first.names.slice(1) } })
    const all = sk.flatMap(k => k.names)
    assert.deepEqual(kit({ skills: all, agentsSkills: all }), [])
    assert.ok(rest.length > 0)
  })

  it('hands the runner the bundled own skills, which it adds or refreshes itself', () => {
    assert.deepEqual(KIT.own, ['aar', 'deep-research', 'harden', 'animation-styles', 'improve-system', 'awwwards', 'crowd-ab', 'model-bench', 'self-improve', 'stages', 'gemini', 'phone', 'accessibility', 'click-path-audit', 'e2e-testing', 'accessible-motion', 'hover-interactions', 'page-transitions', 'scroll-animations', 'toolchain', 'memory-fix', 'goal'])
    assert.deepEqual(steps().filter(s => s.own), [{ label: 'Switchboard skills', own: { from: '/ext/kit/skills', names: ['aar', 'deep-research', 'harden', 'animation-styles', 'improve-system', 'awwwards', 'crowd-ab', 'model-bench', 'self-improve', 'stages', 'gemini', 'phone', 'accessibility', 'click-path-audit', 'e2e-testing', 'accessible-motion', 'hover-interactions', 'page-transitions', 'scroll-animations', 'toolchain', 'memory-fix', 'goal'] } }])
    assert.equal(steps({ skills: ['aar', 'animation-styles'] }).filter(s => s.own).length, 1)
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'kit', 'skills', 'animation-styles', 'SKILL.md')))
  })

  it('re-registers an old Codex ask entry that lacks --codex, which is what gives Codex chats_wait', () => {
    const old = steps({ codex: { ...fresh.codex, mcps: ['switchboard'], askOld: true } }).filter(s => s.run?.[0] === 'codex' && s.run.includes('switchboard'))
    assert.deepEqual(old.map(s => s.run!.slice(0, 4).join(' ')), ['codex mcp remove switchboard', 'codex mcp add switchboard'])
    assert.ok(old[1].run!.includes('--codex'))
    assert.deepEqual(steps({ codex: { ...fresh.codex, mcps: ['switchboard'] } }).filter(s => s.run?.[0] === 'codex' && s.run.includes('switchboard')), [])
  })

  it('reads whether the Codex switchboard entry has --codex', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cx-')), 'config.toml')
    const read = (t: string) => { fs.writeFileSync(f, t); return codexState(f) }
    assert.equal(read('[mcp_servers.switchboard]\ncommand = "node"\nargs = ["/a/ask-server.mjs"]\n\n[mcp_servers.x]\nargs = ["--codex"]\n').askOld, true)
    assert.equal(read('[mcp_servers.switchboard]\ncommand = "node"\nargs = ["/a/ask-server.mjs", "--codex"]\n').askOld, undefined)
  })

  it('ships the Codex plugin to Claude only', () => {
    assert.equal(KIT.marketplaces['openai-codex'], 'openai/codex-plugin-cc')
    const r = steps().map(s => s.run?.join(' '))
    assert.ok(r.includes('claude plugin install codex@openai-codex'))
    assert.ok(!r.some(l => l?.startsWith('codex') && l.includes('codex-plugin-cc')))
  })

  it('gives Codex the same marketplaces, plugins, mcps and ask tool, each needing codex', () => {
    const cx = steps().filter(s => s.run?.[0] === 'codex')
    const r = cx.map(s => s.run!.join(' '))
    for (const [name, repo] of Object.entries(KIT.marketplaces)) assert.equal(r.includes(`codex plugin marketplace add ${repo}`), name !== 'openai-codex', name)
    for (const id of KIT.plugins) assert.equal(r.includes(`codex plugin add ${id}`), !id.endsWith('@openai-codex'), id)
    for (const m of KIT.mcps.filter(x => x.url && !x.keyHeader)) assert.ok(r.includes(`codex mcp add ${m.name} --url ${m.url}`), m.name)
    assert.ok(!r.some(l => l.includes('kenneth-mods')))
    // codex mcp add --url writes the entry, then waits on a browser login; the runner stops waiting after wait seconds.
    for (const m of KIT.mcps.filter(x => x.url && !x.keyHeader)) assert.deepEqual(cx.find(s => s.run!.includes(m.url!))?.wait, 20, m.name)
    assert.ok(steps().some(s => s.say?.includes('codex mcp login slack')))
    assert.deepEqual(cx.find(s => s.run!.includes('switchboard')), { label: 'Ask tool (Codex)', needs: ['codex'], ifExists: ASK, run: ['codex', 'mcp', 'add', 'switchboard', '--', 'node', ASK, '--codex'] })
    for (const s of cx) assert.ok(s.needs?.includes('codex'), s.label)
    const all = { plugins: KIT.plugins, marketplaces: Object.keys(KIT.marketplaces), mcps: [...KIT.mcps.map(m => m.name), 'switchboard', ...(KIT.tools ?? []).flatMap(t => t.mcp ? [t.mcp.name] : [])] }
    assert.deepEqual(steps({ codex: all }).filter(s => s.run?.[0] === 'codex'), [])
  })

  it('installs each python tool with uv, its skill and its mcp for both AIs, all needing uv', () => {
    const t = (KIT.tools ?? []).find(x => x.uv === 'scrapling[ai]')
    assert.deepEqual(t, { uv: 'scrapling[ai]', skill: { repo: 'D4Vinci/Scrapling', path: 'agent-skill', name: 'scrapling-official' }, mcp: { name: 'scrapling', command: 'scrapling-mcp' } })
    assert.ok(KIT.tools?.some(x => x.uv === 'agent-reach' && x.skill?.file === 'SKILL_en.md'))
    const s = steps()
    assert.deepEqual(s.find(x => x.run?.join(' ') === 'uv tool install scrapling[ai]'), { label: 'scrapling[ai]', needs: ['uv'], quiet: true, run: ['uv', 'tool', 'install', 'scrapling[ai]'] })
    assert.deepEqual(s.find(x => x.skills?.names.includes('scrapling-official')), { label: 'D4Vinci/Scrapling', needs: ['uv'], skills: { repo: 'D4Vinci/Scrapling', names: ['scrapling-official'], path: 'agent-skill' } })
    assert.deepEqual(s.find(x => x.skills?.names.includes('agent-reach'))?.skills, { repo: 'Panniantong/Agent-Reach', names: ['agent-reach'], path: 'agent_reach', file: 'SKILL_en.md' })
    const bin = '~/.local/bin/scrapling-mcp'
    assert.ok(s.some(x => x.run?.join(' ') === `claude mcp add --scope user scrapling -- ${bin}` && x.needs?.join() === 'uv'))
    assert.ok(s.some(x => x.run?.join(' ') === `codex mcp add scrapling -- ${bin}` && x.needs?.join() === 'uv,codex'))
    const done = steps({ mcps: ['scrapling'], codex: { ...fresh.codex, mcps: ['scrapling'] }, skills: ['scrapling-official', 'agent-reach'], agentsSkills: ['scrapling-official', 'agent-reach'] })
    assert.ok(!done.some(x => x.skills?.names.some(n => ['scrapling-official', 'agent-reach'].includes(n)) || x.run?.includes('scrapling')))
  })

  it('installs agent-browser everywhere and agent-desktop on macOS and Windows with npm, skipped when already on PATH', () => {
    assert.deepEqual(KIT.npm, [{ pkg: 'agent-browser', then: ['agent-browser', 'install'] }, { pkg: 'agent-desktop', os: ['darwin', 'win32'] }])
    const npm = (platform: NodeJS.Platform) => steps({ platform }).filter(s => s.run?.[0] === 'npm')
    assert.deepEqual(npm('darwin'), [
      { label: 'agent-browser', needs: ['npm'], unless: 'agent-browser', run: ['npm', 'install', '-g', 'agent-browser'], then: ['agent-browser', 'install'] },
      { label: 'agent-desktop', needs: ['npm'], unless: 'agent-desktop', run: ['npm', 'install', '-g', 'agent-desktop'] },
    ])
    assert.deepEqual(npm('win32').map(s => s.label), ['agent-browser', 'agent-desktop'])
    assert.deepEqual(npm('linux').map(s => s.label), ['agent-browser'])
  })

  it('runner skips an unless step whose command answers, else runs it and its then', () => {
    if (process.platform === 'win32') return
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-npm-'))
    const log = path.join(dir, 'log')
    for (const c of ['claude', 'npm', 'have']) fs.writeFileSync(path.join(dir, c), `#!/bin/sh\necho "${c} $*" >> "${log}"\n`, { mode: 0o755 })
    const plan = path.join(dir, 'plan.json')
    fs.writeFileSync(plan, JSON.stringify([
      { label: 'have', needs: ['npm'], unless: 'have', run: ['npm', 'install', '-g', 'have'], then: ['have', 'install'] },
      { label: 'fresh', needs: ['npm'], unless: 'sb-not-there', run: ['npm', 'install', '-g', 'fresh'], then: ['npm', 'after'] },
    ]))
    const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'kit', 'setup-run.mjs'), plan], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:/usr/bin:/bin` } })
    const calls = fs.readFileSync(log, 'utf8').split('\n').filter(l => !l.startsWith('claude'))
    assert.deepEqual(calls, ['npm --version', 'have --version', 'npm install -g fresh', 'npm after', ''])
    assert.match(out, /have: already installed/)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('adds Perplexity to Claude and Codex only with its key saved, reading the key at launch', () => {
    const saved = { keys: [{ name: 'PERPLEXITY_API_KEY' as const, saved: true, last4: 'abcd' }] }
    const mac = steps({ ...saved, platform: 'darwin' })
    const wrap = 'PERPLEXITY_API_KEY=$(security find-generic-password -s switchboard -a PERPLEXITY_API_KEY -w) exec npx -y @perplexity-ai/mcp-server'
    assert.deepEqual(mac.find(s => s.label === 'perplexity')?.run, ['claude', 'mcp', 'add', '--scope', 'user', 'perplexity', '--', 'sh', '-c', wrap])
    assert.deepEqual(mac.find(s => s.label === 'perplexity (Codex)'), { label: 'perplexity (Codex)', needs: ['codex'], run: ['codex', 'mcp', 'add', 'perplexity', '--', 'sh', '-c', wrap] })
    // The key itself never lands in a step.
    assert.ok(!mac.some(s => s.run?.join(' ').includes('abcd')))
    assert.match(steps({ ...saved, platform: 'linux' }).find(s => s.label === 'perplexity')!.run!.at(-1)!, /cat "\$HOME\/\.claude\/switchboard\/keys\/PERPLEXITY_API_KEY"/)
    assert.ok(!steps().some(s => s.label?.startsWith('perplexity')))
    assert.match(text(), /perplexity: no key saved, skipped/)
    assert.ok(!steps({ ...saved, mcps: ['perplexity'], codex: { ...fresh.codex, mcps: ['perplexity'] } }).some(s => s.label?.startsWith('perplexity')))
    assert.match(JSON.stringify(steps({ ...saved, platform: 'win32' })), /perplexity: not added on Windows/)
  })

  it('adds Firecrawl with its saved key, PostHog and Composio by OAuth sign-in', () => {
    const mac = steps({ keys: [{ name: 'FIRECRAWL_API_KEY', saved: true, last4: 'abcd' }], platform: 'darwin' })
    const wrap = 'FIRECRAWL_API_KEY=$(security find-generic-password -s switchboard -a FIRECRAWL_API_KEY -w) exec npx -y firecrawl-mcp'
    assert.deepEqual(mac.find(s => s.label === 'firecrawl')?.run, ['claude', 'mcp', 'add', '--scope', 'user', 'firecrawl', '--', 'sh', '-c', wrap])
    assert.match(text(), /firecrawl: no key saved, skipped/)
    const r = steps().map(s => s.run?.join(' '))
    assert.ok(r.includes('claude mcp add --scope user --transport http posthog https://mcp.posthog.com/mcp'))
    assert.ok(r.includes('claude mcp add --scope user --transport http composio https://connect.composio.dev/mcp'))
    assert.match(text(), /Sign in to slack, cloudflare, posthog, composio with \/mcp/)
    assert.match(text(), /codex mcp login posthog, codex mcp login composio/)
  })

  it('installs untangle-codebase from caldoai/skills', () => {
    assert.ok(KIT.skills?.some(k => k.repo === 'caldoai/skills' && k.names.includes('untangle-codebase')))
  })

  it('installs ui-sdk from vercel-labs/ui, where it lives under packages/core/skills', () => {
    assert.ok(KIT.skills?.some(k => k.repo === 'vercel-labs/ui' && k.path === 'packages/core/skills' && k.names.includes('ui-sdk')))
  })

  it('designer and engineer pin ui-sdk web bundles, since the skill says the unpinned ui-sdk.dev/web.js', () => {
    for (const role of ['designer', 'engineer']) {
      const md = fs.readFileSync(path.join(__dirname, '..', 'kit', 'agents', `${role}.md`), 'utf8')
      assert.match(md, /cdn\.jsdelivr\.net\/npm\/@ui-sdk\/web@<exact version>\/browser\/web\.js/, role)
      assert.match(md, /never the unpinned ui-sdk\.dev\/web\.js/, role)
    }
  })

  it('installs caveman as a skill, not as a plugin with hooks', () => {
    assert.ok(KIT.skills?.some(k => k.repo === 'JuliusBrussee/caveman' && k.names.includes('caveman')))
    assert.ok(!KIT.plugins.some(p => p.startsWith('caveman')))
  })

  it('fetches a skill again when only Codex lacks it', () => {
    const [first] = KIT.skills ?? []
    const all = first.names
    assert.deepEqual(steps({ skills: all, agentsSkills: all.slice(1) }).find(s => s.skills?.repo === first.repo)?.skills?.names, [all[0]])
  })

  it('carries no absolute path from this machine', () => {
    assert.doesNotMatch(text(), /\/Users\//)
    assert.doesNotMatch(JSON.stringify(KIT), /\/Users\/|kennykennethkkang/)
  })
})

describe('setup runner', () => {
  it('expands ~/ against home', () => {
    assert.equal(expand('~/.claude/x', '/h'), path.join('/h', '.claude/x'))
    assert.equal(expand('obra/superpowers', '/h'), 'obra/superpowers')
  })

  it('keeps the key in the OS store, fed by stdin or env, never in args', () => {
    const mac = storeKey('k1', 'darwin', '/h')
    assert.deepEqual(mac.args.slice(0, 5), ['add-generic-password', '-U', '-s', 'switchboard-21st', '-a'])
    assert.equal(mac.args.at(-1), '-w')
    assert.equal(mac.input, 'k1\nk1\n')
    // In a terminal, security reads the tty and ignores stdin unless it has none.
    assert.equal(mac.detached, true)
    const win = storeKey('k1', 'win32', 'C:\\Users\\A B')
    assert.equal(win.cmd, 'powershell')
    assert.match(win.args.at(-1), /ConvertFrom-SecureString/)
    assert.deepEqual(win.env, { API_KEY_21ST: 'k1', SB_KEY_FILE: path.join('C:\\Users\\A B', '.claude', 'switchboard', '21st.key') })
    for (const c of [mac, win]) assert.ok(!c.args.some((a: string) => a.includes('k1')))
    assert.equal(storeKey('k1', 'linux', '/h'), undefined)
  })

  it('takes the key from the env, else from a plain-text header in ~/.claude.json', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-key-'))
    const k = { name: '21st', url: 'u', header: 'x-api-key' }
    assert.equal(keyFor(k, { API_KEY_21ST: ' k1 ' }, home), 'k1')
    assert.equal(keyFor(k, {}, home), '')
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { '21st': { headers: { 'x-api-key': 'old1' } } } }))
    assert.equal(keyFor(k, {}, home), 'old1')
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { '21st': { headers: { 'x-api-key': '${API_KEY_21ST}' } } } }))
    assert.equal(keyFor(k, {}, home), '')
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('reads the key back from the same store', () => {
    assert.deepEqual(readKey('darwin', '/h'), { cmd: 'security', args: ['find-generic-password', '-s', 'switchboard-21st', '-w'] })
    const win = readKey('win32', '/h')
    assert.match(win.args.at(-1), /ConvertTo-SecureString/)
    assert.equal(win.env.SB_KEY_FILE, path.join('/h', '.claude', 'switchboard', '21st.key'))
    assert.equal(readKey('linux', '/h'), undefined)
  })

  it('registers a headers helper where there is a store, else an env reference', () => {
    const url = 'https://21st.dev/api/mcp'
    assert.deepEqual(mcpConfig(url, 'x-api-key', 'darwin', '/h'), { type: 'http', url, headersHelper: `node "${path.join('/h', '.claude', 'switchboard', 'setup-run.mjs')}" --headers x-api-key` })
    assert.equal(mcpConfig(url, 'x-api-key', 'win32', 'C:\\Users\\A B').headersHelper, 'node "C:/Users/A B/.claude/switchboard/setup-run.mjs" --headers x-api-key')
    assert.deepEqual(mcpConfig(url, 'x-api-key', 'linux', '/h'), { type: 'http', url, headers: { 'x-api-key': '${API_KEY_21ST}' } })
  })

  it('runs claude directly on macOS and through cmd with quoted args on Windows', () => {
    assert.deepEqual(commandFor('claude', ['mcp', 'add', 'x-api-key: k'], 'darwin'), { cmd: 'claude', args: ['mcp', 'add', 'x-api-key: k'], shell: false })
    assert.deepEqual(commandFor('claude', ['plugin', 'add', 'C:\\Users\\A B\\mods', 'a"b'], 'win32'), { cmd: 'claude', args: ['plugin', 'add', '"C:\\Users\\A B\\mods"', '"a\\"b"'], shell: true })
    // Backslashes before a quote double, so JSON with escaped quotes survives.
    assert.deepEqual(commandFor('claude', ['{"h":"node \\"C:/x y\\""}', 'C:\\A B\\'], 'win32').args, ['"{\\"h\\":\\"node \\\\\\"C:/x y\\\\\\"\\"}"', '"C:\\A B\\\\"'])
  })

  it('copies named skills from a clone, found by their SKILL.md name, and never overwrites one', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-skills-'))
    const fake = (repo: string, dir: string) => {
      assert.equal(repo, 'a/b')
      for (const [folder, name] of [['one', 'one'], ['renamed', 'two'], ['three', 'three']]) {
        fs.mkdirSync(path.join(dir, 'skills', folder, 'refs'), { recursive: true })
        fs.writeFileSync(path.join(dir, 'skills', folder, 'SKILL.md'), `---\nname: ${name}\n---\nbody ${folder}\n`)
        fs.writeFileSync(path.join(dir, 'skills', folder, 'refs', 'x.md'), 'x')
      }
      return ''
    }
    const mine = path.join(home, '.claude', 'skills', 'three')
    fs.mkdirSync(mine, { recursive: true })
    fs.writeFileSync(path.join(mine, 'SKILL.md'), 'my own')
    const r = await installSkills({ repo: 'a/b', names: ['one', 'two', 'three', 'gone'] }, { home, clone: fake, scan: passed, log: () => {} })
    assert.deepEqual(r, { added: ['one', 'two'], flagged: [], kept: ['three'], missing: ['gone'], refused: [], codex: ['one', 'two', 'three'] })
    assert.match(fs.readFileSync(path.join(home, '.claude', 'skills', 'two', 'SKILL.md'), 'utf8'), /body renamed/)
    assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'one', 'refs', 'x.md')))
    assert.equal(fs.readFileSync(path.join(mine, 'SKILL.md'), 'utf8'), 'my own')
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('mirrors each skill Claude has on into ~/.agents/skills for Codex, never over one already there', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-skills-'))
    const put = (p: string, body: string) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body) }
    const fake = (_repo: string, dir: string) => {
      put(path.join(dir, 'skills', 'one', 'SKILL.md'), '---\nname: one\n---\nnew\n')
      put(path.join(dir, 'pkg', 'skill', 'SKILL.md'), '---\nname: reach\n---\nother tongue\n')
      put(path.join(dir, 'pkg', 'skill', 'SKILL_en.md'), '---\nname: reach\n---\nenglish\n')
      return ''
    }
    put(path.join(home, '.claude', 'skills', 'kept', 'SKILL.md'), 'claude copy')
    put(path.join(home, '.claude', 'skills', 'theirs', 'SKILL.md'), 'claude copy')
    put(path.join(home, '.agents', 'skills', 'theirs', 'SKILL.md'), 'codex own')
    put(path.join(home, '.claude', 'skills-archive', 'held', 'SKILL.md'), 'held')
    const r = await installSkills({ repo: 'a/b', names: ['one', 'kept', 'theirs', 'held'] }, { home, clone: fake, scan: passed, log: () => {} })
    assert.deepEqual(r.codex, ['one', 'kept'])
    const agents = path.join(home, '.agents', 'skills')
    assert.match(fs.readFileSync(path.join(agents, 'one', 'SKILL.md'), 'utf8'), /new/)
    assert.equal(fs.readFileSync(path.join(agents, 'kept', 'SKILL.md'), 'utf8'), 'claude copy')
    assert.equal(fs.readFileSync(path.join(agents, 'theirs', 'SKILL.md'), 'utf8'), 'codex own')
    assert.ok(!fs.existsSync(path.join(agents, 'held')))
    assert.equal(mirrorSkill('missing', home), false)
    // A tool skill: found under its own path, its English file becomes SKILL.md.
    const t = await installSkills({ repo: 'a/b', names: ['reach'], path: 'pkg', file: 'SKILL_en.md' }, { home, clone: fake, scan: passed, log: () => {} })
    assert.deepEqual(t.added, ['reach'])
    for (const root of ['.claude', '.agents']) assert.match(fs.readFileSync(path.join(home, root, 'skills', 'reach', 'SKILL.md'), 'utf8'), /english/)
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('mirrors every skill folder Claude has into ~/.agents/skills, leaving any Codex already has', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-mirror-'))
    const put = (p: string, body: string) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body) }
    put(path.join(home, '.claude', 'skills', 'a', 'SKILL.md'), 'a')
    put(path.join(home, '.claude', 'skills', 'a', 'refs', 'x.md'), 'x')
    put(path.join(home, '.claude', 'skills', 'same', 'SKILL.md'), 'claude')
    put(path.join(home, '.claude', 'skills', 'old', 'SKILL.md'), 'claude')
    put(path.join(home, '.claude', 'skills', 'nomd', 'README.md'), 'no skill file')
    put(path.join(home, '.claude', 'skills', '.hidden', 'SKILL.md'), 'h')
    put(path.join(home, '.agents', 'skills', 'same', 'SKILL.md'), 'codex')
    put(path.join(home, '.codex', 'skills', 'old', 'SKILL.md'), 'codex legacy')
    const added = mirrorAllSkills(home)
    assert.deepEqual(added, ['a'])
    const agents = path.join(home, '.agents', 'skills')
    assert.equal(fs.readFileSync(path.join(agents, 'a', 'refs', 'x.md'), 'utf8'), 'x')
    assert.equal(fs.readFileSync(path.join(agents, 'same', 'SKILL.md'), 'utf8'), 'codex')
    for (const n of ['old', 'nomd', '.hidden']) assert.ok(!fs.existsSync(path.join(agents, n)))
    assert.deepEqual(mirrorAllSkills(home), [])
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('copies own skills into ~/.agents/skills too, by the same rules', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-own-')), from = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-own-kit-'))
    fs.mkdirSync(path.join(from, 'aar'), { recursive: true })
    fs.writeFileSync(path.join(from, 'aar', 'SKILL.md'), 'aar\n\n<!-- switchboard generic copy -->\n')
    const r = installOwnSkills({ from, names: ['aar'] }, { home, root: path.join('.agents', 'skills'), log: () => {} })
    assert.deepEqual(r.added, ['aar'])
    assert.ok(fs.existsSync(path.join(home, '.agents', 'skills', 'aar', 'SKILL.md')))
    assert.ok(!fs.existsSync(path.join(home, '.claude', 'skills', 'aar')))
    for (const d of [home, from]) fs.rmSync(d, { recursive: true, force: true })
  })

  it('adds a missing own skill, refreshes an older copy of ours, and leaves links and the user\'s own alone', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-own-')), from = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-own-kit-'))
    const MARK = '<!-- switchboard generic copy -->'
    const put = (p: string, body: string) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body) }
    const skills = path.join(home, '.claude', 'skills')
    for (const n of ['add', 'link', 'mine', 'old', 'same']) { put(path.join(from, n, 'SKILL.md'), `${n} v2\n\n${MARK}\n`); put(path.join(from, n, 'clips', 'a.mp4'), 'v2') }
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-own-link-'))
    put(path.join(elsewhere, 'SKILL.md'), 'claude-mods copy')
    fs.mkdirSync(skills, { recursive: true })
    fs.symlinkSync(elsewhere, path.join(skills, 'link'))
    put(path.join(skills, 'mine', 'SKILL.md'), 'my own, no mark')
    put(path.join(skills, 'old', 'SKILL.md'), `old v1\n\n${MARK}\n`); put(path.join(skills, 'old', 'gone.md'), 'v1 only')
    fs.cpSync(path.join(from, 'same'), path.join(skills, 'same'), { recursive: true })
    const r = installOwnSkills({ from, names: ['add', 'link', 'mine', 'old', 'same', 'absent'] }, { home, log: () => {} })
    assert.deepEqual(r, { added: ['add'], refreshed: ['old'], kept: ['mine', 'same'], linked: ['link'], failed: [] })
    assert.equal(fs.readFileSync(path.join(skills, 'add', 'clips', 'a.mp4'), 'utf8'), 'v2')
    assert.match(fs.readFileSync(path.join(skills, 'old', 'SKILL.md'), 'utf8'), /old v2/)
    assert.ok(!fs.existsSync(path.join(skills, 'old', 'gone.md')))
    assert.equal(fs.readFileSync(path.join(skills, 'mine', 'SKILL.md'), 'utf8'), 'my own, no mark')
    assert.ok(fs.lstatSync(path.join(skills, 'link')).isSymbolicLink())
    assert.equal(fs.readFileSync(path.join(elsewhere, 'SKILL.md'), 'utf8'), 'claude-mods copy')
    for (const d of [home, from, elsewhere]) fs.rmSync(d, { recursive: true, force: true })
  })

  it('refuses an own skill name that is not a plain folder name', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-own-'))
    const lines: string[] = []
    const r = installOwnSkills({ from: home, names: ['', '..', '../x', 'a/b', 'a\\b'] }, { home, log: (l: string) => lines.push(l) })
    assert.deepEqual(r.failed, ['', '..', '../x', 'a/b', 'a\\b'])
    assert.match(lines.join('\n'), /not a plain folder name/)
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('keeps the old copy when a refresh fails, says so, and goes on to the next skill', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-own-')), from = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-own-kit-'))
    const MARK = '<!-- switchboard generic copy -->'
    const put = (p: string, body: string) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body) }
    const skills = path.join(home, '.claude', 'skills')
    put(path.join(from, 'bad', 'SKILL.md'), `bad v2\n\n${MARK}\n`); put(path.join(from, 'bad', 'locked.md'), 'x')
    fs.chmodSync(path.join(from, 'bad', 'locked.md'), 0o000)
    put(path.join(from, 'next', 'SKILL.md'), `next v2\n\n${MARK}\n`)
    put(path.join(skills, 'bad', 'SKILL.md'), `bad v1\n\n${MARK}\n`)
    const lines: string[] = []
    try {
      const r = installOwnSkills({ from, names: ['bad', 'next'] }, { home, log: (l: string) => lines.push(l) })
      assert.deepEqual(r.failed, ['bad'])
      assert.deepEqual(r.added, ['next'])
      assert.match(fs.readFileSync(path.join(skills, 'bad', 'SKILL.md'), 'utf8'), /bad v1/)
      assert.match(lines.join('\n'), /bad: could not copy/)
      assert.deepEqual(fs.readdirSync(skills).sort(), ['bad', 'next'])
    } finally {
      fs.chmodSync(path.join(from, 'bad', 'locked.md'), 0o644)
      for (const d of [home, from]) fs.rmSync(d, { recursive: true, force: true })
    }
  })

  it('fails soft when a skill repo cannot be cloned, saying why', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-skills-'))
    const lines: string[] = []
    const r = await installSkills({ repo: 'a/b', names: ['one'] }, { home, clone: () => 'repository not found', scan: passed, log: (l: string) => lines.push(l) })
    assert.equal(r.error, 'repository not found')
    assert.match(lines.join('\n'), /a\/b: .*repository not found/)
    assert.ok(!fs.existsSync(path.join(home, '.claude', 'skills', 'one')))
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('prints the steps in dry-run, without the key and without running them', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-run-'))
    const plan = path.join(dir, 'plan.json')
    fs.writeFileSync(plan, JSON.stringify(setupSteps(KIT, { ...fresh, key21st: true, modsDir: path.join(dir, 'mods') })))
    const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'kit', 'setup-run.mjs'), plan, '--dry-run'], { encoding: 'utf8', env: { ...process.env, API_KEY_21ST: 'secret-key-1' } })
    assert.match(out, /claude plugin install superpowers@superpowers-dev/)
    assert.match(out, /copy .*mods/)
    assert.match(out, /Set up done/)
    assert.match(out, /git clone --depth 1 https:\/\/github.com\/emilkowalski\/skills.git/)
    assert.match(out, /copy aar deep-research harden animation-styles improve-system awwwards crowd-ab model-bench self-improve stages gemini phone accessibility click-path-audit e2e-testing accessible-motion hover-interactions page-transitions scroll-animations toolchain memory-fix goal from .* to ~\/.claude\/skills and ~\/.agents\/skills/)
    assert.match(out, /claude mcp remove --scope user 21st/)
    assert.match(out, /claude mcp add-json --scope user 21st .*"type":"http"/)
    assert.match(out, /codex plugin add superpowers@superpowers-dev/)
    assert.match(out, /to ~\/.claude\/skills and ~\/.agents\/skills/)
    assert.doesNotMatch(out, /secret-key-1/)
    assert.ok(!fs.existsSync(path.join(dir, 'mods')))
    // A plain-text key is moved with no key given, and never printed.
    fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ mcpServers: { '21st': { headers: { 'x-api-key': 'plain-key-2' } } } }))
    fs.writeFileSync(plan, JSON.stringify(setupSteps(KIT, { ...fresh, ...setupState(dir), modsDir: path.join(dir, 'mods') })))
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: dir, USERPROFILE: dir }
    delete env.API_KEY_21ST
    const moved = execFileSync(process.execPath, [path.join(__dirname, '..', 'kit', 'setup-run.mjs'), plan, '--dry-run'], { encoding: 'utf8', env })
    assert.match(moved, /claude mcp add-json --scope user 21st/)
    assert.doesNotMatch(moved, /plain-key-2/)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('claude call', () => {
  it('registers the ask tool directly on macOS and through a shell with quoted paths on Windows', () => {
    const args = ['mcp', 'add', '--scope', 'user', 'switchboard', '--', 'node', 'C:\\Users\\A B\\.claude\\switchboard\\ask\\ask-server.mjs']
    assert.deepEqual(claudeCall(args, 'darwin'), { cmd: claudeBinary(), args, shell: false })
    const w = claudeCall(args, 'win32')
    assert.equal(w.shell, true)
    assert.deepEqual(w.args.slice(0, 7), args.slice(0, 7))
    assert.equal(w.args[7], '"C:\\Users\\A B\\.claude\\switchboard\\ask\\ask-server.mjs"')
  })
})

describe('setup state', () => {
  it('reads installed plugins, marketplaces and user mcps, empty when missing', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-setup-'))
    assert.deepEqual(setupState(home), { plugins: [], marketplaces: [], mcps: [], plain: [], skills: [], agentsSkills: [], codex: { plugins: [], marketplaces: [], mcps: [] } })
    fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true })
    fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'a@b': [] } }))
    fs.writeFileSync(path.join(home, '.claude', 'plugins', 'known_marketplaces.json'), JSON.stringify({ b: { source: {} } }))
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { slack: {} } }))
    fs.mkdirSync(path.join(home, '.claude', 'skills', 'animate'), { recursive: true })
    fs.mkdirSync(path.join(home, '.agents', 'skills', 'animate'), { recursive: true })
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true })
    fs.writeFileSync(path.join(home, '.codex', 'config.toml'), 'model = "x"\n[mcp_servers.figma]\nurl = "u"\n[mcp_servers.figma.env]\nA = "b"\n[mcp_servers."my-srv"]\n[plugins."github@openai-curated"]\nenabled = true\n[marketplaces.superpowers-dev]\nsource = "x"\n[projects."/x"]\n')
    assert.deepEqual(setupState(home), { plugins: ['a@b'], marketplaces: ['b'], mcps: ['slack'], plain: [], skills: ['animate'], agentsSkills: ['animate'], codex: { plugins: ['github@openai-curated'], marketplaces: ['superpowers-dev'], mcps: ['figma', 'my-srv'] } })
    // A key written into the config in plain text counts as missing, so the next run replaces it.
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { a: { headers: { 'x-api-key': 'k1' } }, b: { headers: { 'x-api-key': '${API_KEY_21ST}' } }, c: { headersHelper: 'node x' } } }))
    assert.deepEqual(setupState(home).mcps, ['b', 'c'])
    assert.deepEqual(setupState(home).plain, ['a'])
    fs.rmSync(home, { recursive: true, force: true })
  })
})

describe('setup key lines', () => {
  const says = (o = {}) => steps(o).flatMap(s => (s.say ? [s.say] : []))
  it('points a missing key to Sign-ins, not ~/.zshrc', () => {
    const lines = says({ keys: [{ name: 'GEMINI_API_KEY', saved: true, last4: 'wxyz', checked: { ok: true, at: 1 } }, { name: 'OPENROUTER_API_KEY', saved: false }] })
    assert.ok(lines.includes('Gemini key: saved (ends wxyz), works.'))
    assert.ok(lines.includes('OpenRouter (Jev, MiroFish) key: missing. Get one at https://openrouter.ai/keys and paste it in Switchboard: Settings, Accounts, API keys.'))
    assert.ok(!lines.some(l => l.includes('zshrc')))
  })
  it('names MiroFish on the Zep line with its sign-up link, and adds no prompt step', () => {
    const s = steps({ keys: [{ name: 'ZEP_API_KEY', saved: false }] })
    assert.ok(s.some(x => x.say === 'Zep (MiroFish) key: missing. Get one at https://app.getzep.com and paste it in Switchboard: Settings, Accounts, API keys.'))
    assert.ok(!s.some(x => x.key && x.key.name !== '21st'))
  })
  it('says nothing about keys when an older caller passes none', () => {
    assert.ok(!says().some(l => /key:/.test(l)))
  })
})
