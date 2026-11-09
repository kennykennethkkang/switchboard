import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { openCmd } from './open'

describe('openCmd', () => {
  it('opens in the background on macOS', () => {
    assert.deepEqual(openCmd('http://x', 'darwin'), { cmd: 'open', args: ['-g', 'http://x'] })
    assert.deepEqual(openCmd('http://x', 'linux'), { cmd: 'xdg-open', args: ['http://x'] })
    assert.equal(openCmd('http://x', 'win32'), undefined)
  })
})
