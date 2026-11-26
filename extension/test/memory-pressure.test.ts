import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { memoryPressure, readMemoryPressure } from '../src/hub/memory-pressure'

test('memoryPressure accepts only Darwin levels 1, 2 and 4', () => {
  assert.equal(memoryPressure('1\n'), 1)
  assert.equal(memoryPressure('2'), 2)
  assert.equal(memoryPressure('4\n'), 4)
  for (const value of ['0', '3', '5', '', 'pressure: 2', '2\n4', '02', '2.0']) assert.equal(memoryPressure(value), undefined, value)
})

test('readMemoryPressure returns only a supported level and reuses its cached value', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-pressure-'))
  try {
    const first = await readMemoryPressure(directory)
    const second = await readMemoryPressure(directory)
    assert.ok(first === undefined || [1, 2, 4].includes(first))
    assert.equal(second, first)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
