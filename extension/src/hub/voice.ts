/**
 * The Jarvis mic: tap to record the Mac mic; it stops on a pause after speech, a second tap or 30 s. Whisper's
 * transcript goes into the box and waits for Ask; Kokoro reads the reply to a question sent from the mic.
 * The services start on a tap when down. Every window stamps each use in ~/.claude/switchboard/voice/last-used,
 * and any window stops the services once that is 10 min old. hub-panel.ts runs hub-voice through voiceBox(macVoice(...)).
 */
import { execFile, execFileSync, spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { copyChanged } from './questions'
import type { JarvisReply } from './types'

export type VoiceState = 'listening' | 'transcribing'
export type Recording = { file: string; done: Promise<void>; stop: () => void; dispose: () => void }
export type VoiceIo = {
  /** What is not installed, as one line, or undefined. */
  missing: () => string | undefined
  up: () => Promise<boolean>
  /** Launches the services and resolves once both answer. */
  start: () => Promise<void>
  /** Stops the services and clears the stamp. */
  stop: () => void
  touch: () => void
  /** When any window last used voice, or undefined since the last stop. */
  lastUsed: () => number | undefined
  /** onDb: the mic's loudness, one reading per CHUNK_MS. */
  record: (onDb: (db: number) => void) => Recording
  transcribe: (r: Recording) => Promise<string>
  /** Plays the line, cutting off any line still playing or still being made. */
  speak: (text: string) => void
  hush: () => void
}

const IDLE_MS = 10 * 60_000
const SWEEP_MS = 60_000
const SAY_MAX = 300

/** What Kenneth hears: the answer, or a nudge to Confirm a start. The box still needs the tap. */
export function speakLine(r: JarvisReply): string | undefined {
  if (r.start) return `Start a chat in ${r.start.project} to ${r.start.goal.replace(/[.!?]+$/, '')}? Tap Confirm.`
  return r.answer
}

/** The first SAY_MAX chars, cut at the last sentence end inside them, so Kokoro stays quick. */
export function clip(text: string, max = SAY_MAX): string {
  const t = text.trim()
  if (t.length <= max) return t
  const head = t.slice(0, max)
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '), head.lastIndexOf('\n'))
  return end > 0 ? head.slice(0, end + 1).trim() : head
}

const CHUNK_MS = 80
// 16 kHz mono s16le
const CHUNK_BYTES = 16 * CHUNK_MS * 2

/** dBFS per CHUNK_MS of raw PCM, however the pipe splits it. Silence reads -100. */
export function meter(onDb: (db: number) => void): (b: Buffer) => void {
  let rest = Buffer.alloc(0)
  return b => {
    rest = rest.length ? Buffer.concat([rest, b]) : b
    for (; rest.length >= CHUNK_BYTES; rest = rest.subarray(CHUNK_BYTES)) {
      let sum = 0
      for (let i = 0; i < CHUNK_BYTES; i += 2) { const v = rest.readInt16LE(i); sum += v * v }
      const rms = Math.sqrt(sum / (CHUNK_BYTES / 2))
      onDb(rms ? Math.max(-100, 20 * Math.log10(rms / 32768)) : -100)
    }
  }
}

/** -60 dB and under is 0, -15 dB and over is 1, for the bars. */
export const toLevel = (db: number) => Math.round(Math.min(1, Math.max(0, (db + 60) / 45)) * 100) / 100

/** Fed one dB reading per chunk; true once there was speech and then silenceMs of quiet. Each reading is the median
 * of the last 5 chunks, and speech is speechMs of it in a row, so a click, a cough or a noise swing is not a word.
 * The room is the 20th percentile of the last windowMs, so it follows a fan or a TV, kept at least 15 dB under the
 * loudest speech so a long monologue never turns into room. Speech is 15 dB over a quiet room, down to 10 dB over a
 * loud one (never under minSpeech); quiet is under room + 10 dB or loudest - 20 dB, whichever is higher, and never
 * over the softest speech so far. Before any speech it never ends (the 30 s cap still does).
 * Stopping early is the lesser miss: nothing is sent and another tap carries on. */
export function endpointer({ silenceMs = 1800, speechMs = 240, minSpeech = -50, windowMs = 3000 } = {}) {
  const recent: number[] = [], room: number[] = []
  // spoke: the run of speech so far, held once it reaches speechMs
  let skip = 4, spoke = 0, quiet = 0, peak = -Infinity, softest = Infinity
  return (db: number): boolean => {
    // the mic's first chunks read low while it wakes up; digital zeros say nothing about the room
    if (skip > 0) { skip--; return false }
    if (db <= -85) return quiet >= silenceMs
    recent.push(db); if (recent.length > 5) recent.shift()
    room.push(db); if (room.length > windowMs / CHUNK_MS) room.shift()
    if (recent.length < 5) return false
    const level = [...recent].sort((a, b) => a - b)[recent.length >> 1]
    const sorted = [...room].sort((a, b) => a - b)
    const floor = Math.min(sorted[Math.floor(sorted.length * 0.2)], spoke >= speechMs ? peak - 15 : Infinity)
    // 15 dB at a -55 dB room or quieter, 10 dB at -40 or louder
    const margin = 15 - 5 * Math.min(1, Math.max(0, (floor + 55) / 15))
    if (level > Math.max(floor + margin, minSpeech)) { spoke += CHUNK_MS; peak = Math.max(peak, level); softest = Math.min(softest, level) } else if (spoke < speechMs) spoke = 0
    if (spoke < speechMs) return false
    quiet = level < Math.min(Math.max(floor + 10, peak - 20), softest) ? quiet + CHUNK_MS : 0
    return quiet >= silenceMs
  }
}

// whisper marks silence and noise as [BLANK_AUDIO], (wind)...
const clean = (t: string) => t.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()

export type VoiceUi = {
  show: (v: VoiceState | null, problem?: string) => void
  /** A transcript for the box; never sent from here. */
  heard: (text: string) => void
  /** 0..1, per chunk while listening. */
  level: (l: number) => void
}

export function voiceBox(io: VoiceIo, ui: VoiceUi, idleMs = IDLE_MS, everyMs = SWEEP_MS) {
  const { show } = ui
  let rec: Recording | undefined
  let starting: Promise<void> | undefined
  // The stamp this window last wrote: on dispose it stops the services only if no one used them since.
  let mine: number | undefined
  let turn = 0
  let disposed = false
  const use = () => { if (disposed) return; io.touch(); mine = io.lastUsed() }
  // Any window cleans up, a crashed host's leftovers included.
  const sweep = () => { const t = io.lastUsed(); if (t !== undefined && Date.now() - t > idleMs) io.stop() }
  sweep()
  const every = setInterval(sweep, everyMs).unref()
  const warm = () => io.up().then(up => {
    if (up || disposed) return
    // A start still running at dispose: stop what it brought up, or it outlives the stamp.
    return starting ??= io.start().finally(() => { starting = undefined; if (disposed) io.stop() })
  })

  /** The cleaned transcript, or undefined once the box shows why there is none. Frees the mic for the next tap. */
  async function hear(r: Recording, w: Promise<void>): Promise<string | undefined> {
    try {
      try { await r.done } catch (err) { show(null, `Could not record the mic (${(err as Error).message}).`); return undefined }
      show('transcribing')
      try { await w } catch (err) { show(null, `Voice services did not start (${(err as Error).message}).`); return undefined }
      try { return clean(await io.transcribe(r)) } catch (err) { show(null, `Could not transcribe (${(err as Error).message}).`); return undefined }
    } finally {
      r.dispose()
      if (rec === r) rec = undefined
      use()
    }
  }

  async function finish(r: Recording, w: Promise<void>) {
    const q = await hear(r, w)
    if (q === undefined || disposed) return
    if (!q) return show(null, "Didn't catch that. Tap the mic to try again.")
    show(null)
    ui.heard(q)
  }

  return {
    toggle(on: boolean) {
      if (!on) { rec?.stop(); return }
      if (rec) return
      const gone = io.missing()
      if (gone) return show(null, gone)
      io.hush()
      use()
      turn++
      const end = endpointer()
      let ended = false
      const r: Recording = rec = io.record(db => {
        if (rec !== r || ended) return
        ui.level(toLevel(db))
        if (end(db)) { ended = true; r.stop() }
      })
      show('listening')
      // Warm while Kenneth talks.
      const w = warm()
      w.catch(() => {})
      void finish(r, w)
    },
    /** A question sent from the mic's text: its reply is read out, unless a newer tap or recording came first. */
    answer(p: Promise<JarvisReply | undefined>) {
      const n = turn
      void p.then(reply => {
        const line = reply && speakLine(reply)
        if (line && n === turn && !rec && !disposed) io.speak(clip(line))
      }, () => {})
    },
    dispose() {
      disposed = true
      clearInterval(every)
      rec?.stop()
      io.hush()
      if (mine !== undefined && io.lastUsed() === mine) io.stop()
    },
  }
}

const MAX_S = 30
// Extension hosts started from the Dock lack Homebrew on PATH.
const BINS = ['/opt/homebrew/bin', '/usr/local/bin', ...(process.env.PATH ?? '').split(':')]
const which = (b: string) => BINS.map(d => path.join(d, b)).find(f => fs.existsSync(f))

const answers = (url: string) => fetch(url, { signal: AbortSignal.timeout(1000) }).then(r => r.ok, () => false)

/** A half second of 16 kHz silence, for whisper's first slow run. */
function silence(): Blob {
  const n = 8000, b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28)
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40)
  return new Blob([b], { type: 'audio/wav' })
}

async function inference(stt: string, wav: Blob): Promise<string> {
  const form = new FormData()
  form.append('file', wav, 'q.wav')
  form.append('response_format', 'json')
  const r = await fetch(`${stt}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) })
  if (!r.ok) throw new Error(`whisper answered ${r.status}`)
  return String(((await r.json()) as { text?: string }).text ?? '')
}

type MacOpts = { home?: string; log?: (m: string) => void; stt?: string; tts?: string; player?: string }

/** The real thing: voice.sh from ~/.claude/switchboard/voice, ffmpeg on the default mic, afplay. */
export function macVoice({ home = os.homedir(), log = () => {}, stt = 'http://127.0.0.1:8178', tts = 'http://127.0.0.1:8179', player: play = '/usr/bin/afplay' }: MacOpts = {}): VoiceIo {
  const dir = path.join(home, '.claude', 'switchboard', 'voice')
  const sh = path.join(dir, 'voice.sh')
  const stamp = path.join(dir, 'last-used')
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-voice-'))
  const gone = (d: string) => fs.rmSync(d, { recursive: true, force: true })
  let player: ReturnType<typeof spawn> | undefined
  let making: AbortController | undefined
  const hush = () => { making?.abort(); making = undefined; player?.kill(); player = undefined }
  return {
    missing() {
      if (!which('ffmpeg')) return 'Voice needs ffmpeg: brew install ffmpeg.'
      if (!which('whisper-server')) return 'Voice needs whisper-server: brew install whisper-cpp.'
      if (!fs.existsSync(path.join(dir, '.venv', 'bin', 'python'))) return `Voice needs the Kokoro env at ${path.join(dir, '.venv')}.`
      for (const m of ['ggml-base.en.bin', 'kokoro-v1.0.onnx', 'voices-v1.0.bin']) if (!fs.existsSync(path.join(dir, 'models', m))) return `Voice needs ${path.join(dir, 'models', m)}.`
      return undefined
    },
    up: async () => (await Promise.all([answers(stt), answers(tts)])).every(Boolean),
    async start() {
      const env = { ...process.env, PATH: BINS.join(':') }
      await new Promise<void>((ok, no) => execFile('/bin/sh', [sh, 'start'], { env, timeout: 15_000 }, err => err ? no(err) : ok()))
      const t0 = Date.now()
      while (!(await answers(stt) && await answers(tts))) {
        if (Date.now() - t0 > 60_000) throw new Error('services did not answer in 60 s, see ~/.claude/switchboard/voice/*.log')
        await new Promise(r => setTimeout(r, 300))
      }
      await inference(stt, silence()).catch(() => '')
      log(`Voice services up in ${Date.now() - t0} ms`)
    },
    // Sync: on deactivate the host may exit before an async child runs.
    stop() {
      try { execFileSync('/bin/sh', [sh, 'stop'], { timeout: 10_000 }) } catch (err) { log(`Voice stop failed: ${(err as Error).message}`) }
      fs.rmSync(stamp, { force: true })
    },
    touch() { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(stamp, '') } catch (err) { log(`Voice stamp failed: ${(err as Error).message}`) } },
    lastUsed() { try { return fs.statSync(stamp).mtimeMs } catch { return undefined } },
    record(onDb) {
      const d = tmp()
      const file = path.join(d, 'q.wav')
      const out = ['-t', String(MAX_S), '-ac', '1', '-ar', '16000']
      // :default follows the Mac's input setting; :0 is just the first device listed (an iPhone Continuity mic here).
      // A second output, raw PCM on stdout, feeds the level meter.
      const p = spawn(which('ffmpeg') ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostats', '-f', 'avfoundation', '-i', ':default', ...out, '-y', file, ...out, '-f', 's16le', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] })
      p.stdout?.on('data', meter(onDb))
      let err = ''
      p.stderr?.on('data', c => { err = (err + c).slice(-300) })
      p.stdin?.on('error', () => {})
      const done = new Promise<void>((ok, no) => {
        p.on('error', no)
        p.on('close', code => code === 0 || code === 255 || fs.existsSync(file) ? ok() : no(new Error(err.trim().split('\n').pop() || `ffmpeg exited ${code}`)))
      })
      return {
        file,
        done,
        stop() {
          // q lets ffmpeg write the wav header; kill only if it hangs.
          p.stdin?.end('q')
          setTimeout(() => { if (p.exitCode === null) p.kill('SIGINT') }, 2000).unref()
        },
        dispose() { if (p.exitCode === null) p.kill('SIGINT'); gone(d) },
      }
    },
    async transcribe(r) {
      await r.done
      return inference(stt, new Blob([fs.readFileSync(r.file)], { type: 'audio/wav' }))
    },
    speak(text) {
      hush()
      const c = making = new AbortController()
      void fetch(`${tts}/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.any([c.signal, AbortSignal.timeout(60_000)]) })
        .then(async res => {
          if (!res.ok) throw new Error(`kokoro answered ${res.status}`)
          const wav = Buffer.from(await res.arrayBuffer())
          if (c.signal.aborted) return
          making = undefined
          const d = tmp()
          const file = path.join(d, 'a.wav')
          fs.writeFileSync(file, wav)
          const p = player = spawn(play, [file], { stdio: 'ignore' })
          p.on('error', e => log(`Voice play failed: ${e.message}`))
          p.on('close', () => { gone(d); if (player === p) player = undefined })
        })
        .catch(err => { if (!c.signal.aborted) log(`Voice speak failed: ${(err as Error).message}`) })
    },
    hush,
  }
}

/** Copies the bundled voice scripts next to the env and models in ~/.claude/switchboard/voice. */
export const installVoice = (from: string, home = os.homedir()) => copyChanged(from, path.join(home, '.claude', 'switchboard', 'voice'), ['voice.sh', 'tts-server.py'])
