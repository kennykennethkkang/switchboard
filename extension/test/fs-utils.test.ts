/**
 * Unit tests for readNewFileLines.
 *
 * The critical invariant: if a writer flushes a line in two chunks, newSize
 * stops after the last newline, so the next read picks up the whole line.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { readNewFileLines, readFileBytes, tryLock, upperDrive, withLock } from '../src/fs-utils'

describe('upperDrive', () => {
  it('gives one spelling to c:\\ and C:\\, leaving other paths alone', () => {
    assert.equal(upperDrive('c:\\u\\agent-flow'), 'C:\\u\\agent-flow')
    assert.equal(upperDrive('C:\\u'), 'C:\\u')
    assert.equal(upperDrive('/u/c:x'), '/u/c:x')
  })
})

describe('readNewFileLines', () => {
  let dir: string
  let file: string

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-fs-utils-'))
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
