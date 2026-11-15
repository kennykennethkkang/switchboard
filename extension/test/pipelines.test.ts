import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listPipelines, savePipeline, seedPipeline, takeSeeded } from '../src/hub/pipelines'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-'))
process.env.HOME = home
const cwd = path.join(home, 'proj')
const run = path.join(cwd, '.switchboard', 'stages', '2026-11-14-x-abc')
fs.mkdirSync(path.join(run, '01_research', 'output'), { recursive: true })
fs.mkdirSync(path.join(run, '02_build'), { recursive: true })
fs.writeFileSync(path.join(run, 'stages.json'), JSON.stringify([{ n: 1, name: 'research', role: 'researcher', status: 'done' }, { n: 2, name: 'build', role: 'engineer', status: 'doing' }]))
fs.writeFileSync(path.join(run, '01_research', 'CONTEXT.md'), 'ctx1')
fs.writeFileSync(path.join(run, '01_research', 'output', 'findings.md'), 'secret result')
fs.writeFileSync(path.join(run, '02_build', 'CONTEXT.md'), 'ctx2')

test('save copies stages.json and CONTEXT.md only', () => {
  const p = savePipeline(cwd, '2026-11-14-x-abc', 'Research then build')
  assert.equal(p.slug, 'research-then-build')
  assert.equal(p.stages, 2)
  const dir = path.join(home, '.claude', 'switchboard', 'pipelines', p.slug)
  assert.equal(fs.readFileSync(path.join(dir, '02_build', 'CONTEXT.md'), 'utf8'), 'ctx2')
  assert.equal(fs.existsSync(path.join(dir, '01_research', 'output')), false)
  assert.deepEqual(listPipelines().map(x => x.slug), ['research-then-build'])
})

test('seed makes the run folder with every status todo', () => {
  const dest = seedPipeline('research-then-build', cwd, 'new-run')
  assert.equal(dest, path.join(cwd, '.switchboard', 'stages', 'new-run'))
  const rows = JSON.parse(fs.readFileSync(path.join(dest, 'stages.json'), 'utf8'))
  assert.deepEqual(rows.map((r: { status: string }) => r.status), ['todo', 'todo'])
  assert.equal(fs.readFileSync(path.join(dest, '01_research', 'CONTEXT.md'), 'utf8'), 'ctx1')
  assert.equal(fs.existsSync(path.join(dest, '01_research', 'output')), true)
})

test('bad names, slugs and run ids are refused', () => {
  assert.throws(() => savePipeline(cwd, '../x', 'a'))
  assert.throws(() => savePipeline(cwd, 'nope', 'a'))
  assert.throws(() => seedPipeline('../x', cwd, 'r'))
  assert.throws(() => seedPipeline('research-then-build', cwd, '../r'))
  assert.throws(() => seedPipeline('research-then-build', cwd, 'new-run'))
})

test('takeSeeded names the fresh seeded run once', () => {
  const line = takeSeeded(cwd)
  assert.match(line, /\.switchboard\/stages\/new-run\//)
  assert.equal(takeSeeded(cwd), '')
  seedPipeline('research-then-build', cwd, 'old-run')
  assert.equal(takeSeeded(cwd, Date.now() + 6 * 60_000), '')
})

test('a failed re-save keeps the old pipeline', () => {
  const dir = path.join(home, '.claude', 'switchboard', 'pipelines', 'keepme')
  savePipeline(cwd, '2026-11-14-x-abc', 'keepme')
  fs.rmSync(path.join(run, 'stages.json'))
  assert.throws(() => savePipeline(cwd, '2026-11-14-x-abc', 'keepme'))
  assert.equal(fs.readFileSync(path.join(dir, '02_build', 'CONTEXT.md'), 'utf8'), 'ctx2')
  fs.writeFileSync(path.join(run, 'stages.json'), JSON.stringify([{ n: 1, name: 'research', role: 'researcher', status: 'done' }]))
  fs.rmSync(path.join(run, '02_build'), { recursive: true })
  fs.mkdirSync(path.join(run, '02_build', 'CONTEXT.md'), { recursive: true })
  assert.throws(() => savePipeline(cwd, '2026-11-14-x-abc', 'keepme'))
  assert.equal(fs.readFileSync(path.join(dir, '01_research', 'CONTEXT.md'), 'utf8'), 'ctx1')
  assert.deepEqual(fs.readdirSync(path.dirname(dir)).filter(n => n.includes('.tmp')), [])
})
