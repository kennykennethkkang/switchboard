'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useFlash } from '@/hooks/use-flash'
import type { Ask, Choice, DoneCheck, LearnReady, StuckItem } from '@/lib/hub-types'
import { CheckStamp } from './approve'
import type { HubCommand } from '@/lib/vscode-bridge'
import { diagnosis, forHow, stuckTone, usage } from '@/lib/stuck'

/** A chat waiting on you. ask: the terminal prompt, answered here when it is one plain pick. check: the done-check stamp, sent only for the closing question. */
export type NeedRow = { sessionId: string; question?: string; ask?: Ask; check?: DoneCheck; /** Why the extension would refuse an Approve now (approveBlock). */ block?: string }
/** A red check on the shown repo: failed CI or tests. */
export type FailRow = { sessionId: string; what: string; url?: string }

/** The buttons a row answers with in place: a permission's options, or a lone single-select question's; [] sends you to the chat. */
export const oneClick = (a?: Ask): string[] => !a ? [] : a.kind === 'permission' ? a.options
  : a.questions?.length === 1 && !a.questions[0].multiSelect ? a.questions[0].options : []

/**
 * Needs you: chats asking, stuck work and red checks in one strip. Every row answers in place or jumps to its chat. bare: no heading, the Now lane has its own.
 * tint: the chat's project color, a left rule on its row. diff: the changes under a Your OK row, rendered once its Changes fold opens; onDiff says which one is open.
 */
export function StuckStrip({ stuck = [], needs = [], fails = [], approvals = [], learning = [], approve, name, send, onJump, onCopy, onAnswer, bare, tint, diff, onDiff }: {
  stuck?: StuckItem[]; needs?: NeedRow[]; fails?: FailRow[]; /** Done chats waiting for approval, and their Approve bar. */ approvals?: string[]; approve?: (sessionId: string) => ReactNode; /** Self-improve wins waiting on Approve. */ learning?: LearnReady[]; name: (sessionId: string) => string; send: (c: HubCommand) => void
  onJump: (sessionId: string) => void; onCopy: (text: string) => Promise<boolean>; onAnswer: (sessionId: string, askId: string, choice: Choice) => void; bare?: boolean
  tint?: (sessionId: string) => string | undefined; diff?: (sessionId: string) => ReactNode; onDiff?: (sessionId?: string) => void
}) {
  const [confirm, setConfirm] = useState<string>()
  const [peek, setPeek] = useState<string>()
  const fold = (id: string, open: boolean) => { if (open === (peek === id)) return; const next = open ? id : undefined; setPeek(next); onDiff?.(next) }
  // Hand the shell's changes back to its chat when the open fold leaves: its row went, or the strip did.
  const last = useRef({ peek, onDiff })
  last.current = { peek, onDiff }
  useEffect(() => () => { if (last.current.peek) last.current.onDiff?.() }, [])
  useEffect(() => { if (peek && !approvals.includes(peek)) { setPeek(undefined); onDiff?.() } }, [peek, approvals, onDiff])
  const rule = (id: string) => { const c = tint?.(id); return c ? { borderLeftColor: c } as const : undefined }
  const [copied, setCopied] = useFlash<string | undefined>(undefined, 1400)
  const n = stuck.length + needs.length + fails.length + learning.length + (approve ? approvals.length : 0)
  if (!n) return null
  const now = Date.now()
  const jump = (id: string, label = 'Jump to chat') => <button type="button" className="hub-btn sm" aria-label={`${label}: ${name(id)}`} onClick={() => onJump(id)}>{label}</button>
  return (
    <section className="hub-stuck" aria-label="Needs you">
      {!bare && <h2>Needs you <span>{n}</span></h2>}
      <ul role="list">
        {needs.map(r => (
          <li key={`ask-${r.sessionId}`} data-tone="red" style={rule(r.sessionId)}>
            <i aria-hidden />
            <span className="hub-stuck-text">
              <span className="hub-stuck-who">{r.ask?.sub ? 'A subagent in ' : ''}<b>{name(r.sessionId)}</b> {r.ask?.kind === 'permission' ? 'asks to run' : 'asks'}</span>
              <span className="hub-stuck-q">{r.question || r.ask?.questions?.[0]?.question || r.ask?.tool || 'Waiting for you'}{(r.ask?.questions?.length ?? 0) > 1 && <span className="hub-stuck-meta"> · and {r.ask!.questions!.length - 1} more</span>}</span>
              <CheckStamp check={r.check} wrap />
              {r.block && oneClick(r.ask).includes('Approve') && <span className="hub-stuck-meta" role="status" style={{ color: 'var(--hub-red)' }}>Approve is held: {r.block}.</span>}
              {r.ask?.preview && <span className="hub-stuck-meta"><code>{r.ask.preview}</code></span>}
            </span>
            <span className="hub-stuck-acts">
              {oneClick(r.ask).map((o, i) => <button key={i} type="button" className="hub-btn sm hub-stuck-opt" disabled={o === 'Approve' && !!r.block} onClick={() => onAnswer(r.sessionId, r.ask!.id, [i])}>{o}</button>)}
              {jump(r.sessionId, oneClick(r.ask).length ? 'Other or open chat' : 'Answer')}
            </span>
          </li>
        ))}
        {approve && approvals.map(id => (
          <li key={`ok-${id}`} data-tone="yellow" style={rule(id)}>
            <i aria-hidden />
            <span className="hub-stuck-text">
              <span className="hub-stuck-who"><b>{name(id)}</b> finished</span>
              <span className="hub-stuck-q">Ready for your OK</span>
              {diff && <details className="hub-stuck-diff" open={peek === id} onToggle={e => fold(id, e.currentTarget.open)}>
                <summary aria-label={`Changes in ${name(id)}`}>Changes</summary>
                {peek === id && diff(id)}
              </details>}
            </span>
            <span className="hub-stuck-acts">{approve(id)}{jump(id, 'Open chat')}</span>
          </li>
        ))}
        {learning.map(l => (
          <li key={`learn-${l.id}`} data-tone="yellow">
            <i aria-hidden />
            <span className="hub-stuck-text">
              <span><b>Learning ready</b> · {l.target} · held-out {Math.round(l.before * 100)}% to {Math.round(l.after * 100)}%</span>
              <details className="hub-stuck-meta"><summary>Diff</summary><pre style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 320, overflow: 'auto' }}>{l.diff}</pre></details>
            </span>
            <span className="hub-stuck-acts">
              <button type="button" className="hub-btn primary sm" onClick={() => send({ type: 'hub-learn', id: l.id, ok: true })}>Approve</button>
              <button type="button" className="hub-btn sm" onClick={() => send({ type: 'hub-learn', id: l.id, ok: false })}>Discard</button>
            </span>
          </li>
        ))}
        {fails.map(f => (
          <li key={`fail-${f.what}`} data-tone="red" style={rule(f.sessionId)}>
            <i aria-hidden />
            <span className="hub-stuck-text"><span><b>{name(f.sessionId)}</b> · {f.what}</span></span>
            <span className="hub-stuck-acts">
              <button type="button" className="hub-btn sm" onClick={() => send({ type: 'hub-send', sessionId: f.sessionId, text: `${f.what}${f.url ? ` (${f.url})` : ''}. Find the cause and fix it.` })}>Send to chat</button>
              {f.url && <a className="hub-btn sm" href={f.url} target="_blank" rel="noreferrer">Open run</a>}
              {jump(f.sessionId)}
            </span>
          </li>
        ))}
        {stuck.map(i => {
          const tone = stuckTone([i], i.sessionId)
          const meta = [`for ${forHow(i, now)}`, usage(i), i.pid && `pid ${i.pid}`].filter(Boolean).join(' · ')
          const copy = async () => { if (await onCopy(diagnosis(i, name(i.sessionId), now))) setCopied(i.id) }
          return (
            <li key={i.id} data-tone={tone} style={rule(i.sessionId)}>
              <i aria-hidden />
              <span className="hub-stuck-text">
                <span><b>{name(i.sessionId)}</b> · {i.what}</span>
                <span className="hub-stuck-meta">{meta}{i.command && <> · <code>{i.command}</code></>}</span>
              </span>
              <span className="hub-stuck-acts">
                {confirm === i.id ? <>
                  <span role="alert" style={{ fontSize: 12 }}>Stop pid {i.pid} and what it started?</span>
                  <button type="button" className="hub-btn sm danger" onClick={() => { setConfirm(undefined); send({ type: 'hub-stuck-stop', sessionId: i.sessionId, id: i.id }) }}>Stop it</button>
                  <button type="button" className="hub-btn sm" onClick={() => setConfirm(undefined)}>Cancel</button>
                </> : <>
                  <button type="button" className="hub-btn sm" title={i.kind === 'agent' ? 'Tell the chat to check on this subagent' : i.pid ? 'Stop it and tell the chat to rerun it if needed' : 'Tell the chat to stop and rerun it'} onClick={() => send({ type: 'hub-stuck-fix', sessionId: i.sessionId, id: i.id })}>Fix</button>
                  {i.pid && <button type="button" className="hub-btn sm" onClick={() => setConfirm(i.id)}>Stop process</button>}
                  <button type="button" className="hub-btn sm" aria-live="polite" onClick={() => void copy()}>{copied === i.id ? 'Copied' : 'Copy diagnosis'}</button>
                  {jump(i.sessionId)}
                  <button type="button" className="hub-link" style={{ padding: '6px 4px', fontSize: 12 }} title="Hide it for 30 min" onClick={() => send({ type: 'hub-stuck-dismiss', sessionId: i.sessionId, id: i.id })}>Dismiss</button>
                </>}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
