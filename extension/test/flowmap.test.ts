/**
 * Flow map: the import scanner over a fixture project, and one chat's transcript folded into skills, plugins, mods, roles and files.
 */
import { describe, it } from 'node:test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import assert from 'node:assert/strict'
import { HubService } from '../src/hub/hub-service'
import { handleHub, type HubReply } from '../src/hub/routes'
import { KIT_MODS, addLine, assemble, buildFlowMap, flowCacheSize, flowChatDirs, flowLabels, flowRoots, headerOf, newWork, parseImports, readmeLine, resolveImport, scanCode, serverOf, slugOf } from '../src/hub/flowmap'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'flowmap-'))
const put = (root: string, rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text) }

describe('import scanner', () => {
  it('finds import, export from, side effect, require and dynamic import', () => {
    const src = `import a from './a'\nimport type { B } from "../b"\nexport * from './c.js'\nimport './d.css'\nconst e = require('./e')\nconst f = await import('@/lib/f')\nimport x from 'react'`
    assert.deepEqual(parseImports(src, '.ts').sort(), ['../b', './a', './c.js', './d.css', './e', '@/lib/f', 'react'])
  })

  it('finds python from and import lines', () => {
    assert.deepEqual(parseImports('from .util import x\nfrom pkg.mod import y\nimport os.path\n', '.py').sort(), ['.util', 'os.path', 'pkg.mod'])
  })

  it('resolves extensions, index files, .js to .ts, @/ to the nearest package and python dots; skips packages', () => {
    const files = new Set(['src/a.ts', 'src/lib/index.ts', 'src/b.tsx', 'web/lib/f.ts', 'py/pkg/util.py', 'py/pkg/__init__.py', 'py/main.py'])
    assert.equal(resolveImport('./a', 'src/b.tsx', files, []), 'src/a.ts')
    assert.equal(resolveImport('./lib', 'src/a.ts', files, []), 'src/lib/index.ts')
    assert.equal(resolveImport('./a.js', 'src/b.tsx', files, []), 'src/a.ts')
    assert.equal(resolveImport('@/lib/f', 'web/app/page.tsx', files, ['.', 'web']), 'web/lib/f.ts')
    assert.equal(resolveImport('.util', 'py/pkg/__init__.py', files, []), 'py/pkg/util.py')
    assert.equal(resolveImport('..pkg', 'py/pkg/util.py', files, []), 'py/pkg/__init__.py')
    assert.equal(resolveImport('react', 'src/a.ts', files, []), undefined)
    assert.equal(resolveImport('../../../x', 'src/a.ts', files, []), undefined)
  })

  it('reads the header comment and the README line in plain words', () => {
    assert.equal(headerOf("'use client'\n/**\n * The chat rail. Lists every chat.\n */\nexport {}"), 'The chat rail. Lists every chat.')
    assert.equal(headerOf('// Small helpers for dates\nexport {}'), 'Small helpers for dates')
    assert.equal(headerOf('"""Loads the config file."""\nimport os'), 'Loads the config file.')
    assert.equal(headerOf('export const x = 1'), undefined)
    assert.equal(readmeLine('# Web\n\n<!-- note -->\n\nThe Next app that draws the hub.\nMore here.'), 'The Next app that draws the hub.')
  })

  it('walks a project, skips node_modules and dot folders, links imports and stops at the cap', async () => {
    const root = tmp()
    put(root, 'package.json', '{}')
    put(root, 'src/README.md', '# src\n\nWhere the code lives.')
    put(root, 'src/a.ts', "/** Entry point. */\nimport { b } from './b'")
    put(root, 'src/b.ts', 'export const b = 1')
    put(root, 'node_modules/x/index.js', "require('../../src/a')")
    put(root, '.hidden/c.ts', "import './a'")
    const code = await scanCode(root)
    assert.deepEqual([...code.files.keys()], ['src/a.ts', 'src/b.ts'])
    assert.equal(code.files.get('src/a.ts'), 'Entry point.')
    assert.equal(code.folders.get('src'), 'Where the code lives.')
    assert.deepEqual([...code.imports], [['src/a.ts\nsrc/b.ts', 1]])
    assert.equal(code.cut, false)
    const capped = await scanCode(root, 1)
    assert.equal(capped.files.size, 1)
    assert.equal(capped.cut, true)
    fs.rmSync(root, { recursive: true, force: true })
  })
})

const tool = (name: string, input: object, ts = '2026-11-01T10:00:00Z') => JSON.stringify({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', name, input }] } })

describe('transcript aggregation', () => {
  it('names MCP servers the way people do', () => {
    assert.equal(serverOf('mcp__plugin_playwright_playwright__browser_click'), 'playwright')
    assert.equal(serverOf('mcp__claude_ai_Claude_Docs__read'), 'Claude_Docs')
    assert.equal(serverOf('mcp__switchboard__ask'), 'switchboard')
    assert.equal(serverOf('Bash'), undefined)
  })

  it('folds a chat into skills, plugins, mods, roles and files under the project', () => {
    const w = newWork('s1')
    const lines = [
      JSON.stringify({ type: 'user', timestamp: '2026-11-01T09:00:00Z', message: { content: '<command-name>x</command-name>' } }),
      JSON.stringify({ type: 'user', timestamp: '2026-11-01T09:01:00Z', message: { content: 'Build the flow map\nplease' } }),
      tool('Skill', { skill: 'superpowers:test-driven-development' }),
      tool('Skill', { skill: 'ponytail' }),
      tool('mcp__plugin_playwright_playwright__browser_click', {}),
      tool('mcp__usage-meter__hub_recall', {}),
      tool('Agent', { subagent_type: 'engineer', prompt: 'x' }),
      tool('Edit', { file_path: '/p/src/a.ts' }, '2026-11-01T11:00:00Z'),
      tool('Write', { file_path: 'src/b.ts' }),
      tool('Edit', { file_path: '/elsewhere/c.ts' }),
      JSON.stringify({ type: 'attachment', attachment: { type: 'hook_success', command: 'node ~/.claude/mods/repo-rules/hooks/x.js' } }),
      'not json "tool_use"',
    ]
    for (const l of lines) addLine(w, l, '/p')
    assert.equal(w.label, 'Build the flow map please')
    assert.deepEqual([...w.skills.keys()], ['superpowers:test-driven-development', 'ponytail'])
    assert.deepEqual([...w.plugins.keys()], ['superpowers', 'playwright'])
    assert.deepEqual([...w.mods.keys()], ['usage-meter', 'repo-rules'])
    assert.deepEqual([...w.roles.keys()], ['engineer'])
    assert.deepEqual([...w.files.keys()], ['src/a.ts', 'src/b.ts'])
    assert.equal(w.files.get('src/a.ts'), Date.parse('2026-11-01T11:00:00Z'))
    assert.equal(w.first, Date.parse('2026-11-01T09:00:00Z'))

    const code = { files: new Map([['src/a.ts', 'A.'], ['src/b.ts', undefined]]), folders: new Map([['src', undefined]]), imports: new Map([['src/a.ts\nsrc/b.ts', 1]]), cut: false }
    const map = assemble('p', code, [w], { s1: 'flow map v1' })
    assert.equal(map.nodes.find(n => n.id === 'chat:s1')?.label, 'flow map v1')
    assert.ok(map.edges.some(e => e.from === 'chat:s1' && e.to === 'skill:ponytail' && e.kind === 'used'))
    assert.ok(map.edges.some(e => e.from === 'chat:s1' && e.to === 'f:src/a.ts' && e.kind === 'touched'))
    assert.ok(map.edges.some(e => e.from === 'f:src/a.ts' && e.to === 'f:src/b.ts' && e.kind === 'import'))
    assert.equal(map.nodes.find(n => n.id === 'f:src/a.ts')?.folder, 'd:src')
  })

  it('builds from a fake home, folds subagents into their chat, and serves the cache until a transcript changes', async () => {
    const home = tmp(), proj = tmp()
    put(proj, 'src/a.ts', 'export {}')
    const dir = path.join(home, '.claude', 'projects', slugOf(proj))
    put(dir, 's1.jsonl', `${tool('Edit', { file_path: path.join(proj, 'src/a.ts') })}\n`)
    put(dir, 's1/subagents/agent-1.jsonl', `${tool('Skill', { skill: 'dataviz' })}\n`)
    put(dir, 's1/subagents/agent-1.meta.json', '{"agentType":"qa"}')
    const one = await buildFlowMap(proj, {}, [proj], home)
    assert.ok(one.nodes.some(n => n.id === 'skill:dataviz'))
    assert.ok(one.nodes.some(n => n.id === 'role:qa'))
    assert.ok(one.edges.some(e => e.to === 'f:src/a.ts' && e.kind === 'touched'))
    assert.equal(await buildFlowMap(proj, {}, [proj], home), one)
    fs.appendFileSync(path.join(dir, 's1.jsonl'), `${tool('Skill', { skill: 'ponytail' })}\n`)
    fs.utimesSync(path.join(dir, 's1.jsonl'), new Date(), new Date(Date.now() + 6 * 60_000))
    assert.ok((await buildFlowMap(proj, {}, [proj], home)).nodes.some(n => n.id === 'skill:ponytail'))
    await assert.rejects(buildFlowMap('relative/path', {}, [proj], home))
    fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(proj, { recursive: true, force: true })
  })
})

describe('GET /hub/flowmap', () => {
  it('needs the token and a cwd, and answers a project folder with its map', async () => {
    const h = new HubService(), proj = tmp()
    h.set({ projects: [{ name: 'p', path: proj, kind: 'project', isOpen: true }] })
    put(proj, 'a.ts', "import './b'")
    put(proj, 'b.ts', '')
    const get = (q: string) => Promise.resolve(handleHub(h, 'GET', `/hub/flowmap?${q}`, '') as HubReply | Promise<HubReply>)
    assert.equal((await get(`cwd=${encodeURIComponent(proj)}`)).status, 403)
    assert.equal((await get(`token=${h.token}`)).status, 400)
    assert.equal((await get(`token=${h.token}&cwd=nope`)).status, 400)
    assert.equal((await get(`token=${h.token}&cwd=${encodeURIComponent('/')}`)).status, 400)
    const ok = await get(`token=${h.token}&cwd=${encodeURIComponent(proj)}`)
    assert.equal(ok.status, 200)
    assert.ok((JSON.parse(ok.body) as { edges: { kind: string }[] }).edges.some(e => e.kind === 'import'))
    fs.rmSync(proj, { recursive: true, force: true })
  })
})

describe('qa fixes', () => {
  it('only maps a known project folder or a folder inside one, after symlinks', async () => {
    const home = tmp(), proj = tmp(), other = tmp()
    put(proj, 'sub/a.ts', '')
    fs.symlinkSync(other, path.join(proj, 'out-link'))
    await assert.rejects(buildFlowMap('/', {}, [proj], home), /not a known project/)
    await assert.rejects(buildFlowMap(other, {}, [proj], home), /not a known project/)
    await assert.rejects(buildFlowMap(path.join(proj, 'out-link'), {}, [proj], home), /not a known project/)
    await assert.rejects(buildFlowMap(`${proj}-x`, {}, [proj], home))
    assert.ok((await buildFlowMap(path.join(proj, 'sub'), {}, [proj], home)).nodes.some(n => n.id === 'f:a.ts'))
    for (const d of [home, proj, other]) fs.rmSync(d, { recursive: true, force: true })
  })

  it('stops walking once the cap is reached', async () => {
    const root = tmp()
    for (const d of ['a', 'b', 'c', 'd', 'e']) put(root, `${d}/x/f.ts`, '')
    const real = fs.promises.readdir
    let calls = 0
    ;(fs.promises as { readdir: unknown }).readdir = (...a: unknown[]) => { calls++; return (real as (...x: unknown[]) => unknown)(...a) }
    try { assert.equal((await scanCode(root, 1)).cut, true) } finally { (fs.promises as { readdir: unknown }).readdir = real }
    assert.ok(calls <= 4, `readdir ran ${calls} times`)
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('keeps at most 10 projects cached', async () => {
    const home = tmp(), dirs = Array.from({ length: 12 }, () => tmp())
    for (const d of dirs) await buildFlowMap(d, {}, dirs, home)
    assert.ok(flowCacheSize() <= 10)
    for (const d of [home, ...dirs]) fs.rmSync(d, { recursive: true, force: true })
  })

  it('redacts header and README text', () => {
    const key = 'sk-ant-api03-' + 'A'.repeat(40)
    assert.ok(!headerOf(`// Calls the API with ${key} for now\nexport {}`)?.includes(key))
    assert.ok(!readmeLine(`Uses ${key} to sign in.`)?.includes(key))
  })

  it('reads the mod list from kit/setup.json', () => {
    const kit = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'kit', 'setup.json'), 'utf8')) as { mods: string[] }
    assert.deepEqual(KIT_MODS, kit.mods)
  })

  it('names a handoff chat by its note title or file name, never the path', () => {
    const dir = tmp(), note = path.join(dir, '2026-11-08-1034-agent-flow-chat-view-f426e746.md')
    fs.writeFileSync(note, '# Handoff v3 · Codex Setup\nFrom: x\n')
    const said = (file: string) => { const w = newWork('s'); addLine(w, JSON.stringify({ type: 'user', message: { content: `Continue from ${file}: read it first, then carry on.` } }), '/p'); return w.label }
    assert.equal(said(note), 'Codex Setup v3')
    assert.equal(said(path.join(dir, '2026-11-08-0900-agent-flow-gone-12345678.md')), 'agent-flow-gone-12345678')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('takes chat names from live chats, then the archive', () => {
    const s = { chats: [{ sessionId: 'a', name: 'Live' }, { sessionId: 'c' }], archive: [{ sessionId: 'a', name: 'Old' }, { sessionId: 'b', name: 'Archived' }] } as unknown as Parameters<typeof flowLabels>[0]
    assert.deepEqual(flowLabels(s), { a: 'Live', b: 'Archived' })
  })

  it('skips agent and build folders in the code scan', async () => {
    const root = tmp()
    put(root, 'src/a.ts', '')
    for (const d of ['docs/superpowers/prototypes', '.superpowers', '.claude', '.playwright-mcp', 'node_modules', '.next', 'dist', 'out']) put(root, `${d}/x.ts`, '')
    put(root, 'docs/site/b.ts', '')
    assert.deepEqual([...(await scanCode(root)).files.keys()], ['docs/site/b.ts', 'src/a.ts'])
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('folds chats that ran in a subfolder into the project, files relative to the project', async () => {
    const home = tmp(), proj = tmp(), web = path.join(proj, 'web')
    put(proj, 'web/a.ts', '')
    put(path.join(home, '.claude', 'projects', slugOf(web)), 'w1.jsonl', `${tool('Edit', { file_path: 'a.ts' })}\n`)
    const state = { projects: [{ path: proj }], chats: [{ sessionId: 'w1', cwd: web }, { sessionId: 'h', cwd: home }] } as unknown as Parameters<typeof flowRoots>[0]
    assert.deepEqual(flowRoots(state), [proj])
    await assert.rejects(buildFlowMap(home, {}, flowRoots(state), home, flowChatDirs(state)), /not a known project/)
    const map = await buildFlowMap(proj, {}, flowRoots(state), home, flowChatDirs(state))
    assert.ok(map.nodes.some(n => n.id === 'chat:w1'))
    assert.ok(map.edges.some(e => e.from === 'chat:w1' && e.to === 'f:web/a.ts' && e.kind === 'touched'))
    fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(proj, { recursive: true, force: true })
  })

  it('stops walking at the folder cap even with no code files', async () => {
    const root = tmp()
    for (const d of ['a', 'b', 'c', 'd', 'e']) fs.mkdirSync(path.join(root, d, 'x'), { recursive: true })
    put(root, 'e/x/f.ts', '')
    const code = await scanCode(root, 100, 3)
    assert.equal(code.cut, true)
    assert.equal(code.files.size, 0)
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('nests folders by full path, with a node for every ancestor', async () => {
    const root = tmp()
    put(root, 'a.ts', '')
    put(root, 'app/page.ts', '')
    put(root, 'app/api/admin/users/route.ts', '')
    const map = assemble('p', await scanCode(root), [])
    const folder = (id: string) => map.nodes.find(n => n.id === id)
    assert.equal(folder('f:app/api/admin/users/route.ts')?.folder, 'd:app/api/admin/users')
    assert.equal(folder('f:a.ts')?.folder, 'd:.')
    assert.equal(folder('d:app')?.folder, undefined)
    assert.equal(folder('d:app/api')?.folder, 'd:app')
    assert.equal(folder('d:app/api/admin')?.folder, 'd:app/api')
    assert.equal(folder('d:app/api/admin/users')?.folder, 'd:app/api/admin')
    assert.equal(folder('d:.')?.folder, undefined)
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('names a chat by its title record, never a skill load or meta line', () => {
    const user = (content: string, extra = {}) => JSON.stringify({ type: 'user', ...extra, message: { content } })
    const w = newWork('s')
    for (const l of [user('Base directory for this skill: /Users/k/.claude/skills/x', { isMeta: true }), user('<system-reminder>x</system-reminder>'), user('Base directory for this skill: /Users/k/y')]) addLine(w, l, '/p')
    assert.equal(w.label, undefined)
    addLine(w, user('Fix the code map so deep folders nest and chat names read like titles instead of prompts'), '/p')
    assert.equal((w.label as string | undefined)?.length, 60)
    addLine(w, JSON.stringify({ type: 'ai-title', aiTitle: 'Code map fixes', sessionId: 's' }), '/p')
    assert.equal(assemble('p', { files: new Map(), folders: new Map(), imports: new Map(), cut: false }, [w]).nodes[0].label, 'Code map fixes')
    addLine(w, JSON.stringify({ type: 'custom-title', customTitle: 'agent-flow · map v2', sessionId: 's' }), '/p')
    assert.equal(w.title, 'agent-flow · map v2')
    const s = { chats: [{ sessionId: 'a', name: 'Base directory for this skill: /Users/k' }], archive: [] } as unknown as Parameters<typeof flowLabels>[0]
    assert.deepEqual(flowLabels(s), {})
  })

  it('serves the cache while a running chat keeps writing inside the same 5 minutes', async () => {
    const home = tmp(), proj = tmp()
    put(proj, 'a.ts', '')
    const t = path.join(home, '.claude', 'projects', slugOf(proj), 's.jsonl')
    put(path.dirname(t), 's.jsonl', '{}\n')
    const bucket = Math.floor(Date.now() / 300_000) * 300_000
    fs.utimesSync(t, new Date(), new Date(bucket + 1000))
    const one = await buildFlowMap(proj, {}, [proj], home)
    fs.utimesSync(t, new Date(), new Date(bucket + 2000))
    assert.equal(await buildFlowMap(proj, {}, [proj], home), one)
    fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(proj, { recursive: true, force: true })
  })

  it('leaves out a project folder that holds other projects', () => {
    const state = { projects: [{ path: '/u/GitHub' }, { path: '/u/GitHub/a' }, { path: '/u/GitHub/b' }, { path: '/x' }, { path: '/u/GitHubby' }] } as unknown as Parameters<typeof flowRoots>[0]
    assert.deepEqual(flowRoots(state), ['/u/GitHub/a', '/u/GitHub/b', '/x', '/u/GitHubby'])
  })

  it('keeps a parent project that is a git repo itself', () => {
    const repo = tmp()
    fs.mkdirSync(path.join(repo, '.git'))
    const state = { projects: [{ path: repo }, { path: path.join(repo, 'web') }] } as unknown as Parameters<typeof flowRoots>[0]
    assert.deepEqual(flowRoots(state), [repo, path.join(repo, 'web')])
    fs.rmSync(repo, { recursive: true, force: true })
  })
})
