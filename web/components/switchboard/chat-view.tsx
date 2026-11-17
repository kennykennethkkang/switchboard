'use client'
// The chat view: what one chat produced, and its transcript a page at a time. Read only.
// A modal dialog on the right, full screen on a phone; Esc or Close shuts it and focus goes back to what opened it.
import { useDialog } from '@/hooks/use-dialog'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useFlash } from '@/hooks/use-flash'
import { fileName, loadOutputs, loadShot, loadTranscript, type ChatMessage, type ChatOutputs, type ChatTranscript } from '@/lib/chat-view'
import { demoChat } from '@/lib/hub-demo'
import type { HubState } from '@/lib/hub-types'
import './chat-view.css'

type Props = { sessionId: string; name: string; demo?: HubState; onClose: () => void; onCopy: (text: string) => Promise<boolean> }
type Tab = 'outputs' | 'transcript'

const Ic = ({ d }: { d: string }) => <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
const COPY = 'M5.5 5.5V3.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z'
const CLOSE = 'M4 4l8 8M12 4l-8 8'
const ROLE: Record<ChatMessage['role'], string> = { you: 'You', claude: 'Claude', tool: 'Tool', subagent: 'Subagent' }

function Fold({ title, count, open, children }: { title: string; count?: number; open?: boolean; children: ReactNode }) {
  return (
    <details className="cv-fold" open={open}>
      <summary><svg className="cv-chev" viewBox="0 0 16 16" aria-hidden><path d="m6 3.5 4.5 4.5L6 12.5" /></svg><span>{title}</span>{count !== undefined && <small>{count}</small>}</summary>
      <div className="cv-fold-b">{children}</div>
    </details>
  )
}

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

function Outputs({ o, sessionId, demo, copy }: { o: ChatOutputs; sessionId: string; demo?: HubState; copy: (what: string, text: string) => void }) {
  const st = o.standup
  const any = o.final || st || o.commit || o.reports.length || o.tests.length || o.errors.length || o.files.length || o.questions.length || o.shots.length
  if (!any) return <p className="cv-mute">Nothing to show yet: no final message, reports or files.</p>
  return (
    <div className="cv-outs">
      {o.codex && <p className="cv-mute">A Codex chat: only what its progress kept.</p>}
      {o.final && <Fold title="Final message" open>
        <pre className="cv-pre">{o.final}</pre>
        <div className="cv-acts"><button type="button" className="hub-btn" aria-label="Copy the final message" onClick={() => copy('Final message', o.final!)}><Ic d={COPY} />Copy</button></div>
      </Fold>}
      {st && (st.done.length > 0 || st.left.length > 0) && <Fold title="Standup" count={st.done.length + st.left.length} open>
        <dl className="cv-rep">
          {([['Done', st.done], ['Left', st.left]] as const).filter(([, xs]) => xs.length).map(([k, xs]) => (
            <div key={k}><dt>{k}</dt><dd><ul>{xs.map((x, i) => <li key={i}>{x}</li>)}</ul></dd></div>
          ))}
        </dl>
      </Fold>}
      {o.commit && <Fold title="Commit message" open>
        <pre className="cv-pre">{o.commit}</pre>
        <div className="cv-acts"><button type="button" className="hub-btn" aria-label="Copy the commit message" onClick={() => copy('Commit message', o.commit!)}><Ic d={COPY} />Copy</button></div>
      </Fold>}
      {o.reports.length > 0 && <Fold title="Reports" count={o.reports.length} open>
        <ul className="cv-list">{o.reports.map(r => (
          <li key={r.id} className="cv-report">
            <div className="cv-report-h"><b>{r.label}</b>{r.role && <span className="cv-chip">{r.role}</span>}
              <button type="button" className="cv-icon" aria-label={`Copy the report of ${r.label}`} title="Copy" onClick={() => copy('Report', r.text)}><Ic d={COPY} /></button></div>
            <pre className="cv-pre">{r.text}</pre>
          </li>
        ))}</ul>
      </Fold>}
      {o.tests.length > 0 && <Fold title="Tests" count={o.tests.length}>
        <ul className="cv-list cv-tests">{[...o.tests].reverse().map((t, i) => (
          <li key={i} data-ok={t.ok || undefined}>
            <span className="cv-dot" aria-hidden /><span className="sr-only">{t.ok ? 'Passed: ' : 'Failed: '}</span>
            <code>{t.command}</code>
            <small>{[t.total !== undefined && `${t.total} tests`, t.failed ? `${t.failed} failed` : t.ok ? 'passed' : 'failed', t.first].filter(Boolean).join(' · ')}</small>
          </li>
        ))}</ul>
      </Fold>}
      {o.errors.length > 0 && <Fold title="Errors" count={o.errors.length}>
        <ul className="cv-list">{[...o.errors].reverse().map((e, i) => <li key={i} className="cv-err"><b>{e.tool}</b><pre>{e.text}</pre></li>)}</ul>
      </Fold>}
      {o.files.length > 0 && <Fold title="Files changed" count={o.files.length}>
        <ul className="cv-files">{o.files.map(f => <li key={f} title={f}><bdi>{f}</bdi></li>)}</ul>
      </Fold>}
      {o.questions.length > 0 && <Fold title="Questions" count={o.questions.length}>
        <dl className="cv-qs">{o.questions.map((q, i) => <div key={i}><dt>{q.question}</dt><dd>{q.answer ?? <span className="cv-mute">No answer recorded</span>}</dd></div>)}</dl>
      </Fold>}
      {o.shots.length > 0 && <Fold title="Screenshots" count={o.shots.length} open>
        <div className="cv-shots">{[...o.shots].reverse().map(p => <Shot key={p} sessionId={sessionId} path={p} demo={demo} />)}</div>
      </Fold>}
    </div>
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
      <ol className="cv-msgs" aria-label="Messages, oldest first">
        {t.messages.map((m, i) => (
          <li key={i} data-r={m.role}>
            {m.role !== 'tool' && <b>{m.role === 'claude' && t.codex ? 'Codex' : ROLE[m.role]}</b>}
            {m.role === 'tool' ? <code>{m.text}</code> : <p>{m.text}</p>}
          </li>
        ))}
      </ol>
    </div>
  )
}

export function ChatView({ sessionId, name, demo: demoNow, onClose, onCopy }: Props) {
  // The demo hub changes every tick; the view reads the one it opened with.
  const [demo] = useState(demoNow)
  const box = useRef<HTMLDialogElement>(null), body = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<Tab>('outputs')
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
  const tabs: Array<[Tab, string]> = [['outputs', 'Outputs'], ['transcript', 'Transcript']]
  const arrow = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = tab === 'outputs' ? 'transcript' : 'outputs'
    setTab(next)
    box.current?.querySelector<HTMLElement>(`#cv-tab-${next}`)?.focus()
  }
  return (
    <dialog ref={box} className="cv" aria-labelledby="cv-title"
      onCancel={e => { e.preventDefault(); onClose() }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cv-in">
        <div className="cv-h">
          <div><h2 id="cv-title" tabIndex={-1}>{name}</h2><small>Read only</small></div>
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
            : <Transcript sessionId={sessionId} demo={demo} body={body} />}
        </div>
        <p className="cv-said" role="status">{said}</p>
      </div>
    </dialog>
  )
}
