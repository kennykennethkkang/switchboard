import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { dropEffortGuard, keepEffortDefault, logPick, readPick, type PickRow } from '../src/hub/picks'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-picks-'))
const row = (o: Partial<PickRow> = {}): PickRow => ({ at: 1, session: 's1', project: 'p', ai: 'claude', role: 'lead', model: 'opus', effort: 'high', ultracode: false, ultrathink: false, reason: 'routine task', auto: true, ...o })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('picks log', () => {
  it('appends one JSON row per pick and reads a session back, the latest first', () => {
    const dir = tmp(), file = path.join(dir, 'x', 'picks.jsonl')
    try {
      logPick(row({ effort: 'medium' }), file)
      logPick(row({ session: 's2', model: 'sonnet' }), file)
      logPick(row({ effort: 'xhigh', ultracode: true }), file)
      assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 3)
      assert.deepEqual([readPick('s1', file)?.effort, readPick('s1', file)?.ultracode], ['xhigh', true])
      assert.equal(readPick('s2', file)?.model, 'sonnet')
      assert.equal(readPick('none', file), undefined)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
  it('skips a torn line and a missing file', () => {
    const dir = tmp(), file = path.join(dir, 'picks.jsonl')
    try {
      assert.equal(readPick('s1', file), undefined)
      fs.writeFileSync(file, `${JSON.stringify(row())}\n{"session":"s1","mo`)
      assert.equal(readPick('s1', file)?.model, 'opus')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
  it('never throws: a log that cannot be written does not stop a chat', () => {
    const dir = tmp()
    try {
      fs.writeFileSync(path.join(dir, 'file'), '')
      assert.doesNotThrow(() => logPick(row(), path.join(dir, 'file', 'picks.jsonl')))
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('keepEffortDefault', () => {
  const setup = (settings: object) => {
    const dir = tmp(), file = path.join(dir, 'settings.json')
    fs.writeFileSync(file, JSON.stringify(settings))
    return { dir, file, read: () => JSON.parse(fs.readFileSync(file, 'utf8')) }
  }
  it('puts the default effort back when a per-chat /effort changed it', async () => {
    const t = setup({ effortLevel: 'medium', model: 'opus' })
    try {
      keepEffortDefault(t.file, 30)
      fs.writeFileSync(t.file, JSON.stringify({ effortLevel: 'max', model: 'opus', other: 1 }))
      await sleep(80)
      assert.deepEqual(t.read(), { effortLevel: 'medium', model: 'opus', other: 1 })
    } finally { fs.rmSync(t.dir, { recursive: true, force: true }) }
  })
  it('removes the key when there was no default', async () => {
    const t = setup({ model: 'opus' })
    try {
      keepEffortDefault(t.file, 30)
      fs.writeFileSync(t.file, JSON.stringify({ model: 'opus', effortLevel: 'high' }))
      await sleep(80)
      assert.deepEqual(t.read(), { model: 'opus' })
    } finally { fs.rmSync(t.dir, { recursive: true, force: true }) }
  })
  it('keeps the first snapshot when /effort is sent twice', async () => {
    const t = setup({ effortLevel: 'low' })
    try {
      keepEffortDefault(t.file, 40)
      fs.writeFileSync(t.file, JSON.stringify({ effortLevel: 'high' }))
      keepEffortDefault(t.file, 40)
      fs.writeFileSync(t.file, JSON.stringify({ effortLevel: 'max' }))
      await sleep(120)
      assert.equal(t.read().effortLevel, 'low')
    } finally { fs.rmSync(t.dir, { recursive: true, force: true }) }
  })
  it('does nothing when the gear sets a new default on purpose', async () => {
    const t = setup({ effortLevel: 'low' })
    try {
      keepEffortDefault(t.file, 30)
      dropEffortGuard()
      fs.writeFileSync(t.file, JSON.stringify({ effortLevel: 'xhigh' }))
      await sleep(80)
      assert.equal(t.read().effortLevel, 'xhigh')
    } finally { fs.rmSync(t.dir, { recursive: true, force: true }) }
  })
  it('leaves an unreadable settings file alone', async () => {
    const dir = tmp(), file = path.join(dir, 'settings.json')
    try {
      fs.writeFileSync(file, '{not json')
      keepEffortDefault(file, 20)
      await sleep(60)
      assert.equal(fs.readFileSync(file, 'utf8'), '{not json')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})
