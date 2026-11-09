/**
 * Uploads: where a file lands, its cleaned name, no overwrites, the INDEX.md line, the size cap,
 * and the streamed /hub/upload route. Temp dirs only.
 */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Readable } from 'stream'
import { SliceUploads, chatLabel, cleanName, readUploads, saveUpload, uploadEvents } from '../src/hub/uploads'
import { handleUpload } from '../src/hub/routes'
import { HubService } from '../src/hub/hub-service'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-up-'))
after(() => fs.rmSync(ROOT, { recursive: true, force: true }))
const now = new Date(2026, 9, 30, 14, 3)
const bytes = (s: string) => [new TextEncoder().encode(s)]

describe('cleanName', () => {
  it('keeps the base name and extension, drops paths and control characters', () => {
    assert.equal(cleanName('../../etc/passwd'), 'passwd')
    assert.equal(cleanName('C:\\Users\\me\\shot.png'), 'shot.png')
    assert.equal(cleanName('a\u0000b\nc.txt'), 'abc.txt')
    assert.equal(cleanName('..'), 'file')
    assert.equal(cleanName(''), 'file')
    assert.equal(cleanName('.env'), '.env')
    const long = cleanName(`${'x'.repeat(300)}.png`)
    assert.ok(long.length <= 200 && long.endsWith('.png'))
  })
})

describe('saveUpload', () => {
  it('saves under uploads/<project>/<date>/, never overwrites, and logs each in INDEX.md', async () => {
    const cwd = path.join(ROOT, 'proj', 'my app')
    fs.mkdirSync(cwd, { recursive: true })
    const a = await saveUpload({ cwd, name: 'shot.png', chat: 'Fix login (abc12345)', root: path.join(ROOT, 'u'), now }, bytes('one'))
    const b = await saveUpload({ cwd, name: 'shot.png', root: path.join(ROOT, 'u'), now }, bytes('two'))
    assert.equal(a, path.join(ROOT, 'u', 'my app', '2026-10-30', 'shot.png'))
    assert.equal(b, path.join(ROOT, 'u', 'my app', '2026-10-30', 'shot (2).png'))
    assert.deepEqual([fs.readFileSync(a, 'utf8'), fs.readFileSync(b, 'utf8')], ['one', 'two'])
    const index = fs.readFileSync(path.join(ROOT, 'u', 'my app', 'INDEX.md'), 'utf8')
    assert.match(index, /^# Uploads: my app\n/)
    assert.match(index, /- 2026-10-30 14:03 \| 2026-10-30\/shot\.png \| 3 B \| Fix login \(abc12345\)\n/)
    assert.match(index, /2026-10-30\/shot \(2\)\.png \| 3 B \| new chat\n/)
    assert.match(fs.readFileSync(path.join(ROOT, 'u', 'README.md'), 'utf8'), /INDEX\.md/)
  })

  it('keeps uploads owner-only: folders 0700, files 0600', async () => {
    const root = path.join(ROOT, 'private')
    const file = await saveUpload({ cwd: path.join(ROOT, 'proj', 'priv'), name: 'k.txt', root, now }, bytes('s'))
    const mode = (p: string) => fs.statSync(p).mode & 0o777
    assert.equal(mode(path.dirname(file)), 0o700)
    assert.equal(mode(path.join(root, 'priv')), 0o700)
    assert.equal(mode(file), 0o600)
    assert.equal(mode(path.join(root, 'README.md')), 0o600)
    assert.equal(mode(path.join(root, 'priv', 'INDEX.md')), 0o600)
  })

  it('keeps a chat label with newlines or pipes to one INDEX.md line', async () => {
    const root = path.join(ROOT, 'inject')
    await saveUpload({ cwd: path.join(ROOT, 'proj', 'inj'), name: 'x.txt', chat: 'evil\n- 2099-01-01 | ../../x | forged', root, now }, bytes('1'))
    const lines = fs.readFileSync(path.join(root, 'inj', 'INDEX.md'), 'utf8').split('\n').filter(l => l.startsWith('- '))
    assert.equal(lines.length, 1)
    assert.match(lines[0], /\| evil - 2099-01-01 \/ \.\.\/\.\.\/x \/ forged$/)
  })

  it('refuses a file over the cap and leaves no partial file', async () => {
    const root = path.join(ROOT, 'cap')
    await assert.rejects(saveUpload({ cwd: ROOT, name: 'big.bin', root, now, max: 4 }, bytes('12345')), (e: Error & { status?: number }) => e.status === 413 && /100 MB|limit/.test(e.message))
    assert.deepEqual(fs.readdirSync(path.join(root, path.basename(ROOT), '2026-10-30')), [])
  })

  it('deletes the partial file when the stream breaks', async () => {
    const root = path.join(ROOT, 'broken')
    const src = Readable.from((async function* () { yield Buffer.from('half'); throw new Error('gone') })())
    await assert.rejects(saveUpload({ cwd: ROOT, name: 'x.txt', root, now }, src), /gone/)
    assert.deepEqual(fs.readdirSync(path.join(root, path.basename(ROOT), '2026-10-30')), [])
  })
})

describe('SliceUploads', () => {
  const day = (root: string) => path.join(root, path.basename(ROOT), '2026-10-30')
  const enc = (s: string) => new TextEncoder().encode(s)

  it('writes slices in order, each before its chunk resolves, and answers the path on end', async () => {
    const root = path.join(ROOT, 'sl-order'), up = new SliceUploads()
    const done = up.start('a', { cwd: ROOT, name: 's.txt', root, now })
    await up.chunk('a', enc('ab'))
    await up.chunk('a', enc('cd'))
    assert.equal(fs.readFileSync(path.join(day(root), 's.txt'), 'utf8'), 'abcd')
    up.end('a')
    assert.equal(fs.readFileSync(await done, 'utf8'), 'abcd')
    assert.match(fs.readFileSync(path.join(root, path.basename(ROOT), 'INDEX.md'), 'utf8'), /s\.txt \| 4 B/)
    await assert.rejects(up.chunk('a', enc('late')), /no such upload/)
  })

  it('enforces the cap across slices and leaves nothing', async () => {
    const root = path.join(ROOT, 'sl-cap'), up = new SliceUploads()
    const done = up.start('a', { cwd: ROOT, name: 'big.bin', root, now, max: 5 })
    await up.chunk('a', enc('abc'))
    await assert.rejects(up.chunk('a', enc('def')), /limit/)
    await assert.rejects(done, (e: Error & { status?: number }) => e.status === 413)
    assert.deepEqual(fs.readdirSync(day(root)), [])
  })

  it('abort removes the partial file', async () => {
    const root = path.join(ROOT, 'sl-abort'), up = new SliceUploads()
    const done = up.start('a', { cwd: ROOT, name: 'x.txt', root, now })
    await up.chunk('a', enc('half'))
    up.abort('a')
    await assert.rejects(done, /cancelled/)
    assert.deepEqual(fs.readdirSync(day(root)), [])
  })

  it('keeps two uploads apart and abortAll ends every open one', async () => {
    const root = path.join(ROOT, 'sl-two'), up = new SliceUploads()
    const a = up.start('a', { cwd: ROOT, name: 'same.txt', root, now })
    const b = up.start('b', { cwd: ROOT, name: 'same.txt', root, now })
    await Promise.all([up.chunk('a', enc('A1')), up.chunk('b', enc('B1'))])
    await up.chunk('b', enc('B2'))
    await up.chunk('a', enc('A2'))
    up.end('a')
    const pa = await a
    assert.equal(fs.readFileSync(pa, 'utf8'), 'A1A2')
    const c = up.start('c', { cwd: ROOT, name: 'c.txt', root, now })
    up.abortAll()
    await assert.rejects(b, /cancelled/)
    await assert.rejects(c, /cancelled/)
    assert.deepEqual(fs.readdirSync(day(root)), [path.basename(pa)])
  })
})

describe('chatLabel', () => {
  it('names the chat with a short id, else says new chat', () => {
    assert.equal(chatLabel([{ sessionId: 'abc12345-xyz', name: 'Fix login' }], 'abc12345-xyz'), 'Fix login (abc12345)')
    assert.equal(chatLabel([], 'abc12345-xyz'), 'abc12345')
    assert.equal(chatLabel([], undefined), 'new chat')
  })
})

describe('POST /hub/upload', () => {
  const hub = new HubService()
  const url = (q: string) => `/hub/upload?${q}`
  it('needs the window token', async () => {
    assert.equal((await handleUpload(hub, url(`cwd=${ROOT}&name=a.txt&token=nope`), bytes('x'))).status, 403)
    assert.equal((await handleUpload(hub, url(`cwd=${ROOT}&name=a.txt&token=${hub.token}`), bytes('x'), undefined, 'nope')).status, 403)
    // The header token, as the app sends it now.
    assert.equal((await handleUpload(hub, url('name=a.txt'), bytes('x'), undefined, hub.token)).status, 400)
  })
  it('needs cwd and name', async () => {
    assert.equal((await handleUpload(hub, url(`name=a.txt&token=${hub.token}`), bytes('x'))).status, 400)
  })
  it('streams the body to disk and answers its path', async () => {
    const root = path.join(ROOT, 'route')
    const r = await handleUpload(hub, url(`cwd=${encodeURIComponent(ROOT)}&name=n.txt&token=${hub.token}`), Readable.from([Buffer.from('ab'), Buffer.from('cd')]), (o, d) => saveUpload({ ...o, root }, d))
    assert.equal(r.status, 200)
    const { path: p } = JSON.parse(r.body)
    assert.equal(fs.readFileSync(p, 'utf8'), 'abcd')
  })
  it('answers 413 with the reason for a file over the cap', async () => {
    const root = path.join(ROOT, 'route-cap')
    const r = await handleUpload(hub, url(`cwd=${encodeURIComponent(ROOT)}&name=n.txt&token=${hub.token}`), bytes('12345'), (o, d) => saveUpload({ ...o, root, max: 4 }, d))
    assert.equal(r.status, 413)
    assert.match(r.body, /limit/)
  })
})

describe('readUploads', () => {
  it('counts each project and lists its newest few from INDEX.md, names only', async () => {
    const root = path.join(ROOT, 'read')
    for (let i = 0; i < 7; i++) await saveUpload({ cwd: '/w/app', name: `f${i}.txt`, chat: i === 6 ? 'Fix login (abc12345)' : undefined, root, now: new Date(2026, 9, 30, 14, i) }, bytes('ab'))
    await saveUpload({ cwd: '/w/web', name: 'shot.png', root, now }, bytes('x'))
    const u = await readUploads(root)
    assert.deepEqual(Object.keys(u).sort(), ['app', 'web'])
    assert.equal(u.app.count, 7)
    assert.equal(u.app.last.length, 5)
    assert.deepEqual(u.app.last[0], { name: 'f6.txt', at: new Date(2026, 9, 30, 14, 6).getTime(), size: '2 B', chat: 'Fix login (abc12345)' })
    assert.deepEqual(u.app.last.map(r => r.name), ['f6.txt', 'f5.txt', 'f4.txt', 'f3.txt', 'f2.txt'])
    assert.equal(u.web.last[0].chat, 'new chat')
    assert.ok(!JSON.stringify(u).includes(root))
  })
  it('is empty with no uploads folder, and skips a project with no INDEX.md', async () => {
    assert.deepEqual(await readUploads(path.join(ROOT, 'none')), {})
    const root = path.join(ROOT, 'bare')
    fs.mkdirSync(path.join(root, 'p'), { recursive: true })
    assert.deepEqual(await readUploads(root), {})
  })
  it('tells listeners when a file lands', async () => {
    let n = 0
    const on = () => { n++ }
    uploadEvents.on('saved', on)
    await saveUpload({ cwd: '/w/app', name: 'x.txt', root: path.join(ROOT, 'ev'), now }, bytes('x'))
    uploadEvents.off('saved', on)
    assert.equal(n, 1)
  })
})
