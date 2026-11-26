import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseCodexAccount, readCodexAccount } from '../src/hub/codex-account'

test('maps Codex rate windows and the last 30 daily usage buckets', () => {
  const parsed = parseCodexAccount({
    rateLimits: { primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1_800_000_000 }, secondary: { usedPercent: 70, windowDurationMins: 10080, resetsAt: 1_800_100_000 } },
    planType: 'plus', rateLimitResetCredits: { availableCount: 2 },
    dailyUsageBuckets: Array.from({ length: 35 }, (_, i) => ({ startDate: `2026-11-${String(i + 1).padStart(2, '0')}`, tokens: i })),
  }, 1_700_000_000_000)
  assert.deepEqual(parsed.windows, [
    { kind: 'codex_five_hour', percentUsed: 20, resetsAt: new Date(1_800_000_000_000).toISOString() },
    { kind: 'codex_seven_day', percentUsed: 70, resetsAt: new Date(1_800_100_000_000).toISOString() },
  ])
  assert.equal(parsed.planType, 'plus')
  assert.equal(parsed.resets, 2)
  assert.equal(parsed.daily.length, 30)
  assert.equal(parseCodexAccount({ rateLimits: { primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: 1 } } }, 2_000).windows[0].percentUsed, 0)
})

test('a Codex that closes stdin early rejects instead of crashing', async () => {
  const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-account-')), 'codex')
  fs.writeFileSync(bin, '#!/bin/sh\nexec 0<&-\necho \'{"id":1,"result":{}}\'\nsleep 1\n', { mode: 0o755 })
  await assert.rejects(readCodexAccount(bin))
  await new Promise(r => setTimeout(r, 200))
  await assert.rejects(readCodexAccount(path.join(path.dirname(bin), 'absent')))
})
