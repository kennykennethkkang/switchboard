// Phone clips for Jarvis: the types a phone sends, voiceBox.clip, and macVoice's ffmpeg conversion.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { isClipType, macVoice, voiceBox, type Recording, type VoiceIo } from '../src/hub/voice'

function fakes(over: Partial<VoiceIo> = {}) {
  const log: string[] = []
  const io: VoiceIo = {
    missing: () => undefined,
    up: async () => true,
    start: async () => { log.push('start') },
    stop: () => { log.push('stop') },
    touch: () => {},
    lastUsed: () => Date.now(),
    record: () => { throw new Error('no Mac mic for a phone clip') },
    transcribe: async r => { log.push(`transcribe ${r.file}`); return ' [BLANK_AUDIO] what is running? ' },
    fromClip: () => ({ file: '/tmp/q.wav', done: Promise.resolve(), stop: () => {}, dispose: () => { log.push('gone') } }),
    speak: () => {},
    hush: () => {},
    ...over,
  }
  const box = voiceBox(io, { show: () => {}, heard: () => {}, level: () => {} })
  return { log, box }
}

describe('phone clips', () => {
  it('takes the types Chrome and iOS Safari record', () => {
    for (const t of ['audio/webm;codecs=opus', 'audio/mp4', 'AUDIO/MP4; codecs=mp4a.40.2', 'audio/ogg', 'audio/x-m4a']) assert.equal(isClipType(t), true, t)
    for (const t of ['video/mp4', 'text/plain', '', undefined, 'audio/webm-evil']) assert.equal(isClipType(t), false, String(t))
  })

  it('transcribes a clip, cleaned, and drops the temp file', async () => {
    const { log, box } = fakes()
    assert.equal(await box.clip(new Uint8Array([1])), 'what is running?')
    assert.deepEqual(log, ['transcribe /tmp/q.wav', 'gone'])
    box.dispose()
  })

  it('starts the services when down and says why a clip fails', async () => {
    const { log, box } = fakes({ up: async () => false })
    await box.clip(new Uint8Array([1]))
    assert.equal(log[0], 'start')
    box.dispose()
    const bad = fakes({ fromClip: () => ({ file: '', done: Promise.reject(new Error('moov atom not found')), stop: () => {}, dispose: () => { bad.log.push('gone') } }) as Recording })
    await assert.rejects(bad.box.clip(new Uint8Array([1])), /Could not read the clip \(moov atom not found\)/)
    assert.deepEqual(bad.log, ['gone'])
    bad.box.dispose()
    const missing = fakes({ missing: () => 'Voice needs ffmpeg: brew install ffmpeg.' })
    await assert.rejects(missing.box.clip(new Uint8Array([1])), /needs ffmpeg/)
    missing.box.dispose()
  })

  const ffmpeg = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find(f => fs.existsSync(f))
  it('turns an iOS style mp4 clip into 16 kHz mono wav', { skip: !ffmpeg && 'no ffmpeg' }, async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-clip-'))
    try {
      const m4a = path.join(d, 'in.mp4')
      execFileSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac', '-f', 'mp4', m4a])
      const r = macVoice({ home: d }).fromClip!(fs.readFileSync(m4a))
      await r.done
      const wav = fs.readFileSync(r.file)
      assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
      assert.equal(wav.readUInt16LE(22), 1)
      assert.equal(wav.readUInt32LE(24), 16000)
      r.dispose()
      assert.equal(fs.existsSync(r.file), false)
    } finally {
      fs.rmSync(d, { recursive: true, force: true })
    }
  })
})
