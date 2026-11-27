/**
 * Unit tests for the Jarvis mic: listening with levels, a smart end on silence, then the transcript lands in the box.
 * Only a sent question gets its reply spoken. ffmpeg, whisper, Kokoro and afplay are fakes here.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as http from 'http'
import * as os from 'os'
import * as path from 'path'
import { execFileSync, spawn } from 'child_process'
import { clip, endpointer, macVoice, meter, speakLine, toLevel, voiceBox, type VoiceIo, type VoiceState } from '../src/hub/voice'
import { commandProblem } from '../src/hub/routes'
import type { JarvisReply } from '../src/hub/types'

const tick = () => new Promise(r => setImmediate(r))

function fakes(extra: Partial<VoiceIo> = {}) {
  const log: string[] = []
  let finish = () => {}
  let feed: (db: number) => void = () => {}
  let up = false
  let stamp: number | undefined
  const io: VoiceIo = {
    missing: () => undefined,
    up: async () => up,
    start: async () => { log.push('start'); up = true },
    stop: () => { log.push('stop'); up = false; stamp = undefined },
    touch: () => { stamp = Date.now() },
    lastUsed: () => stamp,
    record: onDb => {
      log.push('record')
      feed = onDb
      return { file: '/tmp/q.wav', done: new Promise<void>(r => { finish = r }), stop: () => { log.push('rec-stop'); finish() }, dispose: () => { log.push('rec-gone') } }
    },
    transcribe: async () => { log.push('transcribe'); return ' what is running? ' },
    speak: t => { log.push(`speak:${t}`) },
    hush: () => { log.push('hush') },
    ...extra,
  }
  const shown: (VoiceState | null)[] = []
  const problems: string[] = []
  const heard: string[] = []
  const levels: number[] = []
  const box = (idleMs = 600_000, everyMs = 60_000) => voiceBox(io, { show: (v, p) => { shown.push(v); if (p) problems.push(p) }, heard: t => { heard.push(t) }, level: l => { levels.push(l) } }, idleMs, everyMs)
  return {
    io, log, shown, problems, heard, levels, box, maxOut: () => finish(), feed: (db: number) => feed(db),
    setUp: (u: boolean) => { up = u }, setStamp: (t?: number) => { stamp = t }, stamp: () => stamp,
  }
}

const turn = async (v: ReturnType<ReturnType<typeof fakes>['box']>) => { v.toggle(true); await tick(); v.toggle(false); await tick(); await tick() }

describe('hub-voice command', () => {
  it('takes on as a boolean only', () => {
    assert.equal(commandProblem({ type: 'hub-voice', on: true }), undefined)
    assert.equal(commandProblem({ type: 'hub-voice', on: false }), undefined)
    assert.ok(commandProblem({ type: 'hub-voice' }))
    assert.ok(commandProblem({ type: 'hub-voice', on: 'yes' }))
  })

  it('takes a hub-jarvis question with an optional mic flag', () => {
    assert.equal(commandProblem({ type: 'hub-jarvis', q: 'hi', voice: true }), undefined)
    assert.equal(commandProblem({ type: 'hub-jarvis', q: 'hi' }), undefined)
    assert.ok(commandProblem({ type: 'hub-jarvis', q: 'hi', voice: 'yes' }))
  })
})

describe('voice box', () => {
  it('listens, transcribes, and hands the transcript to the box without asking or speaking', async () => {
    const f = fakes()
    const v = f.box()
    v.toggle(true)
    await tick()
    assert.deepEqual(f.shown, ['listening'])
    assert.deepEqual(f.log, ['hush', 'record', 'start'])
    v.toggle(false)
    await tick(); await tick()
    assert.deepEqual(f.shown, ['listening', 'transcribing', null])
    assert.deepEqual(f.heard, ['what is running?'])
    assert.deepEqual(f.log.slice(3), ['rec-stop', 'transcribe', 'rec-gone'])
    v.dispose()
  })

  it('passes mic levels on while listening', async () => {
    const f = fakes()
    const v = f.box()
    v.toggle(true); await tick()
    f.feed(-60); f.feed(-15); f.feed(-37.5)
    assert.deepEqual(f.levels, [0, 1, 0.5])
    v.dispose()
  })

  it('stops by itself after speech then silence, and only once', async () => {
    const f = fakes()
    const v = f.box()
    v.toggle(true); await tick()
    for (let i = 0; i < 10; i++) f.feed(-55)
    for (let i = 0; i < 8; i++) f.feed(-25)
    for (let i = 0; i < 40; i++) f.feed(-55)
    await tick(); await tick()
    assert.equal(f.log.filter(x => x === 'rec-stop').length, 1)
    assert.deepEqual(f.heard, ['what is running?'])
    v.dispose()
  })

  it('speaks the reply to a sent question, unless a newer tap or recording came first', async () => {
    const f = fakes()
    const v = f.box()
    v.answer(Promise.resolve({ q: 'x', at: 1, answer: 'No chat is working right now.' }))
    await tick(); await tick()
    assert.ok(f.log.includes('speak:No chat is working right now.'))
    let late: (r: JarvisReply) => void = () => {}
    v.answer(new Promise(r => { late = r }))
    v.toggle(true); await tick()
    late({ q: 'x', at: 2, answer: 'old' }); await tick(); await tick()
    assert.ok(!f.log.includes('speak:old'))
    v.answer(Promise.resolve(undefined)); await tick()
    v.dispose()
  })

  it('starts the services when they are down on any tap, not just the first', async () => {
    const f = fakes()
    const v = f.box()
    await turn(v)
    f.setUp(false)
    await turn(v)
    assert.equal(f.log.filter(x => x === 'start').length, 2)
    assert.deepEqual(f.problems, [])
    v.dispose()
  })

  it('leaves running services alone', async () => {
    const f = fakes()
    f.setUp(true)
    const v = f.box()
    await turn(v)
    assert.ok(!f.log.includes('start'))
    v.dispose()
  })

  it('drops the recording on every path', async () => {
    for (const extra of [{}, { start: async () => { throw new Error('down') } }, { transcribe: async () => { throw new Error('bad') } }] as Partial<VoiceIo>[]) {
      const f = fakes(extra)
      const v = f.box()
      await turn(v)
      assert.equal(f.log.filter(x => x === 'rec-gone').length, 1, JSON.stringify(Object.keys(extra)))
      v.dispose()
    }
    const g = fakes({ record: () => ({ file: '/tmp/q.wav', done: Promise.reject(new Error('no mic')), stop: () => {}, dispose: () => { g.log.push('rec-gone') } }) })
    const w = g.box()
    w.toggle(true); await tick(); await tick()
    assert.match(g.problems[0], /no mic/)
    assert.deepEqual(g.log.filter(x => x === 'rec-gone'), ['rec-gone'])
    w.dispose()
  })

  it('starts nothing and says nothing after dispose', async () => {
    const f = fakes({ up: () => new Promise(r => setTimeout(() => r(false), 5)) })
    const v = f.box()
    v.toggle(true); v.dispose()
    await new Promise(r => setTimeout(r, 20))
    assert.ok(!f.log.includes('start'))
    const g = fakes()
    let answer: (r: JarvisReply) => void = () => {}
    const w = g.box()
    w.answer(new Promise(r => { answer = r }))
    w.dispose()
    answer({ q: 'x', at: 1, answer: 'late' }); await tick(); await tick()
    assert.ok(!g.log.includes('speak:late'))
  })

  it('stops services whose start was still running at dispose', async () => {
    const f = fakes()
    f.io.start = () => new Promise(r => setTimeout(() => { f.log.push('start'); r() }, 10))
    const v = f.box()
    v.toggle(true); await tick()
    v.dispose()
    await new Promise(r => setTimeout(r, 30))
    assert.ok(f.log.includes('start') && f.log.indexOf('start') < f.log.lastIndexOf('stop'), f.log.join(','))
    assert.equal(f.stamp(), undefined)
  })

  it('stamps each use for every window', async () => {
    const f = fakes()
    const v = f.box()
    v.toggle(true)
    assert.ok(f.stamp() && Date.now() - f.stamp()! < 1000)
    v.dispose()
  })

  it('stops services whose last use is older than the idle time, from any window', async () => {
    const f = fakes()
    f.setStamp(Date.now() - 1000)
    const v = f.box(500, 5)
    await new Promise(r => setTimeout(r, 20))
    assert.deepEqual(f.log.filter(x => x === 'stop'), ['stop'])
    assert.equal(f.stamp(), undefined)
    v.dispose()
    const g = fakes()
    g.setStamp(Date.now())
    const w = g.box(500, 5)
    await new Promise(r => setTimeout(r, 20))
    assert.ok(!g.log.includes('stop'))
    w.dispose()
  })

  it('stops on dispose unless another window used voice since', async () => {
    const f = fakes()
    const v = f.box()
    await turn(v)
    v.dispose()
    assert.equal(f.log.at(-1), 'stop')
    const g = fakes()
    const w = g.box()
    await turn(w)
    g.setStamp(Date.now() + 5)
    w.dispose()
    assert.ok(!g.log.includes('stop'))
    const h = fakes()
    h.box().dispose()
    assert.ok(!h.log.includes('stop'), 'never used here: nothing to stop')
  })

  it('goes on to transcribe when the recording hits its max length', async () => {
    const f = fakes()
    const v = f.box()
    v.toggle(true); await tick()
    f.maxOut()
    await tick(); await tick()
    assert.deepEqual(f.heard, ['what is running?'])
    assert.deepEqual(f.shown.at(-1), null)
    v.dispose()
  })

  it('ignores a second start while listening and a stop while idle', async () => {
    const f = fakes()
    const v = f.box()
    v.toggle(false)
    v.toggle(true); v.toggle(true)
    await tick()
    assert.equal(f.log.filter(x => x === 'record').length, 1)
    v.dispose()
  })

  it('says what is missing in one line and records nothing', async () => {
    const f = fakes({ missing: () => 'Voice needs ffmpeg: brew install ffmpeg.' })
    const v = f.box()
    v.toggle(true); await tick()
    assert.deepEqual(f.problems, ['Voice needs ffmpeg: brew install ffmpeg.'])
    assert.ok(!f.log.includes('record'))
    assert.deepEqual(f.shown, [null])
  })

  it('says so when the services do not come up, with nothing for the box', async () => {
    const f = fakes({ start: async () => { throw new Error('whisper did not answer') } })
    const v = f.box()
    v.toggle(true); await tick(); v.toggle(false); await tick(); await tick()
    assert.match(f.problems[0], /whisper did not answer/)
    assert.deepEqual(f.heard, [])
    assert.equal(f.shown.at(-1), null)
  })

  it('says when it heard nothing and adds nothing to the box', async () => {
    const f = fakes({ transcribe: async () => ' [BLANK_AUDIO] ' })
    const v = f.box()
    v.toggle(true); await tick(); v.toggle(false); await tick(); await tick()
    assert.deepEqual(f.heard, [])
    assert.match(f.problems[0], /didn't catch that/i)
    assert.ok(!f.log.some(x => x.startsWith('speak:')))
    v.dispose()
  })
})

describe('endpointer', () => {
  const run = (dbs: number[], o?: Parameters<typeof endpointer>[0]) => { const e = endpointer(o); return dbs.findIndex(d => e(d)) }
  const n = (k: number, db: number) => Array<number>(k).fill(db)

  it('never ends on silence or noise alone, before any speech', () => {
    assert.equal(run(n(375, -55)), -1)
    assert.equal(run([...n(5, -100), ...n(370, -48)]), -1)
  })

  it('ends about 1.8 s after speech stops, measured against the room', () => {
    // 80 ms chunks: 1.8 s is 23 of them, and the 5 chunk median lags the last word by 2.
    const i = run([...n(10, -50), ...n(10, -22), ...n(40, -50)])
    assert.equal(i, 20 + 22 + 2)
    // A loud room: speech still counts, its noise is silence.
    assert.equal(run([...n(10, -38), ...n(10, -15), ...n(40, -38)]), 44)
  })

  it('waits through a 1.3 s pause between sentences', () => {
    assert.equal(run([...n(5, -55), ...n(6, -22), ...n(16, -55), ...n(6, -22), ...n(30, -55)]), 5 + 6 + 16 + 6 + 22 + 2)
  })

  // qa's rooms; seeded jitter so a failure repeats
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const j = (k: number, db: number, a = 3) => Array.from({ length: k }, () => db + (rnd() * 2 - 1) * a)
  const ends = (dbs: number[], from: number, max: number) => {
    for (let t = 0; t < 20; t++) {
      const i = run(dbs.map(d => d + (rnd() * 2 - 1) * 0.5))
      assert.ok(i >= from && i <= max, `ended at ${i}, wanted ${from}..${max}`)
    }
  }

  it('ends in the rooms qa measured, about 1.8 s after the last word where the room stays put', () => {
    // quiet room, a 1 s pause mid sentence, more words
    ends([...j(10, -60), ...j(25, -25), ...j(12, -60), ...j(25, -25), ...j(30, -60)], 72 + 21, 72 + 25)
    // steady fan
    ends([...j(10, -42), ...j(30, -22), ...j(40, -42)], 40 + 21, 40 + 25)
    // mic warming up at -70, then room noise
    ends([...n(3, -70), ...j(10, -45, 2), ...j(30, -22), ...j(60, -45, 2)], 43 + 21, 43 + 26)
    // a TV comes on after the question: later, but it ends
    ends([...j(10, -60), ...j(30, -22), ...j(100, -35)], 40 + 21, 40 + 80)
    // noise swinging 8 dB either way
    ends([...j(10, -45, 8), ...j(30, -22), ...j(100, -45, 8)], 40 + 21, 40 + 35)
  })

  // Words of 2 to 5 chunks at speech +-5 dB with 1 or 2 chunk gaps, three sentences with 0.5 to 1 s between.
  const talk = (room: number, speech: number) => {
    const r = (a: number, b: number) => a + rnd() * (b - a)
    const out = j(15, room)
    for (let s = 0; s < 3; s++) {
      for (let w = 0; w < 6; w++) { out.push(...Array.from({ length: Math.round(r(2, 5)) }, () => speech + r(-5, 5)), ...j(Math.round(r(1, 2)), room)) }
      if (s < 2) out.push(...j(Math.round(r(500, 1000) / 80), room))
    }
    return { dbs: [...out, ...j(60, room)], last: out.length }
  }

  it('hears a soft talker next to a fan and ends within about 2 s, never running on to the cap', () => {
    // An early stop is the lesser miss: nothing is sent and a tap carries on. Running to 30 s is the one to avoid.
    for (const [speech, maxNever] of [[-30, 0], [-28, 0], [-32, 5]] as const) {
      let never = 0
      for (let t = 0; t < 50; t++) {
        const { dbs, last } = talk(-42, speech)
        const i = run(dbs)
        if (i < 0) never++
        else assert.ok(i <= last + 25, `${speech} dB: ended ${i - last} chunks after the last word`)
      }
      assert.ok(never <= maxNever, `${speech} dB: ${never} of 50 never ended`)
    }
  })

  it('never ends in a noisy room before anyone speaks', () => {
    for (let t = 0; t < 20; t++) {
      assert.equal(run([...n(3, -70), ...j(370, -45, 8)]), -1)
      assert.equal(run(j(370, -42)), -1)
    }
  })

  it('keeps a long steady monologue going', () => {
    assert.equal(run([...j(10, -55), ...j(150, -22)]), -1)
  })

  it('takes a cough as no speech', () => {
    assert.equal(run([...n(5, -55), ...n(2, -20), ...n(60, -55)]), -1)
  })
})

describe('meter', () => {
  const pcm = (n: number, v: number) => { const b = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) b.writeInt16LE(i % 2 ? -v : v, i * 2); return b }

  it('gives one dB reading per 80 ms of 16 kHz audio, across split reads', () => {
    const got: number[] = []
    const m = meter(d => got.push(Math.round(d)))
    m(pcm(1000, 3277)); assert.deepEqual(got, [])
    m(pcm(1000, 3277)); assert.deepEqual(got, [-20])
    m(pcm(560, 3277)); m(pcm(1280, 0))
    assert.deepEqual(got, [-20, -20, -100])
  })

  it('maps dB to a 0..1 level', () => {
    assert.deepEqual([toLevel(-100), toLevel(-60), toLevel(-37.5), toLevel(-15), toLevel(0)], [0, 0, 0.5, 1, 1])
  })
})

describe('speakLine', () => {
  it('reads an answer and asks for Confirm on a start, never confirming itself', () => {
    assert.equal(speakLine({ q: 'x', at: 1, answer: 'Two open to-dos.' }), 'Two open to-dos.')
    assert.equal(speakLine({ q: 'x', at: 1, start: { folder: '/w/a', project: 'Armasu', goal: 'add a size chart' } }), 'Start a chat in Armasu to add a size chart? Tap Confirm.')
    assert.equal(speakLine({ q: 'x', at: 1, busy: true }), undefined)
    assert.equal(speakLine({ q: 'x', at: 1, start: { folder: '/w/a', project: 'Armasu', goal: 'fix the redirect.' } }), 'Start a chat in Armasu to fix the redirect? Tap Confirm.')
  })
})

describe('clip', () => {
  it('keeps a short line and cuts a long one at a sentence end', () => {
    assert.equal(clip('Two open to-dos.'), 'Two open to-dos.')
    const long = 'First sentence here. ' + 'word '.repeat(80) + 'end.'
    assert.equal(clip(long), 'First sentence here.')
    assert.ok(clip('x'.repeat(400)).length <= 300)
  })
})

describe('macVoice speak', { skip: process.platform !== 'darwin' && 'the voice player uses macOS tools' }, () => {
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
  async function rig() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-test-'))
    const played = path.join(dir, 'played')
    const player = path.join(dir, 'player.sh')
    fs.writeFileSync(player, `#!/bin/sh\necho "$1" >> "${played}"\n`, { mode: 0o755 })
    // A slow Kokoro: 150 ms per line.
    const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { setTimeout(() => res.end(Buffer.alloc(44)), 150) }) })
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
    const tts = `http://127.0.0.1:${(srv.address() as { port: number }).port}`
    const io = macVoice({ home: dir, tts, player })
    const plays = () => fs.existsSync(played) ? fs.readFileSync(played, 'utf8').trim().split('\n').length : 0
    return { io, plays, done: () => { srv.closeAllConnections(); srv.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
  }

  it('plays nothing when hushed while Kokoro still synthesizes', async () => {
    const r = await rig()
    try {
      r.io.speak('first'); r.io.hush()
      await wait(1000)
      assert.equal(r.plays(), 0)
    } finally { r.done() }
  })

  it('plays only the newer of two quick lines', async () => {
    const r = await rig()
    try {
      r.io.speak('a'); await wait(30); r.io.speak('b')
      for (let i = 0; i < 50 && !r.plays(); i++) await wait(100)
      await wait(400)
      assert.equal(r.plays(), 1)
    } finally { r.done() }
  })
})

describe('voice.sh', { skip: process.platform === 'win32' && 'voice.sh requires a POSIX shell' }, () => {
  it('treats a pid file that names some other process as stale and never kills it', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-sh-'))
    const dir = path.join(home, '.claude', 'switchboard', 'voice')
    fs.mkdirSync(dir, { recursive: true })
    const other = spawn('/bin/sleep', ['30'], { stdio: 'ignore' })
    const sh = (cmd: string) => execFileSync('/bin/sh', [path.join(__dirname, '..', 'voice', 'voice.sh'), cmd], { env: { ...process.env, HOME: home } }).toString()
    try {
      fs.writeFileSync(path.join(dir, 'stt.pid'), String(other.pid))
      fs.writeFileSync(path.join(dir, 'tts.pid'), String(other.pid))
      sh('stop')
      assert.equal(other.exitCode, null)
      assert.doesNotThrow(() => process.kill(other.pid!, 0))
      fs.writeFileSync(path.join(dir, 'stt.pid'), String(other.pid))
      assert.match(sh('status'), /stt down/)
      assert.equal(fs.existsSync(path.join(dir, 'stt.pid')), false)
    } finally { other.kill(); fs.rmSync(home, { recursive: true, force: true }) }
  })
})
