import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { firstRunOf } from '../src/hub/first-run'
import { writeCompany } from '../src/hub/advanced'
import { commandProblem } from '../src/hub/routes'
import type { HubState } from '../src/hub/types'

const base: Pick<HubState, 'ais' | 'projects' | 'chats' | 'archive'> = { ais: [], projects: [], chats: [], archive: [] }

test('first run: nothing done on a bare install', () => {
  assert.deepEqual(firstRunOf(base, false, false), { github: false, claude: false, project: false, chat: false, approved: false })
})

test('first run: each step reads its own state', () => {
  const s = {
    ais: [{ id: 'claude' as const, name: 'Claude', installed: true, signedIn: true, chats: 0 }],
    projects: [{ name: 'app', path: '/g/app', kind: 'repo' as const, isOpen: true }],
    chats: [],
    archive: [{ sessionId: 'a', ai: 'claude' as const, name: 'x', origin: 'a', version: 1, cwd: '/g/app', project: 'app', archivedAt: 1, approvedAt: 2 }],
  }
  assert.deepEqual(firstRunOf(s, true, true), { github: true, claude: true, project: true, chat: true, approved: true, dismissed: true })
  // Codex signed in is not Claude; an archived chat never approved is a chat, not an approval.
  const codex = { ...s, ais: [{ id: 'codex' as const, name: 'Codex', installed: true, signedIn: true, chats: 0 }], archive: [{ ...s.archive[0], approvedAt: undefined }] }
  const r = firstRunOf(codex, false, false)
  assert.equal(r.claude, false)
  assert.equal(r.chat, true)
  assert.equal(r.approved, false)
})

test('coder view lands in company.json and leaves the other keys', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'coder-')), 'company.json')
  fs.writeFileSync(f, JSON.stringify({ paused: false }))
  writeCompany(f, { smartModelSwitch: true, advancedMode: {}, coderView: true })
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { paused: false, smartModelSwitch: true, advancedMode: {}, coderView: true })
  // Unset stays out of the file.
  writeCompany(f, { smartModelSwitch: true, advancedMode: {} })
  assert.equal('coderView' in JSON.parse(fs.readFileSync(f, 'utf8')), false)
})

test('hub-coder-view and hub-first-run need a boolean', () => {
  assert.equal(commandProblem({ type: 'hub-coder-view', on: false }), undefined)
  assert.ok(commandProblem({ type: 'hub-coder-view' }))
  assert.ok(commandProblem({ type: 'hub-coder-view', on: 'yes' }))
  assert.equal(commandProblem({ type: 'hub-first-run', dismissed: true }), undefined)
  assert.ok(commandProblem({ type: 'hub-first-run' }))
})
