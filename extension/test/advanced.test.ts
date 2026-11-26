import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { escalationsByProject, excludeSwitchboard, keepSwitchboardDir, readStages, resetEscalations, setStageStatus, writeCompany } from '../src/hub/advanced'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'adv-'))
const put = (f: string, body: unknown) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body)) }
const age = (f: string, at: number) => fs.utimesSync(f, at / 1000, at / 1000)

test('company.json keeps its other keys and gets both settings', () => {
  const d = tmp(); const f = path.join(d, 'company.json')
  put(f, { paused: false, failover: true, budgets: { a: 1 } })
  writeCompany(f, { smartModelSwitch: false, advancedMode: { '/g/x': true }, codexFirst: false })
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { paused: false, failover: true, budgets: { a: 1 }, smartModelSwitch: false, advancedMode: { '/g/x': true }, codexFirst: false })
  fs.writeFileSync(f, '{broken')
  writeCompany(f, { smartModelSwitch: true, advancedMode: {} })
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { smartModelSwitch: true, advancedMode: {} })
})

test('.switchboard is made and excluded once, never in .gitignore', () => {
  const d = tmp()
  put(path.join(d, '.git', 'info', 'exclude'), '# git ls-files --others\n.claude/')
  keepSwitchboardDir(d)
  keepSwitchboardDir(d)
  assert.ok(fs.statSync(path.join(d, '.switchboard')).isDirectory())
  assert.equal(fs.readFileSync(path.join(d, '.git', 'info', 'exclude'), 'utf8'), '# git ls-files --others\n.claude/\n.switchboard/\n')
  assert.equal(fs.existsSync(path.join(d, '.gitignore')), false)
  // Not a repo: the folder only.
  const plain = tmp()
  keepSwitchboardDir(plain)
  assert.ok(fs.existsSync(path.join(plain, '.switchboard')))
  assert.equal(fs.existsSync(path.join(plain, '.git')), false)
})

test('excludeSwitchboard hides .switchboard in a repo without making the folder', () => {
  const d = tmp()
  fs.mkdirSync(path.join(d, '.git'))
  excludeSwitchboard(d)
  excludeSwitchboard(d)
  assert.equal(fs.readFileSync(path.join(d, '.git', 'info', 'exclude'), 'utf8'), '.switchboard/\n')
  assert.equal(fs.existsSync(path.join(d, '.switchboard')), false)
})

test('stages: newest run per chat named in the folder, else the newest run', () => {
  const d = tmp(); const s = path.join(d, '.switchboard', 'stages')
  const st = (status: string) => [{ n: 1, name: 'research', role: 'researcher', status }]
  put(path.join(s, 'old-abc123', 'stages.json'), st('done')); age(path.join(s, 'old-abc123', 'stages.json'), 1000)
  put(path.join(s, 'new-abc123', 'stages.json'), st('doing')); age(path.join(s, 'new-abc123', 'stages.json'), 2000)
  put(path.join(s, 'plain', 'stages.json'), st('todo')); age(path.join(s, 'plain', 'stages.json'), 3000)
  put(path.join(s, 'broken', 'stages.json'), '{nope'); age(path.join(s, 'broken', 'stages.json'), 4000)
  assert.deepEqual(readStages(d, ['abc123', 'zzz']), [{ run: 'new-abc123', sessionId: 'abc123', at: 2000, stages: st('doing') }])
  assert.deepEqual(readStages(d, ['zzz']), [{ run: 'plain', at: 3000, stages: st('todo') }])
  // Bad rows drop; an unknown status drops the row too.
  put(path.join(s, 'plain', 'stages.json'), [{ n: 1, name: 'a', role: 'qa', status: 'redo' }, { n: 'x' }, { n: 2, name: 'b', role: 'qa', status: 'wat' }]); age(path.join(s, 'plain', 'stages.json'), 3000)
  assert.deepEqual(readStages(d, [])[0].stages, [{ n: 1, name: 'a', role: 'qa', status: 'redo' }])
  assert.deepEqual(readStages(tmp(), ['abc123']), [])
})

test('escalations group by project and skip bad rows', () => {
  const d = tmp(); const f = path.join(d, 'model-learn.json')
  const e = { project: '/g/x', role: 'qa', files: ['src/x.ts'], from: 'sonnet', to: 'opus', reason: 'missed bug', at: 5 }
  put(f, [e, { ...e, project: '/g/y', resolvedBy: 'user' }, { project: 1 }, 'x'])
  assert.deepEqual(escalationsByProject(f), { '/g/x': [e], '/g/y': [{ ...e, project: '/g/y', resolvedBy: 'user' }] })
  fs.writeFileSync(f, 'nope')
  assert.deepEqual(escalationsByProject(f), {})
  assert.deepEqual(escalationsByProject(path.join(d, 'missing.json')), {})
})

test('stage status: sets one stage, refuses bad runs and missing stages', () => {
  const d = tmp(); const f = path.join(d, '.switchboard', 'stages', 'r1', 'stages.json')
  put(f, [{ n: 1, name: 'a', role: 'qa', status: 'doing', extra: 'kept' }, { n: 2, name: 'b', role: 'qa', status: 'todo' }])
  assert.equal(setStageStatus(d, 'r1', 1, 'redo'), undefined)
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), [{ n: 1, name: 'a', role: 'qa', status: 'redo', extra: 'kept' }, { n: 2, name: 'b', role: 'qa', status: 'todo' }])
  for (const run of ['..', '../r1', 'a/b', '', '.']) assert.ok(setStageStatus(d, run, 1, 'done'))
  assert.ok(setStageStatus(d, 'nope', 1, 'done'))
  assert.ok(setStageStatus(d, 'r1', 9, 'done'))
})

test('escalation reset drops only the matching rows', () => {
  const d = tmp(); const f = path.join(d, 'model-learn.json')
  const e = { project: '/g/x', role: 'qa', files: ['b.ts', 'a.ts'], from: 'sonnet', to: 'opus', reason: 'r', at: 1 }
  const keep = [{ ...e, role: 'engineer' }, { ...e, files: ['a.ts'] }, { ...e, project: '/g/y' }, 'odd']
  put(f, [e, ...keep, { ...e, at: 2 }])
  resetEscalations(f, '/g/x', 'qa', ['a.ts', 'b.ts'])
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), keep)
  resetEscalations(path.join(d, 'missing.json'), '/g/x', 'qa', [])
  assert.equal(fs.existsSync(path.join(d, 'missing.json')), false)
})

test('a worktree (.git file) gets its exclude line in the shared git dir', () => {
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process')
  const d = tmp()
  const main = path.join(d, 'main'), wt = path.join(d, 'wt')
  const git = (cwd: string, ...a: string[]) => spawnSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=a', ...a], { cwd, encoding: 'utf8' })
  fs.mkdirSync(main)
  git(main, 'init', '-q'); git(main, 'commit', '--allow-empty', '-qm', 'x')
  assert.equal(git(main, 'worktree', 'add', '-q', wt).status, 0)
  assert.ok(fs.statSync(path.join(wt, '.git')).isFile())
  excludeSwitchboard(wt)
  excludeSwitchboard(wt)
  const f = git(wt, 'rev-parse', '--git-path', 'info/exclude').stdout.trim()
  assert.equal(fs.readFileSync(path.resolve(wt, f), 'utf8').split('\n').filter(l => l === '.switchboard/').length, 1)
})
