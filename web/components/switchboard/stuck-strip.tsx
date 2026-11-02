'use client'
import { useState } from 'react'
import type { StuckItem } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { diagnosis, forHow, stuckTone, usage } from '@/lib/stuck'


/** Needs attention: one row per stuck item, with Stop process (two steps), Copy diagnosis, Jump to chat and Dismiss. */
export function StuckStrip({ stuck, name, send, onJump, onCopy }: { stuck?: StuckItem[]; name: (sessionId: string) => string; send: (c: HubCommand) => void; onJump: (sessionId: string) => void; onCopy: (text: string) => Promise<boolean> }) {
  const [confirm, setConfirm] = useState<string>()
  const [copied, setCopied] = useState<string>()
  if (!stuck?.length) return null
  const now = Date.now()
  return (
    <section className="hub-stuck" aria-label="Needs attention">
      <h2>Needs attention <span>{stuck.length}</span></h2>
      <ul role="list">
        {stuck.map(i => {
          const tone = stuckTone([i], i.sessionId)
          const meta = [`for ${forHow(i, now)}`, usage(i), i.pid && `pid ${i.pid}`].filter(Boolean).join(' · ')
          const copy = async () => { if (await onCopy(diagnosis(i, name(i.sessionId), now))) { setCopied(i.id); setTimeout(() => setCopied(c => (c === i.id ? undefined : c)), 1400) } }
          return (
            <li key={i.id} data-tone={tone}>
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
                  {i.pid && <button type="button" className="hub-btn sm" onClick={() => setConfirm(i.id)}>Stop process</button>}
                  <button type="button" className="hub-btn sm" aria-live="polite" onClick={() => void copy()}>{copied === i.id ? 'Copied' : 'Copy diagnosis'}</button>
                  <button type="button" className="hub-btn sm" onClick={() => onJump(i.sessionId)}>Jump to chat</button>
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
