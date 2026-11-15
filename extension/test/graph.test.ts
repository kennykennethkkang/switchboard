/**
 * The memory graph: frontmatter, [[links]] (dangling ones kept off the edges), redaction, and what links to what.
 */
import { describe, it } from 'node:test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import assert from 'node:assert/strict'
import { buildGraph, parseMemory, projectId, readGraph, recall, recentGraph, slugOf } from '../src/hub/graph'
import { emptyHub } from '../src/hub/hub-service'
import type { HubState } from '../src/hub/types'

const MEM = `---
name: armasu-logo
description: the sun logo
metadata:
  type: project
---

Picked Dawn. See [[armasu-colors]] and [[gone-note]], also [[armasu-colors]].
`

describe('parseMemory', () => {
  it('reads name, description, nested type and the links once each', () => {
    const m = parseMemory('armasu-logo.md', MEM)
    assert.equal(m.name, 'armasu-logo')
    assert.equal(m.description, 'the sun logo')
    assert.equal(m.type, 'project')
    assert.deepEqual(m.links, ['armasu-colors', 'gone-note'])
    assert.match(m.body, /^Picked Dawn/)
  })

  it('takes a top-level type, and falls back to the file name and reference', () => {
    assert.equal(parseMemory('a.md', '---\nname: a\ntype: feedback\n---\nx').type, 'feedback')
    const bare = parseMemory('plain-note.md', 'no frontmatter here')
    assert.equal(bare.name, 'plain-note')
    assert.equal(bare.type, 'reference')
    assert.equal(bare.body, 'no frontmatter here')
  })

  it('takes [[name|alias]] as name', () => {
    assert.deepEqual(parseMemory('a.md', 'see [[b|the b note]]').links, ['b'])
  })
})

const state = (extra: Partial<HubState> = {}): HubState => ({
  ...emptyHub(),
  projects: [{ name: 'Armasu', path: '/w/Armasu', kind: 'repo', isOpen: true }],
  ...extra,
})

describe('buildGraph', () => {
  const dir = slugOf('/w/Armasu')
  const mems = [
    { dir, file: 'armasu-logo.md', text: MEM },
    { dir, file: 'armasu-colors.md', text: '---\nname: armasu-colors\nmetadata:\n  type: reference\n---\nkey sk-abcdefghijklmnopqrstuvwxyz here' },
  ]

  it('links memories by [[name]], keeps dangling ones off the edges, and ties each to its project', () => {
    const g = buildGraph(state(), mems, [])
    const logo = g.nodes.find(n => n.label === 'armasu-logo')!
    const colors = g.nodes.find(n => n.label === 'armasu-colors')!
    assert.equal(logo.kind, 'memory')
    assert.equal(logo.type, 'project')
    assert.deepEqual(logo.missing, ['gone-note'])
    assert.ok(g.edges.some(e => e.source === logo.id && e.target === colors.id && e.kind === 'link'))
    assert.ok(!g.edges.some(e => e.target.includes('gone-note')))
    assert.ok(g.edges.some(e => e.source === logo.id && e.target === 'project:/w/Armasu'))
    assert.equal(g.nodes.find(n => n.id === 'project:/w/Armasu')?.label, 'Armasu')
    for (const e of g.edges) assert.ok(g.nodes.some(n => n.id === e.source) && g.nodes.some(n => n.id === e.target), `${e.source} -> ${e.target}`)
  })

  it('redacts keys out of memory and rule text', () => {
    const g = buildGraph(state(), mems, [{ path: '/w/Armasu/CLAUDE.md', text: 'token ghp_abcdefghijklmnopqrstuvwxyz0123' }])
    const text = JSON.stringify(g)
    assert.ok(!text.includes('sk-abcdefghijklmnopqrstuvwxyz'))
    assert.ok(!text.includes('ghp_abcdefghijklmnopqrstuvwxyz0123'))
    assert.ok(text.includes('[removed]'))
    const rule = g.nodes.find(n => n.kind === 'rule')!
    assert.ok(g.edges.some(e => e.source === rule.id && e.target === 'project:/w/Armasu'))
  })

  it('ties a rule file outside every project to each project, since it applies to all of them', () => {
    const g = buildGraph(state(), [...mems, { dir: '-Users-k-Documents-CSEN122', file: 'x.md', text: 'x' }], [{ path: '/home/k/.claude/CLAUDE.md', text: '# rules' }])
    const projects = g.nodes.filter(n => n.kind === 'project').map(n => n.id)
    const rule = g.nodes.find(n => n.kind === 'rule')!
    assert.deepEqual(g.edges.filter(e => e.source === rule.id).map(e => e.target).sort(), projects.sort())
  })

  it('names a memory folder no project claims after its last part', () => {
    const g = buildGraph(state(), [{ dir: '-Users-k-Documents-CSEN122', file: 'x.md', text: 'x' }], [])
    assert.ok(g.nodes.some(n => n.kind === 'project' && n.label === 'CSEN122'))
  })

  it('puts chats under their project and to-do items under their project and chat', () => {
    const g = buildGraph(state({
      chats: [{ pid: 1, sessionId: 's1', name: 'Armasu v2', cwd: '/w/Armasu/app', link: '', live: true, why: [] }],
      archive: [{ sessionId: 's0', ai: 'claude', name: 'Armasu', origin: 'Armasu', version: 1, cwd: '/w/Armasu', project: 'Armasu', archivedAt: 1 }],
      todos: { '/w/Armasu': { todo: [{ id: 't1', text: 'ship the logo', at: 1, chat: 's1' }] } },
    }), [], [])
    assert.ok(g.edges.some(e => e.source === 'chat:s1' && e.target === 'project:/w/Armasu'))
    assert.ok(g.edges.some(e => e.source === 'chat:s0' && e.target === 'project:/w/Armasu'))
    assert.ok(g.edges.some(e => e.source === 'todo:t1' && e.target === 'project:/w/Armasu'))
    assert.ok(g.edges.some(e => e.source === 'todo:t1' && e.target === 'chat:s1'))
  })
})

describe('the graph stays in memory', () => {
  // Memory notes hold ids and addresses redact() lets through; the graph may be shown, never saved.
  it('writes nothing while the route builds and serves it', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-'))
    const mem = path.join(home, '.claude', 'projects', slugOf('/w/Armasu'), 'memory')
    fs.mkdirSync(mem, { recursive: true })
    fs.writeFileSync(path.join(mem, 'armasu-logo.md'), MEM)
    const tree = () => fs.readdirSync(home, { recursive: true }).map(String).sort().map(f => `${f}:${fs.statSync(path.join(home, f)).mtimeMs}`)
    const before = tree()
    const { HubService } = await import('../src/hub/hub-service')
    const { handleHub } = await import('../src/hub/routes')
    const h = new HubService()
    const r = await handleHub(h, 'GET', `/hub/graph?token=${h.token}`, '', undefined, undefined, s => readGraph(s, home))
    assert.equal(r?.status, 200)
    assert.match(r!.body, /armasu-logo/)
    assert.deepEqual(tree(), before)
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('has no file writes in graph.ts or its route', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/hub/graph.ts'), 'utf8')
    assert.doesNotMatch(src, /write|append|createWriteStream|copyFile|rename|mkdir/i)
    const route = fs.readFileSync(path.join(__dirname, '../src/hub/routes.ts'), 'utf8')
    const block = route.slice(route.indexOf("u.pathname === '/hub/graph'"), route.indexOf("u.pathname === '/hub/state'"))
    assert.ok(block.length > 0)
    assert.doesNotMatch(block, /write|append|save|record/i)
  })
})

describe('readGraph skips what is not a plain memory note', () => {
  const home = () => {
    const h = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-'))
    const mem = path.join(h, '.claude', 'projects', slugOf('/w/Armasu'), 'memory')
    fs.mkdirSync(mem, { recursive: true })
    fs.writeFileSync(path.join(mem, 'armasu-logo.md'), MEM)
    return { h, mem }
  }
  const memories = async (h: string) => (await readGraph(state(), h)).nodes.filter(n => n.kind === 'memory').map(n => n.label).sort()

  it('skips a file over 1 MB', async () => {
    const { h, mem } = home()
    fs.writeFileSync(path.join(mem, 'huge.md'), `---\nname: huge\n---\n${'x'.repeat(1_100_000)}`)
    assert.deepEqual(await memories(h), ['armasu-logo'])
    fs.rmSync(h, { recursive: true, force: true })
  })

  it('never opens a FIFO', { timeout: 5000 }, async () => {
    const { h, mem } = home()
    execFileSync('mkfifo', [path.join(mem, 'pipe.md')])
    assert.deepEqual(await memories(h), ['armasu-logo'])
    fs.rmSync(h, { recursive: true, force: true })
  })

  it('skips a symlinked note or memory folder that leads out of ~/.claude/projects', async () => {
    const { h, mem } = home()
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'))
    fs.writeFileSync(path.join(outside, 'secret.md'), '---\nname: secret\n---\nnot a memory')
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(mem, 'secret.md'))
    const other = path.join(h, '.claude', 'projects', '-elsewhere')
    fs.mkdirSync(other)
    fs.symlinkSync(outside, path.join(other, 'memory'))
    assert.deepEqual(await memories(h), ['armasu-logo'])
    fs.rmSync(h, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true })
  })

  it('reads memory/archive as archived notes, but not a symlinked archive folder', async () => {
    const { h, mem } = home()
    fs.mkdirSync(path.join(mem, 'archive'))
    fs.writeFileSync(path.join(mem, 'archive', 'old.md'), '---\nname: old\n---\nhistory')
    const g = await readGraph(state(), h)
    assert.equal(g.nodes.find(n => n.label === 'old')!.superseded, true)
    assert.deepEqual(g.health.orphans, [g.nodes.find(n => n.label === 'armasu-logo')!.id])
    fs.rmSync(path.join(mem, 'archive'), { recursive: true })
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'))
    fs.writeFileSync(path.join(outside, 'secret.md'), '---\nname: secret\n---\nnot a memory')
    fs.symlinkSync(outside, path.join(mem, 'archive'))
    assert.deepEqual(await memories(h), ['armasu-logo'])
    fs.rmSync(h, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true })
  })

  it('cuts a long description to 300 characters', () => {
    const g = buildGraph(state(), [{ dir: 'd', file: 'a.md', text: `---\nname: a\ndescription: ${'y'.repeat(900)}\n---\nx` }], [])
    assert.ok(g.nodes.find(n => n.label === 'a')!.description!.length <= 303)
  })
})

describe('readGraph', () => {
  it('reads memory folders and CLAUDE.md files under a home, skipping MEMORY.md', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-'))
    const mem = path.join(home, '.claude', 'projects', slugOf('/w/Armasu'), 'memory')
    fs.mkdirSync(mem, { recursive: true })
    fs.writeFileSync(path.join(mem, 'MEMORY.md'), '- [Logo](armasu-logo.md)')
    fs.writeFileSync(path.join(mem, 'armasu-logo.md'), MEM)
    fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), '# rules')
    const g = await readGraph(state(), home)
    assert.deepEqual(g.nodes.filter(n => n.kind === 'memory').map(n => n.label), ['armasu-logo'])
    assert.ok(g.nodes.some(n => n.kind === 'rule' && n.label === '~/.claude/CLAUDE.md'))
    fs.rmSync(home, { recursive: true, force: true })
  })
})

describe('the vault', () => {
  const dir = slugOf('/w/Armasu')
  const mems = [{ dir, file: 'armasu-logo.md', text: MEM }]

  it('adds wiki and raw notes, links them by [[slug]] to each other and to memory both ways', () => {
    const g = buildGraph(state(), mems, [], [
      { kind: 'wiki', file: 'logo-history.md', text: 'From [[armasu-logo]] and [[dawn-clip]]. key sk-abcdefghijklmnopqrstuvwxyz' },
      { kind: 'wiki', file: 'armasu-colors.md', text: '# colors' },
      { kind: 'raw', file: 'dawn-clip.md', text: 'clipped' },
    ])
    const wiki = g.nodes.find(n => n.id === 'wiki:logo-history')!
    assert.equal(wiki.kind, 'wiki')
    assert.equal(g.nodes.find(n => n.id === 'raw:dawn-clip')?.kind, 'raw')
    assert.ok(g.edges.some(e => e.source === wiki.id && e.target === 'raw:dawn-clip' && e.kind === 'link'))
    assert.ok(g.edges.some(e => e.source === wiki.id && e.target.startsWith('memory:') && e.kind === 'link'))
    // armasu-logo links [[armasu-colors]], which only the wiki has
    assert.ok(g.edges.some(e => e.source.startsWith('memory:') && e.target === 'wiki:armasu-colors'))
    assert.ok(!JSON.stringify(g).includes('sk-abcdefghijklmnopqrstuvwxyz'))
  })

  it('reads ~/Documents/vault wiki and raw, skipping index.md and log.md, and is a no-op without it', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-'))
    assert.deepEqual((await readGraph(state(), home)).nodes, [])
    const v = path.join(home, 'Documents', 'vault')
    fs.mkdirSync(path.join(v, 'wiki', 'tools'), { recursive: true })
    fs.mkdirSync(path.join(v, 'raw'))
    fs.writeFileSync(path.join(v, 'wiki', 'index.md'), '[[a]]')
    fs.writeFileSync(path.join(v, 'wiki', 'log.md'), 'log')
    fs.writeFileSync(path.join(v, 'wiki', 'a.md'), 'see [[b]]')
    fs.writeFileSync(path.join(v, 'wiki', 'tools', 'b.md'), 'b')
    fs.writeFileSync(path.join(v, 'raw', 'clip.md'), 'c')
    fs.writeFileSync(path.join(v, 'raw', 'paper.pdf'), 'pdf')
    const g = await readGraph(state(), home)
    assert.deepEqual(g.nodes.map(n => n.id).sort(), ['raw:clip', 'wiki:a', 'wiki:tools/b'])
    assert.ok(g.edges.some(e => e.source === 'wiki:a' && e.target === 'wiki:tools/b'))
    fs.rmSync(home, { recursive: true, force: true })
  })

  const vaultHome = () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-'))
    const wiki = path.join(home, 'Documents', 'vault', 'wiki')
    fs.mkdirSync(wiki, { recursive: true })
    fs.writeFileSync(path.join(wiki, 'a.md'), 'a')
    return { home, wiki }
  }
  const ids = async (home: string) => (await readGraph(state(), home)).nodes.map(n => n.id).sort()

  it('never follows a symlinked folder, out of the vault or in a loop', { timeout: 5000 }, async () => {
    const { home, wiki } = vaultHome()
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'))
    fs.writeFileSync(path.join(outside, 'secret.md'), 'secret')
    fs.symlinkSync(outside, path.join(wiki, 'out'))
    fs.symlinkSync(wiki, path.join(wiki, 'loop1'))
    fs.symlinkSync(wiki, path.join(wiki, 'loop2'))
    assert.deepEqual(await ids(home), ['wiki:a'])
    fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true })
  })

  it('keeps the rest of a folder when one subfolder cannot be read', async () => {
    const { home, wiki } = vaultHome()
    fs.mkdirSync(path.join(wiki, 'locked'))
    fs.writeFileSync(path.join(wiki, 'locked', 'x.md'), 'x')
    fs.chmodSync(path.join(wiki, 'locked'), 0o000)
    try { assert.deepEqual(await ids(home), ['wiki:a']) } finally {
      fs.chmodSync(path.join(wiki, 'locked'), 0o755)
      fs.rmSync(home, { recursive: true, force: true })
    }
  })

  it('keeps two notes with one file name in different subfolders apart', () => {
    const g = buildGraph(state(), [], [], [
      { kind: 'wiki', file: 'x/notes.md', text: 'one [[gone]]' },
      { kind: 'wiki', file: 'y/notes.md', text: 'two' },
    ])
    assert.equal(g.nodes.find(n => n.id === 'wiki:x/notes')?.text, 'one [[gone]]')
    assert.equal(g.nodes.find(n => n.id === 'wiki:y/notes')?.text, 'two')
    assert.equal(g.nodes.find(n => n.id === 'wiki:y/notes')?.missing, undefined)
  })

  it('takes a vault note over a memory note of the same name for a vault link', () => {
    const g = buildGraph(state(), [{ dir, file: 'colors.md', text: 'memory colors' }], [], [
      { kind: 'wiki', file: 'page.md', text: '[[colors]]' },
      { kind: 'raw', file: 'colors.md', text: 'clipped colors' },
    ])
    assert.deepEqual(g.edges.filter(e => e.source === 'wiki:page').map(e => e.target), ['raw:colors'])
  })
})

describe('redaction comes before cutting', () => {
  const KEY = 'sk-abcdefghijklmnopqrstuvwxyz'
  it('leaves no key prefix at the text cut, and redacts labels and missing link names', () => {
    const g = buildGraph(state(), [
      { dir: 'd', file: 'a.md', text: `${'x'.repeat(5991)} ${KEY}` },
      { dir: 'd', file: 'b.md', text: `---\nname: ${KEY}\n---\nsee [[${KEY}x]]` },
    ], [])
    const text = JSON.stringify(g)
    assert.ok(!text.includes('sk-abcdef'), text.slice(-400))
  })

  it('keeps two notes in one folder whose names are both secrets, and still links to them by name', () => {
    const KEY2 = 'sk-zyxwvutsrqponmlkjihgfedcba'
    const g = buildGraph(state(), [
      { dir: 'd', file: 'one.md', text: `---\nname: ${KEY}\n---\nfirst` },
      { dir: 'd', file: 'two.md', text: `---\nname: ${KEY2}\n---\nsecond` },
      { dir: 'd', file: 'c.md', text: `see [[${KEY}]] and [[${KEY2}]]` },
    ], [])
    const mems = g.nodes.filter(n => n.kind === 'memory')
    assert.equal(mems.length, 3)
    const one = mems.find(n => n.text === 'first')!
    const two = mems.find(n => n.text === 'second')!
    assert.notEqual(one.id, two.id)
    assert.ok(g.edges.some(e => e.source === 'memory:d/c' && e.target === one.id && e.kind === 'link'))
    assert.ok(g.edges.some(e => e.source === 'memory:d/c' && e.target === two.id && e.kind === 'link'))
    assert.ok(!JSON.stringify(g).includes('sk-'))
  })

  it('keeps secret-named notes apart when the file name is the secret too, or another note uses that name', () => {
    const KEY2 = 'sk-zyxwvutsrqponmlkjihgfedcba'
    const g = buildGraph(state(), [
      { dir: 'd', file: `${KEY}.md`, text: 'first' },
      { dir: 'd', file: `${KEY2}.md`, text: 'second' },
      { dir: 'd', file: 'a.md', text: '---\nname: b\n---\nnamed b' },
      { dir: 'd', file: 'b.md', text: `---\nname: ${KEY}x\n---\nsecret b` },
    ], [])
    const texts = g.nodes.filter(n => n.kind === 'memory').map(n => n.text).sort()
    assert.deepEqual(texts, ['first', 'named b', 'second', 'secret b'])
    assert.ok(!JSON.stringify(g).includes('sk-'))
  })
})

const KG = `---
name: hub-recall
description: how chats query memory
aliases: [recall-tool, "Graph Search"]
supersedes: old-ask
metadata:
  node_type: memory
  type: project
  depends-on: [[graph-core]], vault-wiki
  part-of: [switchboard]
  contradicts: [no-graph]
  related: Kenneth
  originSessionId: s1
  modified: 2026-11-01T10:00:00Z
---
Recall walks the graph. See [[graph-core]] and [[GRAPH SEARCH]].
`

describe('the knowledge graph', () => {
  const dir = slugOf('/w/Armasu')
  const note = (name: string, extra = '', body = 'x') => ({ dir, file: `${name}.md`, text: `---\nname: ${name}\n${extra}---\n${body}` })
  const mems = [
    { dir, file: 'hub-recall.md', text: KG },
    note('old-ask', 'description: ask the brain for everything\n', 'the old way'),
    note('graph-core', 'aliases: core\n'),
    note('switchboard', 'aliases: sb, core\n'),
    note('no-graph', 'contradicts: hub-recall\n'),
    note('kenneth'),
    note('lonely'),
  ]
  const g = () => buildGraph(state({ chats: [{ pid: 1, sessionId: 's1', name: 'kg chat', cwd: '/w/Armasu', link: '', live: true, why: [] }] }), mems, [], [{ kind: 'wiki', file: 'vault-wiki.md', text: 'wiki page' }])
  const id = (label: string) => g().nodes.find(n => n.label === label)!.id
  const has = (s: string, t: string, kind: string) => g().edges.some(e => e.source === id(s) && e.target === id(t) && e.kind === kind)

  it('reads aliases, typed relations from the top level or metadata, origin and modified', () => {
    const m = parseMemory('hub-recall.md', KG)
    assert.deepEqual(m.aliases, ['recall-tool', 'Graph Search'])
    assert.deepEqual(m.rel, { supersedes: ['old-ask'], 'depends-on': ['graph-core', 'vault-wiki'], 'part-of': ['switchboard'], contradicts: ['no-graph'], related: ['Kenneth'] })
    assert.equal(m.origin, 's1')
    assert.equal(m.modified, '2026-11-01T10:00:00Z')
    assert.equal(m.type, 'project')
    assert.deepEqual(m.links, ['graph-core', 'GRAPH SEARCH'])
  })

  it('makes a typed edge per predicate, by name then alias, ignoring case, and a from edge to the chat', () => {
    assert.ok(has('hub-recall', 'old-ask', 'supersedes'))
    assert.ok(has('hub-recall', 'graph-core', 'depends-on'))
    assert.ok(has('hub-recall', 'vault-wiki', 'depends-on'))
    assert.ok(has('hub-recall', 'switchboard', 'part-of'))
    assert.ok(has('hub-recall', 'no-graph', 'contradicts'))
    assert.ok(has('hub-recall', 'kenneth', 'related'))
    assert.ok(g().edges.some(e => e.source === id('hub-recall') && e.target === 'chat:s1' && e.kind === 'from'))
    // [[GRAPH SEARCH]] is hub-recall's own alias: a self link, dropped. [[graph-core]] is already a depends-on.
    assert.ok(!g().edges.some(e => e.source === id('hub-recall') && e.kind === 'link'))
    // "core" is graph-core's alias and switchboard's too; the name wins over neither, the first claim does.
    const b = buildGraph(state(), [note('a', '', 'see [[Core]] and [[SB]]'), ...mems.slice(2, 4)], [])
    assert.deepEqual(b.edges.filter(e => e.kind === 'link').map(e => e.target).sort(), [`memory:${dir}/graph-core`, `memory:${dir}/switchboard`])
  })

  it('fills the node fields and the health report', () => {
    const n = g().nodes.find(x => x.label === 'hub-recall')!
    assert.deepEqual(n.aliases, ['recall-tool', 'Graph Search'])
    assert.equal(n.origin, 's1')
    assert.equal(n.modified, '2026-11-01T10:00:00Z')
    assert.equal(g().nodes.find(x => x.label === 'old-ask')!.superseded, true)
    assert.equal(n.superseded, undefined)
    const h = g().health
    assert.deepEqual(h.superseded, [id('old-ask')])
    assert.deepEqual(h.contradictions, [[id('hub-recall'), id('no-graph')]])
    assert.deepEqual(h.duplicates, ['core'])
    assert.deepEqual(h.orphans, [id('lonely')])
    assert.deepEqual(h.dangling, [])
    assert.deepEqual(buildGraph(state(), [note('a', 'part-of: nowhere\n')], []).health.dangling, [`memory:${dir}/a`])
    assert.deepEqual(buildGraph(state(), [note('a', 'part-of: nowhere\n')], []).nodes[0].missing, ['nowhere'])
  })

  it('reports supersede loops as id groups', () => {
    const loop = buildGraph(state(), [note('a', 'supersedes: b\n'), note('b', 'supersedes: c\n'), note('c', 'supersedes: a\n'), note('d', 'supersedes: a\n')], [])
    assert.deepEqual(loop.health.loops, [['a', 'b', 'c'].map(x => `memory:${dir}/${x}`)])
    assert.deepEqual(buildGraph(state(), [note('a', 'supersedes: b\n'), note('b', '')], []).health.loops, [])
  })

  it('keeps an archived note linkable and superseded, but out of every health list', () => {
    const old = { ...note('old', 'type: project\n'), archived: true, mtime: 0 }
    const b = buildGraph(state(), [note('new', 'supersedes: old\n'), old, note('b', '', 'see [[old]] and [[new]]')], [])
    assert.equal(b.nodes.find(x => x.label === 'old')!.superseded, true)
    assert.ok(b.edges.some(e => e.target === `memory:${dir}/archive/old` && e.kind === 'link'))
    assert.deepEqual([b.health.superseded, b.health.dangling, b.health.orphans, b.health.stale], [[], [], [], []])
    // History says nothing about live notes: an archived note's supersedes and contradicts are dropped.
    const said = buildGraph(state(), [{ ...note('gone', 'supersedes: live\ncontradicts: live\n'), archived: true }, note('live', '', '[[gone]]')], [])
    assert.equal(said.nodes.find(x => x.label === 'live')!.superseded, undefined)
    assert.deepEqual([said.health.superseded, said.health.contradictions], [[], []])
    // An archived note sharing a live note's name loses to it and is no clash.
    const twin = buildGraph(state(), [{ ...note('new', '', 'old text'), archived: true }, note('new', '', 'live'), note('c', '', '[[new]]')], [])
    assert.deepEqual(twin.health.duplicates, [])
    assert.match(twin.nodes.find(x => x.id === `memory:${dir}/new`)!.text!, /live/)
    assert.ok(twin.edges.some(e => e.source === `memory:${dir}/c` && e.target === `memory:${dir}/new`))
  })

  it('recalls the best seeds, their relations within the hops, and skips superseded notes', () => {
    const r = recall(g(), 'hub recall')
    assert.match(r, /^hub-recall: how chats query memory\n {2}Recall walks the graph/)
    assert.match(r, /\(hub-recall\) --\[depends-on\]--> \(graph-core\)/)
    assert.match(r, /\(no-graph\) --\[contradicts\]--> \(hub-recall\)/)
    assert.match(r, /\(hub-recall\) --\[in\]--> \(Armasu\)/)
    assert.doesNotMatch(r, /old-ask/)
    assert.doesNotMatch(r, /kg chat/)
    const lines = r.split('\n').filter(l => l.includes('--['))
    assert.equal(new Set(lines).size, lines.length)
    // The seed's project first, then its own relations, sorted.
    assert.match(lines[0], /--\[in\]-->/)
    assert.deepEqual(lines.slice(1), [...lines.slice(1)].sort())
    assert.ok(r.length <= 1500)
  })

  it('shows a superseded note that is a seed, marked, follows aliases, and says when nothing matches', () => {
    assert.match(recall(g(), 'old-ask'), /^old-ask \(superseded\): ask the brain/)
    assert.match(recall(g(), 'old-ask'), /\(hub-recall\) --\[supersedes\]--> \(old-ask, superseded\)/)
    assert.match(recall(g(), 'recall-tool'), /^hub-recall:/)
    assert.equal(recall(g(), 'zebra'), 'Nothing in memory matches "zebra".')
    assert.ok(recall(g(), 'graph', 1).split('\n\n')[0].split('\n').filter(l => !l.startsWith('  ')).length <= 3)
  })

  it('stays redacted and near 1500 characters on a big graph', () => {
    const many = Array.from({ length: 80 }, (_, i) => note(`n${i}`, `related: [${Array.from({ length: 10 }, (_, j) => `n${(i + j + 1) % 80}`).join(', ')}]\n`, `body sk-abcdefghijklmnopqrstuvwxyz ${i}`))
    const r = recall(buildGraph(state(), many, []), 'n1')
    assert.ok(r.length <= 1500, String(r.length))
    assert.ok(!r.includes('sk-abcdef'))
  })
})

describe('GET /hub/recall', () => {
  it('needs the token and a query, and answers recall over the graph it is given', async () => {
    const { HubService } = await import('../src/hub/hub-service')
    const { handleHub } = await import('../src/hub/routes')
    const h = new HubService()
    const graph = async (s: HubState) => buildGraph(s, [{ dir: 'd', file: 'a.md', text: '---\nname: alpha\ndescription: the first\n---\nbody' }], [])
    const get = (url: string, token?: string) => handleHub(h, 'GET', url, '', undefined, undefined, graph, undefined, undefined, token)
    assert.equal((await get('/hub/recall?q=alpha'))?.status, 403)
    assert.equal((await get('/hub/recall?cwd=/w', h.token))?.status, 400)
    const r = await get('/hub/recall?q=alpha&cwd=/w', h.token)
    assert.equal(r?.status, 200)
    assert.match(r!.body, /^alpha: the first/)
  })
})

describe('health: invalid and stale', () => {
  const now = Date.parse('2026-11-04T00:00:00Z')
  const m = (file: string, head: string) => ({ dir: 'd', file, text: `---\n${head}---\nx` })
  const g = buildGraph(state(), [
    m('ok.md', 'name: ok\ndescription: fine\nmetadata:\n  type: project\n  modified: 2026-10-01T00:00:00Z\n'),
    m('old.md', 'name: old\ndescription: fine\ntype: project\nmodified: 2026-07-01T00:00:00Z\n'),
    m('oldref.md', 'name: oldref\ndescription: fine\ntype: reference\nmodified: 2025-01-01T00:00:00Z\n'),
    m('nodesc.md', 'name: nodesc\ntype: user\n'),
    m('notype.md', 'name: notype\ndescription: fine\n'),
    m('badtype.md', 'name: badtype\ndescription: fine\ntype: misc\n'),
  ], [], [{ kind: 'wiki', file: 'page.md', text: 'no frontmatter' }], now)

  it('flags memory notes with no description or a type missing or outside the four, never vault pages', () => {
    assert.deepEqual(g.health.invalid, ['memory:d/nodesc', 'memory:d/notype', 'memory:d/badtype'])
    assert.equal(parseMemory('a.md', 'x').typed, false)
    assert.equal(parseMemory('a.md', '---\ntype: user\n---\nx').typed, true)
  })

  it('flags project notes last modified over 90 days before now', () => {
    assert.deepEqual(g.health.stale, ['memory:d/old'])
  })
})

describe('qa round', () => {
  const m = (dir: string, file: string, head: string, body = 'x') => ({ dir, file, text: `---\n${head}---\n${body}` })

  it('never seeds recall with a superseded note unless the query is its name or alias', () => {
    const g = buildGraph(state(), [
      m('d', 'v2.md', 'name: deploy-steps-v2\ndescription: how to deploy\nsupersedes: deploy-steps\n'),
      m('d', 'v1.md', 'name: deploy-steps\naliases: old-deploy\ndescription: how to deploy, old\n'),
    ], [])
    assert.doesNotMatch(recall(g, 'deploy'), /deploy-steps[^-]/)
    assert.match(recall(g, 'Deploy-Steps'), /^deploy-steps \(superseded\)/m)
    assert.match(recall(g, 'OLD-DEPLOY'), /^deploy-steps \(superseded\)/m)
  })

  it('reads an empty key as empty, not the next line, and YAML block lists', () => {
    const p = parseMemory('a.md', '---\ndescription:\nname: a\naliases:\n  - one\n  - "two"\nmetadata:\n  related:\n    - b\n    - [[c|C]]\n  type: user\n---\nx')
    assert.equal(p.description, undefined)
    assert.equal(p.name, 'a')
    assert.deepEqual(p.aliases, ['one', 'two'])
    assert.deepEqual(p.rel.related, ['b', 'c'])
    assert.equal(p.type, 'user')
  })

  it('strips |alias and #section from [[links]] in a relation value', () => {
    assert.deepEqual(parseMemory('a.md', '---\nsupersedes: [[a|A]], [[b#sec]], [c]\n---\nx').rel.supersedes, ['a', 'b', 'c'])
  })

  it('matches query words in any script', () => {
    const g = buildGraph(state(), [m('d', 'jp.md', 'name: 日本-notes\ndescription: travel\n'), m('d', 'c.md', 'name: coffee\ndescription: the café list\n')], [])
    assert.match(recall(g, '日本'), /^日本-notes/)
    assert.match(recall(g, 'Café'), /^coffee/)
  })

  it('keeps one edge per source, target and kind', () => {
    const g = buildGraph(state(), [m('d', 'a.md', 'name: a\nrelated: [b, B]\n', 'see [[b]] and [[B]], [[c]] [[C]]'), m('d', 'b.md', 'name: b\n'), m('d', 'c.md', 'name: c\n')], [])
    const keys = g.edges.map(e => `${e.source} ${e.kind} ${e.target}`)
    assert.equal(new Set(keys).size, keys.length)
    assert.equal(g.edges.filter(e => e.source === 'memory:d/a' && e.kind === 'related').length, 1)
    assert.equal(g.edges.filter(e => e.source === 'memory:d/a' && e.kind === 'link').length, 1)
  })

  it('counts duplicate names within a memory folder or the vault, not across them', () => {
    const g = buildGraph(state(), [m('p1', 'a.md', 'name: same\n'), m('p2', 'a.md', 'name: same\n'), m('p1', 'b.md', 'name: twin\n'), m('p1', 'c.md', 'name: other\naliases: Twin\n')], [], [
      { kind: 'wiki', file: 'same.md', text: 'w' }, { kind: 'wiki', file: 'x/page.md', text: 'one' }, { kind: 'raw', file: 'page.md', text: 'two' },
    ])
    assert.deepEqual(g.health.duplicates, ['twin', 'page'])
  })

  it('takes the file mtime for stale when modified is missing', async () => {
    const now = Date.parse('2026-11-04T00:00:00Z')
    const old = Date.parse('2026-01-01T00:00:00Z')
    const g = buildGraph(state(), [{ ...m('d', 'a.md', 'name: a\ntype: project\n'), mtime: old }, { ...m('d', 'b.md', 'name: b\ntype: project\n'), mtime: now }], [], [], now)
    assert.deepEqual(g.health.stale, ['memory:d/a'])
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-'))
    const mem = path.join(home, '.claude', 'projects', 'd', 'memory')
    fs.mkdirSync(mem, { recursive: true })
    fs.writeFileSync(path.join(mem, 'a.md'), '---\nname: a\ntype: project\n---\nx')
    fs.utimesSync(path.join(mem, 'a.md'), old / 1000, old / 1000)
    assert.deepEqual((await readGraph(state(), home)).health.stale, ['memory:d/a'])
    fs.rmSync(home, { recursive: true, force: true })
  })
})

describe('leftovers', () => {
  it('reads only top-level keys and metadata children, never a block scalar or nested lines', () => {
    const p = parseMemory('real.md', `---
name: real
description: |
  name: evil
  type: feedback
  supersedes: victim
other:
  type: user
  aliases: [sneaky]
metadata:
  nested:
    type: user
    related: deep
  type: project
  related:
    - kept
---
x`)
    assert.equal(p.name, 'real')
    assert.equal(p.description, 'name: evil type: feedback supersedes: victim')
    assert.equal(p.type, 'project')
    assert.deepEqual(p.rel.supersedes, [])
    assert.deepEqual(p.rel.related, ['kept'])
    assert.deepEqual(p.aliases, [])
    assert.equal(parseMemory('a.md', '---\ndescription: >-\n  folded\n  text\ntype: user\n---\nx').type, 'user')
    assert.deepEqual(parseMemory('a.md', '---\naliases:\n- flush\n- left\ntype: user\n---\nx').aliases, ['flush', 'left'])
  })

  it('puts the chat\'s own project first among seeds that score the same, keeping the rest', () => {
    const s = state({ projects: [{ name: 'Armasu', path: '/w/Armasu', kind: 'repo', isOpen: true }, { name: 'Other', path: '/w/Other', kind: 'repo', isOpen: true }] })
    const g = buildGraph(s, [
      { dir: slugOf('/w/Armasu'), file: 'x.md', text: '---\nname: alpha-x\ndescription: d\n---\nx' },
      { dir: slugOf('/w/Other'), file: 'y.md', text: '---\nname: alpha-y\ndescription: d\n---\ny' },
    ], [])
    const order = (r: string) => r.split('\n').filter(l => /^alpha-/.test(l)).map(l => l.slice(0, 7))
    assert.deepEqual(order(recall(g, 'alpha')), ['alpha-x', 'alpha-y'])
    assert.equal(projectId(s, '/w/Other/app'), 'project:/w/Other')
    assert.deepEqual(order(recall(g, 'alpha', 2, projectId(s, '/w/Other/app'))), ['alpha-y', 'alpha-x'])
  })

  it('reads the recall graph once per 30 s, shared by calls in flight, and again after', async () => {
    let reads = 0
    let text = 'one'
    const read = async (st: HubState) => { reads++; await new Promise(r => setTimeout(r, 10)); return buildGraph(st, [{ dir: 'd', file: 'a.md', text: `---\nname: alpha\ndescription: ${text}\n---\nx` }], []) }
    const t = 5_000_000
    const [a, b] = await Promise.all([recentGraph(state(), read, t), recentGraph(state(), read, t + 1)])
    assert.equal(reads, 1)
    assert.equal(a, b)
    text = 'two'
    assert.match(recall(await recentGraph(state(), read, t + 29_000), 'alpha'), /alpha: one/)
    assert.equal(reads, 1)
    assert.match(recall(await recentGraph(state(), read, t + 30_001), 'alpha'), /alpha: two/)
    assert.equal(reads, 2)
    // Another reader (a test's, or readGraph) never gets this one's graph.
    await recentGraph(state(), async st => { reads++; return read(st) }, t + 30_002)
    assert.equal(reads, 4)
  })

  it('reads the graph once for two recalls through the route, and passes cwd on', async () => {
    const { HubService } = await import('../src/hub/hub-service')
    const { handleHub } = await import('../src/hub/routes')
    const h = new HubService()
    let reads = 0
    const graph = async (s: HubState) => { reads++; return buildGraph(s, [{ dir: 'd', file: 'a.md', text: '---\nname: alpha\ndescription: the first\n---\nbody' }], []) }
    const get = () => handleHub(h, 'GET', '/hub/recall?q=alpha&cwd=/w/Armasu', '', undefined, undefined, graph, undefined, undefined, h.token)
    const [r1, r2] = await Promise.all([get(), get()])
    assert.equal(r1?.status, 200); assert.equal(r2?.status, 200)
    assert.equal(reads, 1)
  })
})

describe('graph data from the live audit', () => {
  const dir = slugOf('/w/Armasu')
  it('lists a broken link once, however often it is named', () => {
    const g = buildGraph(state(), [{ dir, file: 'a.md', text: '---\nname: a\nrelated: crowd-ab\n---\nSee [[crowd-ab]] and [[crowd-ab]].' }], [])
    assert.deepEqual(g.nodes.find(n => n.label === 'a')!.missing, ['crowd-ab'])
  })

  it('reads no links inside code, nor ones starting with a colon', () => {
    const m = parseMemory('a.md', 'Real [[b]].\n```\n[[slug]] in a fence\n```\nInline `[[slug]]` and [[:space:]] too.')
    assert.deepEqual(m.links, ['b'])
  })

  it('unescapes quotes and backslashes in a double-quoted value', () => {
    assert.equal(parseMemory('a.md', '---\nname: a\ndescription: "says \\"hi\\" at C:\\\\x"\n---\nx').description, 'says "hi" at C:\\x')
  })

  it('leaves out archived chats outside a registered project', () => {
    const g = buildGraph(state({
      archive: [
        { sessionId: 'b1', ai: 'claude', name: 'solo-t11-2', origin: 'x', version: 1, cwd: '/home/k/.claude/bench-kit/runs/solo-t11-2', project: 'x', archivedAt: 3 },
        { sessionId: 'b2', ai: 'claude', name: 'tmp', origin: 'x', version: 1, cwd: '/private/tmp/claude-501/x', project: 'x', archivedAt: 2 },
        { sessionId: 'b3', ai: 'claude', name: 'GitHub', origin: 'x', version: 1, cwd: '/w', project: 'x', archivedAt: 2 },
        { sessionId: 'ok', ai: 'claude', name: 'Armasu', origin: 'x', version: 1, cwd: '/w/Armasu/app', project: 'x', archivedAt: 1 },
      ],
    }), [], [])
    assert.deepEqual(g.nodes.filter(n => n.kind === 'chat').map(n => n.id), ['chat:ok'])
    assert.deepEqual(g.nodes.filter(n => n.kind === 'project').map(n => n.id), ['project:/w/Armasu'])
  })
})
