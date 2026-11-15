'use client'
import { useEffect, useRef, useState } from 'react'
import type { HubState, JarvisReply } from '@/lib/hub-types'
import { fetchVoice, type VoicePoll } from '@/lib/hub-remote'
import { appendHeard, stillSpoken, takesHeard } from '@/lib/voice'
import { PHONE_MIC_NOTE, phoneMic, pickMime, sendClip } from '@/lib/phone-mic'
import { vscodeBridge, type HubCommand } from '@/lib/vscode-bridge'
import type { AskBits } from './switcher'

const DRAFT = 'switchboard.jarvisDraft'
const BARS = 14
const POLL_MS = 80
const flat = () => Array<number>(BARS).fill(0)

/** Mic levels while on: posted by the extension in VS Code; the app polls /hub/voice, which also brings the mic's
 * state and transcript sooner than the 2 s state poll; the demo makes them up. */
function useMic(on: boolean, demo: boolean) {
  const [levels, setLevels] = useState(flat)
  const [polled, setPolled] = useState<VoicePoll>()
  useEffect(() => {
    if (!on) { setLevels(flat()); setPolled(undefined); return }
    const push = (l: number) => setLevels(a => [...a.slice(1), l])
    if (vscodeBridge?.isVSCode) return vscodeBridge.onVoiceLevel(push)
    if (demo) {
      const t = setInterval(() => push(Math.max(0, Math.sin(Date.now() / 300)) * (0.4 + Math.random() * 0.5)), POLL_MS)
      return () => clearInterval(t)
    }
    let stop = false, t: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      t = undefined
      // A hidden tab asks nothing; showing it again starts the polls over.
      if (document.hidden) return
      const v = await fetchVoice()
      if (stop) return
      if (v) { setPolled(v); if (v.voice === 'listening') push(v.level) }
      t = setTimeout(tick, POLL_MS)
    }
    const shown = () => { if (!document.hidden && !t) void tick() }
    document.addEventListener('visibilitychange', shown)
    void tick()
    return () => { stop = true; clearTimeout(t); document.removeEventListener('visibilitychange', shown) }
  }, [on, demo])
  return { levels, polled }
}

const PHONE_MAX_MS = 30_000

/** A phone browser's own mic: MediaRecorder until a second tap or 30 s, then the clip goes to whisper on the Mac.
 * No voice flag on the question it fills: a spoken reply plays on the Mac, which a phone may not ask for. */
function usePhoneMic(want: boolean, heard: (text: string) => void) {
  const [kind, setKind] = useState<ReturnType<typeof phoneMic>>('none')
  const [state, setState] = useState<'listening' | 'transcribing'>()
  const [note, setNote] = useState<string>()
  const rec = useRef<MediaRecorder>(undefined)
  useEffect(() => { setKind(want ? phoneMic(window) : 'none') }, [want])
  useEffect(() => () => rec.current?.stop(), [])
  const tap = async () => {
    if (state === 'transcribing') return
    if (rec.current) { rec.current.stop(); return }
    setNote(undefined)
    if (kind === 'insecure') { setNote(PHONE_MIC_NOTE); return }
    let stream: MediaStream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch (err) { setNote(`Could not open the mic (${(err as Error).message}).`); return }
    const mimeType = pickMime(m => MediaRecorder.isTypeSupported(m))
    let r: MediaRecorder
    // A throw here would leave the mic on.
    try { r = new MediaRecorder(stream, mimeType ? { mimeType } : undefined) } catch (err) { stream.getTracks().forEach(t => t.stop()); setNote(`Could not record (${(err as Error).message}).`); return }
    const parts: Blob[] = []
    const cap = setTimeout(() => r.state !== 'inactive' && r.stop(), PHONE_MAX_MS)
    r.ondataavailable = e => { if (e.data.size) parts.push(e.data) }
    r.onstop = async () => {
      clearTimeout(cap)
      stream.getTracks().forEach(t => t.stop())
      rec.current = undefined
      setState('transcribing')
      // Safari leaves blob types empty; the recorder's own type is the real one.
      const out = await sendClip(new Blob(parts, { type: r.mimeType || mimeType || 'audio/mp4' }))
      setState(undefined)
      if ('text' in out) heard(out.text)
      else setNote(out.problem)
    }
    try { r.start() } catch (err) { clearTimeout(cap); stream.getTracks().forEach(t => t.stop()); setNote(`Could not record (${(err as Error).message}).`); return }
    rec.current = r
    setState('listening')
  }
  return { can: kind !== 'none', state, note, tap: () => void tap() }
}

/** One line to ask the hub or tell it to start work; a start waits for Confirm, nothing runs on Enter alone.
 * mic: the page runs on the Mac (VS Code or localhost), where hub-voice records; a phone browser records itself (usePhoneMic).
 * bare: inside the Cmd+K switcher, which owns the text and the input; this adds the mic and the reply. */
export function Jarvis({ reply, voice: stateVoice, heard: stateHeard, mic, demo = false, send, bare }: { reply?: JarvisReply | null; voice?: HubState['voice']; heard?: HubState['heard']; mic: boolean; demo?: boolean; send: (c: HubCommand) => void; bare?: AskBits }) {
  // Kept in sessionStorage so a reload for a new build does not drop an unsent question.
  const [draft, setQRaw] = useState(() => { try { return sessionStorage.getItem(DRAFT) ?? '' } catch { return '' } })
  const q = bare ? bare.value : draft
  const setQ = (v: string) => { if (bare) { bare.onValue(v); return } setQRaw(v); try { if (v) sessionStorage.setItem(DRAFT, v); else sessionStorage.removeItem(DRAFT) } catch { /* private mode */ } }
  const own = useRef<HTMLInputElement>(null)
  const input = bare?.input ?? own
  const { levels, polled } = useMic(!!stateVoice, demo)
  const voice = polled ? polled.voice : stateVoice
  const heard = [stateHeard, polled?.heard].reduce((a, b) => (b && (!a || b.at > a.at) ? b : a), undefined as HubState['heard'])
  // When this view's tap started a recording: only that view takes the transcript.
  const tapped = useRef<number>(undefined)
  // The last transcript put in the box: while the draft holds it, the reply is read out too.
  const lastHeard = useRef<string>(undefined)
  const phone = usePhoneMic(!mic && !demo && !vscodeBridge?.isVSCode, text => setQ(appendHeard(input.current?.value ?? '', text)))
  useEffect(() => {
    // A recording that ended with nothing to take (an error, Didn't catch that) lets go of the tap.
    if (voice || tapped.current === undefined) return
    const was = tapped.current
    const t = setTimeout(() => { if (tapped.current === was) tapped.current = undefined }, 3000)
    return () => clearTimeout(t)
  }, [voice])
  useEffect(() => {
    if (!mic || !heard || !takesHeard(heard, tapped.current)) return
    tapped.current = undefined
    lastHeard.current = heard.text
    const next = appendHeard(input.current?.value ?? q, heard.text)
    setQ(next)
    requestAnimationFrame(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(next.length, next.length) } })
    // Only a new transcript matters here, not each new setQ.
  }, [heard?.at, mic])
  // The reply a Confirm went out for: a double tap must not start two chats.
  const [sent, setSent] = useState<number>()
  const sentRef = useRef<number>(undefined)
  const clear = () => { send({ type: 'hub-jarvis', q: '' }); input.current?.focus() }
  const confirm = (r: JarvisReply) => {
    if (!r.start || sentRef.current === r.at) return
    sentRef.current = r.at; setSent(r.at)
    send({ type: 'hub-new-chat', path: r.start.folder, text: r.start.goal, remote: false })
    clear()
  }
  const ask = () => {
    const t = q.trim()
    if (!t) return
    send({ type: 'hub-jarvis', q: t, ...(stillSpoken(t, lastHeard.current) ? { voice: true } : {}) })
    lastHeard.current = undefined
    setQ('')
  }
  if (bare) bare.askRef.current = ask
  const mics = <>
        {voice === 'listening' && (
          <span className="hub-jarvis-meter" aria-hidden>{levels.map((l, i) => <span key={i} style={{ transform: `scaleY(${0.15 + l * 0.85})` }} />)}</span>
        )}
        {mic && (
          // aria-disabled, not disabled: the focused button keeps focus while it transcribes.
          <button type="button" className="hub-btn hub-jarvis-mic" aria-label="Speak to Jarvis" title="Speak to Jarvis" aria-pressed={voice === 'listening'} aria-disabled={voice === 'transcribing'}
            onClick={() => {
              if (voice === 'transcribing') return
              const on = voice !== 'listening'
              if (on) tapped.current = Date.now()
              send({ type: 'hub-voice', on })
            }}>
            <svg aria-hidden width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5.5" y="1.5" width="5" height="8" rx="2.5" /><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5V14.5" /></svg>
          </button>
        )}
        {phone.can && (
          <button type="button" className="hub-btn hub-jarvis-mic" aria-label="Speak to Jarvis" title="Speak to Jarvis" aria-pressed={phone.state === 'listening'} aria-disabled={phone.state === 'transcribing'} onClick={phone.tap}>
            <svg aria-hidden width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5.5" y="1.5" width="5" height="8" rx="2.5" /><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5V14.5" /></svg>
          </button>
        )}
  </>
  const live = <>
      {/* Mounted from the start so a screen reader hears the first Thinking… */}
      <div aria-live="polite" className="hub-jarvis-live">
        {voice && <div className="hub-jarvis-out"><span className="hub-jarvis-busy">{voice === 'listening' ? 'Listening… stops when you pause, or tap the mic.' : 'Transcribing…'}</span></div>}
        {!voice && phone.state && <div className="hub-jarvis-out"><span className="hub-jarvis-busy">{phone.state === 'listening' ? 'Listening… tap the mic when you are done.' : 'Transcribing…'}</span></div>}
        {!voice && !phone.state && phone.note && <div className="hub-jarvis-out"><p>{phone.note}</p></div>}
        {reply && !voice && (
          <div className="hub-jarvis-out">
            <span className="hub-jarvis-q">{reply.q}</span>
            {reply.busy && <span className="hub-jarvis-busy">Thinking…</span>}
            {reply.answer && <p>{reply.answer}</p>}
            {reply.start && <p>Start a chat in <b>{reply.start.project}</b>: {reply.start.goal}</p>}
            <span className="hub-jarvis-acts">
              {reply.start && <button type="button" className="hub-btn sm primary" disabled={sent === reply.at} onClick={() => confirm(reply)}>Confirm</button>}
              {!reply.busy && <button type="button" className={reply.start ? 'hub-btn sm' : 'hub-link'} style={reply.start ? undefined : { padding: '4px', fontSize: 12 }} onClick={clear}>{reply.start ? 'Cancel' : 'Clear'}</button>}
            </span>
          </div>
        )}
      </div>
  </>
  if (bare) return <div className="hub-jarvis-pal"><span className="pal-mics">{mics}</span>{live}</div>
  return (
    <section className="hub-jarvis" aria-label="Jarvis">
      <form className="hub-jarvis-bar" style={{ minWidth: 0 }} onSubmit={e => { e.preventDefault(); ask() }}>
        <svg aria-hidden width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4.5 6.5 8 3 11.5M8.5 11.5H13" /></svg>
        <input ref={input} type="text" aria-label="Ask Jarvis" placeholder="Ask Jarvis" value={q} maxLength={2000}
          enterKeyHint="send" autoComplete="off" spellCheck={false} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape' && reply && !reply.busy) { e.preventDefault(); clear() } }} />
        {mics}
        <button type="submit" className="hub-btn" disabled={!q.trim()}>Ask</button>
      </form>
      {live}
    </section>
  )
}
