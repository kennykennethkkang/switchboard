import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { authEnv, buildMapping, decide, isSecret, projectKey, rekey, runSync, type Mapping } from '../src/hub/sync-core'

const tmp = (n: string) => fs.mkdtempSync(path.join(os.tmpdir(), `sb-sync-${n}-`))
const w = (f: string, t: string) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t) }
const r = (f: string) => { try { return fs.readFileSync(f, 'utf8') } catch { return undefined } }

test('decide: the 3-way table', () => {
  const md = (b?: string, l?: string, rr?: string) => decide(b, l, rr, true)
  const js = (b?: string, l?: string, rr?: string) => decide(b, l, rr, false)
  assert.equal(md('a', 'a', 'a'), 'none')
  assert.equal(md('a', 'b', 'a'), 'push')
  assert.equal(md('a', 'a', 'b'), 'pull')
  assert.equal(md('a', 'b', 'c'), 'merge')
  assert.equal(js('a', 'b', 'c'), 'remoteWins')
  assert.equal(md('a', undefined, 'a'), 'removeRepo')
  assert.equal(md('a', 'a', undefined), 'removeLocal')
  assert.equal(md('a', undefined, 'b'), 'pull')
  assert.equal(md('a', 'b', undefined), 'push')
  assert.equal(md('a', undefined, undefined), 'none')
  // no base: never a delete
  assert.equal(md(undefined, 'x', undefined), 'push')
  assert.equal(md(undefined, undefined, 'x'), 'pull')
  assert.equal(md(undefined, 'x', 'y'), 'merge')
  assert.equal(js(undefined, 'x', 'y'), 'remoteWins')
})

test('projectKey: remotes normalize, folder name is the fallback', () => {
  const k = 'github.com/owner/repo'
  for (const u of ['https://github.com/Owner/Repo.git', 'git@github.com:owner/repo.git', 'ssh://git@github.com/Owner/Repo', 'https://x:tok@github.com/owner/repo/']) assert.equal(projectKey(u, '/a/b'), k)
  assert.equal(projectKey(undefined, '/Users/me/Documents/GitHub/Switchboard'), 'switchboard')
  assert.equal(projectKey('', '/a/My App'), 'my_app')
})

test('isSecret: secret-looking files are skipped', () => {
  for (const f of ['prefs/keys.json', 'memory/x/.env.local', 'vault/a/id_rsa', 'vault/server.pem', 'vault/a.key', 'prefs/aws-identity.json', 'prefs/aws-sessions.json', 'vault/credentials.json', 'prefs/phone.secret', 'prefs/vapid.json', 'prefs/push.json', 'prefs/logins.json', 'vault/.npmrc']) assert.ok(isSecret(f), f)
  for (const f of ['memory/x/note.md', 'prefs/groups.json', 'memory/x/llm-prompt-secret-filter.md', 'vault/wiki/credentials-guide.md', 'prefs/aws-prefs.json']) assert.ok(!isSecret(f), f)
})

test('rekey: absolute paths out to keys and back, unknown kept', () => {
  const toKey = (p: string) => (p === '/Users/a/proj' ? 'github.com/o/p' : p)
  const toPath = (k: string) => (k === 'github.com/o/p' ? '/Users/b/proj' : k)
  const colors = JSON.stringify({ '/Users/a/proj': 'violet', '/gone': 'teal' })
  const out = rekey('top', colors, toKey)
  assert.deepEqual(JSON.parse(out), { 'github.com/o/p': 'violet', '/gone': 'teal' })
  assert.deepEqual(JSON.parse(rekey('top', out, toPath)), { '/Users/b/proj': 'violet', '/gone': 'teal' })
  const co = JSON.stringify({ coderView: true, advancedMode: { '/Users/a/proj': true } })
  assert.deepEqual(JSON.parse(rekey('company', co, toKey)), { coderView: true, advancedMode: { 'github.com/o/p': true } })
  assert.equal(rekey('top', 'not json', toKey), 'not json')
})

// One machine: its own home pieces plus the shared bare repo.
function machine(root: string, name: string, bare: string, projPath: string) {
  const h = path.join(root, name)
  const d = { claude: path.join(h, 'claude', 'projects'), vault: path.join(h, 'vault'), sb: path.join(h, 'sb') }
  const map = (): Mapping => buildMapping({ projects: [{ path: projPath, remote: 'git@github.com:o/p.git' }], claudeProjects: d.claude, vault: d.vault, sbDir: d.sb })
  const sync = () => runSync({ repoDir: path.join(h, 'repo'), remote: bare, map: map(), stateFile: path.join(h, 'state.json'), backupDir: path.join(h, 'backups'), host: name })
  const mem = (f: string) => path.join(d.claude, '-Users-' + name + '-proj', 'memory', f)
  return { h, d, sync, mem, backups: path.join(h, 'backups') }
}

test('runSync: two machines through a bare repo', async () => {
  const root = tmp('two')
  const bare = path.join(root, 'bare.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
  const a = machine(root, 'a', bare, '/Users/a/proj'), b = machine(root, 'b', bare, '/Users/b/proj')
  w(a.mem('n.md'), 'one\n'); w(path.join(a.d.vault, 'wiki', 'x.md'), 'x\n'); w(path.join(a.d.sb, 'colors.json'), JSON.stringify({ '/Users/a/proj': 'violet' }))
  w(a.mem('.env'), 'S=1'); w(path.join(a.d.vault, 'big.bin'), 'x'.repeat(6 * 1024 * 1024))
  await a.sync()
  assert.ok(!fs.existsSync(path.join(a.h, 'repo', 'memory', 'github.com', 'o', 'p', '.env')))
  assert.ok(!fs.existsSync(path.join(a.h, 'repo', 'vault', 'big.bin')))
  // first sync on b: local-only note survives, differing md is union-merged, nothing deleted
  w(b.mem('own.md'), 'mine\n'); w(b.mem('n.md'), 'one\ntwo\n')
  await b.sync()
  assert.equal(r(b.mem('own.md')), 'mine\n')
  assert.match(r(b.mem('n.md'))!, /two/)
  assert.equal(r(path.join(b.d.vault, 'wiki', 'x.md')), 'x\n')
  assert.deepEqual(JSON.parse(r(path.join(b.d.sb, 'colors.json'))!), { '/Users/b/proj': 'violet' })
  // a picks up b's note; then a deletes it locally and b follows, with a backup on b
  await a.sync()
  assert.equal(r(a.mem('own.md')), 'mine\n')
  fs.rmSync(a.mem('own.md')); await a.sync(); await b.sync()
  assert.equal(r(b.mem('own.md')), undefined)
  assert.equal(r(path.join(b.backups, new Date().toISOString().slice(0, 10), 'memory/github.com/o/p/own.md')), 'mine\n')
  // both edit a json: the repo copy wins, the local one is kept in backups
  w(path.join(a.d.sb, 'groups.json'), '{"a":1}'); await a.sync(); await b.sync()
  w(path.join(a.d.sb, 'groups.json'), '{"a":2}'); await a.sync()
  w(path.join(b.d.sb, 'groups.json'), '{"a":3}'); await b.sync()
  assert.equal(r(path.join(b.d.sb, 'groups.json')), '{"a":2}')
  assert.equal(r(path.join(b.backups, new Date().toISOString().slice(0, 10), 'prefs/groups.json')), '{"a":3}')
  fs.rmSync(root, { recursive: true, force: true })
})

const slug = (p: string) => p.replace(/[^a-zA-Z0-9]/g, '-')
type Box = { root: string; bare: (n: string) => string; claude: string; vault: string; sb: string; sync: (o: { projects: string[]; remote?: string }) => Promise<Awaited<ReturnType<typeof runSync>>>; backups: string; repo: string }
function box(): Box {
  const root = tmp('box')
  const bare = (n: string) => { const b = path.join(root, n + '.git'); if (!fs.existsSync(b)) execFileSync('git', ['init', '-q', '--bare', '-b', 'main', b]); return b }
  const d = { claude: path.join(root, 'claude'), vault: path.join(root, 'vault'), sb: path.join(root, 'sb') }
  const sync = (o: { projects: string[]; remote?: string }) => runSync({
    repoDir: path.join(root, 'repo'), remote: o.remote ?? bare('one'), stateFile: path.join(root, 'state.json'), backupDir: path.join(root, 'backups'), host: 'h',
    map: buildMapping({ projects: o.projects.map(p => ({ path: p, remote: 'git@github.com:o/p.git' })), claudeProjects: d.claude, vault: d.vault, sbDir: d.sb }),
  })
  return { root, bare, ...d, sync, backups: path.join(root, 'backups'), repo: path.join(root, 'repo') }
}

test('runSync: an empty or new remote never deletes local files', async () => {
  const b = box()
  w(path.join(b.vault, 'a.md'), 'a\n'); w(path.join(b.vault, 'b.md'), 'b\n')
  await b.sync({ projects: [] })
  const res = await b.sync({ projects: [], remote: b.bare('two') })
  assert.equal(res.removed, 0)
  assert.equal(r(path.join(b.vault, 'a.md')), 'a\n')
  // a different non-empty remote: local-only files stay and go up
  w(path.join(b.vault, 'c.md'), 'c\n')
  await b.sync({ projects: [], remote: b.bare('two') })
  await b.sync({ projects: [], remote: b.bare('three') })
  assert.equal(r(path.join(b.vault, 'c.md')), 'c\n')
  assert.equal(r(path.join(b.repo, 'vault', 'c.md')), 'c\n')
  fs.rmSync(b.root, { recursive: true, force: true })
})

test('runSync: binary files come through byte for byte', async () => {
  const x = tmp('bin'), bare = path.join(x, 'bare.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
  const a = machine(x, 'a', bare, '/Users/a/proj'), c = machine(x, 'c', bare, '/Users/c/proj')
  const bytes = Buffer.from([0x89, 0x50, 0xff, 0xfe, 0x00, 0x80, 0xc3])
  fs.mkdirSync(a.d.vault, { recursive: true }); fs.writeFileSync(path.join(a.d.vault, 'img.png'), bytes)
  await a.sync(); await c.sync()
  assert.deepEqual(fs.readFileSync(path.join(c.d.vault, 'img.png')), bytes)
  fs.rmSync(x, { recursive: true, force: true })
})

test('buildMapping: the main checkout owns a shared key, whatever the order', async () => {
  const b = box()
  const main = path.join(b.root, 'main'), wt = path.join(b.root, 'wt')
  fs.mkdirSync(path.join(main, '.git'), { recursive: true }); fs.mkdirSync(wt); fs.writeFileSync(path.join(wt, '.git'), 'gitdir: x')
  w(path.join(b.claude, slug(main), 'memory', 'n.md'), 'n\n')
  await b.sync({ projects: [wt, main] })
  assert.equal(r(path.join(b.repo, 'memory', 'github.com', 'o', 'p', 'n.md')), 'n\n')
  const res = await b.sync({ projects: [main, wt] })
  assert.equal(res.removed, 0)
  assert.equal(r(path.join(b.claude, slug(main), 'memory', 'n.md')), 'n\n')
  fs.rmSync(b.root, { recursive: true, force: true })
})

test('runSync: a key whose local folder changed deletes nothing that run', async () => {
  const b = box()
  const a = path.join(b.root, 'a'), c = path.join(b.root, 'cc')
  fs.mkdirSync(path.join(a, '.git'), { recursive: true }); fs.mkdirSync(path.join(c, '.git'), { recursive: true })
  w(path.join(b.claude, slug(a), 'memory', 'n.md'), 'n\n')
  await b.sync({ projects: [a] })
  const res = await b.sync({ projects: [c] })
  assert.equal(res.removed, 0)
  assert.equal(r(path.join(b.claude, slug(c), 'memory', 'n.md')), 'n\n')
  assert.equal(r(path.join(b.repo, 'memory', 'github.com', 'o', 'p', 'n.md')), 'n\n')
  fs.rmSync(b.root, { recursive: true, force: true })
})

test('rekey: two paths with one key stay apart, whatever the json order', () => {
  const key = 'github.com/o/p'
  const m = buildMapping({ projects: [{ path: '/p/ab', remote: key }, { path: '/p/a', remote: key }], claudeProjects: '/nope', vault: '/v', sbDir: '/s' })
  for (const j of [{ '/p/a': 'red', '/p/ab': 'blue' }, { '/p/ab': 'blue', '/p/a': 'red' }]) {
    const out = rekey('top', JSON.stringify(j), m.toKey)
    assert.deepEqual(JSON.parse(out), { [key]: 'red', '/p/ab': 'blue' })
    assert.deepEqual(JSON.parse(rekey('top', out, m.toPath)), { '/p/a': 'red', '/p/ab': 'blue' })
  }
})

test('runSync: a pulled keyed json backs up the file it replaces', async () => {
  const x = tmp('keyed'), bare = path.join(x, 'bare.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
  const a = machine(x, 'a', bare, '/Users/a/proj'), c = machine(x, 'c', bare, '/Users/c/proj')
  w(path.join(a.d.sb, 'colors.json'), JSON.stringify({ '/Users/a/proj': 'violet' }))
  await a.sync(); await c.sync()
  w(path.join(a.d.sb, 'colors.json'), JSON.stringify({ '/Users/a/proj': 'teal' }))
  await a.sync(); await c.sync()
  assert.deepEqual(JSON.parse(r(path.join(c.d.sb, 'colors.json'))!), { '/Users/c/proj': 'teal' })
  assert.deepEqual(JSON.parse(r(path.join(c.backups, new Date().toISOString().slice(0, 10), 'prefs/colors.json'))!), { '/Users/c/proj': 'violet' })
  fs.rmSync(x, { recursive: true, force: true })
})

test('authEnv: the token rides in env, not argv', () => {
  const e = authEnv('tok123')
  assert.equal(e.GIT_CONFIG_KEY_0, 'http.extraHeader')
  assert.equal(e.GIT_CONFIG_VALUE_0, 'Authorization: Basic ' + Buffer.from('x-access-token:tok123').toString('base64'))
  assert.ok(!JSON.stringify(e).includes('tok123'))
})

test('mapping: traversal and drive paths resolve to nothing', () => {
  const m = buildMapping({ projects: [], claudeProjects: '/nope', vault: '/v', sbDir: '/s' })
  for (const rel of ['vault/../x', 'vault/a\\..\\x', 'vault/C:/x', 'vault//etc/x', 'vault/\\srv\\x', 'prefs/../keys.json']) assert.equal(m.resolve(rel), undefined, rel)
  assert.ok(m.resolve('vault/ok/x.md'))
})

test('runSync: nothing is written through a symlinked folder', async () => {
  const x = tmp('link'), bare = path.join(x, 'bare.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
  const a = machine(x, 'a', bare, '/Users/a/proj'), c = machine(x, 'c', bare, '/Users/c/proj')
  w(path.join(a.d.vault, 'sub', 'n.md'), 'n\n')
  await a.sync()
  const outside = path.join(x, 'outside'); fs.mkdirSync(outside); fs.mkdirSync(c.d.vault, { recursive: true })
  fs.symlinkSync(outside, path.join(c.d.vault, 'sub'))
  await c.sync()
  assert.deepEqual(fs.readdirSync(outside), [])
  fs.rmSync(x, { recursive: true, force: true })
})

test('mapping: jev presets sync under jev/ and stay inside their folder', () => {
  const j = tmp('jev')
  w(path.join(j, 'p', 'a.json'), '{}'); w(path.join(j, 'keys.json'), '{}')
  const m = buildMapping({ projects: [], claudeProjects: '/nope', vault: '/v', sbDir: '/s', jev: j })
  assert.deepEqual([...m.list().keys()], ['jev/p/a.json'])
  assert.equal(m.resolve('jev/p/a.json')?.root, j)
  assert.equal(m.resolve('jev/../x'), undefined)
  assert.equal(buildMapping({ projects: [], claudeProjects: '/nope', vault: '/v', sbDir: '/s' }).resolve('jev/p/a.json'), undefined)
  fs.rmSync(j, { recursive: true, force: true })
})

test('runSync: a repo recreated at the same url deletes nothing', async () => {
  const x = tmp('recreate'), bare = path.join(x, 'bare.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
  const a = machine(x, 'a', bare, '/Users/a/proj'), b = machine(x, 'b', bare, '/Users/b/proj'), c = machine(x, 'c', bare, '/Users/c/proj')
  w(path.join(a.d.vault, 'n.md'), 'n\n'); w(path.join(a.d.vault, 'wiki', 'x.md'), 'x\n')
  await a.sync(); await b.sync()
  fs.rmSync(bare, { recursive: true, force: true })
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
  w(path.join(c.d.vault, 'c.md'), 'c\n')
  await c.sync()
  const res = await b.sync()
  assert.equal(res.removed, 0)
  assert.equal(r(path.join(b.d.vault, 'n.md')), 'n\n')
  assert.equal(r(path.join(b.d.vault, 'wiki', 'x.md')), 'x\n')
  assert.equal(r(path.join(b.d.vault, 'c.md')), 'c\n')
  fs.rmSync(x, { recursive: true, force: true })
})
