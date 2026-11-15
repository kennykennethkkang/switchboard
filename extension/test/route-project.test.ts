import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MOVED, routeProject } from '../src/hub/route-project'

const projects = [
  { name: 'Switchboard', path: '/g/Switchboard' },
  { name: 'armasu', path: '/g/armasu' },
  { name: 'claude-mods', path: '/g/claude-mods' },
]
const same = (p: string) => p

test('moves to the project the answer names, never the current one', async () => {
  let asked = ''
  const to = await routeProject('fix the armasu login page', '/g/Switchboard/extension', projects, async p => { asked = p; return '1' }, 1000, same)
  assert.equal(to, '/g/armasu')
  assert.match(asked, /0\. Switchboard/)
  assert.match(asked, /1\. armasu/)
  assert.match(asked, /2\. claude-mods/)
  assert.doesNotMatch(asked, /\d\. Switchboard\n.*\d\. Switchboard/s)
})

test('0, junk, out of range, error or a slow answer: stay put', async () => {
  const run = (ask: () => Promise<string>, ms = 1000) => routeProject('fix the armasu login', '/g/Switchboard', projects, ask, ms, same)
  assert.equal(await run(async () => '0'), undefined)
  assert.equal(await run(async () => 'not sure'), undefined)
  assert.equal(await run(async () => '9'), undefined)
  assert.equal(await run(async () => { throw new Error('x') }), undefined)
  assert.equal(await run(() => new Promise(r => setTimeout(() => r('1'), 50)), 10), undefined)
})

test('a case twin of the current folder counts as the current project', async () => {
  const real = (p: string) => p.toLowerCase()
  const to = await routeProject('fix the login', '/g/switchboard', projects, async () => '2', 1000, real)
  assert.equal(to, '/g/claude-mods')
  let asked = ''
  await routeProject('fix the login', '/g/switchboard', projects, async p => { asked = p; return '0' }, 1000, real)
  assert.doesNotMatch(asked, /\d\. Switchboard\n/)
})

test('slash commands, moved chats, empty prompts and no other project skip the call', async () => {
  let calls = 0
  const ask = async () => { calls++; return '1' }
  assert.equal(await routeProject('/clear', '/g/Switchboard', projects, ask, 1000, same), undefined)
  assert.equal(await routeProject(`${MOVED} armasu.\n\nfix it`, '/g/Switchboard', projects, ask, 1000, same), undefined)
  assert.equal(await routeProject('<system-reminder>x</system-reminder>  ', '/g/Switchboard', projects, ask, 1000, same), undefined)
  assert.equal(await routeProject('fix it', '/g/Switchboard', projects.slice(0, 1), ask, 1000, same), undefined)
  assert.equal(calls, 0)
})

test('a pasted image or a folder outside every listed project: stay put without asking', async () => {
  let calls = 0
  const ask = async () => { calls++; return '1' }
  assert.equal(await routeProject('fix the armasu page [Image #1]', '/g/Switchboard', projects, ask, 1000, same), undefined)
  assert.equal(await routeProject('fix the armasu login', '/g', projects, ask, 1000, same), undefined)
  assert.equal(await routeProject('fix the armasu login', '/home/k', projects, ask, 1000, same), undefined)
  assert.equal(calls, 0)
})
