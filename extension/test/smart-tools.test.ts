import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { ChatProfile, Installed } from '../src/hub/types'
import { applyPicks, designSet, indexPick, pickTools, readSmart, smartEvent, watchTools, withGoal } from '../src/hub/smart-tools'
import { defaultProfile } from '../src/hub/tools'

const inv: Installed[] = [
  { kind: 'plugin', name: 'superpowers@superpowers-dev', enabled: true },
  { kind: 'plugin', name: 'impeccable@impeccable', enabled: true },
  { kind: 'plugin', name: 'stitch-design@google-labs-code-stitch-skills', enabled: true },
  { kind: 'plugin', name: 'pixelfx@pixelfx', enabled: true },
  { kind: 'plugin', name: 'aws-core@claude-plugins-official', enabled: true },
  { kind: 'plugin', name: 'bland@bland', enabled: true, held: true },
  { kind: 'plugin', name: 'security-guidance@claude-code-plugins', enabled: false },
  { kind: 'skill', name: 'animate', enabled: true },
  { kind: 'skill', name: 'accessible-motion', enabled: true },
  { kind: 'skill', name: 'hover-interactions', enabled: true },
  { kind: 'skill', name: 'dataviz', enabled: true },
  { kind: 'skill', name: 'phone', enabled: true },
  { kind: 'asset', name: 'linear.app', enabled: true, source: 'library', path: '/lib/linear.app/DESIGN.md' },
  { kind: 'asset', name: 'vercel', enabled: true, source: 'library', path: '/lib/vercel/DESIGN.md' },
]
const names = (ps: { name: string }[]) => ps.map(p => p.name).sort()
const off = (): ChatProfile => ({
  plugins: Object.fromEntries(inv.filter(i => i.kind === 'plugin').map(i => [i.name, i.name.startsWith('superpowers')])),
  skills: Object.fromEntries(inv.filter(i => i.kind === 'skill').map(i => [i.name, false])),
  assets: { '/lib/linear.app/DESIGN.md': false, '/lib/vercel/DESIGN.md': false },
})

test('designSet: every installed design skill and stitch plugin, pixelfx only for pixel art', () => {
  assert.deepEqual(names(designSet(inv, false)), ['accessible-motion', 'animate', 'dataviz', 'hover-interactions', 'impeccable@impeccable', 'stitch-design@google-labs-code-stitch-skills'])
  assert.ok(names(designSet(inv, true)).includes('pixelfx@pixelfx'))
})

test('pickTools: design keywords and the designer role fire the design set with their rule', () => {
  const byWord = pickTools('Polish the settings page layout and hover states', undefined, inv)
  assert.ok(names(byWord).includes('animate'))
  assert.match(byWord.find(p => p.name === 'animate')!.rule, /design words/)
  const byRole = pickTools('', 'designer', inv)
  assert.ok(names(byRole).includes('impeccable@impeccable'))
  assert.match(byRole[0].rule, /designer role/)
})

test('pickTools: other rules by keyword, nothing for a plain task, never a flagged plugin', () => {
  assert.deepEqual(names(pickTools('Deploy the lambda with the AWS CDK', undefined, inv)), ['aws-core@claude-plugins-official'])
  const founder: Installed[] = [{ kind: 'plugin', name: 'founder@emotix', enabled: true }]
  assert.deepEqual(names(pickTools('Work out a pricing strategy for the app', undefined, founder)), ['founder@emotix'])
  assert.deepEqual(names(pickTools('Draft the pitch deck before we fundraise', undefined, founder)), ['founder@emotix'])
  assert.deepEqual(pickTools('Fix the off by one in the parser', undefined, inv), [])
  assert.ok(!names(pickTools('security review of the UI', 'designer', inv)).includes('security-guidance@claude-code-plugins'))
})

test('indexPick: a named brand first, else the index lines sharing the most words', () => {
  const index = '- `linear.app`: near-black, one lavender accent, hairline panels. A dense dark app that should feel crafted and calm.\n- `vercel`: black and white duet. Developer platform pages, deploy or status UI.'
  assert.deepEqual(indexPick('make it look like vercel', index, inv), ['/lib/vercel/DESIGN.md'])
  assert.deepEqual(indexPick('a dense dark app, crafted panels', index, inv), ['/lib/linear.app/DESIGN.md'])
  assert.deepEqual(indexPick('fix it', index, inv), [])
})

test('applyPicks: turns picks on, records the rule, turns off only what it turned on', () => {
  const picks = pickTools('Redesign the dashboard UI', undefined, inv)
  const first = applyPicks(off(), inv, picks, undefined, 1)
  assert.equal(first.profile.skills.animate, true)
  assert.ok(first.record.on.animate)
  assert.ok(first.changed && first.record.pending)
  // The next task fires other rules, so what it switched on goes back off.
  const second = applyPicks(first.profile, inv, pickTools('Deploy to AWS', undefined, inv), first.record, 2)
  assert.equal(second.profile.skills.animate, false)
  assert.equal(second.profile.plugins['aws-core@claude-plugins-official'], true)
  assert.ok(!second.record.on.animate)
})

test('applyPicks: a prompt with no picks keeps the last set', () => {
  const first = applyPicks(off(), inv, pickTools('Redesign the UI', undefined, inv), undefined, 1)
  const again = applyPicks(first.profile, inv, [], first.record, 2)
  assert.equal(again.profile.skills.animate, true)
  assert.equal(again.changed, false)
})

test('applyPicks: a held tool is refused, left off and listed', () => {
  const r = applyPicks(off(), inv, pickTools('Make a Bland voice agent phone call', undefined, inv), undefined, 1)
  assert.equal(r.profile.plugins['bland@bland'], false)
  assert.deepEqual(r.record.refused, ['bland@bland'])
})

test('smartEvent: prompt replaces, SubagentStart adds the role, SessionStart clears pending', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-'))
  const id = '0a9fa6a8-a134-4239-9fd6-258745d9ebe5'
  try {
    const p = smartEvent({ hook_event_name: 'UserPromptSubmit', session_id: id, prompt: 'Restyle the landing page' }, off(), inv, dir, '', 1)
    assert.equal(p?.skills.animate, true)
    assert.equal(readSmart([id], dir)[id].pending, true)
    smartEvent({ hook_event_name: 'SubagentStart', session_id: id, agent_type: 'designer', agent_id: 'a1' }, p!, inv, dir, '', 2)
    assert.match(readSmart([id], dir)[id].why['impeccable@impeccable'], /design/)
    smartEvent({ hook_event_name: 'SessionStart', session_id: id, source: 'resume' }, p!, inv, dir, '', 3)
    assert.equal(readSmart([id], dir)[id].pending, false)
    // A subagent's prompt is not Kenneth's task.
    assert.equal(smartEvent({ hook_event_name: 'UserPromptSubmit', session_id: id, agent_id: 'a1', prompt: 'aws' }, p!, inv, dir, '', 4), undefined)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('watchTools: many changes in a burst push one refresh; a missing path is skipped', async () => {
  const listeners: Array<() => void> = []
  let closed = 0
  const fake = {
    watch: (p: string, fn: () => void) => {
      if (p === '/missing') throw new Error('ENOENT')
      listeners.push(fn)
      return { close: () => { closed++ } }
    },
  }
  let refreshes = 0
  const stop = watchTools(['/a', '/missing', '/b'], () => { refreshes++ }, 20, fake)
  listeners[0](); listeners[1](); listeners[0]()
  await new Promise(r => setTimeout(r, 50))
  assert.equal(refreshes, 1)
  listeners[1]()
  await new Promise(r => setTimeout(r, 50))
  assert.equal(refreshes, 2)
  stop()
  assert.equal(closed, 2)
})

test('watchTools: a rename right before stop never reopens a watch', async () => {
  const listeners: Array<(event?: string) => void> = []
  let opened = 0, closed = 0
  const fake = { watch: (_p: string, fn: (event?: string) => void) => { opened++; listeners.push(fn); return { close: () => { closed++ } } } }
  const stop = watchTools(['/a'], () => {}, 5, fake)
  listeners[0]('rename')
  stop()
  await new Promise(r => setTimeout(r, 80))
  assert.equal(opened, 1)
  assert.equal(closed, 1)
})

test('withGoal: a first message naming AWS starts the chat with aws-core on; a held one stays off', () => {
  const d = defaultProfile(inv)
  assert.equal(d.plugins['aws-core@claude-plugins-official'], false)
  assert.equal(withGoal(d, 'deploy the lambda behind API Gateway', inv).plugins['aws-core@claude-plugins-official'], true)
  assert.equal(withGoal(d, 'set up a voice agent pathway in bland', inv).plugins['bland@bland'], false)
  assert.deepEqual(withGoal(d, 'fix the flaky unit test', inv), d)
  for (const t of ['fix growth of the array', 'dedupe competitors in the engine', 'trace the code pathways', 'amplify the log signal']) assert.deepEqual(withGoal(d, t, inv), d, t)
})
