import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import { cleanInvisible } from '../src/hub/clean-text'

describe('cleanInvisible', () => {
  it('drops zero width and bidi controls from code', () => {
    assert.deepEqual(cleanInvisible('const\u200B x = 1\u2062;\u202E\u00AD'), { text: 'const x = 1;', count: 4 })
  })

  it('keeps ZWJ emoji, ZWNJ, LRM and exotic spaces', () => {
    const s = 'family \u{1F468}\u200D\u{1F469}\u200D\u{1F467} \u0645\u200C\u0646 \u200E\u061C a\u00A0b'
    assert.deepEqual(cleanInvisible(s), { text: s, count: 0 })
  })

  it('keeps a subdivision flag, strips loose tag chars', () => {
    const wales = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}'
    assert.deepEqual(cleanInvisible(`${wales} hi\u{E0068}\u{E0069}`), { text: `${wales} hi`, count: 2 })
  })

  it('keeps VS16 after an emoji only', () => {
    assert.deepEqual(cleanInvisible('\u2764\uFE0F a\uFE0Fb'), { text: '\u2764\uFE0F ab', count: 1 })
  })

  it('keeps a BOM at offset 0 unless told not to, strips one later', () => {
    assert.deepEqual(cleanInvisible('\uFEFFa\uFEFFb'), { text: '\uFEFFab', count: 1 })
    assert.deepEqual(cleanInvisible('\uFEFFa\uFEFFb', false), { text: 'ab', count: 2 })
  })

  it('has no literal invisible characters in its own source', () => {
    for (const f of ['../src/hub/clean-text.ts', 'clean-text.test.ts', 'git.test.ts']) {
      assert.equal(cleanInvisible(fs.readFileSync(path.join(__dirname, f), 'utf8')).count, 0, f)
    }
  })
})
