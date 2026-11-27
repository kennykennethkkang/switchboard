import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { keep } from './page-keep.mjs'

const script = fileURLToPath(new URL('./page-keep.mjs', import.meta.url))
const run = (input, ...labels) => spawnSync(process.execPath, [script, ...labels], { input, encoding: 'utf8' })

// BGW530 layout: label and value on separate lines. Values are made up.
const bgw = ['Broadband Status', 'Connected', 'Serial Number', 'AB12CD34EF', 'MSISDN', '15551234567', 'RSRP', '-95 dBm', 'SINR', '12 dB',
  'EID', '89049032000001000000123456789012', 'Default: fakepass123'].join('\n')
// CGW450 layout: label and value on one line, the password label holds the password.
const cgw = 'PasswordDefault: hunter2\nSoftware Version: 6.29.7\nIMEI\t356938035643809\nBand\tB66'

test('keeps only the asked labels, value from the next line', () => {
  const out = keep(bgw, ['RSRP', 'SINR'])
  assert.deepEqual(out, ['RSRP: -95 dBm', 'SINR: 12 dB'])
  for (const s of ['AB12', '1555', '8904', 'fakepass']) assert.ok(!out.join('\n').includes(s), s)
})

test('same line values, colon or tab', () => {
  assert.deepEqual(keep(cgw, ['Software Version', 'Band']), ['Software Version: 6.29.7', 'Band: B66'])
  assert.ok(!keep(cgw, ['Software Version']).join().includes('hunter2'))
})

test('reads agent-browser eval output, a JSON string or array', () => {
  assert.deepEqual(keep(JSON.stringify(cgw), ['Software Version']), ['Software Version: 6.29.7'])
  assert.deepEqual(keep(JSON.stringify(bgw.split('\n')), ['SINR']), ['SINR: 12 dB'])
})

test('withholds a value that looks like a secret row, masks long numbers', () => {
  assert.deepEqual(keep('Note: Router Default: hunter2', ['Note']), ['Note: <withheld>'])
  assert.deepEqual(keep('Info: 8904 9032 1234 5678 9012 3456 7890 1234\nLine 1\n+46 70 123 45 67', ['Info', 'Line 1']), ['Info: <long number>', 'Line 1: <long number>'])
  assert.deepEqual(keep('Modem ID\n89049032000001000000123456789012', ['Modem ID']), ['Modem ID: <long number>'])
  assert.deepEqual(keep('Default Gateway: 192.168.1.254', ['Default Gateway']), ['Default Gateway: 192.168.1.254'])
})

test('an empty value never takes the next row', () => {
  assert.deepEqual(keep('Status:\nSN: ABC123XYZ', ['Status']), ['Status: '])
  assert.deepEqual(keep('Band\nDefault: fakepass123', ['Band']), ['Band: '])
  assert.deepEqual(keep('Note:\nRouter Default: hunter2', ['Note']), ['Note: '])
  assert.deepEqual(keep('Status\nOther:foo\nWAN\nIP Address:1.2.3.4', ['Status', 'WAN']), ['Status: ', 'WAN: '])
  assert.deepEqual(keep('Uptime\n3 days 04:05:06\nWAN MAC\naa:bb:cc:dd:ee:ff\nIPv6\nfe80::1', ['Uptime', 'WAN MAC', 'IPv6']), ['Uptime: 3 days 04:05:06', 'WAN MAC: aa:bb:cc:dd:ee:ff', 'IPv6: fe80::1'])
})

test('empty labels match nothing', () => {
  assert.deepEqual(keep('Status:\nSN: ABC123XYZ\nName\n\nMobile Number\n+46 70 123 45 67', ['', ' ']), [])
})

test('cli: refuses secret labels, exits 1 on no match, prints nothing else', () => {
  for (const labels of [[], [''], [' '], ['SINR', ''], ['Wi-Fi Password'], ['SINR', 'Serial Number'], ['Default'], ['Network Name'], ['Mobile Number'], ['SN'], ['S/N'], ['SIM PIN'], ['WPA-PSK'], ['Wi-Fi Name'], ['WiFi Name'], ['Device ID']]) {
    const r = run(bgw, ...labels)
    assert.equal(r.status, 2, labels.join())
    assert.equal(r.stdout, '')
  }
  const miss = run(bgw, 'Uptime')
  assert.equal(miss.status, 1)
  assert.equal(miss.stdout, '')
  const hit = run(JSON.stringify(bgw), 'RSRP')
  assert.equal(hit.status, 0, hit.stderr)
  assert.equal(hit.stdout, 'RSRP: -95 dBm\n')
  const part = run(bgw, 'RSRP', 'Uptime')
  assert.equal(part.status, 0)
  assert.equal(part.stdout, 'RSRP: -95 dBm\n')
  assert.match(part.stderr, /not found: Uptime/)
})
