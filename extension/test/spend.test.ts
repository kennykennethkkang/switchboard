/** Spend limits: the paid-guard policy and this month's count, as Settings shows them. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { readSpend, setSpend } from '../src/hub/spend'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'spend-'))
const month = new Date().toISOString().slice(0, 7)

describe('spend', () => {
  it('lists every tool with its default mode and no spend', () => {
    const rows = readSpend(tmp())
    assert.deepEqual(rows.find(r => r.key === 'gemini'), { key: 'gemini', label: 'Gemini', mode: 'cap', monthlyUsd: 5, calls: 0, usd: 0 })
    assert.equal(rows.find(r => r.key === 'openrouter')?.mode, 'provider')
    assert.equal(rows.find(r => r.key === 'aws')?.mode, 'ask')
  })

  it('reads this month only and saves a change', () => {
    const dir = tmp()
    fs.writeFileSync(path.join(dir, 'spend.json'), JSON.stringify({ month, keys: { gemini: { calls: 3, usd: 0.15 } } }))
    setSpend('gemini', 'cap', 12, dir)
    setSpend('bland', 'ask', undefined, dir)
    const rows = readSpend(dir)
    assert.deepEqual(rows.find(r => r.key === 'gemini'), { key: 'gemini', label: 'Gemini', mode: 'cap', monthlyUsd: 12, calls: 3, usd: 0.15 })
    assert.equal(rows.find(r => r.key === 'bland')?.mode, 'ask')
    fs.writeFileSync(path.join(dir, 'spend.json'), JSON.stringify({ month: '2000-01', keys: { gemini: { calls: 3, usd: 0.15 } } }))
    assert.equal(readSpend(dir).find(r => r.key === 'gemini')?.calls, 0)
  })

  it('refuses an unknown key or a bad cap', () => {
    assert.throws(() => setSpend('nope', 'ask', undefined, tmp()))
    assert.throws(() => setSpend('gemini', 'cap', -1, tmp()))
  })
})
