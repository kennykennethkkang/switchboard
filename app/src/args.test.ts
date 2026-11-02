import { it } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs } from './args'

it('takes the port as --port 4000, --port=4000 and -p 4000', () => {
  assert.equal(parseArgs(['--port', '4000']).port, 4000)
  assert.equal(parseArgs(['--port=4001']).port, 4001)
  assert.equal(parseArgs(['-p', '4002', '--no-open']).port, 4002)
  assert.equal(parseArgs(['--port=nope']).port, parseArgs([]).port)
})
