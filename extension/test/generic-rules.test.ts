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
