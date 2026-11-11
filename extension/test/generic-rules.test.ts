/**
 * The bundled rules name the user, not Kenneth.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { GENERIC } from '../src/hub/rules'
const { genericRules, GENERIC: BUILD_GENERIC } = require('../esbuild.js') as { genericRules: (t: string) => string; GENERIC: string }

describe('genericRules', () => {
  it('swaps the name for the user, capitalized at a sentence start', () => {
    assert.equal(
      genericRules("Kenneth says hi.\nKenneth's work. Ask Kenneth. Once Kenneth has it.\n- Kenneth does that."),
      "The user says hi.\nThe user's work. Ask the user. Once the user has it.\n- The user does that.",
    )
  })
  it('marks generic copies the same way rules.ts reads them', () => assert.equal(BUILD_GENERIC, GENERIC))
  it('capitalizes at a comment or string start too', () => {
    assert.equal(genericRules(`// Kenneth's rules\nwhy: 'Kenneth commits', "Kenneth's guards"`), `// The user's rules\nwhy: 'The user commits', "The user's guards"`)
  })
  it('reads gender neutral', () => {
    assert.equal(genericRules('Kenneth commits and pushes himself, from his own terminal.'), 'The user commits and pushes themselves, from their own terminal.')
  })
  it('swaps he, him and his in a file that names Kenneth', () => {
    assert.equal(
      genericRules('Never take focus from Kenneth unless he clicked it himself. Agent browsers run headless unless he asks.\nCall him, push to his phone.'),
      'Never take focus from the user unless they clicked it themselves. Agent browsers run headless unless they ask.\nCall them, push to their phone.',
    )
  })
  it('leaves pronouns alone in a file that never names Kenneth', () => assert.equal(genericRules('The author said he wrote his notes.'), 'The author said he wrote his notes.'))
  it('leaves other text alone', () => assert.equal(genericRules('No names here.'), 'No names here.'))
})

describe('build stamp', () => {
  const { stamp } = require('../esbuild.js') as { stamp: (files: string[]) => string }
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
  it('follows the bundled files, not the clock', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-stamp-'))
    const a = path.join(d, 'a.js'), b = path.join(d, 'b.js')
    fs.writeFileSync(a, '1'); fs.writeFileSync(b, '2')
    const first = stamp([a, b])
    assert.equal(stamp([a, b]), first)
    fs.writeFileSync(b, '3')
    assert.notEqual(stamp([a, b]), first)
  })
  it('covers everything the vsix loads at window start', () => {
    const { stampFiles } = require('../esbuild.js') as { stampFiles: (root: string) => string[] }
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-stamp-'))
    const want = ['dist/extension.js', 'dist/app/app.js', 'dist/webview/index.js', 'kit/rules.md', 'ask/ask-server.mjs', 'voice/voice.sh', 'media/icon.png', 'keeper/app-keeper.mjs', 'package.json']
    for (const f of want) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), f) }
    assert.deepEqual(stampFiles(d).map((f: string) => path.relative(d, f)).sort(), [...want].sort())
  })
})

describe('own skills in the bundle', () => {
  const { bundleSkills } = require('../esbuild.js') as { bundleSkills: (src: string, out: string, own: string[]) => void }
  const fs = require('fs') as typeof import('fs')
  const os = require('os') as typeof import('os')
  const path = require('path') as typeof import('path')
  const put = (p: string, body: string | Buffer) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body) }
  const CLIP = Buffer.from([0, 1, 2, ...Buffer.from('Kenneth'), 0, 255])

  it('copies each listed skill fresh, generic text and marked SKILL.md, binaries as they are, no junk', () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-src-')), out = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-out-'))
    put(path.join(src, 'skills', 'one', 'SKILL.md'), '---\nname: one\n---\nKenneth uses it.\n')
    put(path.join(src, 'skills', 'one', 'ref', 'notes.md'), 'Ask Kenneth.')
    put(path.join(src, 'skills', 'one', 'reference', 'clips', 'a.mp4'), CLIP)
    put(path.join(src, 'skills', 'one', '.DS_Store'), 'junk')
    put(path.join(src, 'skills', 'one', '__pycache__', 'x.pyc'), 'junk')
    put(path.join(out, 'one', 'old.md'), 'stale')
    put(path.join(out, 'kept', 'SKILL.md'), 'bundled before')
    put(path.join(out, 'dropped', 'SKILL.md'), 'no longer listed')
    bundleSkills(src, out, ['one', 'kept'])
    const md = fs.readFileSync(path.join(out, 'one', 'SKILL.md'), 'utf8')
    assert.match(md, /The user uses it\./)
    assert.ok(md.trimEnd().endsWith(GENERIC))
    assert.equal(fs.readFileSync(path.join(out, 'one', 'ref', 'notes.md'), 'utf8'), 'Ask the user.')
    assert.ok(fs.readFileSync(path.join(out, 'one', 'reference', 'clips', 'a.mp4')).equals(CLIP))
    for (const gone of ['one/.DS_Store', 'one/__pycache__', 'one/old.md', 'dropped']) assert.ok(!fs.existsSync(path.join(out, gone)), gone)
    // No source for it: the bundled copy stays.
    assert.equal(fs.readFileSync(path.join(out, 'kept', 'SKILL.md'), 'utf8'), 'bundled before')
    fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true })
  })

  it('leaves a symlink out of the bundle and never writes through it', () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-src-')), out = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-out-'))
    const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sk-far-')), 'LICENSE')
    fs.writeFileSync(outside, 'Kenneth owns this.')
    put(path.join(src, 'skills', 'one', 'SKILL.md'), 'Kenneth uses it.')
    fs.symlinkSync(outside, path.join(src, 'skills', 'one', 'LICENSE'))
    bundleSkills(src, out, ['one'])
    assert.equal(fs.readFileSync(outside, 'utf8'), 'Kenneth owns this.')
    assert.ok(!fs.existsSync(path.join(out, 'one', 'LICENSE')) && fs.lstatSync(path.join(out, 'one', 'LICENSE'), { throwIfNoEntry: false }) === undefined)
    assert.match(fs.readFileSync(path.join(out, 'one', 'SKILL.md'), 'utf8'), /The user uses it/)
    for (const d of [src, out, path.dirname(outside)]) fs.rmSync(d, { recursive: true, force: true })
  })

  it('refuses a skill name that is not a plain folder name', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-out-'))
    for (const bad of ['', '..', '../x', 'a/b', 'a\\b', '.']) assert.throws(() => bundleSkills(out, out, [bad]), /not a plain folder name/, JSON.stringify(bad))
    fs.rmSync(out, { recursive: true, force: true })
  })

  it('scans UTF-16 text for keys too, and otherwise copies it byte for byte', () => {
    const KEY = 'key sk-abcdefghijklmnopqrstuvwxyz'
    for (const [label, buf] of [
      ['utf16le with a BOM', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(KEY, 'utf16le')])],
      ['utf16le, no BOM', Buffer.from(KEY, 'utf16le')],
      ['utf16be with a BOM', Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(KEY, 'utf16le').swap16()])],
    ] as const) {
      const src = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-src-')), out = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-out-'))
      put(path.join(src, 'skills', 'one', 'SKILL.md'), 'ok')
      put(path.join(src, 'skills', 'one', 'notes.txt'), buf)
      assert.throws(() => bundleSkills(src, out, ['one']), /secret/, label)
      fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true })
    }
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-src-')), out = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-out-'))
    const clean = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Kenneth wrote this', 'utf16le')])
    put(path.join(src, 'skills', 'one', 'SKILL.md'), 'ok')
    put(path.join(src, 'skills', 'one', 'notes.txt'), clean)
    bundleSkills(src, out, ['one'])
    assert.ok(fs.readFileSync(path.join(out, 'one', 'notes.txt')).equals(clean))
    fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true })
  })

  it('refuses a skill folder that is a symlink before touching the bundle', () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-src-')), out = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-out-'))
    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-real-'))
    put(path.join(real, 'SKILL.md'), 'linked in')
    put(path.join(src, 'skills', 'two', 'SKILL.md'), 'fine')
    fs.mkdirSync(path.join(src, 'skills', 'one'), { recursive: true }); fs.rmdirSync(path.join(src, 'skills', 'one'))
    fs.symlinkSync(real, path.join(src, 'skills', 'one'))
    put(path.join(out, 'one', 'SKILL.md'), 'old bundle')
    put(path.join(out, 'two', 'SKILL.md'), 'old two')
    assert.throws(() => bundleSkills(src, out, ['two', 'one']), /one.*symlink/)
    assert.equal(fs.readFileSync(path.join(out, 'one', 'SKILL.md'), 'utf8'), 'old bundle')
    assert.equal(fs.readFileSync(path.join(out, 'two', 'SKILL.md'), 'utf8'), 'old two')
    for (const d of [src, out, real]) fs.rmSync(d, { recursive: true, force: true })
  })

  it('refuses a skill whose text looks like it holds a key', () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-src-')), out = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-out-'))
    put(path.join(src, 'skills', 'one', 'SKILL.md'), 'key sk-abcdefghijklmnopqrstuvwxyz')
    assert.throws(() => bundleSkills(src, out, ['one']), /secret/)
    fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true })
  })
})
