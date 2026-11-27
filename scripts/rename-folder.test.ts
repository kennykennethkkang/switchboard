import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync, spawnSync } from 'child_process'

const SCRIPT = path.join(__dirname, 'rename-folder.sh')
const key = (p: string) => p.replace(/[/.]/g, '-')
const bash = { skip: process.platform === 'win32' && 'rename-folder.sh is a bash script for the Mac checkout' }

function fakeHome() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-rename-')))
  const gh = path.join(home, 'Documents', 'GitHub')
  const src = path.join(gh, 'agent-flow'), dst = path.join(gh, 'switchboard')
  const claude = path.join(home, '.claude'), sb = path.join(claude, 'switchboard')
  const put = (p: string, s = '') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s) }
  put(path.join(src, 'README.md'), 'hi')
  execFileSync('git', ['init', '-q', src])
  execFileSync('git', ['-C', src, 'remote', 'add', 'origin', 'https://github.com/kenny/agent-flow.git'])
  put(path.join(claude, 'projects', key(src), 'memory', 'MEMORY.md'), 'notes')
  put(path.join(claude, 'projects', key(src) + '-extension', 'a.jsonl'), '{}')
  put(path.join(claude, 'projects', key(path.join(gh, 'Armasu')), 'b.jsonl'), '{}')
  put(path.join(sb, 'uploads', 'agent-flow', 'INDEX.md'), `10:00 ${sb}/uploads/agent-flow/2026-11-01/a.png 3 KB chat`)
  put(path.join(sb, 'archive.json'), JSON.stringify([{ cwd: src, project: 'agent-flow' }, { cwd: `${src}/extension` }, { cwd: `${src}-2` }]))
  put(path.join(sb, 'todo', 'todo-sync.json'), JSON.stringify({ [src]: { sync: 'local' } }))
  put(path.join(sb, 'rc-agent-flow.log'), 'log')
  put(path.join(claude, 'handoffs', 'agent-flow', 'h.md'), 'aar-agent-flow stays as content')
  put(path.join(claude, 'jev-presets', 'agent-flow-route.json'), '{}')
  put(path.join(home, '.codex', 'config.toml'), `[projects."${src}"]\ntrust_level = "trusted"\n\n[projects."${src}/web"]\ntrust_level = "trusted"\n`)
  const lsof = path.join(home, 'lsof-stub')
  put(lsof, '#!/bin/sh\n[ -n "$BUSY" ] && printf "p1\\nc%s\\nn%s\\n" "${CMD:-Code Helper}" "$BUSY"\nexit 0\n')
  fs.chmodSync(lsof, 0o755)
  return { home, src, dst, claude, sb, lsof }
}

function run(h: ReturnType<typeof fakeHome>, args: string[], env: Record<string, string> = {}) {
  const e: NodeJS.ProcessEnv = { ...process.env, HOME: h.home, LSOF: h.lsof, ...env }
  delete e.CODEX_HOME; delete e.GH_DIR
  return spawnSync('bash', [SCRIPT, ...args], { env: e, encoding: 'utf8', cwd: h.home })
}

test('dry run changes nothing and prints the gh command', bash, () => {
  const h = fakeHome()
  const r = run(h, [])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /Dry run/)
  assert.match(r.stdout, /gh repo rename switchboard -R kennykennethkkang\/agent-flow/)
  assert.ok(fs.existsSync(h.src) && !fs.existsSync(h.dst))
  assert.ok(fs.existsSync(path.join(h.sb, 'uploads', 'agent-flow')))
  fs.rmSync(h.home, { recursive: true, force: true })
})

test('refuses while VS Code has a cwd inside the folder', bash, () => {
  const h = fakeHome()
  const r = run(h, ['--apply'], { BUSY: path.join(h.src, 'web') })
  assert.equal(r.status, 1)
  assert.match(r.stdout, /refuses until/)
  assert.ok(fs.existsSync(h.src))
  fs.rmSync(h.home, { recursive: true, force: true })
})

// the native claude binary shows up in lsof under its version, not "claude"
test('refuses while a Claude chat named by its version runs inside', bash, () => {
  const h = fakeHome()
  const r = run(h, ['--apply'], { BUSY: h.src, CMD: '2.1.321' })
  assert.equal(r.status, 1)
  assert.match(r.stdout, /2\.1\.321 in/)
  assert.ok(fs.existsSync(h.src))
  fs.rmSync(h.home, { recursive: true, force: true })
})

test('--apply moves the folder and its data, and a second run is a no-op', bash, () => {
  const h = fakeHome()
  for (let i = 0; i < 2; i++) { const r = run(h, ['--apply']); assert.equal(r.status, 0, r.stderr + r.stdout) }
  const read = (p: string) => fs.readFileSync(p, 'utf8')
  assert.ok(!fs.existsSync(h.src) && fs.existsSync(path.join(h.dst, 'README.md')))
  assert.equal(read(path.join(h.claude, 'projects', key(h.dst), 'memory', 'MEMORY.md')), 'notes')
  assert.ok(fs.existsSync(path.join(h.claude, 'projects', key(h.dst) + '-extension', 'a.jsonl')))
  assert.ok(!fs.existsSync(path.join(h.claude, 'projects', key(h.src))))
  assert.ok(fs.existsSync(path.join(h.claude, 'projects', key(path.join(h.home, 'Documents', 'GitHub', 'Armasu')))), 'other projects stay')
  assert.match(read(path.join(h.sb, 'uploads', 'switchboard', 'INDEX.md')), /uploads\/switchboard\/2026-11-01\/a\.png/)
  assert.deepEqual(JSON.parse(read(path.join(h.sb, 'archive.json'))), [
    { cwd: h.dst, project: 'switchboard' }, { cwd: `${h.dst}/extension` }, { cwd: `${h.src}-2` },
  ])
  assert.deepEqual(Object.keys(JSON.parse(read(path.join(h.sb, 'todo', 'todo-sync.json')))), [h.dst])
  assert.ok(fs.existsSync(path.join(h.sb, 'archive.json.pre-rename')))
  assert.ok(fs.existsSync(path.join(h.sb, 'rc-switchboard.log')))
  assert.equal(read(path.join(h.claude, 'handoffs', 'switchboard', 'h.md')), 'aar-agent-flow stays as content')
  assert.ok(fs.existsSync(path.join(h.claude, 'jev-presets', 'switchboard-route.json')))
  assert.equal(read(path.join(h.home, '.codex', 'config.toml')),
    `[projects."${h.dst}"]\ntrust_level = "trusted"\n\n[projects."${h.dst}/web"]\ntrust_level = "trusted"\n`)
  assert.equal(execFileSync('git', ['-C', h.dst, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim(), 'https://github.com/kenny/switchboard.git')
  fs.rmSync(h.home, { recursive: true, force: true })
})
