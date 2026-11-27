/**
 * The Learn run's contradiction probe: which notes get paired, the Jev verdict cache, and what memory health lists.
 */
import { describe, it } from 'node:test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import assert from 'node:assert/strict'
import { buildGraph, probedPairs, probeFile, probeKey, readGraph, slugOf, type MemoryFile } from '../src/hub/graph'
import { emptyHub } from '../src/hub/hub-service'
import { PROBE_MAX, probeMemory, probePairs } from '../src/hub/probe'

const note = (name: string, desc: string, body: string, extra = '') => `---\nname: ${name}\ndescription: ${desc}\n${extra}metadata:\n  type: feedback\n---\n\n${body}\n`
const A = slugOf('/w/a'), B = slugOf('/w/b')
const mems = (over: Partial<Record<string, string>> = {}): MemoryFile[] => [
  { dir: A, file: 'tabs-open.md', text: over.open ?? note('tabs-open', 'open browser tabs in the background', 'Open tabs with open -g so focus stays.') },
  { dir: A, file: 'tabs-front.md', text: over.front ?? note('tabs-front', 'open browser tabs in front', 'Open tabs in front of the window.') },
  { dir: B, file: 'tabs-other.md', text: note('tabs-other', 'open browser tabs in front for project b', 'Project b opens tabs in front.') },
]
const graphOf = (m = mems()) => buildGraph(emptyHub(), m, [])

describe('probePairs', () => {
  it('pairs notes that seed the same query, never across project folders', async () => {
    const ids = (await probePairs(graphOf())).map(([a, b]) => `${a.label}|${b.label}`)
    assert.deepEqual(ids, ['tabs-front|tabs-open'])
  })

  it('skips a pair someone already joined with a typed relation', async () => {
    const g = graphOf(mems({ open: note('tabs-open', 'open browser tabs in the background', 'Open tabs with open -g.', 'related: [tabs-front]\n') }))
    assert.deepEqual(await probePairs(g), [])
  })
})

describe('probedPairs', () => {
  it('lists a sure verdict only while both texts are unchanged', () => {
    const g = graphOf(), [a, b] = ['tabs-open', 'tabs-front'].map(l => g.nodes.find(n => n.label === l)!)
    const v = { [probeKey(a, b)]: { a: a.id, b: b.id, p: 0.9 } }
    assert.deepEqual(probedPairs(g, v), [[a.id, b.id].sort()])
    assert.deepEqual(probedPairs(g, { [probeKey(a, b)]: { a: a.id, b: b.id, p: 0.5 } }), [])
    assert.equal(probeKey(a, b), probeKey(b, a))
    const edited = graphOf(mems({ front: note('tabs-front', 'open browser tabs in front', 'Changed: tabs open in front now.') }))
    assert.deepEqual(probedPairs(edited, v), [])
  })
})

describe('probeMemory', () => {
  const setup = () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'))
    for (const m of mems()) { const d = path.join(home, '.claude', 'projects', m.dir, 'memory'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, m.file), m.text) }
    return home
  }

  it('asks Jev once per pair, caches the verdict, and readGraph lists the hit', async () => {
    const home = setup()
    let calls = 0
    const ask = async (preset: string, input: string) => {
      calls++
      assert.equal(JSON.parse(fs.readFileSync(preset, 'utf8')).questions.conflict.type, 'noul')
      const items = JSON.parse(fs.readFileSync(input, 'utf8')) as Array<{ _id: string; a: string; b: string }>
      assert.ok(items.length <= PROBE_MAX)
      assert.match(items[0].a + items[0].b, /background/)
      return [...items.map(i => JSON.stringify({ _id: i._id, conflict: 0.92 })), 'not json'].join('\n')
    }
    assert.match(await probeMemory(emptyHub(), ask, home), /1 of 1 pairs judged now, 1 possible contradiction$/)
    assert.match(await probeMemory(emptyHub(), ask, home), /0 of 1 pairs judged now, 1 possible/)
    assert.equal(calls, 1)
    assert.ok(fs.existsSync(probeFile(home)))
    const g = await readGraph(emptyHub(), home)
    assert.deepEqual(g.health.probed, [[`memory:${A}/tabs-front`, `memory:${A}/tabs-open`]])
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('keeps one verdict per pair when notes share the same text', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'))
    const d = path.join(home, '.claude', 'projects', A, 'memory')
    fs.mkdirSync(d, { recursive: true })
    for (const n of ['same-a', 'same-b', 'same-c']) fs.writeFileSync(path.join(d, `${n}.md`), note(n, 'open browser tabs in front', 'Open tabs in front.'))
    const ask = async (_p: string, input: string) => (JSON.parse(fs.readFileSync(input, 'utf8')) as Array<{ _id: string }>).map(i => JSON.stringify({ _id: i._id, conflict: 0.9 })).join('\n')
    assert.match(await probeMemory(emptyHub(), ask, home), /3 of 3 pairs judged now, 3 possible/)
    assert.equal((await readGraph(emptyHub(), home)).health.probed?.length, 3)
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('keeps nothing when Jev fails, so the next run asks again', async () => {
    const home = setup()
    assert.match(await probeMemory(emptyHub(), async () => undefined, home), /Jev failed on 1 pairs/)
    assert.match(await probeMemory(emptyHub(), async () => '{"_id":"x","_error":"HTTP 402"}', home), /0 of 1 pairs judged now \(1 failed, retried next run\), 0 possible contradictions/)
    assert.deepEqual((await readGraph(emptyHub(), home)).health.probed, [])
    fs.rmSync(home, { recursive: true, force: true })
  })
})
