'use client'
// The chat view: what one chat produced, and its transcript a page at a time. Read only.
// Outputs open on an In short card (what needs you first, then a headline and health chips), then each part.
// A modal dialog on the right, full screen on a phone; Esc or Close shuts it and focus goes back to what opened it.
import { useDialog } from '@/hooks/use-dialog'
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useFlash } from '@/hooks/use-flash'
import { fileName, loadOutputs, loadShot, loadTranscript, type ChatMessage, type ChatOutputs, type ChatReport, type ChatTranscript } from '@/lib/chat-view'
import { chatStory, groupMessages, parseReport, trivial, type Story, type Tone } from '@/lib/chat-story'
import { demoChat } from '@/lib/hub-demo'
import type { HubState } from '@/lib/hub-types'
import { KEY_LABELS, loadScreen, readable, PHONE_SCREEN, pollScreen, sendKeys, type Screen, type ScreenInput, type ScreenKey } from '@/lib/screen'
import { demoScreen, demoType, NO_TYPING } from '@/lib/screen-demo'
import { vscodeBridge } from '@/lib/vscode-bridge'
import './chat-view.css'

type Props = { sessionId: string; name: string; demo?: HubState; onClose: () => void; onCopy: (text: string) => Promise<boolean> }
type Tab = 'outputs' | 'transcript' | 'screen'
// xterm only loads once a Screen tab opens.
const ScreenXterm = lazy(() => import('./screen-xterm'))
type Copy = (what: string, text: string) => void

const Ic = ({ d }: { d: string }) => <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
const Chev = () => <svg className="cv-chev" viewBox="0 0 16 16" aria-hidden><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
const COPY = 'M5.5 5.5V3.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z'
const CLOSE = 'M4 4l8 8M12 4l-8 8'
const TONE_WORD: Record<Tone, string> = { ok: 'Passed', warn: 'Concerns', bad: 'Blocked', none: 'Reported' }

function Shot({ sessionId, path, demo }: { sessionId: string; path: string; demo?: HubState }) {
  const [src, setSrc] = useState<string | null>()
  useEffect(() => {
    let url: string | undefined, stop = false
    void (demo ? Promise.resolve(demoChat(demo, sessionId, 'shot', { path }).shot) : loadShot(sessionId, path)).then(s => {
      const blob = s?.startsWith('blob:')
      // Closed before it came back: nothing will show it, so free it now.
      if (stop) { if (blob) URL.revokeObjectURL(s!); return }
      if (blob) url = s
      setSrc(s ?? null)
    })
    return () => { stop = true; if (url) URL.revokeObjectURL(url) }
  }, [sessionId, path, demo])
  return (
    <figure className="cv-shot">
      {src ? <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={`Screenshot ${fileName(path)}`} loading="lazy" /></a>
        : <div className="cv-shot-ph">{src === null ? 'Could not load this image.' : 'Loading…'}</div>}
      <figcaption title={path}><bdi>{path}</bdi></figcaption>
    </figure>
  )
}

function Sec({ title, count, tone, open, children }: { title: string; count?: number | string; tone?: Tone; open?: boolean; children: ReactNode }) {
  return (
    <details className="cl-sec" open={open} data-tone={tone}>
      <summary><Chev /><span>{title}</span>{count !== undefined && <small>{count}</small>}</summary>
      <div className="cl-sec-b">{children}</div>
    </details>
  )
}

function Report({ r, copy }: { r: ChatReport; copy: Copy }) {
  const p = parseReport(r.text)
  return (
    <article className="cl-rep" data-tone={p.tone}>
      <header>
        <div className="cl-rep-t"><b>{r.label}</b>{r.role && <span className="cl-role">{r.role}</span>}</div>
        <span className="cl-status"><i aria-hidden />{p.status ? p.status[0].toUpperCase() + p.status.slice(1) : TONE_WORD[p.tone]}</span>
        <button type="button" className="cv-icon" aria-label={`Copy the report of ${r.label}`} title="Copy" onClick={() => copy('Report', r.text)}><Ic d={COPY} /></button>
      </header>
      {p.sections.map(s => (
        <section key={s.label} data-k={s.label.toLowerCase()}>
          <h4>{s.label}</h4>
          {s.items.length === 1 ? <p>{s.items[0]}</p> : <ul>{s.items.map((x, i) => <li key={i}>{x}</li>)}</ul>}
        </section>
      ))}
    </article>
  )
}

function Files({ files }: { files: string[] }) {
  return (
    <ul className="cl-files">{files.map(f => {
      const i = f.lastIndexOf('/')
      return <li key={f} title={f}><b>{f.slice(i + 1)}</b><bdi>{f.slice(0, i).replace(/^\/Users\/[^/]+\//, '~/')}</bdi></li>
    })}</ul>
  )
}

// Final message, standup and commit: what the chat said last.
function Closing({ o, copy }: { o: ChatOutputs; copy: Copy }) {
  return (
    <>
      {!trivial(o.final) && <Sec title="Final message" open><pre className="cv-pre">{o.final}</pre><button type="button" className="hub-btn cl-copy" aria-label="Copy the final message" onClick={() => copy('Final message', o.final!)}><Ic d={COPY} />Copy</button></Sec>}
      {o.standup && (o.standup.done.length > 0 || o.standup.left.length > 0) && (
        <Sec title="Standup" count={o.standup.done.length + o.standup.left.length} open>
          {([['Done', o.standup.done], ['Left', o.standup.left]] as const).filter(([, xs]) => xs.length).map(([k, xs]) => (
            <section key={k} className="cl-plain"><h4>{k}</h4><ul>{xs.map((x, i) => <li key={i}>{x}</li>)}</ul></section>
          ))}
        </Sec>
      )}
      {o.commit && <Sec title="Commit message"><pre className="cv-pre">{o.commit}</pre><button type="button" className="hub-btn cl-copy" aria-label="Copy the commit message" onClick={() => copy('Commit message', o.commit!)}><Ic d={COPY} />Copy</button></Sec>}
    </>
  )
}

function Short({ s }: { s: Story }) {
  // Only a problem gets a color and a dot; the rest stay neutral so Needs you leads.
  const chip = (tone: Tone, k: string, v: string) => <li data-tone={tone}><i aria-hidden /><span>{k}</span><b>{v}</b></li>
  return (
    <section className="cl-card" aria-labelledby="cl-short">
      <h3 id="cl-short">In short</h3>
      {s.needs.length > 0 && <div className="cl-needs">
        <b><i aria-hidden />Needs you</b>
        <ul>{s.needs.map(x => <li key={x}>{x}</li>)}</ul>
      </div>}
      <p className="cl-head">{s.headline}</p>
      <ul className="cl-chips" aria-label="Health">
        {s.tests.runs > 0 && chip(s.tests.tone, 'Tests', s.tests.failing ? `${s.tests.failing} of ${s.tests.runs} failing` : `${s.tests.runs} passing`)}
        {chip(s.errors ? 'bad' : 'ok', 'Errors', String(s.errors))}
        {chip('none', 'Files', String(s.files))}
        {s.questions.total > 0 && chip(s.questions.open ? 'warn' : 'ok', 'Questions', s.questions.open ? `${s.questions.open} still open` : 'all answered')}
      </ul>
      {!s.needs.length && <p className="cl-clear">Nothing needs you.</p>}
    </section>
  )
}

function Outputs({ o, sessionId, demo, copy }: { o: ChatOutputs; sessionId: string; demo?: HubState; copy: Copy }) {
  const any = o.final || o.standup || o.commit || o.reports.length || o.tests.length || o.errors.length || o.files.length || o.questions.length || o.shots.length
  if (!any) return <p className="cv-mute">Nothing to show yet: no final message, reports or files.</p>
  const s = chatStory(o)
  return (
    <div className="cl">
      {o.codex && <p className="cv-mute">A Codex chat: only what its progress kept.</p>}
      <Short s={s} />
      {o.reports.length > 0 && <div className="cl-grp"><h3>Reports <small>{o.reports.length}</small></h3>{o.reports.map(r => <Report key={r.id} r={r} copy={copy} />)}</div>}
      {o.tests.length > 0 && <Sec title="Tests" count={s.tests.failing ? `${s.tests.failing} failing` : 'all passing'} tone={s.tests.tone} open={s.tests.failing > 0}>
        <ul className="cl-tests">{[...o.tests].reverse().map((t, i) => (
          <li key={i} data-ok={t.ok || undefined}>
            <span className="cl-badge">{t.ok ? 'Pass' : 'Fail'}</span>
            <code>{t.command}</code>
            <small>{[t.total !== undefined && `${t.total} tests`, t.failed ? `${t.failed} failed` : undefined, t.first].filter(Boolean).join(' · ')}</small>
          </li>
        ))}</ul>
      </Sec>}
      {o.errors.length > 0 && <Sec title="Errors" count={o.errors.length} tone="bad" open>
        <ul className="cl-errs">{[...o.errors].reverse().map((e, i) => <li key={i}><span className="cl-badge">{e.tool}</span><pre>{e.text}</pre></li>)}</ul>
      </Sec>}
      {o.questions.length > 0 && <Sec title="Questions" count={s.questions.open ? `${s.questions.open} still open` : o.questions.length} tone={s.questions.open ? 'warn' : 'ok'} open={s.questions.open > 0}>
        <ul className="cl-qs">{o.questions.map((q, i) => (
          <li key={i} data-open={!q.answer || undefined}><b>{q.question}</b><p>{q.answer ?? 'No answer recorded'}</p></li>
        ))}</ul>
      </Sec>}
      {o.files.length > 0 && <Sec title="Files changed" count={o.files.length}><Files files={o.files} /></Sec>}
      {o.shots.length > 0 && <div className="cl-grp"><h3>Screenshots <small>{o.shots.length}</small></h3>
        <div className="cl-shots">{[...o.shots].reverse().map(p => <Shot key={p} sessionId={sessionId} path={p} demo={demo} />)}</div>
      </div>}
      <Closing o={o} copy={copy} />
    </div>
  )
}

// Runs of tool calls fold into one row so the transcript reads as messages.
function Messages({ messages, codex }: { messages: ChatMessage[]; codex?: boolean }) {
  const who = (r: ChatMessage['role']) => r === 'claude' ? (codex ? 'Codex' : 'Claude') : r === 'you' ? 'You' : 'Subagent'
  // Keyed by distance from the end: Load earlier prepends, so these stay put and an open row stays open.
  let left = messages.length
  return (
    <ol className="cl-msgs" aria-label="Messages, oldest first">
      {groupMessages(messages).map(g => { const i = left; left -= 'tools' in g ? g.tools.length : 1; return 'tools' in g ? (
        <li key={i} className="cl-tools"><details><summary><Chev />{g.tools.length} tool {g.tools.length === 1 ? 'call' : 'calls'}</summary>
          <ul>{g.tools.map((t, j) => <li key={j}><code>{t.text}</code></li>)}</ul></details></li>
      ) : (
        <li key={i} className="cl-msg" data-r={g.role}><span className="cl-who">{who(g.role)}</span><p>{g.text}</p></li>
      ) })}
    </ol>
  )
}

function Transcript({ sessionId, demo, body }: { sessionId: string; demo?: HubState; body: React.RefObject<HTMLDivElement | null> }) {
  const [t, setT] = useState<ChatTranscript | null | string>()
  const [busy, setBusy] = useState(false)
  // Kept so Load earlier holds the reader's place: the scroll height before the older page went in.
  const keep = useRef<number>(undefined)
  const read = (before?: number) => demo ? Promise.resolve(demoChat(demo, sessionId, 'transcript', { before }).transcript ?? null) : loadTranscript(sessionId, before)
  useEffect(() => { let stop = false; void read().then(r => { if (!stop) setT(r) }); return () => { stop = true } }, [sessionId, demo])
  useLayoutEffect(() => {
    const el = body.current
    if (!el || !t || typeof t === 'string') return
    el.scrollTop = keep.current === undefined ? el.scrollHeight : el.scrollHeight - keep.current
    keep.current = undefined
  }, [t, body])
  const earlier = async () => {
    if (!t || typeof t === 'string' || t.before === null) return
    setBusy(true)
    const r = await read(t.before)
    setBusy(false)
    if (!r || typeof r === 'string') return
    keep.current = (body.current?.scrollHeight ?? 0) - (body.current?.scrollTop ?? 0)
    setT({ ...t, messages: [...r.messages, ...t.messages], before: r.before })
  }
  if (t === undefined) return <p className="cv-mute" role="status">Reading the transcript…</p>
  if (t === null) return <p className="cv-mute">No transcript for this chat on this Mac.</p>
  if (typeof t === 'string') return <p className="cv-mute">Could not read the transcript: {t}</p>
  if (t.transcript === 'unsupported') return <p className="cv-mute">No Codex rollout for this chat on this Mac.</p>
  return (
    <div className="cv-tr">
      {t.before !== null ? <button type="button" className="hub-btn cv-earlier" disabled={busy} onClick={() => void earlier()}>{busy ? 'Loading…' : 'Load earlier'}</button>
        : <p className="cv-mute cv-start">Start of the chat</p>}
      <Messages messages={t.messages} codex={t.codex} />
    </div>
  )
}

// The phone look: the screen fit to the width. Follows the window, so a rotated or resized one switches.
function usePhone() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const q = matchMedia(PHONE_SCREEN), set = () => setOn(q.matches)
    set()
    q.addEventListener('change', set)
    return () => q.removeEventListener('change', set)
  }, [])
  return on
}

// Terminal: the screen drawn with its colors. Text: the same screen as wrapped plain text, easier to read in a
// narrow pane and the one screen readers get (it sits hidden under the terminal too). Kept per browser.
type Look = 'terminal' | 'text'
const LOOK_KEY = 'sb-screen-look'
const savedLook = (): Look => { try { return localStorage.getItem(LOOK_KEY) === 'text' ? 'text' : 'terminal' } catch { return 'terminal' } }

// The chat's terminal as the Mac sees it, polled while this tab is open. Keeps the last screen when a read fails.
function ScreenTab({ sessionId, demo, copy }: { sessionId: string; demo?: HubState; copy: (what: string, text: string) => void }) {
  const fit = usePhone()
  const [look, setLook] = useState<Look>(savedLook)
  const pickLook = (l: Look) => { setLook(l); try { localStorage.setItem(LOOK_KEY, l) } catch { /* private window: just this visit */ } }
  const [s, setS] = useState<Screen>()
  // Why the latest read gave no screen: null when the terminal is gone, else the reason.
  const [miss, setMiss] = useState<null | string>()
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string>()
  // The demo has no terminal: its typing lives here. kick restarts the poll so a key shows at once.
  const [said, setSaid] = useState(NO_TYPING)
  const saidNow = useRef(said)
  saidNow.current = said
  const [kick, setKick] = useState(0)
  useEffect(() => {
    const t0 = Date.now()
    return pollScreen({
      load: () => demo ? Promise.resolve(demoScreen(Math.floor((Date.now() - t0) / 1000), true, saidNow.current)) : loadScreen(sessionId),
      onScreen: r => { if (r && typeof r === 'object') { setS(r); setMiss(undefined) } else setMiss(r) },
      visible: () => document.visibilityState === 'visible',
    })
  }, [sessionId, demo, kick])
  const send = async (input: ScreenInput): Promise<boolean> => {
    setProblem(undefined)
    const why = demo ? undefined : await sendKeys(sessionId, input)
    if (why) { setProblem(why); return false }
    if (demo) setSaid(t => demoType(t, input))
    setKick(k => k + 1)
    return true
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (text) {
      if (!(await send({ text }))) return
      setText('')
    }
    await send({ key: 'enter' })
  }
  if (!s) {
    if (miss === undefined) return <p className="cv-mute" role="status">Reading the screen…</p>
    if (miss === null) return <p className="cv-mute">No terminal for this chat on this Mac. Chats started before their window loaded, ended chats and Codex chats have none.</p>
    return <p className="cv-mute" role="alert">Could not read the screen. {miss}</p>
  }
  const state = miss !== undefined ? 'gone' : s.running ? 'run' : 'idle'
  const label = miss === null ? 'Terminal closed. Last screen.' : miss ? `${miss} Last screen.` : s.running ? 'Running' : 'Nothing running'
  return (
    <div className="cv-scr" data-fit={fit || undefined} data-look={look}>
      <div className="cv-scr-h">
        <small role="status" data-s={state}><span className="cv-scr-dot" aria-hidden />{label}</small>
        <div role="group" aria-label="Show the screen as" className="cv-seg">
          {(['terminal', 'text'] as const).map(l => <button key={l} type="button" aria-pressed={look === l} onClick={() => pickLook(l)}>{l === 'terminal' ? 'Terminal' : 'Text'}</button>)}
        </div>
        <button type="button" className="hub-btn" aria-label="Copy the screen as text" onClick={() => copy('Screen', s.text)}><Ic d={COPY} />Copy</button>
      </div>
      {look === 'text'
        ? <pre className="cv-txt" tabIndex={0} aria-label="Terminal screen as text">{readable(s.text) || ' '}</pre>
        : <Suspense fallback={<p className="cv-mute cv-xt-wait" role="status">Drawing the terminal…</p>}><ScreenXterm screen={s} fit={fit} /></Suspense>}
      {state === 'gone' ? null
        : s.typing ? (
          <div className="cv-bar">
            <form className="cv-type" onSubmit={e => void submit(e)}>
              <input type="text" value={text} onChange={e => setText(e.target.value)} maxLength={2000} aria-label="Text to type into the chat" placeholder="Type to the chat"
                autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="send" />
              <button type="submit" className="hub-btn">Send</button>
            </form>
            <div className="cv-keys" role="group" aria-label="Keys">
              {(Object.keys(KEY_LABELS) as ScreenKey[]).map(k => <button key={k} type="button" className="hub-btn" aria-label={KEY_LABELS[k][1]} onClick={() => void send({ key: k })}>{KEY_LABELS[k][0]}</button>)}
            </div>
            {problem && <p className="cv-err-line" role="alert">{problem}</p>}
          </div>
        )
        : <p className="cv-mute cv-ro">{vscodeBridge?.isVSCode ? 'Read only here. Type in the chat\'s own terminal.' : s.running ? 'Typing from here is off. To turn it on, open VS Code settings on the Mac and tick Switchboard: Screen Typing.' : 'Nothing is running in this terminal, so there is nothing to type into.'}</p>}
    </div>
  )
}

export function ChatView({ sessionId, name, demo: demoNow, onClose, onCopy }: Props) {
  // The demo hub changes every tick; the view reads the one it opened with.
  const [demo] = useState(demoNow)
  const box = useRef<HTMLDialogElement>(null), body = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<Tab>(vscodeBridge?.isVSCode ? 'outputs' : 'screen')
  const [o, setO] = useState<ChatOutputs | null | string>()
  const [said, setSaid] = useFlash<string | undefined>(undefined, 1600)
  useDialog(box, d => d.querySelector<HTMLElement>('#cv-title')?.focus())
  useEffect(() => {
    let stop = false
    setO(undefined)
    void (demo ? Promise.resolve(demoChat(demo, sessionId, 'outputs').outputs ?? null) : loadOutputs(sessionId)).then(r => { if (!stop) setO(r) })
    return () => { stop = true }
  }, [sessionId, demo])
  const copy = async (what: string, text: string) => setSaid(await onCopy(text) ? `${what} copied` : 'The clipboard is not available here')
  // Screen comes first; the app opens on it, the VS Code panel (next to the real terminal) on Outputs.
  const tabs: Array<[Tab, string]> = [['screen', 'Screen'], ['outputs', 'Outputs'], ['transcript', 'Transcript']]
  const arrow = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const at = tabs.findIndex(([k]) => k === tab)
    const next = tabs[(at + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length][0]
    setTab(next)
    box.current?.querySelector<HTMLElement>(`#cv-tab-${next}`)?.focus()
  }
  return (
    <dialog ref={box} className="cv" aria-labelledby="cv-title"
      onCancel={e => { e.preventDefault(); onClose() }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cv-in">
        <div className="cv-h">
          <div><h2 id="cv-title" tabIndex={-1}>{name}</h2>{(tab !== 'screen' || vscodeBridge?.isVSCode) && <small>Read only</small>}</div>
          <button type="button" className="cv-icon cv-x" aria-label={`Close ${name}`} onClick={onClose}><Ic d={CLOSE} /></button>
        </div>
        <div role="tablist" aria-label="Chat view" className="cv-tabs" onKeyDown={arrow}>
          {tabs.map(([k, label]) => (
            <button key={k} type="button" role="tab" id={`cv-tab-${k}`} aria-selected={tab === k} aria-controls="cv-panel" tabIndex={tab === k ? 0 : -1} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        <div ref={body} className="cv-b" id="cv-panel" role="tabpanel" aria-labelledby={`cv-tab-${tab}`} tabIndex={0}>
          {tab === 'outputs'
            ? o === undefined ? <p className="cv-mute" role="status">Reading the chat…</p>
              : o === null ? <p className="cv-mute">No transcript for this chat on this Mac.</p>
              : typeof o === 'string' ? <p className="cv-mute">Could not read the chat: {o}</p>
              : <Outputs o={o} sessionId={sessionId} demo={demo} copy={(w, t) => void copy(w, t)} />
            : tab === 'screen' ? <ScreenTab sessionId={sessionId} demo={demo} copy={(w, t) => void copy(w, t)} />
            : <Transcript sessionId={sessionId} demo={demo} body={body} />}
        </div>
        <p className="cv-said" role="status">{said}</p>
      </div>
    </dialog>
  )
}
