/**
 * Unit tests for readNewFileLines.
 *
 * The critical invariant: if a writer flushes a line in two chunks, newSize
 * stops after the last newline, so the next read picks up the whole line.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { readNewFileLines, readFileBytes, readJsonOr, saveMerged, tryLock, upperDrive, withLock } from '../src/fs-utils'

describe('upperDrive', () => {
  it('gives one spelling to c:\\ and C:\\, leaving other paths alone', () => {
    assert.equal(upperDrive('c:\\u\\switchboard'), 'C:\\u\\switchboard')
    assert.equal(upperDrive('C:\\u'), 'C:\\u')
    assert.equal(upperDrive('/u/c:x'), '/u/c:x')
  })
})

describe('readNewFileLines', () => {
  let dir: string
  let file: string

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-fs-utils-'))
    file = path.join(dir, 'sample.jsonl')
  })

  after(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('returns null when file has not grown', () => {
    fs.writeFileSync(file, 'line1\n')
    const size = fs.statSync(file).size
    assert.equal(readNewFileLines(file, size), null)
  })

  it('splits complete lines and leaves tail empty', () => {
    fs.writeFileSync(file, 'a\nb\nc\n')
    const r = readNewFileLines(file, 0)
    assert.ok(r)
    assert.deepEqual(r!.lines, ['a', 'b', 'c'])
    assert.equal(r!.newSize, fs.statSync(file).size)
  })

  it('stops at the last newline so a half-written line is read again whole', () => {
    // Writer flushes mid-line; the caller only keeps newSize.
    fs.writeFileSync(file, 'first\n{"type":"session_meta","pay')
    const first = readNewFileLines(file, 0)
    assert.ok(first)
    assert.deepEqual(first!.lines, ['first'])
    assert.equal(first!.newSize, Buffer.byteLength('first\n'))

    fs.appendFileSync(file, 'load":{}}\n{"type":"other"}\n')
    const second = readNewFileLines(file, first!.newSize)
    assert.ok(second)
    assert.deepEqual(second!.lines, ['{"type":"session_meta","payload":{}}', '{"type":"other"}'])
    assert.equal(second!.newSize, fs.statSync(file).size)
  })

  it('returns null while only a partial line is new', () => {
    fs.writeFileSync(file, 'done\nhalf')
    assert.equal(readNewFileLines(file, Buffer.byteLength('done\n')), null)
  })

  it('keeps a multi-byte char split across reads intact', () => {
    const line = '{"t":"caf\u00e9 \u{1F600}"}\n'
    const bytes = Buffer.from(line)
    fs.writeFileSync(file, bytes.subarray(0, 11)) // ends inside the 2-byte e-acute
    const first = readNewFileLines(file, 0)
    fs.appendFileSync(file, bytes.subarray(11))
    const second = readNewFileLines(file, first?.newSize ?? 0)
    assert.ok(second)
    assert.deepEqual(second!.lines, [line.trim()])
  })

  it('resets to 0 when the file is truncated', () => {
    fs.writeFileSync(file, 'only\n')
    const r = readNewFileLines(file, 9999)
    assert.ok(r)
    assert.deepEqual(r!.lines, [])
    assert.equal(r!.newSize, 0)
  })

  it('tolerates CRLF line endings', () => {
    fs.writeFileSync(file, 'x\r\ny\r\n')
    const r = readNewFileLines(file, 0)
    assert.ok(r)
    assert.deepEqual(r!.lines, ['x', 'y'])
  })

  it('readFileBytes returns only the bytes read when the file is shorter', () => {
    fs.writeFileSync(file, 'abc')
    assert.equal(readFileBytes(file, 0, 10).toString(), 'abc')
  })

  it('returns null when the file does not exist', () => {
    assert.equal(readNewFileLines(path.join(dir, 'missing.jsonl'), 0), null)
  })
})

describe('file locks across windows', () => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-lock-'))

  it('one holder at a time; a stale lock is taken over', () => {
    const lock = path.join(dir(), 'sub', 'x.lock')
    const release = tryLock(lock)
    assert.ok(release)
    assert.equal(tryLock(lock), undefined)
    release!()
    assert.ok(!fs.existsSync(lock))
    fs.writeFileSync(lock, '1')
    const old = new Date(Date.now() - 120_000)
    fs.utimesSync(lock, old, old)
    assert.ok(tryLock(lock))
    assert.ok(tryLock(path.join(path.dirname(lock), 'y.lock'), 0))
  })

  it('a stale lock goes to one of two contenders, and release leaves a lock that is not ours', async () => {
    const d = dir(), lock = path.join(d, 'x.lock'), src = path.resolve(__dirname, '../src/fs-utils.ts')
    const child = path.join(d, 'c.ts')
    fs.writeFileSync(child, `import { tryLock } from ${JSON.stringify(src)}\nconst at = Number(process.argv[2]); while (Date.now() < at) {}\nprocess.stdout.write(tryLock(${JSON.stringify(lock)}) ? 'won' : 'lost')\n`)
    for (let round = 0; round < 3; round++) {
      fs.writeFileSync(lock, '1')
      const old = new Date(Date.now() - 120_000)
      fs.utimesSync(lock, old, old)
      const at = String(Date.now() + 1500)
      const outs = await Promise.all([0, 1, 2].map(() => new Promise<string>(ok => {
        execFile(process.execPath, [...process.execArgv, child, at], (_e, out) => ok(String(out)))
      })))
      assert.equal(outs.filter(o => o === 'won').length, 1, outs.join(' '))
      fs.rmSync(lock, { force: true })
    }
    // a crash left the takeover gate behind: still one winner
    for (let round = 0; round < 2; round++) {
      fs.writeFileSync(lock, '1'); fs.writeFileSync(`${lock}.takeover`, '1')
      const old = new Date(Date.now() - 120_000)
      fs.utimesSync(lock, old, old); fs.utimesSync(`${lock}.takeover`, old, old)
      const at = String(Date.now() + 1500)
      const outs = await Promise.all([0, 1, 2].map(() => new Promise<string>(ok => {
        execFile(process.execPath, [...process.execArgv, child, at], (_e, out) => ok(String(out)))
      })))
      assert.equal(outs.filter(o => o === 'won').length, 1, outs.join(' '))
      fs.rmSync(lock, { force: true })
    }
    const release = tryLock(lock)!
    fs.writeFileSync(lock, 'someone-else')
    release()
    assert.equal(fs.readFileSync(lock, 'utf8'), 'someone-else')
  })

  it('withLock runs the edit under the lock and frees it, and waits out a holder only so long', () => {
    const lock = path.join(dir(), 'x.lock')
    assert.equal(withLock(lock, () => { assert.ok(fs.existsSync(lock)); return 7 }), 7)
    assert.ok(!fs.existsSync(lock))
    const held = tryLock(lock)!
    const t = Date.now()
    assert.equal(withLock(lock, () => 'ran', 50), 'ran')
    assert.ok(Date.now() - t >= 45)
    assert.ok(fs.existsSync(lock), 'the other holder keeps its lock')
    held()
  })
})

it('readJsonOr parses a file and falls back when it is missing or broken', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rjo-'))
  try {
    const f = path.join(dir, 'a.json')
    fs.writeFileSync(f, '{"a":1}')
    assert.deepEqual(readJsonOr(f), { a: 1 })
    fs.writeFileSync(f, '{')
    assert.equal(readJsonOr(f, 'x'), 'x')
    assert.equal(readJsonOr(path.join(dir, 'none.json')), undefined)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

describe('saveMerged', () => {
  it('drops a key another window deleted since the last save, keeps its new ones and says what it dropped', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-merge-')), 'm.json')
    const seen = new Set<string>()
    assert.deepEqual(saveMerged(file, { a: 1, b: 2 }, seen), [])
    fs.writeFileSync(file, JSON.stringify({ b: 2, theirs: 3 }))
    assert.deepEqual(saveMerged(file, { a: 1, b: 2, c: 4 }, seen), ['a'])
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { b: 2, c: 4, theirs: 3 })
    assert.deepEqual(saveMerged(file, { c: 4 }, seen), [])
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { c: 4, theirs: 3 })
  })
})
