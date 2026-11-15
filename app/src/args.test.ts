import { it } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs } from './args'

it('takes the port as --port 4000, --port=4000 and -p 4000', () => {
  assert.equal(parseArgs(['--port', '4000']).port, 4000)
  assert.equal(parseArgs(['--port=4001']).port, 4001)
  assert.equal(parseArgs(['-p', '4002', '--no-open']).port, 4002)
  assert.equal(parseArgs(['--port=nope']).port, parseArgs([]).port)
})

it('-p never takes a flag as its value, and a bad port warns', () => {
  const def = parseArgs([]).port
  const warn = console.error, said: string[] = []
  console.error = (m: string) => { said.push(m) }
  try {
    assert.deepEqual(parseArgs(['-p', '--no-open']), { ...parseArgs(['--no-open']), port: def })
    assert.equal(parseArgs(['--port', '--lan']).lan, true)
    assert.equal(parseArgs(['--port', '70000']).port, def)
    assert.equal(parseArgs(['--port=0']).port, def)
  } finally { console.error = warn }
  assert.equal(said.length, 4)
  assert.ok(said.every(m => m.includes('port')), said.join('|'))
})
