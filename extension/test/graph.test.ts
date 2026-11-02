/**
 * The memory graph: frontmatter, [[links]] (dangling ones kept off the edges), redaction, and what links to what.
 */
import { describe, it } from 'node:test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import assert from 'node:assert/strict'
import { buildGraph, parseMemory, readGraph, slugOf } from '../src/hub/graph'
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
