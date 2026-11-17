import assert from 'node:assert/strict'
import test from 'node:test'
import { formatDuration } from './duration'

test('duration styles keep their established wording and rounding', () => {
  assert.equal(formatDuration(20_000, 'ago'), 'now')
  assert.equal(formatDuration(21 * 60_000, 'ago'), '21 min')
  assert.equal(formatDuration(3 * 3_600_000, 'short'), '3h')
  assert.equal(formatDuration(125 * 60_000, 'stuck'), '2 h')
  assert.equal(formatDuration(83 * 60_000, 'eta'), 'about 1 h 25 min')
  assert.equal(formatDuration(80 * 60_000, 'elapsed'), '1h 20m')
  assert.equal(formatDuration(125 * 60_000, 'countdown'), '2h 5m')
  assert.equal(formatDuration(42 * 60_000, 'cache'), '42 min')
  assert.equal(formatDuration(3 * 3_600_000, 'indefinite'), '3 h ago')
})
