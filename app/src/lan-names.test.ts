import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { afterRead, macNamesOf } from '../../extension/src/hub/lan'

describe('afterRead', () => {
  const ts = (o: object) => JSON.stringify({ BackendState: 'Running', CertDomains: ['kennys-mbp.tail1234.ts.net'], Self: { DNSName: 'Kennys-MBP.tail1234.ts.net.' }, ...o })
  it('keeps the last name when a read fails or times out, so the phone is not refused', () => {
    const good = macNamesOf(ts({}))
    assert.equal(afterRead(good, ''), good)
    assert.match(afterRead({}, '').problem!, /sign in/i)
    assert.match(afterRead(good, ts({ BackendState: 'Stopped' })).problem!, /sign in/i)
    assert.deepEqual(afterRead({ problem: 'x' }, ts({})), good)
  })
})
