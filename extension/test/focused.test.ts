import { it } from 'node:test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import assert from 'node:assert/strict'
import { readFocused, readWindows, writeFocused } from '../src/hub/dev'

it('remembers the window focused last, and is never read as a window', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focused-'))
  try {
    assert.equal(readFocused(dir), undefined)
    writeFocused('/r/a', dir); writeFocused('/r/b', dir)
    assert.equal(readFocused(dir), '/r/b')
    assert.deepEqual(readWindows(dir), [])
    fs.writeFileSync(path.join(dir, 'focused.json'), '{bad')
    assert.equal(readFocused(dir), undefined)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
