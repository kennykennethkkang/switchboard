/**
 * The Screen tab's backend: shell output into a headless terminal, read back as redacted text and ANSI,
 * the typing allowlist, and the /hub/chat/screen and /hub/chat/keys routes.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { agentForeground, keyBytes, parseSize, readScreen, Screens, typeKeys, type Host } from '../src/hub/screen'

// A claude-like frame: box, colors, a cursor-up redraw over an older status line, wide text.
const FRAME = [
  '\x1b[2J\x1b[H',
  '\x1b[1m\x1b[38;5;208m╭─ Claude ─╮\x1b[0m\r\n',
  '│ \x1b[32mReading\x1b[0m files │\r\n',
  'working 1\r\n',
  '\x1b[1A\x1b[2Kworking 2\r\n',
  '\x1b[7m> \x1b[0mtype here\r\n',
].join('')

describe('Screens', () => {
  it('turns a frame with a redraw into the plain text on the screen', async () => {
    const s = new Screens<string>()
    s.start('t', { cols: 40, rows: 10 })
    s.write('t', FRAME)
    const snap = await s.snapshot('t', false)
    assert.deepEqual(snap?.text.split('\n'), ['╭─ Claude ─╮', '│ Reading files │', 'working 2', '> type here'])
    assert.equal(snap?.ansi, undefined)
    assert.deepEqual([snap?.cols, snap?.rows, snap?.running], [40, 10, true])
  })

  it('keeps color in the ANSI copy, and the same text under it', async () => {
    const s = new Screens<string>()
    s.start('t', { cols: 40, rows: 10 })
    s.write('t', FRAME)
    const snap = await s.snapshot('t', true)
    assert.match(snap!.ansi!, /\x1b\[[0-9;]*38;5;208[0-9;]*m/)
    assert.match(snap!.ansi!, /\x1b\[[0-9;]*32[0-9;]*mReading/)
    assert.equal(snap!.ansi!.replace(/\x1b\[[0-9;]*m/g, ''), snap!.text)
  })

  it('applies a later resize and says when the command ended', async () => {
    const s = new Screens<string>()
    s.start('t', { cols: 20, rows: 5 })
    s.resize('t', { cols: 30, rows: 8 })
    s.end('t')
    const snap = await s.snapshot('t', false)
    assert.deepEqual([snap?.cols, snap?.rows, snap?.running], [30, 8, false])
  })

  it('clears the screen when a new command starts', async () => {
    const s = new Screens<string>()
    s.start('t', { cols: 20, rows: 5 })
    s.write('t', 'old claude frame')
    s.end('t')
    s.start('t', { cols: 20, rows: 5 })
    assert.equal((await s.snapshot('t', false))?.text, '')
  })

  it('clamps a silly size', async () => {
    const s = new Screens<string>()
    s.start('t', { cols: 99999, rows: 0 })
    const snap = await s.snapshot('t', false)
    assert.ok(snap!.cols <= 400 && snap!.rows >= 5)
  })

  it('forgets a terminal once dropped, and has nothing for an unknown one', async () => {
    const s = new Screens<string>()
    s.start('t', { cols: 20, rows: 5 })
    s.write('t', 'hello')
    assert.equal((await s.snapshot('t', false))?.text, 'hello')
    s.drop('t')
    assert.equal(await s.snapshot('t', false), undefined)
    assert.equal(await s.snapshot('never', false), undefined)
    s.write('never', 'x')
    assert.equal(await s.snapshot('never', false), undefined)
  })

  it('writes nothing before a command has started', async () => {
    const s = new Screens<string>()
    s.write('t', 'early')
    assert.equal(await s.snapshot('t', false), undefined)
  })

  // The strings are split so a secret scan of this file finds nothing to flag.
  const KEY = 'sk-' + 'a1B2c3D4e5F6g7H8i9J0k1L2'
  const HEX = 'deadbeef'.repeat(5)

  it('masks a key in the text and in the ANSI copy', async () => {
    const s = new Screens<string>()
    s.start('t', { cols: 80, rows: 5 })
    s.write('t', `\x1b[31mtoken ${KEY} ok\x1b[0m\r\ncommit ${HEX}\r\nplain line`)
    for (const ansi of [false, true]) {
      const snap = (await s.snapshot('t', ansi))!
      for (const out of [snap.text, snap.ansi ?? '']) {
        assert.ok(!out.includes(KEY) && !out.includes(HEX), out)
        assert.ok(!out.includes('a1B2c3D4'), out)
      }
      assert.match(snap.text, /token \[removed\] ok/)
      assert.match(snap.text, /plain line/)
    }
  })

  it('masks a key the app broke over three rows, and only that group loses its colour', async () => {
    const s = new Screens<string>()
    s.start('t', { cols: 20, rows: 8 })
    // Ink hard-wraps a long token at the width with a real newline, so the rows are not marked as wrapped.
    const key = 'sk-' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'
    s.write('t', `\x1b[32mgreen row\x1b[0m\r\n${key.match(/.{1,20}/g)!.join('\r\n')} done`)
    const snap = (await s.snapshot('t', true))!
    for (let i = 3; i + 5 <= key.length; i++) assert.ok(!snap.text.includes(key.slice(i, i + 5)) && !snap.ansi!.includes(key.slice(i, i + 5)), key.slice(i, i + 5))
    assert.deepEqual(snap.text.split('\n'), ['green row', '[removed] done'])
    assert.match(snap.ansi!.split('\n')[0], /\x1b\[0;32mgreen row/)
  })

  it('masks a commit hash without dropping the colour of the other rows', async () => {
    const s = new Screens<string>()
    s.start('t', { cols: 80, rows: 5 })
    s.write('t', `\x1b[31mred\x1b[0m\r\ncommit ${HEX}`)
    const snap = (await s.snapshot('t', true))!
    assert.deepEqual(snap.text.split('\n'), ['red', 'commit [removed]'])
    assert.match(snap.ansi!.split('\n')[0], /\x1b\[0;31mred/)
  })

  // Not token shaped: a password in a URL, a named value in an env file or a JSON dump.
  it('masks passwords and named secrets that are not token shaped', async () => {
    const s = new Screens<string>()
    s.start('t', { cols: 100, rows: 12 })
    s.write('t', [
      'DATABASE_URL=postgres://user:hunter2pass@db.example.com/app',
      'password: correcthorsebatterystaple',
      'export API_KEY=abc123',
      'DB_PASSWORD="two words here"',
      '{"client_secret": "zzz999", "name": "demo"}',
      'Authorization: Basic dXNlcjpwYXNz',
    ].join('\r\n'))
    for (const ansi of [false, true]) {
      const snap = (await s.snapshot('t', ansi))!
      for (const out of [snap.text, snap.ansi ?? '']) {
        for (const leak of ['hunter2pass', 'correcthorse', 'abc123', 'two words', 'zzz999', 'dXNlcjpwYXNz']) assert.ok(!out.includes(leak), `${leak} in ${out}`)
      }
      // The names stay, so the line still says what it was.
      assert.match(snap.text, /DATABASE_URL=postgres:\/\/user:\[removed\]@db\.example\.com\/app/)
      assert.match(snap.text, /password: \[removed\]/)
      assert.match(snap.text, /"name": "demo"/)
    }
  })

  it('masks password flags and loose secret forms', async () => {
    const s = new Screens<string>()
    s.start('t', { cols: 100, rows: 12 })
    s.write('t', [
      'password is hunter2x',
      'pass: hunter3x',
      'key=abcdef123456',
      '{"pw": "hunter4x"}',
      'login --password hunter8x',
      'mysql -u root -phunter9x app',
      'token hunter10x',
      'Bearer abcdef1234567890xyz',
    ].join('\r\n'))
    const snap = (await s.snapshot('t', false))!
    for (const leak of ['hunter2x', 'hunter3x', 'abcdef123456', 'hunter4x', 'hunter8x', 'hunter9x', 'hunter10x', 'abcdef1234567890xyz']) assert.ok(!snap.text.includes(leak), `${leak} in ${snap.text}`)
  })

  it('leaves ordinary lines alone', async () => {
    const s = new Screens<string>()
    s.start('t', { cols: 80, rows: 6 })
    const lines = ['pass 41, fail 1', 'https://example.com/docs', 'done in 12s · 3.4k tokens used', 'user: kenneth', 'git@github.com:a/b.git']
    s.write('t', lines.join('\r\n'))
    assert.deepEqual((await s.snapshot('t', false))!.text.split('\n'), lines)
  })

  it('keeps a full width line apart from the next one when a mask fires in it', async () => {
    const s = new Screens<string>()
    const url = 'DATABASE_URL=postgres://user:hunter2pass@db.example.com/app'
    s.start('t', { cols: url.length, rows: 6 })
    s.write('t', `${url}\r\nAuthorization: Bearer abc.def\r\nnext`)
    const text = (await s.snapshot('t', false))!.text.split('\n')
    assert.equal(text.length, 3, text.join(' | '))
    assert.match(text[0], /^DATABASE_URL=.*\[removed\]/)
    assert.match(text[1], /^Authorization: /)
    assert.equal(text[2], 'next')
  })

  it('masks a private key block', async () => {
    const s = new Screens<string>()
    s.start('t', { cols: 60, rows: 6 })
    s.write('t', '-----BEGIN PRIVATE KEY-----\r\nMIIBVQIBADANBgkqhkiG9w0BAQEFAASC\r\n-----END PRIVATE KEY-----\r\nafter')
    const snap = (await s.snapshot('t', true))!
    assert.ok(!snap.text.includes('MIIBVQ') && !snap.ansi!.includes('MIIBVQ'), snap.text)
  })
})

describe('parseSize', () => {
  it('reads stty size, rows then columns', () => {
    assert.deepEqual(parseSize('27 198\n'), { rows: 27, cols: 198 })
    assert.deepEqual(parseSize('  24 80 '), { rows: 24, cols: 80 })
  })
  it('refuses anything else', () => {
    for (const bad of ['', '0 0', '27', 'a b', 'stty: not a tty', '27 198 3', '-1 80']) assert.equal(parseSize(bad), undefined, bad)
  })
})

describe('keyBytes', () => {
  it('takes printable text as it is', () => {
    assert.deepEqual(keyBytes({ text: 'fix the build, please: naïve 日本語 🙂' }), { ok: true, bytes: 'fix the build, please: naïve 日本語 🙂' })
  })
  it('maps the named keys', () => {
    const want = { enter: '\r', esc: '\x1b', up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D', tab: '\t', 'ctrl-c': '\x03' }
    for (const [key, bytes] of Object.entries(want)) assert.deepEqual(keyBytes({ key }), { ok: true, bytes }, key)
  })
  it('refuses control bytes, escapes and newlines in text', () => {
    for (const text of ['a\x1bb', '\x1b[A', 'a\nb', 'a\rb', 'a\tb', '\x03', 'a\x00b', 'a\x7fb', 'a\u0085b', 'a b']) assert.equal(keyBytes({ text }).ok, false, JSON.stringify(text))
  })
  it('refuses a key that is not named, both fields, neither, a wrong type, and a huge text', () => {
    for (const bad of [{ key: 'f5' }, { key: 'ctrl-d' }, { key: '\x1b' }, { text: 'a', key: 'enter' }, {}, { text: '' }, { text: 5 }, { key: 7 }, null, 'x', [], { text: 'a'.repeat(2001) }]) {
      assert.equal(keyBytes(bad).ok, false, JSON.stringify(bad))
    }
    assert.equal(keyBytes({ text: 'a'.repeat(2000) }).ok, true)
  })
})

describe('agentForeground', () => {
  const ps = (...rows: string[]) => rows.join('\n')
  it('is true when claude or codex holds the terminal', () => {
    assert.equal(agentForeground(ps('S    -zsh', 'S+   /Users/k/.local/bin/claude --settings {} hi')), true)
    assert.equal(agentForeground(ps('S    -zsh', 'S+   claude')), true)
    assert.equal(agentForeground(ps('Ss   -zsh', 'S+   node /usr/local/lib/node_modules/@openai/codex/bin/codex.js -m x')), true)
    assert.equal(agentForeground(ps('S+   codex --yolo')), true)
    assert.equal(agentForeground(ps('S+   node /x/node_modules/@anthropic-ai/claude-code/cli.js')), true)
  })
  it('is false at a shell prompt, in another program, or when the agent is in the background', () => {
    assert.equal(agentForeground(''), false)
    assert.equal(agentForeground(ps('S+   -zsh')), false)
    assert.equal(agentForeground(ps('S    -zsh', 'S    claude')), false)
    assert.equal(agentForeground(ps('S    -zsh', 'S+   vim claude')), false)
    assert.equal(agentForeground(ps('S+   less claude.md')), false)
    assert.equal(agentForeground(ps('S+   node server.js --name claude')), false)
    assert.equal(agentForeground(ps('S+   /bin/bash ./claude-helper.sh')), false)
  })
})

describe('the module level reads', () => {
  const calls: string[] = []
  const host = (o: Partial<Host> = {}): Host => ({
    snapshot: async (s, ansi) => s === 'live' ? { cols: 80, rows: 24, text: 'hi', ...(ansi ? { ansi: 'hi' } : {}), running: true, at: 1 } : undefined,
    typing: () => true,
    type: async (s, bytes) => { calls.push(`${s}:${JSON.stringify(bytes)}`); return s === 'live' ? { status: 204 } : { status: 404, problem: 'no terminal' } },
    ...o,
  })

  it('adds whether typing is allowed, only while a command runs', async () => {
    assert.deepEqual(await readScreen('live', false, host()), { cols: 80, rows: 24, text: 'hi', running: true, at: 1, typing: true })
    assert.equal((await readScreen('live', false, host({ typing: () => false })))?.typing, false)
    assert.equal((await readScreen('live', false, host({ snapshot: async () => ({ cols: 1, rows: 1, text: '', running: false, at: 1 }) })))?.typing, false)
    assert.equal(await readScreen('other', false, host()), undefined)
    assert.equal(await readScreen('live', false, undefined), undefined)
  })

  it('types only when the setting is on, the input is clean, and the host agrees', async () => {
    calls.length = 0
    assert.deepEqual(await typeKeys('live', { text: 'hi' }, host()), { status: 204 })
    assert.deepEqual(calls, ['live:"hi"'])
    calls.length = 0
    const off = await typeKeys('live', { text: 'hi' }, host({ typing: () => false }))
    assert.equal(off.status, 403)
    const bad = await typeKeys('live', { text: '\x1b[A' }, host())
    assert.equal(bad.status, 400)
    assert.equal((await typeKeys('gone', { key: 'enter' }, host())).status, 404)
    assert.equal((await typeKeys('live', { key: 'enter' }, undefined)).status, 404)
    assert.deepEqual(calls, ['gone:"\\r"'])
  })
})
